import { useCallback } from 'react';
import { useWebRTCStateManager } from './useWebRTCStateManager';
import { useWebRTCDataChannelManager, WebRTCMessage } from './useWebRTCDataChannelManager';
import { useWebRTCTrackManager } from './useWebRTCTrackManager';
import { useWebRTCConnectionCore } from './useWebRTCConnectionCore';

// 消息和数据处理器类型
export type MessageHandler = (message: WebRTCMessage) => void;
export type DataHandler = (data: ArrayBuffer) => void;

// WebRTC 连接接口
export interface WebRTCConnection {
  // 状态
  isConnected: boolean;
  isConnecting: boolean;
  isWebSocketConnected: boolean;
  isPeerConnected: boolean;
  error: string | null;
  canRetry: boolean;

  // 操作方法
  connect: (roomCode: string, role: 'sender' | 'receiver') => Promise<void>;
  disconnect: () => void;
  retry: () => Promise<void>;
  sendMessage: (message: WebRTCMessage, channel?: string) => boolean;
  sendData: (data: ArrayBuffer) => boolean;

  // 处理器注册
  registerMessageHandler: (channel: string, handler: MessageHandler) => () => void;
  registerDataHandler: (channel: string, handler: DataHandler) => () => void;

  // 工具方法
  getChannelState: () => RTCDataChannelState;
  isConnectedToRoom: (roomCode: string, role: 'sender' | 'receiver') => boolean;

  // 当前房间信息
  currentRoom: { code: string; role: 'sender' | 'receiver' } | null;

  // 媒体轨道方法
  addTrack: (track: MediaStreamTrack, stream: MediaStream) => RTCRtpSender | null;
  removeTrack: (sender: RTCRtpSender) => void;
  onTrack: (callback: (event: RTCTrackEvent) => void) => void;
  getPeerConnection: () => RTCPeerConnection | null;
  createOfferNow: () => Promise<boolean>;
}

/**
 * 共享 WebRTC 连接管理器
 * 创建单一的 WebRTC 连接实例，供多个业务模块共享使用
 * 整合所有模块，提供统一的接口
 */
export function useSharedWebRTCManager(): WebRTCConnection {
  // 创建各个管理器实例
  const stateManager = useWebRTCStateManager();
  const dataChannelManager = useWebRTCDataChannelManager(stateManager);
  const trackManager = useWebRTCTrackManager(stateManager);
  const connectionCore = useWebRTCConnectionCore(
    stateManager,
    dataChannelManager,
    trackManager
  );

  // 获取当前状态
  const state = stateManager.getState();

  // 创建 createOfferNow 方法
  const createOfferNow = useCallback(async () => {
    const pc = connectionCore.getPeerConnection();
    const ws = connectionCore.getWebSocket();
    if (!pc || !ws) {
      console.error('[SharedWebRTC] PeerConnection 或 WebSocket 不可用');
      return false;
    }
    
    try {
      return await trackManager.createOfferNow(pc, ws);
    } catch (error) {
      console.error('[SharedWebRTC] 创建 offer 失败:', error);
      return false;
    }
  }, [connectionCore, trackManager]);

  // 返回统一的接口，保持与当前 API 一致
  return {
    // 状态
    isConnected: state.isConnected,
    isConnecting: state.isConnecting,
    isWebSocketConnected: state.isWebSocketConnected,
    isPeerConnected: state.isPeerConnected,
    error: state.error,
    canRetry: state.canRetry,

    // 操作方法
    connect: connectionCore.connect,
    disconnect: () => connectionCore.disconnect(true),
    retry: connectionCore.retry,
    sendMessage: dataChannelManager.sendMessage,
    sendData: dataChannelManager.sendData,

    // 处理器注册
    registerMessageHandler: dataChannelManager.registerMessageHandler,
    registerDataHandler: dataChannelManager.registerDataHandler,

    // 工具方法
    getChannelState: dataChannelManager.getChannelState,
    isConnectedToRoom: stateManager.isConnectedToRoom,

    // 媒体轨道方法
    addTrack: trackManager.addTrack,
    removeTrack: trackManager.removeTrack,
    onTrack: trackManager.onTrack,
    getPeerConnection: connectionCore.getPeerConnection,
    createOfferNow,

    // 当前房间信息
    currentRoom: connectionCore.getCurrentRoom(),
  };
}
