import { useCallback, useMemo } from 'react';
import { useWebRTCStore, type WebRTCStateManager } from '../ui/webRTCStore';
import { useWebRTCDataChannelManager } from './useWebRTCDataChannelManager';
import { useWebRTCTrackManager } from './useWebRTCTrackManager';
import { useWebRTCConnectionCore } from './useWebRTCConnectionCore';
import type { WebRTCConnection, TrackHandler, Unsubscribe } from './types';

// Re-export the canonical interface for consumers
export type { WebRTCConnection };

/**
 * 共享 WebRTC 连接管理器
 *
 * 职责：
 * 1. 整合 ConnectionCore + DataChannelManager + TrackManager
 * 2. 暴露统一的 WebRTCConnection 接口给所有业务模块
 * 3. 确保单一 PeerConnection 实例被多个功能共享
 */
export function useSharedWebRTCManager(): WebRTCConnection {
  // 从 Zustand store 创建状态管理器
  const store = useWebRTCStore();
  const stateManager: WebRTCStateManager = useMemo(() => ({
    getState: () => ({
      isConnected: store.isConnected,
      isConnecting: store.isConnecting,
      isWebSocketConnected: store.isWebSocketConnected,
      isPeerConnected: store.isPeerConnected,
      error: store.error,
      canRetry: store.canRetry,
      currentRoom: store.currentRoom,
      transportMode: store.transportMode,
    }),
    updateState: store.updateState,
    setCurrentRoom: store.setCurrentRoom,
    resetToInitial: store.resetToInitial,
    isConnectedToRoom: (roomCode: string, role: 'sender' | 'receiver') =>
      store.currentRoom?.code === roomCode &&
      store.currentRoom?.role === role &&
      store.isConnected,
  }), [store]);

  const dataChannelManager = useWebRTCDataChannelManager(stateManager);
  const trackManager = useWebRTCTrackManager(stateManager);
  const connectionCore = useWebRTCConnectionCore(
    stateManager,
    dataChannelManager,
    trackManager,
  );

  // ── createOfferNow 桥接 ──
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
      console.error('[SharedWebRTC] 创建 Offer 失败:', error);
      return false;
    }
  }, [connectionCore, trackManager]);

  // ── registerTrackHandler 桥接 ──
  const registerTrackHandler = useCallback((key: string, handler: TrackHandler): Unsubscribe => {
    return trackManager.registerTrackHandler(key, handler);
  }, [trackManager]);

  return {
    // 只读状态
    isConnected: store.isConnected,
    isConnecting: store.isConnecting,
    isWebSocketConnected: store.isWebSocketConnected,
    isPeerConnected: store.isPeerConnected,
    error: store.error,
    canRetry: store.canRetry,
    transportMode: store.transportMode,
    currentRoom: connectionCore.getCurrentRoom(),

    // 连接管理
    connect: connectionCore.connect,
    disconnect: () => connectionCore.disconnect(true),
    retry: connectionCore.retry,
    isConnectedToRoom: stateManager.isConnectedToRoom,

    // 数据通道
    sendMessage: dataChannelManager.sendMessage,
    sendData: dataChannelManager.sendData,
    registerMessageHandler: dataChannelManager.registerMessageHandler,
    registerDataHandler: dataChannelManager.registerDataHandler,
    getChannelState: dataChannelManager.getChannelState,
    getBufferedAmount: dataChannelManager.getBufferedAmount,
    waitForBufferDrain: dataChannelManager.waitForBufferDrain,

    // 媒体轨道
    addTrack: trackManager.addTrack,
    removeTrack: trackManager.removeTrack,
    registerTrackHandler,
    getPeerConnection: connectionCore.getPeerConnection,
    createOfferNow,
  };
}
