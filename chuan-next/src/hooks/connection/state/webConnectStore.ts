import { create } from 'zustand';
import { Role } from '../types';

export interface WebConnectState {
  isConnected: boolean;
  isConnecting: boolean;
  isWebSocketConnected: boolean;
  isPeerConnected: boolean;
  isDataChannelConnected: boolean;
  isMediaStreamConnected: boolean;
  currentConnectType: 'webrtc' | 'websocket';
  currentIsLocalNetWork: boolean; // 可选，表示当前是否在局域网内
  state: RTCDataChannelState;
  stateMsg: string | null;
  error: string | null;
  canRetry: boolean;  // 新增：是否可以重试
  currentRoom: { code: string; role: Role } | null;
}

interface WebRTCStore extends WebConnectState {
  updateState: (updates: Partial<WebConnectState>) => void;
  setCurrentRoom: (room: { code: string; role: Role } | null) => void;
  reset: () => void;
  resetToInitial: () => void;  // 新增：完全重置到初始状态
}

const initialState: WebConnectState = {
  isConnected: false,
  isConnecting: false,
  currentIsLocalNetWork: false,
  isWebSocketConnected: false,
  isPeerConnected: false,
  error: null,
  canRetry: false, // 初始状态下不需要重试
  currentRoom: null,
  stateMsg: null,
  isDataChannelConnected: false,
  isMediaStreamConnected: false,
  currentConnectType: 'webrtc',
  state: 'closed'
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

  resetToInitial: () => set(initialState),  // 完全重置到初始状态
}));
