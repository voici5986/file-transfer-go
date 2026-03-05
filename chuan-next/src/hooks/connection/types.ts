import type { TransportMode } from '../ui/webRTCStore';

// ────────────────────────────────────────────
// 基础类型
// ────────────────────────────────────────────

/** 清理函数 / 取消订阅 */
export type Unsubscribe = () => void;

/** WebRTC JSON 消息 */
export interface WebRTCMessage {
  type: string;
  payload: any;
  channel?: string;
}

// ────────────────────────────────────────────
// 处理器类型
// ────────────────────────────────────────────

/** JSON 消息处理器 */
export type MessageHandler = (message: WebRTCMessage) => void;

/** 二进制数据处理器 */
export type DataHandler = (data: ArrayBuffer) => void;

/** 媒体轨道事件处理器 */
export type TrackHandler = (event: RTCTrackEvent) => void;

// ────────────────────────────────────────────
// WebRTC 连接统一接口
// 所有业务模块（文件传输 / 文本传输 / 桌面共享 / 语音通话）
// 都通过此接口与底层通信，不直接依赖具体实现
// ────────────────────────────────────────────

export interface WebRTCConnection {
  // ── 只读状态 ──
  readonly isConnected: boolean;
  readonly isConnecting: boolean;
  readonly isWebSocketConnected: boolean;
  readonly isPeerConnected: boolean;
  readonly error: string | null;
  readonly canRetry: boolean;
  readonly transportMode: TransportMode;
  readonly currentRoom: { code: string; role: 'sender' | 'receiver' } | null;

  // ── 连接管理 ──
  connect(roomCode: string, role: 'sender' | 'receiver'): Promise<void>;
  disconnect(): void;
  retry(): Promise<void>;
  isConnectedToRoom(roomCode: string, role: 'sender' | 'receiver'): boolean;

  // ── 数据通道（DataChannel / Relay 透明切换）──
  sendMessage(message: WebRTCMessage, channel?: string): boolean;
  sendData(data: ArrayBuffer): boolean;
  registerMessageHandler(channel: string, handler: MessageHandler): Unsubscribe;
  registerDataHandler(channel: string, handler: DataHandler): Unsubscribe;
  getChannelState(): RTCDataChannelState;
  getBufferedAmount(): number;
  waitForBufferDrain(threshold?: number): Promise<void>;

  // ── 媒体轨道（支持多监听器） ──
  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender | null;
  removeTrack(sender: RTCRtpSender): void;
  /**
   * 注册轨道事件处理器
   * - 支持多个消费者同时注册（桌面共享 + 语音通话）
   * - 返回清理函数，组件卸载时调用
   * @param key 唯一标识符，如 'desktop-share' / 'voice-chat'
   */
  registerTrackHandler(key: string, handler: TrackHandler): Unsubscribe;
  getPeerConnection(): RTCPeerConnection | null;
  createOfferNow(): Promise<boolean>;
}
