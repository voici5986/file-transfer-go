import { useState, useCallback, useRef, useEffect } from 'react';
import type { WebRTCConnection } from '../connection/types';

// 文本传输业务状态（仅业务相关字段，连接状态直接从 connection 读取）
interface TextTransferState {
  currentText: string; // 对端同步过来的文本内容
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
export function useTextTransferBusiness(connection: WebRTCConnection) {
  const [state, setState] = useState<TextTransferState>({
    currentText: '',
    isTyping: false,
  });

  // 回调引用
  const textSyncCallbackRef = useRef<TextSyncCallback | null>(null);
  const typingCallbackRef = useRef<TypingStatusCallback | null>(null);

  // 消息处理器
  const handleMessage = useCallback((message: any) => {
    if (!message.type.startsWith('text-')) return;

    switch (message.type) {
      case 'text-sync':
        if (message.payload && typeof message.payload.text === 'string') {
          setState(prev => ({ ...prev, currentText: message.payload.text }));
          textSyncCallbackRef.current?.(message.payload.text);
        }
        break;

      case 'text-typing':
        if (typeof message.payload?.typing === 'boolean') {
          setState(prev => ({ ...prev, isTyping: message.payload.typing }));
          typingCallbackRef.current?.(message.payload.typing);
        }
        break;
    }
  }, []);

  // 注册消息处理器
  const registerMessageHandler = connection.registerMessageHandler;
  useEffect(() => {
    return registerMessageHandler(CHANNEL_NAME, handleMessage);
  }, [registerMessageHandler, handleMessage]);

  // 连接管理（透传）
  const connect = useCallback((roomCode: string, role: 'sender' | 'receiver') => {
    return connection.connect(roomCode, role);
  }, [connection]);

  const disconnect = useCallback(() => {
    return connection.disconnect();
  }, [connection]);

  // 发送实时文本同步
  const sendTextSync = useCallback((text: string) => {
    if (!connection.isPeerConnected) return;
    connection.sendMessage({ type: 'text-sync', payload: { text } }, CHANNEL_NAME);
  }, [connection]);

  // 发送打字状态
  const sendTypingStatus = useCallback((isTyping: boolean) => {
    if (!connection.isPeerConnected) return;
    connection.sendMessage({ type: 'text-typing', payload: { typing: isTyping } }, CHANNEL_NAME);
  }, [connection]);

  // 回调注册（返回清理函数）
  const onTextSync = useCallback((callback: TextSyncCallback) => {
    textSyncCallbackRef.current = callback;
    return () => { textSyncCallbackRef.current = null; };
  }, []);

  const onTypingStatus = useCallback((callback: TypingStatusCallback) => {
    typingCallbackRef.current = callback;
    return () => { typingCallbackRef.current = null; };
  }, []);

  return {
    // 连接状态（直接读 connection，不做冗余同步）
    isConnecting: connection.isConnecting,
    isConnected: connection.isConnected,
    isWebSocketConnected: connection.isWebSocketConnected,
    connectionError: connection.error,

    // 业务状态
    currentText: state.currentText,
    isTyping: state.isTyping,

    // 操作方法
    connect,
    disconnect,
    sendTextSync,
    sendTypingStatus,

    // 回调设置
    onTextSync,
    onTypingStatus,
  };
}
