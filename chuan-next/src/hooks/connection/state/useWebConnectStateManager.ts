import { useCallback } from 'react';
import { Role } from '../types';
import { useWebRTCStore, type WebConnectState } from './webConnectStore';



/**
 * WebRTC 状态管理器
 * 负责连接状态的统一管理
 */
export interface IWebConnectStateManager {
  // 获取当前状态
  getState: () => Readonly<WebConnectState>;

  // 更新状态
  updateState: (updates: Partial<WebConnectState>) => void;

  // 设置当前房间
  setCurrentRoom: (room: { code: string; role: Role } | null) => void;

  // 重置到初始状态
  resetToInitial: () => void;

  // 检查是否已连接到指定房间
  isConnectedToRoom: (roomCode: string, role: Role) => boolean;
}

export interface IUseReadConnectState {
  getConnectState: () => Readonly<WebConnectState>;
}


export function useReadConnectState(): IUseReadConnectState {
  const webrtcStore = useWebRTCStore();
  const getConnectState = useCallback((): Readonly<WebConnectState> => {
    return webrtcStore;
  }, [webrtcStore]);
  return {
    getConnectState
  };
}


/**
 * WebRTC 状态管理 Hook
 * 封装对 webRTCStore 的操作，提供状态更新和查询的统一接口
 */
export function useWebConnectStateManager(): IWebConnectStateManager {
  const webrtcStore = useWebRTCStore();

  const getState = useCallback((): WebConnectState => {
    return webrtcStore;
  }, [webrtcStore]);

  const updateState = useCallback((updates: Partial<WebConnectState>) => {
    webrtcStore.updateState(updates);
  }, [webrtcStore]);

  const setCurrentRoom = useCallback((room: { code: string; role: Role } | null) => {
    webrtcStore.setCurrentRoom(room);
  }, [webrtcStore]);

  const resetToInitial = useCallback(() => {
    webrtcStore.resetToInitial();
  }, [webrtcStore]);

  const isConnectedToRoom = useCallback((roomCode: string, role: Role) => {
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