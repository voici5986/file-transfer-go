import { useCallback } from 'react';
import { useWebRTCStore } from '../ui/webRTCStore';

// 基础连接状态
export interface WebRTCState {
  isConnected: boolean;
  isConnecting: boolean;
  isWebSocketConnected: boolean;
  isPeerConnected: boolean;
  error: string | null;
  canRetry: boolean;
}

/**
 * WebRTC 状态管理器
 * 负责连接状态的统一管理
 */
export interface WebRTCStateManager {
  // 获取当前状态
  getState: () => WebRTCState;
  
  // 更新状态
  updateState: (updates: Partial<WebRTCState>) => void;
  
  // 设置当前房间
  setCurrentRoom: (room: { code: string; role: 'sender' | 'receiver' } | null) => void;
  
  // 重置到初始状态
  resetToInitial: () => void;
  
  // 检查是否已连接到指定房间
  isConnectedToRoom: (roomCode: string, role: 'sender' | 'receiver') => boolean;
}

/**
 * WebRTC 状态管理 Hook
 * 封装对 webRTCStore 的操作，提供状态更新和查询的统一接口
 */
export function useWebRTCStateManager(): WebRTCStateManager {
  const webrtcStore = useWebRTCStore();

  const getState = useCallback((): WebRTCState => {
    return {
      isConnected: webrtcStore.isConnected,
      isConnecting: webrtcStore.isConnecting,
      isWebSocketConnected: webrtcStore.isWebSocketConnected,
      isPeerConnected: webrtcStore.isPeerConnected,
      error: webrtcStore.error,
      canRetry: webrtcStore.canRetry,
    };
  }, [webrtcStore]);

  const updateState = useCallback((updates: Partial<WebRTCState>) => {
    webrtcStore.updateState(updates);
  }, [webrtcStore]);

  const setCurrentRoom = useCallback((room: { code: string; role: 'sender' | 'receiver' } | null) => {
    webrtcStore.setCurrentRoom(room);
  }, [webrtcStore]);

  const resetToInitial = useCallback(() => {
    webrtcStore.resetToInitial();
  }, [webrtcStore]);

  const isConnectedToRoom = useCallback((roomCode: string, role: 'sender' | 'receiver') => {
    return webrtcStore.currentRoom?.code === roomCode &&
      webrtcStore.currentRoom?.role === role &&
      webrtcStore.isConnected;
  }, [webrtcStore]);

  return {
    getState,
    updateState,
    setCurrentRoom,
    resetToInitial,
    isConnectedToRoom,
  };
}