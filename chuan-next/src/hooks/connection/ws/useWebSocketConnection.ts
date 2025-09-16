import { useCallback, useEffect, useRef } from 'react';
import { useWebConnectStateManager } from '../state/useWebConnectStateManager';
import { WebConnectState } from '../state/webConnectStore';
import { ConnectType, DataHandler, IWebConnection, IWebMessage, MessageHandler, Role } from '../types';

/**
 * WebSocket 连接管理器
 * 实现 IWebConnection 接口，提供基于 WebSocket 的数据传输
 * 支持注入外部 WebSocket 连接
 */
export function useWebSocketConnection(): IWebConnection & { injectWebSocket: (ws: WebSocket) => void } {
  const wsRef = useRef<WebSocket | null>(null);
  const currentRoomRef = useRef<{ code: string; role: Role } | null>(null);

  // 事件处理器存储
  const messageHandlers = useRef<Map<string, MessageHandler>>(new Map());
  const dataHandlers = useRef<Map<string, DataHandler>>(new Map());

  // 断开连接回调
  const onDisconnectCallback = useRef<(() => void) | null>(null);

  // 全局状态管理器
  const stateManager = useWebConnectStateManager();

  // 创建稳定的状态管理器引用，避免无限循环
  const stateManagerRef = useRef(stateManager);
  stateManagerRef.current = stateManager;

  // 缓存上次的状态，用于比较是否真正改变
  const lastStateRef = useRef<Partial<WebConnectState>>({});

  // 智能状态更新 - 只在状态真正改变时才更新，使用稳定引用
  const updateState = useCallback((updates: Partial<WebConnectState>) => {
    // 检查状态是否真正改变
    const hasChanged = Object.keys(updates).some(key => {
      const typedKey = key as keyof WebConnectState;
      return lastStateRef.current[typedKey] !== updates[typedKey];
    });

    if (hasChanged) {
      console.log('[WebSocket] 状态更新:', updates);
      lastStateRef.current = { ...lastStateRef.current, ...updates };
      stateManagerRef.current.updateState(updates);
    } else {
      console.log('[WebSocket] 状态未改变，跳过更新:', updates);
    }
  }, []); // 空依赖数组，使用 ref 访问最新的 stateManager

  // 连接到房间
  const connect = useCallback(async (roomCode: string, role: Role) => {
    // 检查是否已经注入了 WebSocket
    if (!wsRef.current) {
      throw new Error('[WebSocket] 尚未注入 WebSocket 连接，请先调用 injectWebSocket');
    }

    const ws = wsRef.current;

    // 检查 WebSocket 状态
    if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
      throw new Error('[WebSocket] 注入的 WebSocket 连接已关闭');
    }

    updateState({ isConnecting: true, error: null, canRetry: false });
    currentRoomRef.current = { code: roomCode, role };

    try {
      console.log('[WebSocket] 使用注入的 WebSocket 连接到房间:', roomCode, '角色:', role);

      // 如果 WebSocket 已经连接，直接更新状态
      if (ws.readyState === WebSocket.OPEN) {
        console.log('[WebSocket] WebSocket 已连接，直接设置为已连接状态');
        updateState({
          isConnected: true,
          isConnecting: false,
          isWebSocketConnected: true,
          isPeerConnected: true,        // 欺骗 UI，让 WebRTC 相关功能正常工作
          isDataChannelConnected: true, // 欺骗 UI，WebSocket 也能传输数据
          isMediaStreamConnected: true, // 欺骗 UI，保证所有功能可用
          state: 'open',               // RTCDataChannelState.open
          error: null,
          canRetry: false
        });
      } else if (ws.readyState === WebSocket.CONNECTING) {
        console.log('[WebSocket] WebSocket 正在连接中，等待连接完成');
        // WebSocket 正在连接中，等待 onopen 事件
      } else {
        throw new Error('[WebSocket] WebSocket 状态异常: ' + ws.readyState);
      }

    } catch (error) {
      console.error('[WebSocket] 连接异常:', error);
      updateState({
        isConnected: false,
        isConnecting: false,
        isWebSocketConnected: false,
        isPeerConnected: false,        // 重置所有 WebRTC 相关状态
        isDataChannelConnected: false,
        isMediaStreamConnected: false,
        state: 'closed',              // RTCDataChannelState.closed
        error: error instanceof Error ? error.message : '无法使用注入的 WebSocket 连接',
        canRetry: true
      });
      throw error;
    }
  }, [updateState]);

  // 处理收到的消息
  const handleMessage = useCallback(async (event: MessageEvent) => {
    try {
      console.log('[WebSocket] 收到消息事件:', typeof event.data, event.data.constructor?.name,
        event.data instanceof ArrayBuffer ? `ArrayBuffer ${event.data.byteLength} bytes` :
          event.data instanceof Blob ? `Blob ${event.data.size} bytes` : 'JSON');

      // 处理二进制数据 - 支持 ArrayBuffer 和 Blob
      if (event.data instanceof ArrayBuffer) {
        // 直接的 ArrayBuffer 数据
        console.log('[WebSocket] 收到 ArrayBuffer 数据:', event.data.byteLength, 'bytes');

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
      } else if (event.data instanceof Blob) {
        // Blob 数据，需要转换为 ArrayBuffer
        console.log('[WebSocket] 收到 Blob 数据:', event.data.size, 'bytes，正在转换为 ArrayBuffer');

        try {
          const arrayBuffer = await event.data.arrayBuffer();
          console.log('[WebSocket] Blob 转换完成，ArrayBuffer 大小:', arrayBuffer.byteLength, 'bytes');

          // 优先发给文件传输处理器
          const fileHandler = dataHandlers.current.get('file-transfer');
          if (fileHandler) {
            fileHandler(arrayBuffer);
          } else {
            // 发给第一个处理器
            const firstHandler = dataHandlers.current.values().next().value;
            if (firstHandler) {
              firstHandler(arrayBuffer);
            }
          }
        } catch (blobError) {
          console.error('[WebSocket] Blob 转换为 ArrayBuffer 失败:', blobError);
        }
      } else if (typeof event.data === 'string') {
        // JSON 消息
        const message = JSON.parse(event.data) as IWebMessage;

        // 特殊处理 disconnection 消息 - 与 WebRTC 保持一致
        if (message.type === 'disconnection') {
          console.log('[WebSocket] 🔌 对方主动断开连接');
          // 更新连接状态
          updateState({
            isPeerConnected: false,
            isConnected: false,
            error: '对方已离开房间',
            stateMsg: null,
            canRetry: true
          });

          // 调用断开连接回调，通知上层应用清除数据
          if (onDisconnectCallback.current) {
            console.log('[WebSocket] 📞 调用断开连接回调');
            onDisconnectCallback.current();
          }
        }
        if (message.type === 'peer-joined') {
          console.log('[WebSocket] 🎉 对方加入房间')
          updateState({
            isPeerConnected: true,
            isConnected: true,
            isWebSocketConnected: true,
            currentConnectType: 'websocket',
            error: null,
            stateMsg: '对方已经加入房间',
            canRetry: true
          });
        }

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
      } else {
        console.warn('[WebSocket] 收到未知数据类型:', typeof event.data, event.data.constructor?.name, event.data);
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
      isPeerConnected: false,        // 重置所有 WebRTC 相关状态
      isDataChannelConnected: false,
      isMediaStreamConnected: false,
      state: 'closed',              // RTCDataChannelState.closed
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
    return { ...stateManagerRef.current.getState() };
  }, []);

  // 检查是否连接到指定房间
  const isConnectedToRoom = useCallback((roomCode: string, role: Role) => {
    return stateManagerRef.current.isConnectedToRoom(roomCode, role);
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

  // 注入外部 WebSocket 连接
  const injectWebSocket = useCallback((ws: WebSocket) => {
    console.log('[WebSocket] 注入外部 WebSocket 连接');

    // 如果已有连接，先断开
    if (wsRef.current) {
      wsRef.current.close();
    }

    wsRef.current = ws;

    // 设置事件处理器
    ws.onopen = () => {
      console.log('[WebSocket] 注入的 WebSocket 连接成功');
      updateState({
        currentConnectType: 'websocket',
        isConnected: true,
        isConnecting: false,
        isWebSocketConnected: true,
        isPeerConnected: true,        // 欺骗 UI，让 WebRTC 相关功能正常工作
        isDataChannelConnected: true, // 欺骗 UI，WebSocket 也能传输数据
        isMediaStreamConnected: true, // 欺骗 UI，保证所有功能可用
        state: 'open',               // RTCDataChannelState.open
        error: null,
        canRetry: false,
      });
    };

    ws.onmessage = (event) => {
      handleMessage(event);
    };

    ws.onerror = (error) => {
      console.error('[WebSocket] 注入的 WebSocket 连接错误:', error);
      updateState({
        isConnected: false,
        isConnecting: false,
        isWebSocketConnected: false,
        isPeerConnected: false,        // 重置所有 WebRTC 相关状态
        isDataChannelConnected: false,
        isMediaStreamConnected: false,
        state: 'closed',              // RTCDataChannelState.closed
        error: 'WebSocket 连接失败',
        canRetry: true
      });
    };

    ws.onclose = (event) => {
      console.log('[WebSocket] 注入的 WebSocket 连接关闭:', event.code, event.reason);
      updateState({
        isConnected: false,
        isConnecting: false,
        isWebSocketConnected: false,
        isPeerConnected: false,        // 重置所有 WebRTC 相关状态
        isDataChannelConnected: false,
        isMediaStreamConnected: false,
        state: 'closed',              // RTCDataChannelState.closed
        error: event.wasClean ? null : 'WebSocket 连接意外断开',
        canRetry: !event.wasClean
      });

      // 调用断开连接回调
      if (onDisconnectCallback.current) {
        console.log('[WebSocket] 调用断开连接回调');
        onDisconnectCallback.current();
      }
    };

    // 如果 WebSocket 已经连接，立即更新状态
    if (ws.readyState === WebSocket.OPEN) {
      console.log('[WebSocket] 注入的 WebSocket 已连接，立即更新状态');
      updateState({
        isConnected: true,
        isConnecting: false,
        isWebSocketConnected: true,
        isPeerConnected: true,        // 欺骗 UI，让 WebRTC 相关功能正常工作
        isDataChannelConnected: true, // 欺骗 UI，WebSocket 也能传输数据
        isMediaStreamConnected: true, // 欺骗 UI，保证所有功能可用
        state: 'open',               // RTCDataChannelState.open
        error: null,
        canRetry: false
      });
    }
  }, [handleMessage, updateState]);

  // 设置断开连接回调
  const setOnDisconnectCallback = useCallback((callback: () => void) => {
    onDisconnectCallback.current = callback;
  }, []);

  // 清理连接
  useEffect(() => {
    return () => {
      // 清理时直接关闭 WebSocket，不调用 disconnect 避免状态更新循环
      if (wsRef.current) {
        console.log('[WebSocket] 组件卸载，清理 WebSocket 连接');
        wsRef.current.close(1000, '组件卸载');
        wsRef.current = null;
      }
      currentRoomRef.current = null;
    };
  }, []); // 空依赖数组，只在组件挂载和卸载时执行

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
    setOnDisconnectCallback,
    injectWebSocket,
  };
}