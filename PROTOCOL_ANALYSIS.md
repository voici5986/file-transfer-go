# 文件快传（Chuan）— 传输协议接口分析文档

> 最后更新：2025-08-02

---

## 目录

- [一、协议总览](#一协议总览)
- [二、HTTP REST API 接口](#二http-rest-api-接口)
- [三、WebSocket 信令协议](#三websocket-信令协议)
- [四、DataChannel P2P 消息协议](#四datachannel-p2p-消息协议)
- [五、二进制传输协议](#五二进制传输协议)
- [六、可靠传输机制](#六可靠传输机制)
- [七、桌面共享 MediaStream 协议](#七桌面共享-mediastream-协议)
- [八、优缺点分析](#八优缺点分析)
- [九、设计评价](#九设计评价)
- [十、优化建议](#十优化建议)

---

## 一、协议总览

系统通信分为 **四个平面**，各自承担不同职责：

```
┌──────────────────────────────────────────────────────────────────────────┐
│                           通信协议栈                                      │
│                                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │  控制平面     │  │  信令平面     │  │  数据平面      │  │  媒体平面      │  │
│  │  HTTP REST   │  │  WebSocket   │  │  DataChannel  │  │  MediaStream │  │
│  │              │  │              │  │               │  │              │  │
│  │  房间管理     │  │  SDP/ICE     │  │  文件/文字     │  │  桌面共享      │  │
│  │  状态查询     │  │  连接/断开    │  │  P2P 直传     │  │  P2P 视频流   │  │
│  │              │  │              │  │               │  │              │  │
│  │  浏览器↔服务器 │  │  浏览器↔服务器 │  │  浏览器↔浏览器  │  │  浏览器↔浏览器  │  │
│  └─────────────┘  └─────────────┘  └──────────────┘  └──────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

### 消息类型汇总

| 平面 | 协议 | 消息类型数量 | 方向 |
|------|------|------------|------|
| 控制平面 | HTTP | 2 个端点 | 浏览器 → 服务器 |
| 信令平面 | WebSocket | 6 种消息类型 | 双向 (经服务器中继) |
| 数据平面 | DataChannel | 10 种消息类型 + 二进制流 | P2P 双向 |
| 媒体平面 | MediaStream | 0 自定义消息 (纯 SDP 重协商) | P2P 单向 |

---

## 二、HTTP REST API 接口

### 2.1 创建房间

```
POST /api/create-room
Content-Type: application/json
```

**请求体**：`{}` (空 JSON，后端忽略所有字段)

**成功响应** (200)：
```json
{
  "success": true,
  "code": "A1B2C3",
  "message": "房间创建成功"
}
```

**错误响应** (405 方法不允许)：
```json
{
  "success": false,
  "message": "方法不允许"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `success` | `boolean` | 是否成功 |
| `code` | `string` | 6 位房间码，字符集 `123456789ABCDEFGHIJKLMNPQRSTUVWXYZ` |
| `message` | `string` | 描述信息 |

**房间码生成规则**：
- 字符集排除 `0`（零）和 `O`（大写字母），避免视觉混淆
- 长度固定 6 位
- 随机生成，保证与现有房间不重复
- 代码空间：34^6 ≈ 15.4 亿种组合

---

### 2.2 查询房间状态

```
GET /api/room-info?code={ROOM_CODE}
GET /api/webrtc-room-status?code={ROOM_CODE}
```

两个端点指向同一个 Handler。

**成功响应** (200，房间存在)：
```json
{
  "success": true,
  "exists": true,
  "sender_online": true,
  "receiver_online": false,
  "is_room_full": false,
  "created_at": "2025-08-02T15:00:00Z"
}
```

**错误响应** (200，房间不存在)：
```json
{
  "success": false,
  "exists": false,
  "message": "房间不存在或已过期"
}
```

**错误响应** (400，缺少参数)：
```json
{
  "success": false,
  "message": "缺少房间代码"
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `sender_online` | `boolean` | 发送方 WebSocket 是否连接中 |
| `receiver_online` | `boolean` | 接收方 WebSocket 是否连接中 |
| `is_room_full` | `boolean` | 两方是否都在线 |
| `created_at` | `string` (ISO 8601) | 房间创建时间 |

---

### 2.3 Next.js API 代理层

开发模式下，Next.js 作为代理转发到 Go 后端：

| Next.js 路由 | 代理目标 |
|---------------|----------|
| `POST /api/create-room` | `POST {GO_BACKEND_URL}/api/create-room` |
| `GET /api/room-info?code=X` | `GET {GO_BACKEND_URL}/api/room-info?code=X` |
| `GET /api/get-text-content?code=X` | `GET {GO_BACKEND_URL}/api/get-text-content?code=X` |

生产模式下前端与 Go 后端同源部署，无需代理。

---

## 三、WebSocket 信令协议

### 3.1 连接建立

**URL 格式**：
```
ws[s]://{host}/api/ws/webrtc?code={ROOM_CODE}&role={sender|receiver}&channel=shared
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `code` | string | ✅ | 6 位房间码 |
| `role` | string | ✅ | `"sender"` 或 `"receiver"` |
| `channel` | string | ❌ | 固定值 `"shared"` (前端始终传递) |

**连接验证流程**：
```
WebSocket 升级请求
    │
    ├─ code 为空 → 发送 error → 关闭连接
    ├─ role 不是 sender/receiver → 发送 error → 关闭连接
    ├─ 房间不存在 → 发送 error → 关闭连接
    ├─ 房间已过期 → 删除房间 → 发送 error → 关闭连接
    ├─ 对应角色已有人在线 → 发送 error → 关闭连接
    │
    └─ 验证通过
        ├─ 注册客户端到房间
        └─ 通知对方: peer-joined
```

**兼容路由**：`/ws/webrtc` 和 `/api/ws/webrtc` 指向同一个 Handler。

---

### 3.2 信令消息类型

所有信令消息共享统一的 JSON 结构（Go 端定义）：

```json
{
  "type": "string",
  "from": "string",
  "to": "string",
  "payload": {}
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `string` | 消息类型标识 |
| `from` | `string` | 发送者客户端 ID（服务端自动填充） |
| `to` | `string` | 接收者客户端 ID（服务端自动填充） |
| `payload` | `object` | 消息负载 |

**服务端转发机制**：对 `offer`、`answer`、`ice-candidate` 等客户端消息，服务端 **不解析 payload**，仅中继转发给房间内另一方，并自动填充 `from` 和 `to` 字段。

---

#### 3.2.1 `error` — 服务端 → 客户端

```json
{
  "type": "error",
  "message": "连接参数无效"
}
```

| 触发条件 | message 内容 |
|----------|-------------|
| code 或 role 为空 | `"连接参数无效"` |
| 房间不存在 | `"房间不存在"` |
| 房间已过期 | `"房间已过期"` |
| 角色已被占用 | `"房间已满或角色被占用"` |

---

#### 3.2.2 `peer-joined` — 服务端 → 客户端

```json
{
  "type": "peer-joined",
  "from": "webrtc_client_1234567890",
  "payload": {
    "role": "receiver"
  }
}
```

**触发**：一方加入房间后，服务端通知已在房间内的另一方。

**客户端处理逻辑**：

| 情况 | 动作 |
|------|------|
| sender 收到 `role: "receiver"` | 创建 PeerConnection → 创建 DataChannel → 创建 Offer → 发起 P2P 连接 |
| receiver 收到 `role: "sender"` | 创建 PeerConnection → 等待 Offer |

---

#### 3.2.3 `offer` — sender → (服务端中继) → receiver

```json
{
  "type": "offer",
  "from": "webrtc_client_XXX",
  "to": "webrtc_client_YYY",
  "payload": {
    "type": "offer",
    "sdp": "v=0\r\no=- 1234567890 ..."
  }
}
```

**发送时机**：
1. 初始连接建立时（sender 创建 PeerConnection 后）
2. 桌面共享添加/移除轨道后（SDP 重协商）

**Offer 发送策略**：
- 创建 Offer → 设置 LocalDescription → 等待 ICE 收集完成 → 发送完整 SDP
- ICE 收集超时 5 秒，超时后发送当前已收集的 SDP
- Offer 配置：`{ offerToReceiveAudio: true, offerToReceiveVideo: true }`

---

#### 3.2.4 `answer` — receiver → (服务端中继) → sender

```json
{
  "type": "answer",
  "from": "webrtc_client_YYY",
  "to": "webrtc_client_XXX",
  "payload": {
    "type": "answer",
    "sdp": "v=0\r\no=- 9876543210 ..."
  }
}
```

**特殊处理**：如果收到 answer 时当前信令状态已经是 `stable`（可能由于并发重协商），会自动重新创建 Offer 再处理。

---

#### 3.2.5 `ice-candidate` — 双向中继

```json
{
  "type": "ice-candidate",
  "from": "webrtc_client_XXX",
  "to": "webrtc_client_YYY",
  "payload": {
    "candidate": "candidate:842163049 1 udp ...",
    "sdpMid": "0",
    "sdpMLineIndex": 0,
    "usernameFragment": "abc123"
  }
}
```

**发送时机**：`RTCPeerConnection.onicecandidate` 事件触发时。

**⚠️ 已知问题**：如果收到 ICE 候选时 `remoteDescription` 尚未设置，当前代码仅打印日志，**没有实现 ICE 候选缓存队列**。

---

#### 3.2.6 `disconnection` — 双向

**服务端 → 客户端**（对方断开时）：
```json
{
  "type": "disconnection",
  "from": "webrtc_client_XXX",
  "payload": {
    "role": "sender",
    "message": "对方已停止传输"
  }
}
```

**客户端 → 服务端**（主动断开时）：
```json
{
  "type": "disconnection",
  "payload": {
    "reason": "用户主动断开"
  }
}
```

**客户端处理**：关闭 PeerConnection，但保持 WebSocket 连接（允许对方重连后恢复）。

---

### 3.3 信令时序图

```
sender 浏览器              Go 信令服务器             receiver 浏览器
     │                          │                          │
     │   WS connect             │                          │
     │   ?code=X&role=sender    │                          │
     ├─────────────────────────►│                          │
     │   ♦ 注册到房间            │                          │
     │                          │                          │
     │                          │   WS connect             │
     │                          │   ?code=X&role=receiver  │
     │                          │◄─────────────────────────┤
     │                          │   ♦ 注册到房间            │
     │                          │                          │
     │   peer-joined            │   peer-joined            │
     │   {role:"receiver"}      │   {role:"sender"}        │
     │◄─────────────────────────┤──────────────────────────►│
     │                          │                          │
     │   ♦ 创建 PC + DC         │                          │
     │   ♦ createOffer          │                          │
     │                          │                          │
     │   offer (SDP)            │                          │
     ├─────────────────────────►│──────────────────────────►│
     │                          │   ♦ setRemoteDesc        │
     │                          │   ♦ createAnswer          │
     │                          │                          │
     │                          │   answer (SDP)            │
     │◄─────────────────────────┤◄──────────────────────────┤
     │   ♦ setRemoteDesc        │                          │
     │                          │                          │
     │   ice-candidate ◄════════╪═══════════════════════════╡  (双向多次)
     │   ice-candidate ════════►╪═══════════════════════════►│
     │                          │                          │
     │   ════════ DataChannel OPEN ═════════════════════════│
     │                          │                          │
     │         *** P2P 直连建立，后续数据不经服务器 ***         │
```

---

## 四、DataChannel P2P 消息协议

### 4.1 DataChannel 配置

| 属性 | 值 | 说明 |
|------|-----|------|
| 通道名称 | `"shared-channel"` | 所有功能共享单一通道 |
| `ordered` | `true` | 消息保序 |
| `maxRetransmits` | `3` | SCTP 层最大重传次数 |
| 创建方 | sender | `pc.createDataChannel()` |
| 接收方 | receiver | `pc.ondatachannel` 事件 |

### 4.2 消息路由机制

所有 DataChannel JSON 消息共享统一格式：

```typescript
interface WebRTCMessage {
  type: string;       // 消息类型
  payload: any;       // 消息负载
  channel?: string;   // 通道标识（用于路由）
}
```

**路由逻辑**：

```
DataChannel.onmessage(event)
    │
    ├─ event.data 是 string
    │   └─ JSON.parse → WebRTCMessage
    │       ├─ 有 channel 字段 → 分发给对应通道的 messageHandler
    │       └─ 无 channel 字段 → 广播给所有已注册的 messageHandler
    │
    └─ event.data 是 ArrayBuffer
        └─ 优先路由到 'file-transfer' 的 dataHandler
           （无 file-transfer handler 时，路由到第一个注册的 dataHandler）
```

**已注册通道**：

| 通道名称 | 注册 Hook | 处理的消息类型 |
|----------|-----------|--------------|
| `"file-transfer"` | `useFileTransferBusiness` | `file-metadata`, `file-chunk-info`, `file-chunk-ack`, `file-complete`, `file-list`, `file-request` + 二进制 |
| `"text-transfer"` | `useTextTransferBusiness` | `text-sync`, `text-typing` |

---

### 4.3 文件传输消息 (`channel: "file-transfer"`)

#### 4.3.1 `file-list` — 文件列表同步

**方向**：sender → receiver  
**触发**：发送方文件选择变更后（150ms 防抖）

```json
{
  "type": "file-list",
  "channel": "file-transfer",
  "payload": [
    {
      "id": "file_1709123456789_a1b2c3d4e",
      "name": "document.pdf",
      "size": 1048576,
      "type": "application/pdf",
      "status": "ready",
      "progress": 0
    }
  ]
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `payload[].id` | `string` | 文件唯一 ID |
| `payload[].name` | `string` | 文件名 |
| `payload[].size` | `number` | 文件大小（字节） |
| `payload[].type` | `string` | MIME 类型 |
| `payload[].status` | `string` | `"ready"` / `"downloading"` / `"completed"` |
| `payload[].progress` | `number` | 0-100 传输进度 |

---

#### 4.3.2 `file-request` — 文件下载请求

**方向**：receiver → sender  
**触发**：接收方点击"下载"按钮

```json
{
  "type": "file-request",
  "channel": "file-transfer",
  "payload": {
    "fileId": "file_1709123456789_a1b2c3d4e",
    "fileName": "document.pdf"
  }
}
```

---

#### 4.3.3 `file-metadata` — 文件元信息

**方向**：sender → receiver  
**触发**：开始传输单个文件时

```json
{
  "type": "file-metadata",
  "channel": "file-transfer",
  "payload": {
    "id": "file_1709123456789_a1b2c3d4e",
    "name": "document.pdf",
    "size": 1048576,
    "type": "application/pdf"
  }
}
```

**接收方处理**：
- 初始化 `receivingFiles` Map 条目
- 计算 totalChunks = `Math.ceil(size / CHUNK_SIZE)`
- 创建 chunks 数组 `new Array(totalChunks)`
- 设置 `isTransferring: true`

---

#### 4.3.4 `file-chunk-info` — 块元信息

**方向**：sender → receiver  
**触发**：发送每个文件块前（紧跟二进制数据）

```json
{
  "type": "file-chunk-info",
  "channel": "file-transfer",
  "payload": {
    "fileId": "file_1709123456789_a1b2c3d4e",
    "chunkIndex": 0,
    "totalChunks": 0,
    "checksum": "a1b2c3d4"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `fileId` | `string` | 文件 ID |
| `chunkIndex` | `number` | 块索引（0-based） |
| `totalChunks` | `number` | **⚠️ 当前恒为 0**，实际总数在 metadata 中 |
| `checksum` | `string` | CRC32 校验和（8 字符十六进制） |

**⚠️ 设计问题**：`totalChunks` 字段存在但未被正确填充，详见[优缺点分析](#81-协议设计缺陷)。

---

#### 4.3.5 二进制块数据 (`ArrayBuffer`)

**方向**：sender → receiver  
**紧跟在对应的 `file-chunk-info` 消息之后发送**

- **格式**：纯原始字节，无任何头部或封装
- **大小**：≤ 256KB（`CHUNK_SIZE = 256 * 1024`），最后一块可能更小
- **切片方式**：`file.slice(chunkIndex * CHUNK_SIZE, min((chunkIndex + 1) * CHUNK_SIZE, file.size))`

**关联机制**：接收方通过 `expectedChunk.current` 引用关联：
1. 收到 `file-chunk-info` → 存入 `expectedChunk.current`
2. 收到 `ArrayBuffer` → 读取 `expectedChunk.current`，验证校验和
3. 如果收到 `ArrayBuffer` 但 `expectedChunk.current === null` → 打印警告，**丢弃数据**

---

#### 4.3.6 `file-chunk-ack` — 块确认

**方向**：receiver → sender  
**触发**：接收方处理完每个二进制块后

**成功**：
```json
{
  "type": "file-chunk-ack",
  "channel": "file-transfer",
  "payload": {
    "fileId": "file_xxx",
    "chunkIndex": 0,
    "success": true,
    "checksum": "a1b2c3d4"
  }
}
```

**失败**（校验和不匹配）：
```json
{
  "type": "file-chunk-ack",
  "channel": "file-transfer",
  "payload": {
    "fileId": "file_xxx",
    "chunkIndex": 0,
    "success": false,
    "checksum": "e5f6g7h8"
  }
}
```

---

#### 4.3.7 `file-complete` — 传输完成

**方向**：sender → receiver  
**触发**：所有块都收到 ACK 确认后

```json
{
  "type": "file-complete",
  "channel": "file-transfer",
  "payload": {
    "fileId": "file_1709123456789_a1b2c3d4e"
  }
}
```

**接收方处理**：
1. 从 `receivingFiles` 取出所有 chunks
2. `new Blob(chunks, { type: metadata.type })`
3. `new File([blob], metadata.name, { type: metadata.type })`
4. 触发 `fileReceivedCallbacks`
5. 清理 `receivingFiles` Map 条目

---

#### 4.3.8 `sync-request` — 同步请求

**方向**：双向  
**触发**：DataChannel 打开后延迟 300ms  
**⚠️ 无 `channel` 字段**，会被广播给所有 handler

```json
{
  "type": "sync-request",
  "payload": {
    "timestamp": 1709123456789
  }
}
```

**⚠️ 设计问题**：当前没有任何 handler 处理此消息类型，详见[优缺点分析](#83-废弃代码)。

---

### 4.4 文字传输消息 (`channel: "text-transfer"`)

#### 4.4.1 `text-sync` — 文本同步

**方向**：单向（发送方 → 接收方）  
**触发**：用户编辑 textarea 时实时发送

```json
{
  "type": "text-sync",
  "channel": "text-transfer",
  "payload": {
    "text": "输入的文本内容..."
  }
}
```

**特点**：每次发送 **完整文本内容**，不是增量差异。

---

#### 4.4.2 `text-typing` — 打字状态

**方向**：双向  
**触发**：开始输入时发送 `true`，停止输入 1 秒后发送 `false`

```json
{
  "type": "text-typing",
  "channel": "text-transfer",
  "payload": {
    "typing": true
  }
}
```

---

## 五、二进制传输协议

### 5.1 文件分块策略

| 参数 | 值 | 说明 |
|------|-----|------|
| `CHUNK_SIZE` | `256 * 1024` (256KB) | 块大小上限 |
| 总块数计算 | `Math.ceil(fileSize / CHUNK_SIZE)` | 向上取整 |
| 切片方式 | `File.slice(start, end)` | 使用 Blob API |
| 发送顺序 | 严格顺序 (0 → 1 → 2 → ...) | 串行逐块发送 |

### 5.2 CRC32 校验算法

```typescript
function calculateChecksum(data: ArrayBuffer): string {
  const buffer = new Uint8Array(data);
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buffer.length; i++) {
    crc ^= buffer[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xEDB88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xFFFFFFFF).toString(16).padStart(8, '0');
}
```

| 项目 | 说明 |
|------|------|
| 算法 | CRC-32 (IEEE 802.3 / ITU-T V.42 反射多项式) |
| 多项式 | `0xEDB88320` |
| 输入 | 整个块的 `ArrayBuffer`（最大 256KB） |
| 输出 | 8 字符十六进制字符串（前补零） |
| 校验点 | 发送方发送前计算 → 接收方收到后重新计算 → 比对 |

**备用函数** `simpleChecksum()`：仅计算前 1000 字节的简单字节求和。**当前未被调用**。

### 5.3 消息与二进制数据的关联

```
DataChannel 消息流:
  ┌──────────────────┐     ┌──────────────────┐
  │  file-chunk-info │────►│  ArrayBuffer      │
  │  (JSON string)   │     │  (binary data)    │
  │                  │     │                    │
  │  fileId: "xxx"   │     │  [原始文件字节]     │
  │  chunkIndex: 0   │     │  最大 256KB        │
  │  checksum: "..." │     │                    │
  └──────────────────┘     └──────────────────┘
         ▲                         ▲
         │                         │
     必须先到达               必须紧跟其后
```

接收方使用 `useRef(expectedChunk)` 维护关联状态：

```
          ┌─────────────────────────────────────────────┐
          │ expectedChunk.current                        │
          │                                             │
  null ───┤  收到 file-chunk-info → 设置 {fileId,       │
          │                          chunkIndex,         │
          │                          expectedChecksum}   │
          │                                             │
  set ────┤  收到 ArrayBuffer →                          │
          │    读取 expectedChunk →                      │
          │    计算 CRC32 →                              │
          │    比较校验和 →                               │
          │    发送 ACK →                                │
          │    重置为 null                               │
          └─────────────────────────────────────────────┘
```

---

## 六、可靠传输机制

### 6.1 传输参数

| 参数 | 值 | 说明 |
|------|-----|------|
| `CHUNK_SIZE` | 256KB | 块大小 |
| `MAX_RETRIES` | 5 | 单块最大重试次数 |
| `RETRY_DELAY` | 1000ms | 基础重试延迟 |
| `ACK_TIMEOUT` | 5000ms | ACK 等待超时 |

### 6.2 ACK 协议流程

```
sendChunkWithAck(fileId, chunkIndex, chunkData)
    │
    ├─ 1. 检查通道状态 (closed → 立即失败)
    │
    ├─ 2. 注册 ACK 回调到 chunkAckCallbacks Map
    │      key = "${fileId}-${chunkIndex}"
    │
    ├─ 3. 设置 ACK_TIMEOUT (5000ms) 超时定时器
    │
    ├─ 4. 发送 file-chunk-info (JSON)
    │
    ├─ 5. 发送 chunkData (ArrayBuffer)
    │
    └─ 6. 等待 Promise resolve
         │
         ├─ 收到 ACK (success: true)  → resolve(true)
         ├─ 收到 ACK (success: false) → resolve(false)
         └─ 超时 (5000ms)             → resolve(false)
```

### 6.3 重试策略 — 指数退避

```
发送块 → ACK 失败或超时
    │
    ├─ retryCount < MAX_RETRIES (5)?
    │   ├─ 是 → 等待退避延迟 → 重新发送同一块
    │   └─ 否 → 抛出异常，终止整个文件传输
    │
    └─ 退避延迟计算:
        delay = min(RETRY_DELAY × 2^(retryCount-1), 10000)
        
        第 1 次重试: 1000ms
        第 2 次重试: 2000ms
        第 3 次重试: 4000ms
        第 4 次重试: 8000ms
        第 5 次重试: 10000ms (上限)
```

### 6.4 自适应流控

```typescript
// 速度计算 — 指数移动平均 (EMA)
speed = (chunkBytes / 1024) / timeDiff           // 当前块速度 KB/s
averageSpeed = averageSpeed * 0.7 + speed * 0.3  // 平滑 (α=0.3)

// 延迟计算
expectedTime = (chunkSize / 1024) / averageSpeed  // 期望耗时
actualTime = now - lastChunkTime                   // 实际耗时
delay = max(0, expectedTime - actualTime)          // 需要额外等待

// 仅在 delay > 10ms 时执行，上限 100ms
if (delay > 10) await sleep(min(delay, 100))
```

### 6.5 传输状态追踪

每个正在传输的文件维护一个 `TransferStatus`：

```typescript
interface TransferStatus {
  fileId: string;
  fileName: string;
  totalChunks: number;
  sentChunks: Set<number>;          // 已发送的块索引
  acknowledgedChunks: Set<number>;  // 已收到 ACK 的块索引
  failedChunks: Set<number>;        // 失败的块索引
  lastChunkTime: number;            // 最后发送时间戳
  retryCount: Map<number, number>;  // 块索引 → 重试次数
  averageSpeed: number;             // EMA 平均速度 (KB/s)
}
```

### 6.6 错误恢复矩阵

| 错误类型 | 处理方式 | 恢复策略 |
|----------|---------|---------|
| CRC32 校验失败 | 发送 `ACK {success: false}` | 发送方重试该块（指数退避） |
| ACK 超时 (5s) | `sendChunkWithAck` resolve(false) | 同上，重试该块 |
| 超过 5 次重试 | 抛出异常 | **终止整个文件传输** |
| DataChannel 关闭 | 立即抛出 `'数据通道已关闭'` | **终止传输**，更新错误状态 |
| WebRTC 断连 | 检测到 connecting 状态 | 打印警告，**继续尝试发送** |
| 传输完整性不匹配 | `acknowledgedChunks.size ≠ totalChunks` | **抛出异常** |
| 收到二进制但无前置 chunk-info | `expectedChunk === null` | **丢弃数据**，打印警告 |
| 收到重复块 | `chunks[index] !== undefined` | **跳过**，不重复计数 |

---

## 七、桌面共享 MediaStream 协议

### 7.1 架构特点

桌面共享 **完全不使用 DataChannel 自定义消息**，纯粹依赖 WebRTC 原生的 MediaStream + SDP 重协商机制。

### 7.2 开始共享流程

```
发送方                                              接收方
  │                                                    │
  │  1. getDisplayMedia({video, audio})                │
  │     └─ cursor: 'always'                            │
  │     └─ displaySurface: 'monitor'                   │
  │                                                    │
  │  2. pc.addTrack(videoTrack, stream)               │
  │  3. pc.addTrack(audioTrack, stream)  // 可选       │
  │                                                    │
  │  4. await 500ms (等待轨道完全添加)                   │
  │                                                    │
  │  5. createOfferNow()                               │
  │     └─ pc.createOffer({                            │
  │         offerToReceiveAudio: true,                 │
  │         offerToReceiveVideo: true                  │
  │       })                                           │
  │     └─ pc.setLocalDescription                      │
  │     └─ 等待 ICE 收集 (最多5秒)                      │
  │                                                    │
  │  6. WS: offer (含新的媒体 SDP) ─────────────────────►│
  │                                                    │  7. setRemoteDescription
  │                                                    │  8. createAnswer
  │◄────────────────────────────────── WS: answer       │
  │  9. setRemoteDescription                           │
  │                                                    │
  │  10. await 2000ms (等待重协商完成)                    │
  │                                                    │  11. pc.ontrack 事件
  │                                                    │      └─ 获取远程 MediaStream
  │                                                    │      └─ 设置到 <video> 元素
```

### 7.3 getDisplayMedia 配置

```typescript
{
  video: {
    cursor: 'always',          // 始终显示鼠标
    displaySurface: 'monitor', // 默认选择整个屏幕
  },
  audio: {
    echoCancellation: false,   // 禁用回声消除
    noiseSuppression: false,   // 禁用噪声抑制
    autoGainControl: false,    // 禁用自动增益
  }
}
```

### 7.4 切换桌面源

```
1. getDisplayMedia(newConfig) → 获取新的 MediaStream
2. 停止旧流: localStream.getTracks().forEach(t => t.stop())
3. pc.removeTrack(oldSender)
4. pc.addTrack(newVideoTrack, newStream)
5. createOfferNow() → SDP 重新协商
```

### 7.5 停止共享

```
1. 停止所有本地轨道: localStream.getTracks().forEach(t => t.stop())
2. pc.removeTrack(sender) 移除所有 sender
3. （接收方通过 track.ended 事件感知）
```

---

## 八、优缺点分析

### 8.1 协议设计缺陷

| 问题 | 严重程度 | 说明 |
|------|---------|------|
| **`file-chunk-info.totalChunks` 恒为 0** | 🟡 中 | 发送时填入 0，接收方需从 metadata 自行计算。字段存在但无效，增加了协议理解难度 |
| **ICE 候选缓存缺失** | 🔴 高 | 如果 ICE 候选先于 remoteDescription 到达，直接被丢弃。在高延迟环境下可能导致连接失败 |
| **`sync-request` 消息无人处理** | 🟡 中 | DataChannel 打开后会发送此消息，但没有任何 handler 处理，是无效消息 |
| **`simpleChecksum` 函数未使用** | 🟢 低 | 代码中定义了备用校验函数但从未调用，属于死代码 |
| **文本同步发送全量内容** | 🟡 中 | 每次按键都发送完整文本，在大文本场景下带宽浪费严重 |
| **二进制数据仅通过时序关联** | 🟡 中 | chunk-info 和 binary data 的关联完全依赖消息顺序，若 DataChannel 出现消息乱序（理论上 `ordered: true` 可避免），则数据关联会错误 |

### 8.2 架构优点

| 优点 | 说明 |
|------|------|
| **纯 P2P 零服务器中转** | 文件/文字/视频全部直传，隐私性极佳，服务器成本极低 |
| **单 DataChannel 多路复用** | 通过 `channel` 字段路由，避免多连接管理复杂性 |
| **可靠传输双重保障** | SCTP 底层重传 + 应用层 CRC32 ACK，数据完整性有保证 |
| **自适应流控** | EMA 平滑速度 + 动态延迟，避免缓冲区溢出 |
| **信令服务器极简** | Go 后端仅做纯中继，不解析 payload，职责清晰 |
| **优雅断连处理** | 双方都有断连通知，可区分主动断开和异常断连 |
| **环境自适应** | 开发/静态/嵌入三种模式自动切换 API 和 WS 地址 |
| **ICE 可配置** | 支持用户自定义 STUN/TURN 服务器，适应不同网络环境 |

### 8.3 架构缺点

| 缺点 | 影响 | 说明 |
|------|------|------|
| **串行逐块传输** | 性能瓶颈 | 每个块必须等 ACK 才发下一个，RTT 越高吞吐越低。100ms RTT 下理论上限 ≈ 256KB/100ms = 2.5MB/s |
| **大文件内存问题** | 可用性 | 接收方需在内存中缓存所有 chunks 直到文件组装，1GB 文件需 1GB+ 内存 |
| **单连接瓶颈** | 性能 | 三个功能共享一个 DataChannel，桌面共享重协商可能影响文件传输 |
| **无断点续传** | 可用性 | 连接断开后无法恢复传输，必须从头开始 |
| **无并发文件传输** | 体验 | 一次只能传一个文件，多文件必须排队 |
| **房间仅限 2 人** | 扩展性 | 无法支持一对多或多对多传输 |
| **无加密层控制** | 安全 | 完全依赖 WebRTC 内建 DTLS，无法自定义加密策略 |
| **6位取件码无鉴权** | 安全 | 知道取件码就能加入房间，无额外身份验证 |
| **无传输速度展示** | 体验 | 有 `averageSpeed` 计算但未暴露给 UI 显示 |

---

## 九、设计评价

### 9.1 协议分层设计 — ⭐⭐⭐⭐ (优秀)

```
应用层 (file-list / file-request / text-sync)
    │
可靠传输层 (file-chunk-info + CRC32 + ACK + 重试)
    │
路由层 (channel 字段分发)
    │
传输层 (WebRTC DataChannel, ordered + maxRetransmits:3)
    │
加密层 (DTLS, WebRTC 内建)
```

分层清晰，每层职责明确。路由层用 `channel` 字段实现了轻量级的多路复用，避免了管理多个 DataChannel 的复杂性。

### 9.2 可靠性设计 — ⭐⭐⭐⭐ (优秀)

- SCTP 底层提供有序传输 + 最多 3 次重传
- 应用层 CRC32 提供端到端完整性验证
- 指数退避重试避免了网络抖动时的重试风暴
- ACK 超时兜底，避免无限等待

两层保障设计合理，但 **串行 ACK 导致了性能瓶颈**。

### 9.3 错误处理 — ⭐⭐⭐ (良好)

覆盖了校验失败、超时、通道关闭、完整性验证等场景。但缺少：
- 网络波动后的自动重连
- 断点续传能力
- 部分传输的清理/恢复

### 9.4 可扩展性 — ⭐⭐ (一般)

- channel 路由机制容易添加新功能
- 但单 DataChannel + 串行传输限制了扩展空间
- 房间模型硬编码 2 人，难以支持多人协作

### 9.5 安全性 — ⭐⭐⭐ (良好)

- P2P 直传 + DTLS 加密保障了传输安全
- 服务器零数据留存
- 但取件码空间可能被暴力扫描，缺少速率限制

---

## 十、优化建议

### 10.1 🔴 关键优化 — 滑动窗口并发传输

**现状**：串行逐块等待 ACK，RTT 直接决定吞吐上限。

**建议**：实现类似 TCP 的滑动窗口机制：

```
当前：   [send chunk 0] → [wait ACK 0] → [send chunk 1] → [wait ACK 1] → ...
                                ▲ 100ms RTT 下吞吐上限 2.5MB/s

优化后： [send 0][send 1][send 2][send 3]  ← 窗口大小 = 4
              [ACK 0][ACK 1]
                  [send 4][send 5]          ← 窗口向前滑动
                                ▲ 窗口=4 时理论吞吐 10MB/s
```

**实现要点**：
- 维护发送窗口 `windowSize` (初始 4, 根据丢包率动态调整)
- 每个 in-flight chunk 独立超时
- 窗口内的块可并发发送，但需保证接收方能正确关联

**预估收益**：吞吐量提升 3-8 倍。

---

### 10.2 🔴 关键优化 — 二进制帧协议

**现状**：chunk-info (JSON) + binary data (ArrayBuffer) 通过**时序**关联，依赖消息顺序。

**建议**：将元数据编码进二进制帧头部，合并为单个消息：

```
当前：
  [JSON: file-chunk-info]  →  [ArrayBuffer: raw data]
  两条消息，时序依赖

优化后：
  [ArrayBuffer: header + data]
  单条消息，自包含

帧格式：
  ┌──────────────┬───────────┬───────────┬──────────┬─────────────┐
  │ magic (2B)   │ fileId    │ chunkIdx  │ checksum │ payload     │
  │ 0xCF 0xDA    │ len(2B)   │ (4B)      │ (4B)     │ (变长)      │
  │              │ + string  │ uint32    │ CRC32    │ 文件数据     │
  └──────────────┴───────────┴───────────┴──────────┴─────────────┘
```

**收益**：
- 消除时序依赖风险
- 减少消息数量（每块 2→1）
- 减少 JSON 序列化/反序列化开销
- 为滑动窗口提供帧级标识

---

### 10.3 🟡 重要优化 — ICE 候选缓存队列

**现状**：remoteDescription 未设置时，收到的 ICE 候选直接打印日志丢弃。

**建议**：

```typescript
const pendingCandidates = useRef<RTCIceCandidate[]>([]);

// 收到 ICE 候选时
if (pc.remoteDescription) {
  await pc.addIceCandidate(candidate);
} else {
  pendingCandidates.current.push(candidate);
}

// 设置 remoteDescription 后
await pc.setRemoteDescription(desc);
for (const c of pendingCandidates.current) {
  await pc.addIceCandidate(c);
}
pendingCandidates.current = [];
```

**收益**：避免在高延迟网络下丢失 ICE 候选导致连接失败。

---

### 10.4 🟡 重要优化 — 流式文件写入

**现状**：接收方将所有 chunks 缓存在内存数组中，文件完成后合并为 Blob。大文件占用大量内存。

**建议**：使用 `StreamSaver.js` 或 OPFS (Origin Private File System) 流式写入磁盘：

```typescript
// 使用 File System Access API
const handle = await window.showSaveFilePicker({ suggestedName: fileName });
const writable = await handle.createWritable();

// 每收到一个 chunk
await writable.write(chunkData);  // 直接写入磁盘

// 传输完成
await writable.close();
```

**收益**：内存使用从 O(fileSize) 降低到 O(chunkSize)，支持 GB 级文件传输。

---

### 10.5 🟡 重要优化 — 文本增量同步

**现状**：每次按键发送完整文本内容。10KB 的文本每按一次键发送 10KB+。

**建议**：使用操作变换 (OT) 或 CRDT，或最简单的 diff：

```typescript
// 简易 diff 方案
function createTextDiff(oldText: string, newText: string) {
  // 找到最长公共前缀和后缀
  let prefixLen = 0;
  while (prefixLen < oldText.length && prefixLen < newText.length 
         && oldText[prefixLen] === newText[prefixLen]) prefixLen++;
  
  let suffixLen = 0;
  while (suffixLen < oldText.length - prefixLen 
         && suffixLen < newText.length - prefixLen
         && oldText[oldText.length - 1 - suffixLen] === newText[newText.length - 1 - suffixLen]) 
    suffixLen++;
  
  return {
    offset: prefixLen,
    deleteCount: oldText.length - prefixLen - suffixLen,
    insertText: newText.slice(prefixLen, newText.length - suffixLen || undefined)
  };
}

// 消息格式
{
  "type": "text-diff",
  "channel": "text-transfer",
  "payload": {
    "offset": 5,
    "deleteCount": 0,
    "insertText": "a",
    "version": 42
  }
}
```

**收益**：带宽消耗从 O(textLength) 降低到 O(editSize)。

---

### 10.6 🟢 建议优化 — chunk-info.totalChunks 修复

**现状**：`file-chunk-info.payload.totalChunks` 恒为 0。

**建议**：正确填入实际值：

```typescript
// 发送时
payload: {
  fileId,
  chunkIndex,
  totalChunks: Math.ceil(file.size / CHUNK_SIZE),  // 填入实际值
  checksum
}
```

**收益**：协议自洽，接收方可直接从 chunk-info 获取总数，无需依赖先前的 metadata。

---

### 10.7 🟢 建议优化 — 清理死代码

| 待清理项 | 位置 |
|----------|------|
| `simpleChecksum()` 函数 | `useFileTransferBusiness.ts` |
| `sync-request` 消息发送逻辑 | `useWebRTCDataChannelManager.ts` |
| `file-chunk-info.totalChunks` 赋值为 0 | `useFileTransferBusiness.ts` |

---

### 10.8 🟢 建议优化 — 传输速度 UI 展示

**现状**：`averageSpeed` 已在 `TransferStatus` 中计算，但未暴露给 UI。

**建议**：在文件传输进度条旁边显示实时速度：

```
📄 document.pdf    ███████░░░░░ 65%    12.3 MB/s    剩余 ~3s
```

---

### 10.9 🟢 建议优化 — 房间安全加固

| 措施 | 说明 |
|------|------|
| **连接速率限制** | 同一 IP 每分钟最多尝试 N 次房间连接 |
| **房间码验证延迟** | 错误码时增加响应延迟（如 1s），阻止暴力扫描 |
| **可选密码保护** | 创建房间时可设置密码，加入时需输入 |
| **HMAC 签名** | 房间码 + 时间戳的 HMAC 签名，防止伪造 |

---

### 10.10 优化优先级总览

| 优先级 | 优化项 | 预估收益 | 实现难度 |
|--------|--------|---------|---------|
| 🔴 P0 | 滑动窗口并发传输 | 吞吐量 3-8x | 高 |
| 🔴 P0 | 二进制帧协议 | 消除时序依赖 + 减少消息量 | 中 |
| 🟡 P1 | ICE 候选缓存 | 连接成功率提升 | 低 |
| 🟡 P1 | 流式文件写入 | GB 文件支持 | 中 |
| 🟡 P1 | 文本增量同步 | 带宽节约 > 90% | 中 |
| 🟢 P2 | totalChunks 修复 | 协议一致性 | 极低 |
| 🟢 P2 | 清理死代码 | 代码质量 | 极低 |
| 🟢 P2 | 速度 UI 展示 | 用户体验 | 低 |
| 🟢 P2 | 房间安全加固 | 安全性 | 中 |
