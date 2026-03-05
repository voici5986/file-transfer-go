import { useRef, useCallback } from 'react';
import { WebRTCStateManager } from '../ui/webRTCStore';

// 消息类型
export interface WebRTCMessage {
  type: string;
  payload: any;
  channel?: string;
}

// 消息和数据处理器类型
export type MessageHandler = (message: WebRTCMessage) => void;
export type DataHandler = (data: ArrayBuffer) => void;

/**
 * WebRTC 数据通道管理器
 * 负责数据通道的创建和管理，支持 P2P DataChannel 和 WS Relay 两种传输模式
 */
export interface WebRTCDataChannelManager {
  // 创建数据通道 (P2P 模式)
  createDataChannel: (pc: RTCPeerConnection, role: 'sender' | 'receiver', isReconnect?: boolean) => void;
  
  // 切换到 WS 中继模式（仅设置发送引用，不设置事件监听）
  switchToRelay: (relayWs: WebSocket) => void;
  
  // 关闭中继连接
  closeRelay: () => void;
  
  // 处理中继收到的数据消息（由 ConnectionCore 的 onmessage 调用）
  handleRelayMessage: (event: MessageEvent) => void;
  
  // 发送消息（自动选择可用通道）
  sendMessage: (message: WebRTCMessage, channel?: string) => boolean;
  
  // 发送二进制数据（自动选择可用通道）
  sendData: (data: ArrayBuffer) => boolean;
  
  // 注册消息处理器
  registerMessageHandler: (channel: string, handler: MessageHandler) => () => void;
  
  // 注册数据处理器
  registerDataHandler: (channel: string, handler: DataHandler) => () => void;
  
  // 获取数据通道状态（兼容 RTCDataChannelState）
  getChannelState: () => RTCDataChannelState;
  
  // 获取当前缓冲区大小
  getBufferedAmount: () => number;
  
  // 等待缓冲区排空到指定阈值以下
  waitForBufferDrain: (threshold?: number) => Promise<void>;
  
  // 处理数据通道消息 (P2P)
  handleDataChannelMessage: (event: MessageEvent) => void;
}

/**
 * WebRTC 数据通道管理 Hook
 * 负责数据通道的创建和管理，处理数据通道消息的发送和接收
 * 支持 P2P DataChannel 和 WS Relay 两种传输模式，对上层透明
 */
export function useWebRTCDataChannelManager(
  stateManager: WebRTCStateManager
): WebRTCDataChannelManager {
  const dcRef = useRef<RTCDataChannel | null>(null);
  // WS 中继通道
  const relayWsRef = useRef<WebSocket | null>(null);
  
  // 多通道消息处理器
  const messageHandlers = useRef<Map<string, MessageHandler>>(new Map());
  const dataHandlers = useRef<Map<string, DataHandler>>(new Map());

  // 判断当前是否处于中继模式
  const isRelayMode = useCallback(() => {
    return relayWsRef.current !== null && relayWsRef.current.readyState === WebSocket.OPEN;
  }, []);

  // 判断 P2P 数据通道是否可用
  const isP2PAvailable = useCallback(() => {
    return dcRef.current !== null && dcRef.current.readyState === 'open';
  }, []);

  // 创建数据通道 (P2P 模式)
  const createDataChannel = useCallback((
    pc: RTCPeerConnection, 
    role: 'sender' | 'receiver', 
    isReconnect: boolean = false
  ) => {
    console.log('[DataChannelManager] 创建数据通道...', { role, isReconnect });
    
    // 如果已经存在数据通道，先关闭它
    if (dcRef.current) {
      console.log('[DataChannelManager] 关闭已存在的数据通道');
      dcRef.current.close();
      dcRef.current = null;
    }

    // 数据通道处理
    if (role === 'sender') {
      const dataChannel = pc.createDataChannel('shared-channel', {
        ordered: true
      });
      dcRef.current = dataChannel;

      dataChannel.onopen = () => {
        console.log('[DataChannelManager] 数据通道已打开 (发送方)');
        // 如果之前在中继模式，切回 P2P
        if (relayWsRef.current) {
          console.log('[DataChannelManager] P2P 恢复，关闭中继通道');
          relayWsRef.current.close();
          relayWsRef.current = null;
          stateManager.updateState({ transportMode: 'p2p' });
        }
        // 确保所有连接状态都正确更新
        stateManager.updateState({
          isWebSocketConnected: true,
          isConnected: true,
          isPeerConnected: true,
          error: null,
          isConnecting: false,
          canRetry: false
        });
        
        // 如果是重新连接，触发数据同步
        if (isReconnect) {
          console.log('[DataChannelManager] 发送方重新连接，数据通道已打开，准备同步数据');
          setTimeout(() => {
            if (dataChannel.readyState === 'open') {
              dataChannel.send(JSON.stringify({
                type: 'sync-request',
                payload: { timestamp: Date.now() }
              }));
              console.log('[DataChannelManager] 发送方发送数据同步请求');
            }
          }, 300);
        }
      };
    

      dataChannel.onmessage = handleDataChannelMessage;

      dataChannel.onerror = (error) => {
        console.error('[DataChannelManager] 数据通道错误:', error);
        
        let errorMessage = '数据通道连接失败';
        let shouldRetry = false;
        
        switch (dataChannel.readyState) {
          case 'connecting':
            errorMessage = '数据通道正在连接中，请稍候...';
            shouldRetry = true;
            break;
          case 'closing':
            errorMessage = '数据通道正在关闭，连接即将断开';
            break;
          case 'closed':
            errorMessage = '数据通道已关闭，P2P连接失败';
            shouldRetry = true;
            break;
          default:
            if (pc) {
              switch (pc.connectionState) {
                case 'failed':
                  errorMessage = 'P2P连接失败，可能是网络防火墙阻止了连接，请尝试切换网络或使用VPN';
                  shouldRetry = true;
                  break;
                case 'disconnected':
                  errorMessage = 'P2P连接已断开，网络可能不稳定';
                  shouldRetry = true;
                  break;
                default:
                  errorMessage = '数据通道连接失败，可能是网络环境受限';
                  shouldRetry = true;
              }
            }
        }
        
        console.error(`[DataChannelManager] 数据通道详细错误 - 状态: ${dataChannel.readyState}, 消息: ${errorMessage}, 建议重试: ${shouldRetry}`);
        
        // 如果已经在中继模式，不更新错误状态
        if (!isRelayMode()) {
          stateManager.updateState({
            error: errorMessage,
            isConnecting: false,
            isPeerConnected: false,
            canRetry: shouldRetry
          });
        }
      };
    } else {
      pc.ondatachannel = (event) => {
        const dataChannel = event.channel;
        dcRef.current = dataChannel;

        dataChannel.onopen = () => {
          console.log('[DataChannelManager] 数据通道已打开 (接收方)');
          // 如果之前在中继模式，切回 P2P
          if (relayWsRef.current) {
            console.log('[DataChannelManager] P2P 恢复，关闭中继通道');
            relayWsRef.current.close();
            relayWsRef.current = null;
            stateManager.updateState({ transportMode: 'p2p' });
          }
          stateManager.updateState({
            isWebSocketConnected: true,
            isConnected: true,
            isPeerConnected: true,
            error: null,
            isConnecting: false,
            canRetry: false
          });
          
          if (isReconnect) {
            console.log('[DataChannelManager] 接收方重新连接，数据通道已打开，准备同步数据');
            setTimeout(() => {
              if (dataChannel.readyState === 'open') {
                dataChannel.send(JSON.stringify({
                  type: 'sync-request',
                  payload: { timestamp: Date.now() }
                }));
                console.log('[DataChannelManager] 接收方发送数据同步请求');
              }
            }, 300);
          }
        };

        dataChannel.onmessage = handleDataChannelMessage;

        dataChannel.onerror = (error) => {
          console.error('[DataChannelManager] 数据通道错误 (接收方):', error);
          
          let errorMessage = '数据通道连接失败';
          let shouldRetry = false;
          
          switch (dataChannel.readyState) {
            case 'connecting':
              errorMessage = '数据通道正在连接中，请稍候...';
              shouldRetry = true;
              break;
            case 'closing':
              errorMessage = '数据通道正在关闭，连接即将断开';
              break;
            case 'closed':
              errorMessage = '数据通道已关闭，P2P连接失败';
              shouldRetry = true;
              break;
            default:
              if (pc) {
                switch (pc.connectionState) {
                  case 'failed':
                    errorMessage = 'P2P连接失败，可能是网络防火墙阻止了连接，请尝试切换网络或使用VPN';
                    shouldRetry = true;
                    break;
                  case 'disconnected':
                    errorMessage = 'P2P连接已断开，网络可能不稳定';
                    shouldRetry = true;
                    break;
                  default:
                    errorMessage = '数据通道连接失败，可能是网络环境受限';
                    shouldRetry = true;
                }
              }
          }
          
          console.error(`[DataChannelManager] 数据通道详细错误 (接收方) - 状态: ${dataChannel.readyState}, 消息: ${errorMessage}, 建议重试: ${shouldRetry}`);
          
          // 如果已经在中继模式，不更新错误状态
          if (!isRelayMode()) {
            stateManager.updateState({
              error: errorMessage,
              isConnecting: false,
              isPeerConnected: false,
              canRetry: shouldRetry
            });
          }
        };
      };
    }

    console.log('[DataChannelManager] 数据通道创建完成，角色:', role, '是否重新连接:', isReconnect);
  }, [stateManager]);

  // 切换到 WS 中继模式 - 仅设置发送引用
  // 事件监听由 ConnectionCore 的 initiateRelayFallback 统一管理
  const switchToRelay = useCallback((relayWs: WebSocket) => {
    console.log('[DataChannelManager] 🔄 切换到 WS 中继模式（设置发送引用）');
    relayWsRef.current = relayWs;
  }, []);

  // 关闭中继连接
  const closeRelay = useCallback(() => {
    if (relayWsRef.current) {
      console.log('[DataChannelManager] 关闭中继连接');
      relayWsRef.current.close();
      relayWsRef.current = null;
    }
  }, []);

  // 处理中继收到的数据消息（由 ConnectionCore 分发调用）
  const handleRelayMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data) as WebRTCMessage;
        console.log('[DataChannelManager:Relay] 收到中继消息:', message.type, message.channel || 'default');

        if (message.channel) {
          const handler = messageHandlers.current.get(message.channel);
          if (handler) {
            handler(message);
          }
        } else {
          messageHandlers.current.forEach(handler => handler(message));
        }
      } catch (error) {
        console.error('[DataChannelManager:Relay] 解析中继消息失败:', error);
      }
    } else if (event.data instanceof ArrayBuffer) {
      console.log('[DataChannelManager:Relay] 收到中继二进制数据:', event.data.byteLength, 'bytes');
      const fileHandler = dataHandlers.current.get('file-transfer');
      if (fileHandler) {
        fileHandler(event.data);
      } else {
        const firstHandler = dataHandlers.current.values().next().value;
        if (firstHandler) {
          firstHandler(event.data);
        }
      }
    } else if (event.data instanceof Blob) {
      // WebSocket 某些情况下收到 Blob
      event.data.arrayBuffer().then((buffer: ArrayBuffer) => {
        console.log('[DataChannelManager:Relay] 收到中继二进制数据(Blob):', buffer.byteLength, 'bytes');
        const fileHandler = dataHandlers.current.get('file-transfer');
        if (fileHandler) {
          fileHandler(buffer);
        } else {
          const firstHandler = dataHandlers.current.values().next().value;
          if (firstHandler) {
            firstHandler(buffer);
          }
        }
      });
    }
  }, []);

  // 处理数据通道消息 (P2P 模式)
  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data) as WebRTCMessage;
        console.log('[DataChannelManager] 收到消息:', message.type, message.channel || 'default');

        if (message.channel) {
          const handler = messageHandlers.current.get(message.channel);
          if (handler) {
            handler(message);
          }
        } else {
          messageHandlers.current.forEach(handler => handler(message));
        }
      } catch (error) {
        console.error('[DataChannelManager] 解析消息失败:', error);
      }
    } else if (event.data instanceof ArrayBuffer) {
      console.log('[DataChannelManager] 收到数据:', event.data.byteLength, 'bytes');

      const fileHandler = dataHandlers.current.get('file-transfer');
      if (fileHandler) {
        fileHandler(event.data);
      } else {
        const firstHandler = dataHandlers.current.values().next().value;
        if (firstHandler) {
          firstHandler(event.data);
        }
      }
    }
  }, []);

  // 发送消息 - 自动选择可用通道（P2P 优先，否则用中继）
  const sendMessage = useCallback((message: WebRTCMessage, channel?: string) => {
    const messageWithChannel = channel ? { ...message, channel } : message;
    const jsonStr = JSON.stringify(messageWithChannel);

    // 优先使用 P2P DataChannel
    if (isP2PAvailable()) {
      try {
        dcRef.current!.send(jsonStr);
        console.log('[DataChannelManager:P2P] 发送消息:', message.type, channel || 'default');
        return true;
      } catch (error) {
        console.error('[DataChannelManager:P2P] 发送消息失败:', error);
        // P2P 发送失败，尝试中继
      }
    }

    // 回退到 WS 中继
    if (isRelayMode()) {
      try {
        relayWsRef.current!.send(jsonStr);
        console.log('[DataChannelManager:Relay] 发送消息:', message.type, channel || 'default');
        return true;
      } catch (error) {
        console.error('[DataChannelManager:Relay] 发送消息失败:', error);
        return false;
      }
    }

    console.error('[DataChannelManager] 没有可用的传输通道');
    return false;
  }, [isP2PAvailable, isRelayMode]);

  // 发送二进制数据 - 自动选择可用通道
  const sendData = useCallback((data: ArrayBuffer) => {
    // 优先使用 P2P DataChannel
    if (isP2PAvailable()) {
      try {
        dcRef.current!.send(data);
        console.log('[DataChannelManager:P2P] 发送数据:', data.byteLength, 'bytes');
        return true;
      } catch (error) {
        console.error('[DataChannelManager:P2P] 发送数据失败:', error);
      }
    }

    // 回退到 WS 中继
    if (isRelayMode()) {
      try {
        relayWsRef.current!.send(data);
        console.log('[DataChannelManager:Relay] 发送数据:', data.byteLength, 'bytes');
        return true;
      } catch (error) {
        console.error('[DataChannelManager:Relay] 发送数据失败:', error);
        return false;
      }
    }

    console.error('[DataChannelManager] 没有可用的传输通道');
    return false;
  }, [isP2PAvailable, isRelayMode]);

  // 注册消息处理器
  const registerMessageHandler = useCallback((channel: string, handler: MessageHandler) => {
    console.log('[DataChannelManager] 注册消息处理器:', channel);
    messageHandlers.current.set(channel, handler);

    return () => {
      console.log('[DataChannelManager] 取消注册消息处理器:', channel);
      messageHandlers.current.delete(channel);
    };
  }, []);

  // 注册数据处理器
  const registerDataHandler = useCallback((channel: string, handler: DataHandler) => {
    console.log('[DataChannelManager] 注册数据处理器:', channel);
    dataHandlers.current.set(channel, handler);

    return () => {
      console.log('[DataChannelManager] 取消注册数据处理器:', channel);
      dataHandlers.current.delete(channel);
    };
  }, []);

  // 获取数据通道状态 - 综合 P2P 和 Relay 状态
  const getChannelState = useCallback((): RTCDataChannelState => {
    // P2P 通道打开时优先返回
    if (dcRef.current?.readyState === 'open') {
      return 'open';
    }
    // 中继模式可用
    if (relayWsRef.current?.readyState === WebSocket.OPEN) {
      return 'open';
    }
    // P2P 通道正在连接
    if (dcRef.current?.readyState === 'connecting') {
      return 'connecting';
    }
    return dcRef.current?.readyState || 'closed';
  }, []);

  // 获取当前缓冲区大小
  const getBufferedAmount = useCallback((): number => {
    if (dcRef.current && dcRef.current.readyState === 'open') {
      return dcRef.current.bufferedAmount;
    }
    if (relayWsRef.current && relayWsRef.current.readyState === WebSocket.OPEN) {
      return relayWsRef.current.bufferedAmount;
    }
    return 0;
  }, []);

  // 等待缓冲区排空到阈值以下
  const waitForBufferDrain = useCallback((threshold: number = 1 * 1024 * 1024): Promise<void> => {
    // P2P DataChannel
    if (dcRef.current && dcRef.current.readyState === 'open') {
      if (dcRef.current.bufferedAmount <= threshold) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const dc = dcRef.current!;
        dc.bufferedAmountLowThreshold = threshold;
        const onLow = () => {
          dc.removeEventListener('bufferedamountlow', onLow);
          resolve();
        };
        dc.addEventListener('bufferedamountlow', onLow);
        // 安全超时，防止死等
        setTimeout(() => {
          dc.removeEventListener('bufferedamountlow', onLow);
          resolve();
        }, 5000);
      });
    }
    // Relay WebSocket
    if (relayWsRef.current && relayWsRef.current.readyState === WebSocket.OPEN) {
      if (relayWsRef.current.bufferedAmount <= threshold) {
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!relayWsRef.current || relayWsRef.current.readyState !== WebSocket.OPEN ||
              relayWsRef.current.bufferedAmount <= threshold) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
        // 安全超时
        setTimeout(() => {
          clearInterval(checkInterval);
          resolve();
        }, 5000);
      });
    }
    return Promise.resolve();
  }, []);

  return {
    createDataChannel,
    switchToRelay,
    closeRelay,
    handleRelayMessage,
    sendMessage,
    sendData,
    registerMessageHandler,
    registerDataHandler,
    getChannelState,
    getBufferedAmount,
    waitForBufferDrain,
    handleDataChannelMessage,
  };
}