import { WebConnectState } from "./state/webConnectStore";

// 消息和数据处理器类型
export type MessageHandler = (message: IWebMessage) => void;
export type DataHandler = (data: ArrayBuffer) => void;

// 角色类型
export type Role = 'sender' | 'receiver';


export type ConnectType = 'webrtc' | 'websocket';



// 对外包装类型 暴露接口
export interface IRegisterEventHandler {
  registerMessageHandler: (channel: string, handler: MessageHandler) => () => void;
  registerDataHandler: (channel: string, handler: DataHandler) => () => void;
}


export interface IGetConnectState {
  getConnectState: () => WebConnectState;
}

/***
 * 
 * 对外包装类型 暴露接口
 * 
 */
// WebRTC 连接接口
export interface IWebConnection extends IRegisterEventHandler, IGetConnectState {

  connectType: ConnectType;
  // 操作方法
  connect: (roomCode: string, role: Role) => Promise<void>;
  disconnect: () => void;
  retry: () => Promise<void>;
  sendMessage: (message: IWebMessage, channel?: string) => boolean;
  sendData: (data: ArrayBuffer) => boolean;

  // 工具方法
  getConnectState: () => WebConnectState;
  isConnectedToRoom: (roomCode: string, role: Role) => boolean;

  // 当前房间信息
  currentRoom: { code: string; role: Role } | null;

  // 媒体轨道方法
  addTrack: (track: MediaStreamTrack, stream: MediaStream) => RTCRtpSender | null;
  removeTrack: (sender: RTCRtpSender) => void;
  onTrack: (callback: (event: RTCTrackEvent) => void) => () => void; // 返回清理函数
  getPeerConnection: () => RTCPeerConnection | null;
  createOfferNow: () => Promise<boolean>;

  // 断开连接回调
  setOnDisconnectCallback: (callback: () => void) => void;
}





// 消息类型
export interface IWebMessage {
  type: string;
  payload: any;
  channel?: string;
}






/***
 *
 * 数据通道类型
 * WebRTC 数据通道管理器
 * 负责数据通道的创建和管理
 */
export interface WebRTCDataChannelManager extends IGetConnectState {
  // 创建数据通道
  createDataChannel: (pc: RTCPeerConnection, role: Role, isReconnect?: boolean) => void;

  // 发送消息
  sendMessage: (message: IWebMessage, channel?: string) => boolean;

  // 发送二进制数据
  sendData: (data: ArrayBuffer) => boolean;

  // 处理数据通道消息
  handleDataChannelMessage: (event: MessageEvent) => void;


}



/**
 * WebRTC 媒体轨道管理器
 * 负责媒体轨道的添加和移除
 */
export interface WebRTCTrackManager {
  // 添加媒体轨道
  addTrack: (track: MediaStreamTrack, stream: MediaStream) => RTCRtpSender | null;

  // 移除媒体轨道
  removeTrack: (sender: RTCRtpSender) => void;

  // 设置轨道处理器 - 返回清理函数以移除处理器
  onTrack: (handler: (event: RTCTrackEvent) => void) => () => void;

  // 请求重新协商（通知 Core 层需要重新创建 Offer）
  requestOfferRenegotiation: () => Promise<boolean>;

  // 触发重新协商
  triggerRenegotiation: () => Promise<boolean>;

  // 内部方法，供核心连接管理器调用
  setPeerConnection: (pc: RTCPeerConnection | null) => void;
  setWebSocket: (ws: WebSocket | null) => void;

}