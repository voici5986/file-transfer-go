import { useCallback } from 'react';
import { useWebConnectStateManager } from '../state/useWebConnectStateManager';
import { IGetConnectState, IRegisterEventHandler, IWebConnection } from '../types';
import { useWebRTCConnectionCore } from './useWebRTCConnectionCore';
import { useWebRTCDataChannelManager } from './useWebRTCDataChannelManager';
import { useWebRTCTrackManager } from './useWebRTCTrackManager';


/**
 * 共享 WebRTC 连接管理器
 * 创建单一的 WebRTC 连接实例，供多个业务模块共享使用
 * 整合所有模块，提供统一的接口
 * 
 * webrtc 实现 - 初始化时不需要 WebSocket，通过 injectWebSocket 动态注入
 * 
 */
export function useSharedWebRTCManagerImpl(): IWebConnection & IRegisterEventHandler & IGetConnectState & {
  injectWebSocket: (ws: WebSocket) => void;
} {
  // 创建各个管理器实例
  const stateManager = useWebConnectStateManager();
  const dataChannelManager = useWebRTCDataChannelManager(stateManager);
  const trackManager = useWebRTCTrackManager(stateManager);
  const connectionCore = useWebRTCConnectionCore(
    stateManager,
    dataChannelManager,
    trackManager
  );

  // 创建 createOfferNow 方法
  const createOfferNow = useCallback(async () => {
    const pc = connectionCore.getPeerConnection();
    const ws = connectionCore.getWebSocket();
    if (!pc || !ws) {
      console.error('[SharedWebRTC] PeerConnection 或 WebSocket 不可用');
      return false;
    }

    try {
      return await connectionCore.createOfferForMedia();
    } catch (error) {
      console.error('[SharedWebRTC] 创建 offer 失败:', error);
      return false;
    }
  }, [connectionCore, trackManager]);

  // 返回统一的接口，保持与当前 API 一致
  return {
    // 状态
    connectType: 'webrtc',

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
    getConnectState: stateManager.getState,
    isConnectedToRoom: stateManager.isConnectedToRoom,

    // 媒体轨道方法
    addTrack: trackManager.addTrack,
    removeTrack: trackManager.removeTrack,
    onTrack: trackManager.onTrack,
    getPeerConnection: connectionCore.getPeerConnection,
    createOfferNow,

    // 断开连接回调
    setOnDisconnectCallback: connectionCore.setOnDisconnectCallback,

    // 当前房间信息
    currentRoom: connectionCore.getCurrentRoom(),

    // WebSocket 注入方法
    injectWebSocket: connectionCore.injectWebSocket,
  };
}
