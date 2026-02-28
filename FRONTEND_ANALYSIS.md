# 前端代码架构分析 & 优化计划

> 最后更新：2026-02-28

---

## 目录

- [一、全局数据](#一全局数据)
- [二、文件清单与行数](#二文件清单与行数)
- [三、核心问题分析](#三核心问题分析)
  - [3.1 过度抽象的连接层（5 层 Hook 嵌套）](#31-过度抽象的连接层5-层-hook-嵌套)
  - [3.2 "Shared" 名不副实 — 多处独立创建连接](#32-shared-名不副实--多处独立创建连接)
  - [3.3 WebRTCFileTransfer 组件是复杂度炸弹](#33-webrtcfiletransfer-组件是复杂度炸弹)
  - [3.4 到处重复的类型定义和验证逻辑](#34-到处重复的类型定义和验证逻辑)
  - [3.5 useTabNavigation 不应耦合连接管理](#35-usetabnavigation-不应耦合连接管理)
  - [3.6 其他问题汇总](#36-其他问题汇总)
- [四、优化计划](#四优化计划)
  - [Phase 1：消除重复、统一类型](#phase-1消除重复统一类型)
  - [Phase 2：扁平化 Hook 层](#phase-2扁平化-hook-层)
  - [Phase 3：拆分超级组件](#phase-3拆分超级组件)
  - [Phase 4：基础设施清理](#phase-4基础设施清理)
- [五、优化总览](#五优化总览)

---

## 一、全局数据

| 指标 | 数值 |
|------|------|
| 总行数 | **11,776 行** (69 个 .ts/.tsx 文件) |
| Hooks 文件 | **19 个**, ~3,500 行 |
| 组件文件 | **20 个**, ~5,500 行 |
| `console.log/warn/error` | **428 处** |
| `useEffect` 调用 | **75 处** |
| `setTimeout` / 延时等待 | **28 处** |
| `FileInfo` 接口重复定义 | **7 处** |

---

## 二、文件清单与行数

### 2.1 Hooks 层（19 个文件，~3,500 行）

#### Connection 模块（8 个文件，~1,640 行）

| 文件 | 行数 | 关键导出 | 职责 |
|------|------|----------|------|
| `hooks/connection/index.ts` | 5 | 4 个 re-export | 桶文件 |
| `hooks/connection/useWebRTCConnectionCore.ts` | **569** | `useWebRTCConnectionCore()` | **最大最复杂的 hook** — WebSocket 连接、PeerConnection 创建、信令消息处理(offer/answer/ICE/peer-joined/disconnection)、房间管理 |
| `hooks/connection/useWebRTCDataChannelManager.ts` | **355** | `useWebRTCDataChannelManager()` | 数据通道创建(sender/receiver 分支)、消息/二进制数据分发、通道注册 |
| `hooks/connection/useWebRTCTrackManager.ts` | 229 | `useWebRTCTrackManager()` | 媒体轨道添加/移除、createOffer、onTrack 轮询重试 |
| `hooks/connection/useWebRTCStateManager.ts` | 77 | `useWebRTCStateManager()` | 对 zustand store 的薄封装 |
| `hooks/connection/useSharedWebRTCManager.ts` | 118 | `useSharedWebRTCManager()` → `WebRTCConnection` | **门面模式** — 组合 4 个子 manager，暴露统一的 `WebRTCConnection` 接口 |
| `hooks/connection/useConnectionState.ts` | 137 | `useConnectionState()` | 连接错误展示/状态清理的 side-effect hook |
| `hooks/connection/useRoomConnection.ts` | 110 | `useRoomConnection()` | 房间验证逻辑(HTTP check + connect) |
| `hooks/connection/useWebRTCSupport.ts` | 40 | `useWebRTCSupport()` | WebRTC 浏览器兼容性检测 |

**复杂度观察：**

- `useWebRTCConnectionCore.ts` 是**整个代码库最复杂的文件（569 行）**。它在 `ws.onmessage` 中处理了 7 种信令消息类型，每种都有嵌套的 `if/else` 分支处理 sender/receiver 角色、reconnect 状态、PeerConnection 是否存在。特别是 `answer` 处理（约 L268-L350），有 3 层 `if/else` 嵌套 + 异常恢复逻辑。
- `useWebRTCDataChannelManager` 中 sender 和 receiver 的 `onerror` 处理器是**完全重复的代码**（各约 30 行相同的 `switch` 语句）。
- `useWebRTCTrackManager.onTrack` 中有**轮询重试机制**（50 次 × 每 100ms），是一种脆弱的模式。

#### File-Transfer 模块（4 个文件，~916 行）

| 文件 | 行数 | 关键导出 | 职责 |
|------|------|----------|------|
| `hooks/file-transfer/index.ts` | 4 | re-export | 桶文件 |
| `hooks/file-transfer/useFileTransferBusiness.ts` | **676** | `useFileTransferBusiness(connection)` | **第二大 hook** — 文件分块传输(256KB chunks)、CRC32 校验和、ACK 确认、重试(5 次指数退避)、流控、进度追踪 |
| `hooks/file-transfer/useFileStateManager.ts` | 171 | `useFileStateManager()` | 文件选择、文件列表维护、进度状态管理 |
| `hooks/file-transfer/useFileListSync.ts` | 65 | `useFileListSync()` | 防抖式文件列表同步 |

**复杂度观察：**

- `useFileTransferBusiness` 内含**自实现的 CRC32 校验算法**（`calculateChecksum`, `simpleChecksum`）和完整的**可靠传输协议**（ACK/重传/超时/流控），这本质上是在应用层重建了 TCP 的功能。
- `useFileStateManager` 有 3 个 `useEffect` 都在监听并同步文件列表，任何一个变化都可能触发链式更新，存在复杂的依赖关系。

#### Text-Transfer 模块（2 个文件，~177 行）

| 文件 | 行数 | 关键导出 |
|------|------|----------|
| `hooks/text-transfer/index.ts` | 2 | re-export |
| `hooks/text-transfer/useTextTransferBusiness.ts` | 175 | `useTextTransferBusiness(connection)` |

结构简洁。发送 `text-sync` 和 `text-typing` 消息。连接状态从 `connection` 参数同步。

#### Desktop-Share 模块（2 个文件，~545 行）

| 文件 | 行数 | 关键导出 |
|------|------|----------|
| `hooks/desktop-share/index.ts` | 2 | re-export |
| `hooks/desktop-share/useDesktopShareBusiness.ts` | **543** | `useDesktopShareBusiness()` |

**复杂度观察：**

- 与 file-transfer/text-transfer 不同，**桌面共享直接内部调用** `useSharedWebRTCManager()`，而非从外部接收一个 `connection` 参数。这导致了**不一致的依赖注入模式**。
- `setupVideoSending` 中有大量 `await new Promise(resolve => setTimeout(resolve, ...))` 等待连接稳定的代码（500ms + 2000ms），是一种脆弱的时序控制。

#### Settings 模块（3 个文件，~283 行）

| 文件 | 行数 | 关键导出 |
|------|------|----------|
| `hooks/settings/index.ts` | 3 | re-export |
| `hooks/settings/useIceServersConfig.ts` | 251 | `useIceServersConfig()`, `getIceServersConfig()` |
| `hooks/settings/useWebRTCConfigSync.ts` | 29 | `useWebRTCConfigSync()` |

`useIceServersConfig` 同时导出 hook（React 组件用）和独立函数 `getIceServersConfig()`（非组件代码用），设计合理。

#### UI 模块（5 个文件，~496 行）

| 文件 | 行数 | 关键导出 |
|------|------|----------|
| `hooks/ui/webRTCStore.ts` | 46 | `useWebRTCStore` (zustand) |
| `hooks/ui/useTabNavigation.ts` | 183 | `useTabNavigation()` |
| `hooks/ui/useURLHandler.ts` | 210 | `useURLHandler()` |
| `hooks/ui/useConfirmDialog.ts` | 52 | `useConfirmDialog()` |
| `hooks/ui/index.ts` | 5 | re-export |

**复杂度观察：**

- `useTabNavigation` **内部调用了** `useSharedWebRTCManager()` 和 `useURLHandler()` 和 `useConfirmDialog()`，使得一个 "UI Tab 导航" hook 深度耦合了 WebRTC 连接管理逻辑。
- `useURLHandler` 是泛型 hook，支持 `modeConverter` 进行模式映射（如 desktop share 的 `share/view` ↔ `send/receive`）。

---

### 2.2 组件层（20 个文件，~5,500 行）

#### 顶层业务组件

| 文件 | 行数 | 关键导出 | 职责 |
|------|------|----------|------|
| `components/WebRTCFileTransfer.tsx` | **658** | `WebRTCFileTransfer` | **最大的组件** — 文件传输页面容器，组合 7 个 hooks + 2 个子组件 |
| `components/WebRTCTextImageTransfer.tsx` | 104 | `WebRTCTextImageTransfer` | 文本传输页面容器，较简洁 |
| `components/DesktopShare.tsx` | 199 | `DesktopShare` (default) | 桌面共享页面容器，含 `useScreenShareSupport` 内部 hook |
| `components/WebRTCSettings.tsx` | 565 | `WebRTCSettings` (default) | ICE 服务器配置页（自包含，含 `AddServerModal` 内部组件） |

#### WebRTC 子组件（纯展示/交互层）

| 文件 | 行数 | 职责 |
|------|------|------|
| `components/webrtc/WebRTCFileUpload.tsx` | 357 | 发送方文件列表 UI（拖拽上传、文件展示、取件码展示） |
| `components/webrtc/WebRTCFileReceive.tsx` | 399 | 接收方取件码输入 + 文件下载列表 UI |
| `components/webrtc/WebRTCTextSender.tsx` | **465** | 文本发送方（**内含自己的连接管理逻辑**） |
| `components/webrtc/WebRTCTextReceiver.tsx` | **385** | 文本接收方（**内含自己的连接管理逻辑**） |
| `components/webrtc/WebRTCDesktopSender.tsx` | 325 | 桌面共享发送方 |
| `components/webrtc/WebRTCDesktopReceiver.tsx` | 370 | 桌面共享接收方（**含重复的房间验证逻辑**） |

**复杂度观察：**

- `WebRTCTextSender` 和 `WebRTCTextReceiver` **各自独立调用** `useSharedWebRTCManager()`，然后创建 `useTextTransferBusiness(connection)` 和 `useFileTransferBusiness(connection)`。这意味着**每个子组件都创建了自己的独立 WebRTC 连接实例**。
- `WebRTCDesktopReceiver` 中有两处几乎完全相同的房间验证逻辑（`handleJoinViewing` 和 `autoJoin` useEffect），代码重复约 ~80 行。
- `WebRTCFileReceive` 中也有独立的房间验证代码（`validatePickupCode`），与 `useRoomConnection` 中的 `checkRoomStatus` 功能重复。

#### 共享/展示组件

| 文件 | 行数 | 职责 |
|------|------|------|
| `components/ConnectionStatus.tsx` | 241 | 连接状态 UI（3 种模式：full/compact/inline） |
| `components/WebRTCConnectionStatus.tsx` | 185 | WebRTC 连接状态 UI + `WebRTCStatusIndicator` |
| `components/RoomInfoDisplay.tsx` | 123 | 取件码/QR 码展示通用组件 |
| `components/QRCodeDisplay.tsx` | 68 | QR 码 canvas 渲染 |
| `components/DesktopViewer.tsx` | **546** | 桌面视频播放器（全屏/统计/控制/鼠标隐藏） |
| `components/Hero.tsx` | 42 | 页面顶部标题/链接 |
| `components/RoomStatusDisplay.tsx` | 39 | 房间实时状态展示 |
| `components/WebRTCUnsupportedModal.tsx` | 186 | 浏览器不支持 WebRTC 弹窗 |
| `components/WeChatGroup.tsx` | 68 | 微信群二维码页 |

`ConnectionStatus` 和 `WebRTCConnectionStatus` 是**两个独立的连接状态组件**，功能高度重叠但接口不同：前者使用 zustand store，后者接受 `WebRTCConnection` prop。

---

### 2.3 页面层

| 文件 | 行数 | 职责 |
|------|------|------|
| `app/page.tsx` | 13 | 入口，渲染 `HomePageWrapper` |
| `app/HomePageWrapper.tsx` | 14 | Suspense 包装层 |
| `app/HomePage.tsx` | 206 | **主页面** — Tab 布局，渲染 5 个 Tab 内容 |
| `app/layout.tsx` | 40 | RootLayout + `ToastProvider` |
| `app/help/HelpPage.tsx` | 761 | 帮助页面 |

### 2.4 Types

`types/index.ts`（51 行）— 定义了 `FileInfo`, `TransferProgress`, `RoomStatus`, `FileChunk`, `WebSocketMessage`, `UseWebSocketReturn`。

**问题：** `FileInfo` 类型在此文件中定义了一次，但在 `WebRTCFileTransfer.tsx`、`WebRTCFileUpload.tsx`、`WebRTCFileReceive.tsx`、`useFileTransferBusiness.ts`、`useFileStateManager.ts`、`useFileListSync.ts` 中各自**重新定义了完全相同的 `FileInfo` 接口**（至少 7 处重复定义）。`UseWebSocketReturn` 类型实际没有被任何代码使用。

### 2.5 Lib 工具层

| 文件 | 行数 | 职责 |
|------|------|------|
| `lib/config.ts` | 150 | 环境配置、URL 构造（`getWsUrl`, `getBackendUrl` 等） |
| `lib/api-utils.ts` | 144 | 统一 fetch 封装（`apiFetch`, `apiGet`, `apiPost`...) |
| `lib/client-api.ts` | 119 | `ClientAPI` 类（OOP style API 封装） |
| `lib/webrtc-support.ts` | 162 | WebRTC 特性检测 + 浏览器信息 |
| `lib/utils.ts` | 6 | `cn()` — tailwind 合并工具 |
| `lib/static-config.ts` | 35 | 静态/动态页面路由定义 |

**问题：** `api-utils.ts` 和 `client-api.ts` 是**两套并行的 API 调用方案**。`ClientAPI` 是 class-based 封装，`apiFetch` 是函数式封装，功能完全重叠。实际代码中组件大多直接调用 `fetch()`，两个 utils 文件利用率低。

---

## 三、核心问题分析

### 3.1 过度抽象的连接层（5 层 Hook 嵌套）

从 UI 按钮点击到实际网络传输，需穿越 **5 层抽象**：

```
组件 (WebRTCFileTransfer)                      658 行
  └→ useFileTransferBusiness(connection)         676 行
      └→ useSharedWebRTCManager()                 118 行  ← 门面
          ├→ useWebRTCStateManager()                77 行  ← zustand 薄封装
          ├→ useWebRTCDataChannelManager()         355 行  ← DC 管理
          ├→ useWebRTCTrackManager()               229 行  ← 轨道管理
          └→ useWebRTCConnectionCore()             569 行  ← WS+信令+PC
```

`useWebRTCStateManager` 只是对 47 行的 zustand store 做了 `useCallback` 包装，**额外增加 77 行代码但零业务价值**。`useSharedWebRTCManager` 又对 4 个子 manager 做了一层门面包装。

**状态流动图：**

```
zustand Store (webRTCStore)
    ↑ 写入
useWebRTCStateManager
    ↑ 使用
useWebRTCConnectionCore / useWebRTCDataChannelManager
    ↑ 组合
useSharedWebRTCManager  →  返回 WebRTCConnection 对象
    ↑ 调用                              ↓ 传入
组件层                      useFileTransferBusiness(connection)
(WebRTCFileTransfer)       useTextTransferBusiness(connection)
    ↓ 使用                  useDesktopShareBusiness() ← 内部直接调用 Manager
useFileStateManager
useFileListSync
useConnectionState
useRoomConnection
useURLHandler
useTabNavigation
```

### 3.2 "Shared" 名不副实 — 多处独立创建连接

`useSharedWebRTCManager()` 在 **4 处被独立调用**，每次返回新实例：

| 调用位置 | 文件 | 行号 | 问题 |
|----------|------|------|------|
| 文件传输 | `WebRTCFileTransfer.tsx` | L37 | 文件传输的连接 |
| 文字发送 | `WebRTCTextSender.tsx` | L34 | **自己创建连接** |
| 文字接收 | `WebRTCTextReceiver.tsx` | L40 | **自己创建连接** |
| 桌面共享 | `useDesktopShareBusiness.ts` | L15 | 在 hook 内部直接调用 |

每个组件各自调用 `useSharedWebRTCManager()` → 各自创建独立的 PeerConnection 和 DataChannel。**"shared" 名不副实** —— hook 每次调用返回新实例。

而 `useDesktopShareBusiness` 是**第四种模式**：在 hook 内部自行调用 `useSharedWebRTCManager()`，与 file/text 模块的依赖注入模式不一致。

### 3.3 WebRTCFileTransfer 组件是复杂度炸弹

658 行的组件内：

- **使用 7 个 Hook**：`useSharedWebRTCManager`, `useFileTransferBusiness`, `useFileListSync`, `useFileStateManager`, `useRoomConnection`, `useURLHandler`, `useConnectionState`
- **9 个 `useEffect`**：多个 effect 监听重叠的状态（`isConnected`, `isConnecting`, `error`），一次状态变化触发多个 effect 连锁执行
- **与 `useConnectionState` 完全重复的错误处理**

`WebRTCFileTransfer.tsx` 第 316-368 行的错误处理 if/else 链：

```typescript
// 组件内的错误处理 (L316-L368)
if (error.includes('WebSocket')) {
  errorMessage = '服务器连接失败...';
} else if (error.includes('数据通道')) { ... }
```

与 `useConnectionState.ts` 第 46-64 行**完全相同**：

```typescript
// Hook 内的错误处理 (L46-L64) — 一模一样的 if/else
if (error.includes('WebSocket')) {
  errorMessage = '服务器连接失败...';
} else if (error.includes('数据通道')) { ... }
```

**结果：同一个错误被 Toast 弹出两次。**

**9 个 useEffect 明细：**

| # | 监听依赖 | 职责 | 问题 |
|---|---------|------|------|
| 1 | `onFileListReceived, mode` | 文件列表接收 | 正常 |
| 2 | `onFileReceived, updateFileStatus` | 文件接收完成 | 正常 |
| 3 | `onFileProgress, mode, isConnected, error` | 进度更新 | 正常 |
| 4 | `onFileRequested, mode, selectedFiles, ...` | 文件请求处理 | 正常 |
| 5 | `error, mode, showToast, lastError` | 错误处理 | ⚠️ 与 useConnectionState 重复 |
| 6 | `isWebSocketConnected, isConnected, isConnecting, ...` | 连接状态清理 | ⚠️ 与 useConnectionState 重复 |
| 7 | `isConnected, isPeerConnected, isConnecting, ...` | 日志输出 | ⚠️ 纯日志，可删除 |
| 8 | `connection.isPeerConnected, mode, syncFileListToReceiver` | P2P 建立时同步 | 正常 |
| 9 | `selectedFiles, mode, pickupCode` | 文件选择变化同步 | ⚠️ 与 useFileStateManager 部分重复 |

### 3.4 到处重复的类型定义和验证逻辑

**`FileInfo` 接口在 7 个文件中各自定义**，且字段不完全一致：

| 文件 | 行号 | 字段差异 |
|------|------|---------|
| `types/index.ts` | L2 | `export interface FileInfo` — **无 status/progress**，有 lastModified |
| `WebRTCFileTransfer.tsx` | L13 | `interface FileInfo` — **有 status/progress** |
| `WebRTCFileUpload.tsx` | L10 | `interface FileInfo` — 有 status/progress |
| `WebRTCFileReceive.tsx` | L10 | `interface FileInfo` — 有 status/progress |
| `useFileListSync.ts` | L3 | `interface FileInfo` — 有 status/progress |
| `useFileStateManager.ts` | L3 | `interface FileInfo` — 有 status/progress |
| `useFileTransferBusiness.ts` | L25 | `interface FileInfo` — 有 status/progress |

**房间验证逻辑至少有 4 处重复实现**：

| 位置 | 函数名 | 行数 |
|------|--------|------|
| `hooks/connection/useRoomConnection.ts` | `checkRoomStatus` + `joinRoom` | ~60 行 |
| `components/webrtc/WebRTCFileReceive.tsx` | `validatePickupCode` | ~40 行 |
| `components/webrtc/WebRTCTextReceiver.tsx` | `joinRoom` | ~50 行 |
| `components/webrtc/WebRTCDesktopReceiver.tsx` | `handleJoinViewing` + `autoJoin` | ~80 行 |

### 3.5 useTabNavigation 不应耦合连接管理

`useTabNavigation.ts` 是一个 **UI 导航 hook**，却 import 并调用了：
- `useSharedWebRTCManager()` — 获取 `disconnect` 方法
- `useWebRTCStore` — 直接读取连接状态
- `useURLHandler()` — URL 管理
- `useConfirmDialog()` — 确认弹窗

Tab 切换逻辑不应该知道 WebRTC 的存在，连接生命周期应由更上层管理。

### 3.6 其他问题汇总

| 问题 | 严重程度 | 详情 |
|------|---------|------|
| **428 条 console.log** 散布在生产代码 | 🟡 中 | 使用 emoji 前缀（如 🔧🚀📤），无级别控制，生产环境产生大量噪音 |
| **两个功能重叠的连接状态组件** | 🟡 中 | `ConnectionStatus`（241 行，使用 zustand）+ `WebRTCConnectionStatus`（185 行，使用 prop），426 行总计 |
| **两套 API 封装并存** | 🟡 中 | `api-utils.ts`（函数式）+ `client-api.ts`（class-based），263 行，但组件大多直接用 `fetch()` |
| **`types/index.ts` 中的死代码** | 🟢 低 | `UseWebSocketReturn` 等类型无人引用 |
| **28 处 `setTimeout` 作为同步机制** | 🟡 中 | 500ms/2000ms 硬编码等待连接稳定，在低性能设备上可能不够，在高性能设备上浪费时间 |
| **`useWebRTCTrackManager.onTrack` 轮询** | 🟢 低 | 50 次 × 100ms 轮询等待轨道就绪，应改为事件驱动 |
| **DataChannel `onerror` 处理重复** | 🟡 中 | sender 和 receiver 分支中约 30 行完全相同的 switch 语句 |

---

## 四、优化计划

### Phase 1：消除重复、统一类型

> 影响大，改动小。预估耗时：半天。

| 任务 | 预估时间 | 效果 |
|------|---------|------|
| 统一 `FileInfo`（含 status/progress）到 `types/index.ts`，删除 7 处重复定义 | 30min | **-60 行**，消除类型漂移 |
| 抽取 `validateRoom(code)` 通用函数，替代 4 处房间验证 | 30min | **-200 行** |
| 合并 `ConnectionStatus` + `WebRTCConnectionStatus` 为一个组件 | 1h | **-150 行** |
| 删除 `useConnectionState` hook，其逻辑已在组件中重复 | 15min | **-138 行**，修复双重 Toast |
| 删除 `api-utils.ts` 或 `client-api.ts`，统一为一套 | 30min | **-140 行** |

**Phase 1 预估净减少：~690 行**

---

### Phase 2：扁平化 Hook 层

> 核心改造，风险中等。预估耗时：1-2 天。

**目标：5 层 → 3 层**

```
当前 5 层:
  组件 → 业务Hook → SharedManager → SubManagers(4个) → Native API

目标 3 层:
  组件 → 业务Hook → useWebRTCConnection(合并) → Native API
```

**具体步骤：**

1. **删除 `useWebRTCStateManager`（77 行）**
   - 直接在 `useWebRTCConnectionCore` 中使用 `useWebRTCStore`
   - 一个 hook 包装另一个 hook 再包装 zustand store 毫无必要

2. **合并 `useSharedWebRTCManager` + `useWebRTCConnectionCore`**
   - `useSharedWebRTCManager` 只是 4 个子模块的胶水代码
   - 将其与 `useWebRTCConnectionCore` 合并为 `useWebRTCConnection`
   - 内联数据通道和轨道管理逻辑
   - 用清晰的函数分组而非文件拆分来组织代码

3. **统一连接注入模式**
   - 让 `useDesktopShareBusiness` 也改为接受 `connection` 参数
   - 与 file/text 保持一致

**改造后的目标结构：**

```
hooks/
  useWebRTCConnection.ts    ← 合并后的唯一连接 hook (~600行)
  useFileTransfer.ts         ← file-transfer 业务
  useTextTransfer.ts         ← text-transfer 业务
  useDesktopShare.ts         ← desktop 业务（接受 connection 参数）
  useIceServersConfig.ts     ← 保留
  webRTCStore.ts             ← 保留（直接使用，不再包装）
  useURLHandler.ts           ← 保留
  useTabNavigation.ts        ← 删除 WebRTC 依赖
  useConfirmDialog.ts        ← 保留
```

**预估净减少：~400 行 + 消除 2 层抽象**

---

### Phase 3：拆分超级组件

> 降低单文件复杂度。预估耗时：1 天。

**`WebRTCFileTransfer.tsx`（658 行）→ 拆分为：**

| 新文件 | 职责 | 预估行数 |
|--------|------|----------|
| `WebRTCFileTransfer.tsx` | 仅做 mode 切换 + 子组件渲染 | ~60 行 |
| `useSenderLogic.ts` | 房间创建 + 文件列表同步 | ~150 行 |
| `useReceiverLogic.ts` | 加入房间 + 下载管理 | ~120 行 |
| `useTransferEffects.ts` | 集中管理 useEffect | ~100 行 |

**9 个 `useEffect` 优化为 4 个：**

| 当前 | 优化后 |
|------|--------|
| `onFileListReceived` effect | → 合并到 `useTransferEffects` |
| `onFileReceived` effect | → 合并到 `useTransferEffects` |
| `onFileProgress` effect | → 合并到 `useTransferEffects` |
| `onFileRequested` effect | → 合并到 `useTransferEffects` |
| 错误处理 effect × 2 (重复) | → 删除 1 个，保留 1 个 |
| 连接日志 effect × 2 | → 删除（改用 logger 工具） |
| `selectedFiles` 同步 effect | → 保留，移入 `useSenderLogic` |

---

### Phase 4：基础设施清理

> 代码卫生。预估耗时：半天。

| 任务 | 效果 |
|------|------|
| 引入 `logger.ts` 工具（dev 输出 / prod 静默），替换 428 个 `console.log` | 清洁生产日志 |
| 把 `setTimeout` 同步替换为事件监听 Promise（监听 `connectionstatechange` / `datachannel.open`） | 消除脆弱时序 |
| `useTabNavigation` 改为通过回调通知父组件处理断连，不直接依赖 WebRTC | 关注点分离 |
| 清理 `types/index.ts` 中未使用的类型 | 减少死代码 |
| DataChannel `onerror` 提取为共享处理器 | -30 行重复 |

---

## 五、优化总览

| Phase | 目标 | 代码影响 | 难度 | 耗时 |
|-------|------|---------|------|------|
| **Phase 1** | 消除重复 | **-690 行** | ⭐ 低 | 半天 |
| **Phase 2** | 扁平化 Hook 层 5→3 | **-400 行** + 结构简化 | ⭐⭐⭐ 高 | 1-2 天 |
| **Phase 3** | 拆分超级组件 | 0（重组织） | ⭐⭐ 中 | 1 天 |
| **Phase 4** | 基础设施 | **-428 行** console.log | ⭐ 低 | 半天 |

**总预估**：
- 代码量：11,776 行 → ~10,000 行（减少 ~15%）
- 抽象层数：5 层 → 3 层
- useEffect：75 个 → ~50 个
- console.log：428 处 → 0（替换为 logger）
- FileInfo 定义：7 处 → 1 处
- 房间验证实现：4 处 → 1 处
