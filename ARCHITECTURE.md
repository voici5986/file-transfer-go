# 文件快传（Chuan）— 系统架构与技术设计文档

> 最后更新：2025-08-02

---

## 一、项目总览

**文件快传（Chuan）** 是一个基于 **WebRTC P2P** 的文件传输应用。核心设计理念：**所有实际数据（文件、文字、桌面画面）均通过 WebRTC 点对点直传，服务器仅承担信令中继和房间管理职责**。

### 技术栈

| 层级 | 技术选型 |
|------|---------|
| 后端 | Go 1.21 · chi/v5 路由 · gorilla/websocket |
| 前端 | Next.js 15 · React 19 · TypeScript · Tailwind CSS 4 |
| 状态管理 | Zustand 5 + React useState/useRef |
| UI 组件 | shadcn/ui (Radix UI) · Lucide Icons |
| P2P 通信 | WebRTC DataChannel（文件/文字）· MediaStream（桌面共享）|
| 部署 | 双模式：Next.js 开发模式 / Go 嵌入前端静态文件 |

### 核心特性

| 功能 | 实现方式 |
|------|---------|
| 文件传输 | WebRTC DataChannel · 256KB 分块 · CRC32 校验 · ACK 确认 |
| 文本消息 | WebRTC DataChannel · 实时双向同步 · 打字状态 |
| 桌面共享 | WebRTC MediaStream · getDisplayMedia · renegotiation |
| ICE 配置 | 默认 5 个 STUN · 支持自定义 STUN/TURN · localStorage 持久化 |

---

## 二、系统架构

### 2.1 整体架构图

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Go 后端 (:8080)                               │
│  ┌──────────────┐  ┌───────────────────┐  ┌─────────────────────┐  │
│  │  REST API     │  │  WebSocket 信令    │  │  静态文件服务        │  │
│  │  /api/*       │  │  /api/ws/webrtc   │  │  go:embed frontend  │  │
│  │               │  │  /ws/webrtc       │  │                     │  │
│  │ - create-room │  │                   │  │  SPA 回退 index.html │  │
│  │ - room-info   │  │  纯中继 转发消息   │  │                     │  │
│  └──────────────┘  └───────────────────┘  └─────────────────────┘  │
│                              │                                       │
│              ┌───────────────┼───────────────┐                       │
│              │   内存房间管理  (sync.RWMutex)  │                       │
│              │   map[string]*WebRTCRoom       │                       │
│              │   1小时过期 · 5分钟定时清理     │                       │
│              └───────────────────────────────┘                       │
└──────────────────────────────────────────────────────────────────────┘
        │ WebSocket                                    │ WebSocket
        │ (信令: offer/answer/ice-candidate)            │
        ▼                                              ▼
┌───────────────┐          WebRTC P2P          ┌───────────────┐
│  发送方浏览器   │ ◄══════════════════════════► │  接收方浏览器   │
│               │   DataChannel (文件/文字)      │               │
│  Next.js App  │   MediaStream (桌面共享)       │  Next.js App  │
└───────────────┘                              └───────────────┘
```

### 2.2 数据流向

```
1. 控制平面 (HTTP):  浏览器 ──── REST API ────→ Go 后端    (房间创建/查询)
2. 信令平面 (WS):    浏览器 ←──── WebSocket ──→ Go 后端    (SDP/ICE 交换)
3. 数据平面 (P2P):   浏览器 ◄═══ DataChannel ══► 浏览器     (文件/文字直传)
4. 媒体平面 (P2P):   浏览器 ◄═══ MediaStream ══► 浏览器     (桌面画面直传)
```

**关键设计：数据平面完全绕过服务器，文件和文字内容不经服务器中转。**

---

## 三、后端设计

### 3.1 目录结构

```
cmd/
├── main.go          # 入口：参数解析 → 配置 → 路由 → 启动服务器
├── config.go        # 配置管理：命令行 > 环境变量 > .chuan.env > 默认值
├── router.go        # chi 路由注册 + 中间件 + 前端静态服务
└── server.go        # HTTP Server 封装 + 优雅关闭 (SIGINT/SIGTERM)

internal/
├── handlers/
│   └── handlers.go  # HTTP/WebSocket 请求处理（薄层，委托给 service）
├── models/
│   └── models.go    # 数据模型：WebRTCRoom、WebRTCClient、RoomStatus
├── services/
│   └── webrtc_service.go  # 核心信令服务：房间管理 + WebSocket 消息转发
└── web/
    └── frontend.go  # go:embed 嵌入前端 + SPA 回退
```

### 3.2 API 端点

| 方法 | 路径 | 功能 | 请求/响应 |
|------|------|------|-----------|
| `POST` | `/api/create-room` | 创建房间 | `{}` → `{success, code, message}` |
| `GET` | `/api/room-info?code=XXX` | 查询房间状态 | → `{success, status: RoomStatus}` |
| `GET` | `/api/webrtc-room-status?code=XXX` | 同上（别名）| 同上 |
| `WS` | `/api/ws/webrtc?code=&role=` | WebRTC 信令 | WebSocket 双向 |
| `WS` | `/ws/webrtc?code=&role=` | 同上（兼容路径）| 同上 |
| `GET` | `/*` | 前端静态文件 | SPA 回退 |

### 3.3 房间管理

- **房间代码**：6 位，字符集 `123456789ABCDEFGHIJKLMNPQRSTUVWXYZ`（排除 0 和 O，避免混淆）
- **房间容量**：最多 2 人（1 sender + 1 receiver）
- **过期策略**：创建后 1 小时过期，每 5 分钟后台清理
- **存储方式**：纯内存 `map[string]*WebRTCRoom` + `sync.RWMutex`，无数据库

### 3.4 WebSocket 信令协议

#### 连接 URL
```
ws[s]://host/api/ws/webrtc?code=ROOM_CODE&role=sender|receiver&channel=shared
```

#### 服务端 → 客户端

| type | payload | 触发时机 |
|------|---------|---------|
| `peer-joined` | `{ role }` | 对方加入房间 |
| `disconnection` | `{ role, message }` | 对方断开连接 |
| `error` | `{ message }` | 房间不存在 / 已满 / 参数无效 |

#### 客户端 ↔ 客户端（经服务端纯转发）

| type | payload | 说明 |
|------|---------|------|
| `offer` | `RTCSessionDescription` | SDP Offer |
| `answer` | `RTCSessionDescription` | SDP Answer |
| `ice-candidate` | `RTCIceCandidate` | ICE 候选地址 |

**服务端对 offer/answer/ice-candidate 消息不做任何解析，仅中继转发给房间内另一方。**

---

## 四、前端设计（重点）

### 4.1 目录结构

```
chuan-next/src/
├── app/                            # Next.js App Router
│   ├── page.tsx                    # 入口页（SSG）
│   ├── layout.tsx                  # 根布局（字体、Toast、Umami 统计）
│   ├── globals.css                 # 全局样式 + 动画定义
│   ├── HomePage.tsx                # 主页面组件（Tab 管理 + WebRTC 状态）
│   ├── HomePageWrapper.tsx         # Suspense 包裹（SSR 兼容）
│   └── api/                        # Next.js API Routes（开发模式代理）
│       ├── create-room/route.ts    # → GO_BACKEND_URL/api/create-room
│       ├── room-info/route.ts      # → GO_BACKEND_URL/api/room-info
│       ├── room-status/route.ts    # → GO_BACKEND_URL/api/room-status
│       ├── create-text-room/route.ts
│       ├── get-text-content/route.ts
│       └── update-files/route.ts
│
├── components/                     # UI 组件
│   ├── WebRTCFileTransfer.tsx      # 文件传输整合组件（659行）
│   ├── WebRTCTextImageTransfer.tsx # 文字+图片传输整合组件
│   ├── DesktopShare.tsx            # 桌面共享整合组件
│   ├── Hero.tsx                    # 页头（标题、GitHub 链接）
│   ├── webrtc/                     # WebRTC 功能子组件
│   │   ├── WebRTCFileUpload.tsx    # 文件发送 UI
│   │   ├── WebRTCFileReceive.tsx   # 文件接收 UI
│   │   ├── WebRTCTextSender.tsx    # 文字发送 UI
│   │   ├── WebRTCTextReceiver.tsx  # 文字接收 UI
│   │   ├── WebRTCDesktopSender.tsx # 桌面共享发送 UI
│   │   ├── WebRTCDesktopReceiver.tsx # 桌面共享接收 UI
│   │   └── WebRTCSettings.tsx      # ICE 服务器配置 UI
│   └── ui/                         # 基础 UI 组件 (shadcn/ui)
│       ├── button.tsx              # 按钮（6种 variant）
│       ├── tabs.tsx                # 标签页（Radix Tabs）
│       ├── input.tsx               # 输入框
│       ├── card.tsx                # 卡片
│       ├── dialog.tsx              # 对话框
│       ├── progress.tsx            # 进度条
│       ├── textarea.tsx            # 文本域
│       ├── toast.tsx               # Toast (Radix)
│       ├── toast-simple.tsx        # 轻量 Toast (自定义)
│       ├── toaster.tsx             # Toast 渲染
│       └── confirm-dialog.tsx      # 确认对话框
│
├── hooks/                          # 自定义 Hooks（核心逻辑层）
│   ├── index.ts                    # 统一导出
│   ├── connection/                 # WebRTC 连接管理
│   │   ├── useSharedWebRTCManager.ts      # 整合入口
│   │   ├── useWebRTCConnectionCore.ts     # 核心连接（WS + PeerConnection）
│   │   ├── useWebRTCDataChannelManager.ts # DataChannel 管理 + 消息路由
│   │   ├── useWebRTCTrackManager.ts       # MediaStream 轨道管理
│   │   ├── useWebRTCStateManager.ts       # Zustand store 封装
│   │   ├── useRoomConnection.ts           # 加入房间逻辑
│   │   ├── useConnectionState.ts          # 连接状态变化处理
│   │   └── useWebRTCSupport.ts            # 浏览器 WebRTC 检测
│   ├── file-transfer/              # 文件传输业务
│   │   ├── useFileTransferBusiness.ts     # 核心：分块传输 + CRC32 + ACK
│   │   ├── useFileListSync.ts             # 文件列表实时同步
│   │   └── useFileStateManager.ts         # 文件状态（选中/下载/进度）
│   ├── text-transfer/              # 文字传输业务
│   │   └── useTextTransferBusiness.ts     # 实时文字同步 + 打字状态
│   ├── desktop-share/              # 桌面共享业务
│   │   └── useDesktopShareBusiness.ts     # getDisplayMedia + 轨道管理
│   ├── settings/                   # 设置
│   │   ├── useIceServersConfig.ts         # ICE 服务器配置 + localStorage
│   │   └── useWebRTCConfigSync.ts         # 配置变更监听
│   └── ui/                         # UI 相关
│       ├── webRTCStore.ts                 # Zustand 全局状态
│       ├── useURLHandler.ts               # URL 参数管理
│       ├── useTabNavigation.ts            # Tab 切换管理
│       └── useConfirmDialog.ts            # 确认对话框 Hook
│
├── lib/                            # 工具库
│   ├── config.ts                   # 环境配置（API URL / WS URL 动态计算）
│   ├── utils.ts                    # cn() 样式合并
│   ├── client-api.ts               # ClientAPI 封装
│   ├── api-utils.ts                # apiFetch() 统一请求
│   └── webrtc-support.ts           # WebRTC 支持检测
│
└── types/
    └── index.ts                    # 全局类型定义
```

### 4.2 组件层次结构

```
RootLayout (layout.tsx)
  └─ ToastProvider (toast-simple.tsx)
       └─ HomePageWrapper (Suspense)
            └─ HomePage
                 ├─ Hero                           # 页头
                 ├─ WebRTCUnsupportedModal          # WebRTC 不支持提示
                 ├─ ConfirmDialog                   # Tab 切换确认
                 └─ Tabs (5个标签)
                      │
                      ├─ [Tab: webrtc] WebRTCFileTransfer
                      │    ├─ 模式切换 (发送/接收)
                      │    ├─ [发送模式] WebRTCFileUpload
                      │    │    ├─ 拖拽上传区域 / 文件列表
                      │    │    ├─ RoomInfoDisplay (取件码 + 二维码 + 复制)
                      │    │    ├─ ConnectionStatus (连接状态)
                      │    │    └─ 传输进度条
                      │    └─ [接收模式] WebRTCFileReceive
                      │         ├─ 取件码输入 (6位)
                      │         ├─ ConnectionStatus (连接状态)
                      │         └─ 文件列表 + 下载按钮
                      │
                      ├─ [Tab: message] WebRTCTextImageTransfer
                      │    ├─ 模式切换 (发送/接收)
                      │    ├─ [发送模式] WebRTCTextSender
                      │    │    ├─ Textarea 编辑器
                      │    │    ├─ 图片发送按钮
                      │    │    └─ RoomInfoDisplay
                      │    └─ [接收模式] WebRTCTextReceiver
                      │         ├─ 取件码输入
                      │         └─ 实时文字显示 + 图片接收
                      │
                      ├─ [Tab: desktop] DesktopShare
                      │    ├─ 模式切换 (共享/查看)
                      │    ├─ [共享模式] WebRTCDesktopSender
                      │    │    └─ 选择屏幕 → 开始共享
                      │    └─ [查看模式] WebRTCDesktopReceiver
                      │         └─ DesktopViewer (video 标签)
                      │
                      ├─ [Tab: wechat] WeChatGroup
                      │    └─ 微信群二维码
                      │
                      └─ [Tab: settings] WebRTCSettings
                           └─ ICE 服务器配置表单
```

### 4.3 Hooks 架构（核心设计）

前端逻辑层采用 **分层 Hooks 架构**，自底向上组合：

```
                    ┌─────────────────────────────┐
                    │    Zustand Store             │  ← 最底层：全局状态
                    │    (webRTCStore.ts)           │
                    │    isConnected, isConnecting  │
                    │    currentRoom, error         │
                    └──────────────┬──────────────┘
                                   │
            ┌──────────────────────┼──────────────────────┐
            │                      │                      │
   ┌────────▼────────┐  ┌─────────▼──────────┐  ┌───────▼─────────┐
   │ StateManager     │  │ DataChannelManager  │  │ TrackManager     │
   │ (Zustand 封装)    │  │ (消息路由 + 收发)    │  │ (媒体轨道管理)    │
   └────────┬────────┘  └─────────┬──────────┘  └───────┬─────────┘
            │                      │                      │
            └──────────────────────┼──────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ ConnectionCore               │  ← WebSocket + PeerConnection
                    │ (useWebRTCConnectionCore)     │     信令处理 + ICE 交换
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ SharedWebRTCManager          │  ← 整合入口（4合1）
                    │ (useSharedWebRTCManager)      │     返回统一 WebRTCConnection
                    └──────────────┬──────────────┘
                                   │
          ┌────────────────────────┼────────────────────────┐
          │                        │                        │
 ┌────────▼────────┐   ┌──────────▼──────────┐   ┌────────▼────────┐
 │ FileTransfer     │   │ TextTransfer         │   │ DesktopShare     │
 │ Business         │   │ Business             │   │ Business         │
 │ (文件分块+校验)    │   │ (实时同步文字)         │   │ (屏幕采集+推流)    │
 └────────┬────────┘   └──────────┬──────────┘   └────────┬────────┘
          │                        │                        │
          └────────────────────────┼────────────────────────┘
                                   │
                    ┌──────────────▼──────────────┐
                    │ 业务级组件 (TSX)              │
                    │ WebRTCFileTransfer.tsx 等     │
                    └─────────────────────────────┘
```

#### 4.3.1 连接层 — `useWebRTCConnectionCore`

**职责**：管理 WebSocket 信令连接 + RTCPeerConnection 生命周期。

```
connect(code, role)
    │
    ├─ 1. WebSocket 连接到 ws://host/api/ws/webrtc?code=XXX&role=YYY
    │
    ├─ 2. 收到 "peer-joined" → 创建 RTCPeerConnection
    │      └─ ICE 服务器从 getIceServersConfig() 获取
    │
    ├─ 3. Sender 创建 DataChannel → 创建 Offer
    │      Receiver 等待 ondatachannel
    │
    ├─ 4. offer/answer/ice-candidate 通过 WebSocket 交换
    │
    ├─ 5. ICE 连接建立 → DataChannel open → 连接完成
    │
    └─ 6. 断开时：发送 disconnection → 清理 PeerConnection
```

#### 4.3.2 数据通道层 — `useWebRTCDataChannelManager`

**职责**：管理 DataChannel 消息的路由分发。

**核心设计：多 channel 路由**

所有 JSON 消息通过 `channel` 字段路由到不同的业务处理器：

```typescript
// 消息格式
{
  channel: "file-transfer" | "text-transfer" | "desktop-share",
  type: "具体消息类型",
  payload: { ... }
}
```

```
DataChannel.onmessage
    │
    ├─ typeof data === 'string' → JSON.parse
    │   ├─ channel === 'file-transfer' → fileTransferHandler
    │   ├─ channel === 'text-transfer' → textTransferHandler
    │   └─ channel === 'desktop-share' → desktopShareHandler
    │
    └─ typeof data === ArrayBuffer → 二进制数据
        └─ 优先路由到 'file-transfer' handler（文件块数据）
```

**注意**：三个功能（文件/文字/桌面）共享同一个 DataChannel（`shared-channel`），而非各自创建独立通道。

#### 4.3.3 轨道管理层 — `useWebRTCTrackManager`

**职责**：管理 MediaStream 轨道（仅桌面共享使用）。

- `addTrack(track, stream)` — 添加视频/音频轨道
- `removeTrack(sender)` — 移除轨道
- `createOfferNow()` — 添加轨道后触发重协商
- `onTrack` 回调 — 接收远程媒体流

### 4.4 状态管理设计

采用 **三层状态模型**：

| 层级 | 技术 | 用途 | 示例 |
|------|------|------|------|
| 全局共享状态 | Zustand | WebRTC 连接状态 | `isConnected`, `currentRoom`, `error` |
| 组件级状态 | React useState | UI 交互状态 | `selectedFiles`, `mode`, `progress` |
| 引用状态 | React useRef | 回调/缓冲区/定时器 | `receiveBufferRef`, `messageHandlers`, 防抖 timer |

#### Zustand Store 结构

```typescript
interface WebRTCState {
  // 连接状态
  isConnected: boolean;       // 总体连接状态
  isConnecting: boolean;      // 正在连接中
  isWebSocketConnected: boolean;  // WebSocket 层连接
  isPeerConnected: boolean;   // PeerConnection 层连接

  // 错误状态
  error: string | null;
  canRetry: boolean;

  // 房间信息
  currentRoom: { code: string; role: 'sender' | 'receiver' } | null;

  // Actions
  updateState(partial: Partial<WebRTCState>): void;
  setCurrentRoom(room: { code: string; role: string } | null): void;
  resetToInitial(): void;
}
```

### 4.5 文件传输详细设计

#### 4.5.1 DataChannel 消息协议

**file-transfer channel 消息类型：**

| 方向 | type | payload | 说明 |
|------|------|---------|------|
| S→R | `file-list` | `FileInfo[]` | 发送方文件列表（实时同步） |
| R→S | `file-request` | `{ fileId, fileName }` | 接收方请求下载 |
| S→R | `file-metadata` | `{ id, name, size, type }` | 文件元信息 |
| S→R | `file-chunk-info` | `{ fileId, chunkIndex, totalChunks, checksum }` | 块元信息（含 CRC32） |
| S→R | *(二进制)* | `ArrayBuffer` (≤256KB) | 文件块数据 |
| R→S | `file-chunk-ack` | `{ fileId, chunkIndex, success, checksum }` | 块确认（含校验结果） |
| S→R | `file-complete` | `{ fileId }` | 文件传输完成 |

#### 4.5.2 传输参数

| 参数 | 值 | 说明 |
|------|-----|------|
| 块大小 | 256 KB | 每个 chunk 的最大字节数 |
| 最大重试 | 5 次 | 单个 chunk 校验失败后的重试上限 |
| 退避策略 | 指数退避 | 重试间隔指数增长 |
| 校验算法 | CRC32 | 每个 chunk 独立校验 |
| 流控 | 自适应 | 根据平均传输速度动态调整发送间隔 |
| DataChannel 配置 | `ordered: true, maxRetransmits: 3` | 有序可靠传输 |

#### 4.5.3 完整传输时序

```
发送方                              信令服务器                           接收方
  │                                     │                                 │
  │  1. POST /api/create-room           │                                 │
  │ ──────────────────────────────────► │                                 │
  │ ◄── {success: true, code: "AB12CD"} │                                 │
  │                                     │                                 │
  │  2. WS connect (role=sender)        │                                 │
  │ ═══════════════════════════════════► │                                 │
  │                                     │                                 │
  │                                     │  3. GET /api/room-info?code=... │
  │                                     │ ◄────────────────────────────── │
  │                                     │ ── {success, status} ─────────► │
  │                                     │                                 │
  │                                     │  4. WS connect (role=receiver)  │
  │                                     │ ◄═══════════════════════════════ │
  │                                     │                                 │
  │  5. ◄── peer-joined ──             │  ── peer-joined ──►             │
  │                                     │                                 │
  │  6. 创建 PeerConnection + DataChannel                                 │
  │  7. 创建 SDP Offer                                                    │
  │  ═══ offer ═══════════════════════► │ ═══ offer ═══════════════════► │
  │                                     │                                 │
  │                                     │  8. 创建 PeerConnection         │
  │                                     │  9. 设置 Remote/Local SDP       │
  │  ◄═══ answer ══════════════════════ │ ◄═══ answer ═════════════════ │
  │                                     │                                 │
  │  10. ICE Candidate 交换 ◄═══════════╋══════════════════════════════► │
  │                                     │                                 │
  │  ══════════ DataChannel OPEN ═══════╪══════════════════════════════ │
  │                                     │                                 │
  │  11. file-list ─────────────────────┼────────────────────────────────► │
  │      [{id, name, size, type}, ...]  │                                 │
  │                                     │                                 │
  │  ◄─────────────────────────────────┼──── 12. file-request ────────── │
  │      {fileId, fileName}             │                                 │
  │                                     │                                 │
  │  13. file-metadata ────────────────┼────────────────────────────────► │
  │      {id, name, size, type}         │                                 │
  │                                     │                                 │
  │  ╔══ 循环每个 chunk ═══════════════╪════════════════════════════════╗ │
  │  ║  14. file-chunk-info ───────────┼──────────────────────────────► ║ │
  │  ║      {fileId, chunkIndex,        │                              ║ │
  │  ║       totalChunks, checksum}     │                              ║ │
  │  ║                                  │                              ║ │
  │  ║  15. [ArrayBuffer 256KB] ───────┼──────────────────────────────► ║ │
  │  ║                                  │                              ║ │
  │  ║  ◄───────────────────────────────┼── 16. file-chunk-ack ─────── ║ │
  │  ║      {fileId, chunkIndex,        │      success, checksum}      ║ │
  │  ║                                  │                              ║ │
  │  ║  [如果 success=false, 指数退避重试，最多5次]                      ║ │
  │  ╚══════════════════════════════════╪══════════════════════════════╝ │
  │                                     │                                 │
  │  17. file-complete ────────────────┼────────────────────────────────► │
  │      {fileId}                       │                                 │
  │                                     │                   18. 组装 Blob  │
  │                                     │                       → File   │
  │                                     │                       → 下载    │
```

#### 4.5.4 文件列表同步机制

发送方选择文件后，文件列表会 **实时同步** 到接收方：

```
发送方文件变更 → useFileListSync hook
    │
    ├─ 150ms 防抖（debounce）
    │
    ├─ 比对新旧文件列表（避免无变更的冗余同步）
    │
    └─ 通过 DataChannel 发送 file-list 消息
        │
        └─ 接收方更新 UI 展示文件列表
```

### 4.6 文字传输详细设计

#### 4.6.1 DataChannel 消息协议

**text-transfer channel 消息类型：**

| 方向 | type | payload | 说明 |
|------|------|---------|------|
| S→R | `text-sync` | `{ text: string }` | 实时文本内容同步 |
| 双向 | `text-typing` | `{ typing: boolean }` | 打字状态指示 |

#### 4.6.2 实时同步机制

```
发送方 Textarea 输入
    │
    ├─ onChange → handleTextInputChange()
    │
    ├─ 调用 textTransfer.sendTextSync(text)
    │   └─ DataChannel 发送 { channel: "text-transfer", type: "text-sync", payload: { text } }
    │
    ├─ 同时发送 text-typing: { typing: true }
    │   └─ 1秒后自动发送 text-typing: { typing: false }
    │
    └─ 接收方
        ├─ onTextSync 回调 → 更新显示文本
        └─ onTyping 回调 → 显示 "对方正在输入..." 动画
```

**图片传输**：复用文件传输的 `file-transfer` channel，图片作为文件发送。

### 4.7 桌面共享详细设计

```
发送方
    │
    ├─ navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
    │
    ├─ 获取 MediaStream → 提取 video/audio Track
    │
    ├─ trackManager.addTrack(track, stream)
    │   └─ peerConnection.addTrack()
    │
    ├─ trackManager.createOfferNow()  ← 触发 SDP 重协商
    │   └─ 新 Offer → WebSocket → 对方 → Answer → WebSocket → 本方
    │
    └─ 接收方
        ├─ ontrack 事件 → 获取远程 MediaStream
        └─ <video> 元素播放 → DesktopViewer 组件
```

### 4.8 ICE 配置设计

#### 默认 STUN 服务器

```typescript
const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.easyvoip.com:3478' },
  { urls: 'stun:stun.miwifi.com:3478' },
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:global.stun.twilio.com:3478' },
];
```

#### 用户自定义

- 通过 WebRTCSettings 界面添加 STUN/TURN 服务器
- 配置持久化到 `localStorage`（key: `webrtc-ice-config`）
- `getIceServersConfig()` 导出给非 React 代码使用
- 配置变更后提示用户断开重连

### 4.9 环境适配设计

```
                    ┌─────────────────────────────────────────┐
                    │           config.ts 环境判断              │
                    │                                         │
                    │  isStaticMode = Next.js 构建输出判断      │
                    │  isDev = NODE_ENV === 'development'      │
                    └────────────────┬────────────────────────┘
                                     │
                   ┌─────────────────┼─────────────────┐
                   │                 │                 │
          ┌────────▼────────┐ ┌─────▼──────┐ ┌───────▼───────┐
          │ 开发模式          │ │ SSG 静态模式 │ │ 嵌入 Go 模式   │
          │ (yarn dev)       │ │ (build:ssg) │ │ (go run)      │
          │                  │ │             │ │               │
          │ API:             │ │ API:        │ │ API:          │
          │ /api/* → Next.js │ │ 直连 Go     │ │ 同源 /api/*   │
          │ API Route 代理   │ │ 后端地址     │ │               │
          │                  │ │             │ │               │
          │ WS:              │ │ WS:         │ │ WS:           │
          │ ws://localhost   │ │ 当前域名     │ │ 当前域名       │
          │ :8080/...        │ │ ws[s]://    │ │ ws[s]://      │
          └──────────────────┘ └─────────────┘ └───────────────┘
```

#### URL 动态计算逻辑

```typescript
// API URL
getApiUrl() → 
  开发模式 ? '/api'  (通过 Next.js API Route 代理到 GO_BACKEND_URL)
  静态模式 ? getDirectBackendUrl() + '/api'  (直连 Go 后端)

// WebSocket URL
getWsUrl() →
  开发模式 ? 'ws://localhost:8080'  (直连 Go 后端 WS)
  静态模式 ? 'ws[s]://' + window.location.host  (同源)
```

### 4.10 URL 路由设计

前端通过 URL 参数控制功能和模式：

```
/?type=webrtc&mode=send            → 文件传输-发送模式
/?type=webrtc&mode=receive         → 文件传输-接收模式
/?type=webrtc&mode=receive&code=ABC123  → 自动填入取件码
/?type=message&mode=send           → 文字消息-发送模式
/?type=desktop&mode=send           → 桌面共享-共享模式
```

**URL 参数映射**：
- `type`: `webrtc` | `message` | `desktop` | `wechat` | `settings` → 对应 Tab
- `mode`: `send` | `receive` → 发送/接收子模式
- `code`: 6 位取件码 → 自动填入并可自动加入房间

---

## 五、关键设计决策

### 5.1 为什么用纯 P2P？

- **隐私**：文件内容不经服务器，用户数据零留存
- **成本**：服务器仅做信令，带宽成本极低
- **性能**：局域网环境下可接近网卡极限速度

### 5.2 为什么共享单个 DataChannel？

三个功能（文件/文字/桌面控制）共享同一个 `shared-channel`，通过 JSON `channel` 字段路由：

- **简化连接管理**：只需建立一次 P2P 连接
- **减少信令开销**：无需为每个功能单独协商
- **统一状态管理**：连接/断开状态全局一致

### 5.3 为什么用 CRC32 + ACK？

WebRTC DataChannel 本身基于 SCTP（配置为 `ordered: true, maxRetransmits: 3`），已有一定可靠性。额外的 CRC32 + ACK 是 **应用层二次保障**：

- 防止极端情况下 SCTP 重传仍失败后的数据损坏
- 提供块级粒度的错误恢复（只重传失败的块，无需从头开始）
- 接收方独立验证数据完整性

### 5.4 为什么 256KB 块大小？

- WebRTC DataChannel 最大消息大小约 256KB（不同浏览器有差异）
- 小块有利于进度反馈的精度
- 小块降低单次重传的代价

### 5.5 为什么关闭 React Strict Mode？

```typescript
// next.config.ts
reactStrictMode: false
```

React 18+ Strict Mode 会在开发环境 **双重调用** effect，导致：
- WebSocket 连接被创建两次
- PeerConnection 生命周期混乱
- DataChannel 状态不一致

---

## 六、部署模式

### 模式一：开发模式

```bash
# 终端 1：Go 后端
go run cmd/main.go          # :8080

# 终端 2：Next.js 前端
cd chuan-next && yarn dev   # :3000 (turbopack)
```

前端 API 调用链：`浏览器 → localhost:3000/api/* → Next.js API Route → localhost:8080/api/*`

### 模式二：生产模式（Go 嵌入前端）

```bash
cd chuan-next && yarn build:ssg    # 输出到 out/
cp -r out/ ../internal/web/frontend/  # 复制到 Go embed 目录
go build -o chuan cmd/*.go         # 编译
./chuan                            # :8080 同时提供 API + 前端
```

所有请求都由 Go 单进程处理，前端静态文件通过 `go:embed` 嵌入二进制。

---

## 七、安全与限制

| 维度 | 现状 |
|------|------|
| 加密 | WebRTC 自带 DTLS 加密，P2P 数据全程加密传输 |
| 认证 | 无用户认证，仅靠 6 位取件码 |
| 房间安全 | 取件码空间 34^6 ≈ 15 亿，暴力破解概率低 |
| 数据留存 | 服务器零数据留存，所有文件仅在浏览器内存/临时存储 |
| 并发限制 | 每房间最多 2 人，单进程内存管理 |
| 文件大小 | 受限于浏览器内存（大文件需接收方有足够内存组装 Blob）|
| NAT 穿透 | 依赖 STUN 服务器，对称 NAT 需 TURN 服务器（默认未配置）|
