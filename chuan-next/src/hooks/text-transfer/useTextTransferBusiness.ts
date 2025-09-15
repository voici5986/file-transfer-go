import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebConnectStateManager } from '../connection/state/useWebConnectStateManager';
import { Role, type IWebConnection } from '../connection/types';

// 文本传输状态
interface TextTransferState {
  isConnecting: boolean;
  isConnected: boolean;
  isWebSocketConnected: boolean;
  connectionError: string | null;
  currentText: string; // 当前文本内容
  isTyping: boolean;   // 对方是否在输入
}

// 回调类型
type TextSyncCallback = (text: string) => void;
type TypingStatusCallback = (isTyping: boolean) => void;

const CHANNEL_NAME = 'text-transfer';

/**
 * 文本传输业务层
 * 必须传入共享的 WebRTC 连接
 */
export function useTextTransferBusiness(connection: IWebConnection) {
  const [state, setState] = useState<TextTransferState>({
    isConnecting: false,
    isConnected: false,
    isWebSocketConnected: false,
    connectionError: null,
    currentText: '',
    isTyping: false
  });

const connectState = useWebConnectStateManager(); // 确保状态管理器被初始化

  // 回调引用
  const textSyncCallbackRef = useRef<TextSyncCallback | null>(null);
  const typingCallbackRef = useRef<TypingStatusCallback | null>(null);

  // 更新状态的辅助函数
  const updateState = useCallback((updates: Partial<TextTransferState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // 消息处理器
  const handleMessage = useCallback((message: any) => {
    if (!message.type.startsWith('text-')) return;
    
    console.log('文本传输收到消息:', message.type, message);

    switch (message.type) {
      case 'text-sync':
        // 实时文本同步 - 接收方看到发送方的实时编辑
        if (message.payload && typeof message.payload.text === 'string') {
          updateState({ currentText: message.payload.text });
          
          // 触发文本同步回调
          if (textSyncCallbackRef.current) {
            textSyncCallbackRef.current(message.payload.text);
          }
        }
        break;

      case 'text-typing':
        // 打字状态
        if (typeof message.payload?.typing === 'boolean') {
          updateState({ isTyping: message.payload.typing });
          
          // 触发打字状态回调
          if (typingCallbackRef.current) {
            typingCallbackRef.current(message.payload.typing);
          }
        }
        break;

      default:
        console.warn('未知的文本消息类型:', message.type);
    }
  }, [updateState]);

  // 注册消息处理器
  useEffect(() => {
    const unregister = connection.registerMessageHandler(CHANNEL_NAME, handleMessage);
    return unregister;
  }, [handleMessage]);

  // 监听连接状态变化 (直接使用 connection 的状态)
  useEffect(() => {
    // 同步连接状态
    updateState({
      isConnecting: connectState.getState().isConnecting,
      isConnected: connectState.getState().isConnected,
      isWebSocketConnected: connectState.getState().isWebSocketConnected,
      connectionError: connectState.getState().error
    });
  }, [connectState.getState, updateState]);

  // 连接
  const connect = useCallback((roomCode: string, role: Role) => {
    return connection.connect(roomCode, role);
  }, [connection]);

  // 断开连接
  const disconnect = useCallback(() => {
    return connection.disconnect();
  }, [connection]);

  // 发送实时文本同步 (替代原来的 sendMessage)
  const sendTextSync = useCallback((text: string) => {
    if (!connectState.getState().isConnected || !connection.getConnectState().isPeerConnected) return;
    
    const message = {
      type: 'text-sync',
      payload: { text }
    };
    
    const success = connection.sendMessage(message, CHANNEL_NAME);
    if (success) {
      console.log('发送实时文本同步:', text.length, '字符');
    }
  }, [connectState.getState]);

  // 发送打字状态
  const sendTypingStatus = useCallback((isTyping: boolean) => {
    if (!connection || !connection.getConnectState().isPeerConnected) return;
    
    const message = {
      type: 'text-typing',
      payload: { typing: isTyping }
    };
    
    const success = connection.sendMessage(message, CHANNEL_NAME);
    if (success) {
      console.log('发送打字状态:', isTyping);
    }
  }, [connection]);

  // 设置文本同步回调
  const onTextSync = useCallback((callback: TextSyncCallback) => {
    textSyncCallbackRef.current = callback;
    
    // 返回清理函数
    return () => {
      textSyncCallbackRef.current = null;
    };
  }, []);

  // 设置打字状态回调
  const onTypingStatus = useCallback((callback: TypingStatusCallback) => {
    typingCallbackRef.current = callback;
    
    // 返回清理函数
    return () => {
      typingCallbackRef.current = null;
    };
  }, []);

  return {
    // 状态 - 直接从 connection 获取
    isConnecting: connection.getConnectState().isConnecting,
    isConnected: connection.getConnectState().isConnected,
    isWebSocketConnected: connection.getConnectState().isWebSocketConnected,
    connectionError: connection.getConnectState().error,
    currentText: state.currentText,
    isTyping: state.isTyping,
    
    // 操作方法
    connect,
    disconnect,
    sendTextSync,
    sendTypingStatus,
    
    // 回调设置
    onTextSync,
    onTypingStatus
  };
}
