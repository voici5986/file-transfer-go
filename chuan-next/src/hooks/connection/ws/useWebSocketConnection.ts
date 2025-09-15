import { useCallback, useEffect, useRef } from 'react';
import { WebConnectState } from '../state/webConnectStore';
import { ConnectType, DataHandler, IWebConnection, IWebMessage, MessageHandler, Role } from '../types';

/**
 * WebSocket 连接管理器
 * 实现 IWebConnection 接口，提供基于 WebSocket 的数据传输
 */
export function useWebSocketConnection(): IWebConnection {
  const wsRef = useRef<WebSocket | null>(null);
  const currentRoomRef = useRef<{ code: string; role: Role } | null>(null);
  
  // 事件处理器存储
  const messageHandlers = useRef<Map<string, MessageHandler>>(new Map());
  const dataHandlers = useRef<Map<string, DataHandler>>(new Map());
  
  // 连接状态
  const connectionState = useRef<WebConnectState>({
    isConnected: false,
    isConnecting: false,
    isWebSocketConnected: false,
    isPeerConnected: false,
    isDataChannelConnected: false,
    isMediaStreamConnected: false,
    currentConnectType: 'websocket',
    state: 'closed',
    error: null,
    canRetry: false,
    currentRoom: null
  });

  // 更新连接状态
  const updateState = useCallback((updates: Partial<WebConnectState>) => {
    connectionState.current = {
      ...connectionState.current,
      ...updates
    };
  }, []);

  // 连接到房间
  const connect = useCallback(async (roomCode: string, role: Role) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] 已存在连接，先断开');
      disconnect();
    }

    updateState({ isConnecting: true, error: null, canRetry: false });
    currentRoomRef.current = { code: roomCode, role };

    try {
      // 构建 WebSocket URL
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const host = window.location.host;
      const wsUrl = `${protocol}//${host}/api/ws/${roomCode}?role=${role}`;
      
      console.log('[WebSocket] 连接到:', wsUrl);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // 连接成功
      ws.onopen = () => {
        console.log('[WebSocket] 连接成功');
        updateState({
          isConnected: true,
          isConnecting: false,
          isWebSocketConnected: true,
          error: null,
          canRetry: false
        });
      };

      // 接收消息
      ws.onmessage = (event) => {
        handleMessage(event);
      };

      // 连接错误
      ws.onerror = (error) => {
        console.error('[WebSocket] 连接错误:', error);
        updateState({
          isConnected: false,
          isConnecting: false,
          isWebSocketConnected: false,
          error: 'WebSocket 连接失败',
          canRetry: true
        });
      };

      // 连接关闭
      ws.onclose = (event) => {
        console.log('[WebSocket] 连接关闭:', event.code, event.reason);
        updateState({
          isConnected: false,
          isConnecting: false,
          isWebSocketConnected: false,
          error: event.wasClean ? null : 'WebSocket 连接意外断开',
          canRetry: !event.wasClean
        });
      };

    } catch (error) {
      console.error('[WebSocket] 连接异常:', error);
      updateState({
        isConnected: false,
        isConnecting: false,
        isWebSocketConnected: false,
        error: '无法建立 WebSocket 连接',
        canRetry: true
      });
    }
  }, [updateState]);

  // 处理收到的消息
  const handleMessage = useCallback((event: MessageEvent) => {
    try {
      if (typeof event.data === 'string') {
        // JSON 消息
        const message = JSON.parse(event.data) as IWebMessage;
        console.log('[WebSocket] 收到消息:', message.type, message.channel || 'default');

        // 根据通道分发消息
        if (message.channel) {
          const handler = messageHandlers.current.get(message.channel);
          if (handler) {
            handler(message);
          }
        } else {
          // 广播给所有处理器
          messageHandlers.current.forEach(handler => handler(message));
        }
      } else if (event.data instanceof ArrayBuffer) {
        // 二进制数据
        console.log('[WebSocket] 收到二进制数据:', event.data.byteLength, 'bytes');
        
        // 优先发给文件传输处理器
        const fileHandler = dataHandlers.current.get('file-transfer');
        if (fileHandler) {
          fileHandler(event.data);
        } else {
          // 发给第一个处理器
          const firstHandler = dataHandlers.current.values().next().value;
          if (firstHandler) {
            firstHandler(event.data);
          }
        }
      }
    } catch (error) {
      console.error('[WebSocket] 处理消息失败:', error);
    }
  }, []);

  // 断开连接
  const disconnect = useCallback(() => {
    if (wsRef.current) {
      console.log('[WebSocket] 主动断开连接');
      wsRef.current.close(1000, '用户主动断开');
      wsRef.current = null;
    }
    currentRoomRef.current = null;
    updateState({
      isConnected: false,
      isConnecting: false,
      isWebSocketConnected: false,
      error: null,
      canRetry: false
    });
  }, [updateState]);

  // 重试连接
  const retry = useCallback(async () => {
    if (currentRoomRef.current) {
      console.log('[WebSocket] 重试连接');
      await connect(currentRoomRef.current.code, currentRoomRef.current.role);
    }
  }, [connect]);

  // 发送消息
  const sendMessage = useCallback((message: IWebMessage, channel?: string) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[WebSocket] 连接未就绪，无法发送消息');
      return false;
    }

    try {
      const messageWithChannel = channel ? { ...message, channel } : message;
      ws.send(JSON.stringify(messageWithChannel));
      console.log('[WebSocket] 发送消息:', message.type, channel || 'default');
      return true;
    } catch (error) {
      console.error('[WebSocket] 发送消息失败:', error);
      return false;
    }
  }, []);

  // 发送二进制数据
  const sendData = useCallback((data: ArrayBuffer) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.error('[WebSocket] 连接未就绪，无法发送数据');
      return false;
    }

    try {
      ws.send(data);
      console.log('[WebSocket] 发送二进制数据:', data.byteLength, 'bytes');
      return true;
    } catch (error) {
      console.error('[WebSocket] 发送数据失败:', error);
      return false;
    }
  }, []);

  // 注册消息处理器
  const registerMessageHandler = useCallback((channel: string, handler: MessageHandler) => {
    console.log('[WebSocket] 注册消息处理器:', channel);
    messageHandlers.current.set(channel, handler);

    return () => {
      console.log('[WebSocket] 取消注册消息处理器:', channel);
      messageHandlers.current.delete(channel);
    };
  }, []);

  // 注册数据处理器
  const registerDataHandler = useCallback((channel: string, handler: DataHandler) => {
    console.log('[WebSocket] 注册数据处理器:', channel);
    dataHandlers.current.set(channel, handler);

    return () => {
      console.log('[WebSocket] 取消注册数据处理器:', channel);
      dataHandlers.current.delete(channel);
    };
  }, []);

  // 获取连接状态
  const getConnectState = useCallback((): WebConnectState => {
    return { ...connectionState.current };
  }, []);

  // 检查是否连接到指定房间
  const isConnectedToRoom = useCallback((roomCode: string, role: Role) => {
    return currentRoomRef.current?.code === roomCode &&
           currentRoomRef.current?.role === role &&
           connectionState.current.isConnected;
  }, []);

  // 媒体轨道方法（WebSocket 不支持，返回 null）
  const addTrack = useCallback(() => {
    console.warn('[WebSocket] WebSocket 不支持媒体轨道');
    return null;
  }, []);

  const removeTrack = useCallback(() => {
    console.warn('[WebSocket] WebSocket 不支持媒体轨道');
  }, []);

  const onTrack = useCallback(() => {
    console.warn('[WebSocket] WebSocket 不支持媒体轨道');
  }, []);

  const getPeerConnection = useCallback(() => {
    console.warn('[WebSocket] WebSocket 不支持 PeerConnection');
    return null;
  }, []);

  const createOfferNow = useCallback(async () => {
    console.warn('[WebSocket] WebSocket 不支持创建 Offer');
    return false;
  }, []);

  // 清理连接
  useEffect(() => {
    return () => {
      disconnect();
    };
  }, [disconnect]);

  return {
    connectType: 'websocket' as ConnectType,
    connect,
    disconnect,
    retry,
    sendMessage,
    sendData,
    registerMessageHandler,
    registerDataHandler,
    getConnectState,
    isConnectedToRoom,
    currentRoom: currentRoomRef.current,
    addTrack,
    removeTrack,
    onTrack,
    getPeerConnection,
    createOfferNow,
  };
}