import { create } from 'zustand';

export interface WebRTCState {
  isConnected: boolean;
  isConnecting: boolean;
  isWebSocketConnected: boolean;
  isPeerConnected: boolean;
  error: string | null;
  canRetry: boolean;
  currentRoom: { code: string; role: 'sender' | 'receiver' } | null;
}

/**
 * WebRTC 状态管理器接口
 * 供 ConnectionCore / DataChannelManager / TrackManager 作为参数使用
 */
export interface WebRTCStateManager {
  getState: () => WebRTCState;
  updateState: (updates: Partial<WebRTCState>) => void;
  setCurrentRoom: (room: { code: string; role: 'sender' | 'receiver' } | null) => void;
  resetToInitial: () => void;
  isConnectedToRoom: (roomCode: string, role: 'sender' | 'receiver') => boolean;
}

interface WebRTCStore extends WebRTCState {
  updateState: (updates: Partial<WebRTCState>) => void;
  setCurrentRoom: (room: { code: string; role: 'sender' | 'receiver' } | null) => void;
  reset: () => void;
  resetToInitial: () => void;
}

const initialState: WebRTCState = {
  isConnected: false,
  isConnecting: false,
  isWebSocketConnected: false,
  isPeerConnected: false,
  error: null,
  canRetry: false,
  currentRoom: null,
};

export const useWebRTCStore = create<WebRTCStore>((set) => ({
  ...initialState,
  
  updateState: (updates) => set((state) => ({
    ...state,
    ...updates,
  })),
  
  setCurrentRoom: (room) => set((state) => ({
    ...state,
    currentRoom: room,
  })),
  
  reset: () => set(initialState),
  
  resetToInitial: () => set(initialState),
}));
