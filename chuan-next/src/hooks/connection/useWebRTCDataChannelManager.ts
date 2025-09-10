import { useRef, useCallback } from 'react';
import { WebRTCStateManager } from './useWebRTCStateManager';

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
 * 负责数据通道的创建和管理
 */
export interface WebRTCDataChannelManager {
  // 创建数据通道
  createDataChannel: (pc: RTCPeerConnection, role: 'sender' | 'receiver', isReconnect?: boolean) => void;
  
  // 发送消息
  sendMessage: (message: WebRTCMessage, channel?: string) => boolean;
  
  // 发送二进制数据
  sendData: (data: ArrayBuffer) => boolean;
  
  // 注册消息处理器
  registerMessageHandler: (channel: string, handler: MessageHandler) => () => void;
  
  // 注册数据处理器
  registerDataHandler: (channel: string, handler: DataHandler) => () => void;
  
  // 获取数据通道状态
  getChannelState: () => RTCDataChannelState;
  
  // 处理数据通道消息
  handleDataChannelMessage: (event: MessageEvent) => void;
}

/**
 * WebRTC 数据通道管理 Hook
 * 负责数据通道的创建和管理，处理数据通道消息的发送和接收
 */
export function useWebRTCDataChannelManager(
  stateManager: WebRTCStateManager
): WebRTCDataChannelManager {
  const dcRef = useRef<RTCDataChannel | null>(null);
  
  // 多通道消息处理器
  const messageHandlers = useRef<Map<string, MessageHandler>>(new Map());
  const dataHandlers = useRef<Map<string, DataHandler>>(new Map());

  // 创建数据通道
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
        ordered: true,
        maxRetransmits: 3
      });
      dcRef.current = dataChannel;

      dataChannel.onopen = () => {
        console.log('[DataChannelManager] 数据通道已打开 (发送方)');
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
          // 发送同步请求消息
          setTimeout(() => {
            if (dataChannel.readyState === 'open') {
              dataChannel.send(JSON.stringify({
                type: 'sync-request',
                payload: { timestamp: Date.now() }
              }));
              console.log('[DataChannelManager] 发送方发送数据同步请求');
            }
          }, 300); // 等待数据通道完全稳定
        }
      };
    

      dataChannel.onmessage = handleDataChannelMessage;

      dataChannel.onerror = (error) => {
        console.error('[DataChannelManager] 数据通道错误:', error);
        
        // 获取更详细的错误信息
        let errorMessage = '数据通道连接失败';
        let shouldRetry = false;
        
        // 根据数据通道状态提供更具体的错误信息
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
            // 检查PeerConnection状态
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
        
        stateManager.updateState({
          error: errorMessage,
          isConnecting: false,
          isPeerConnected: false,  // 数据通道出错时，P2P连接肯定不可用
          canRetry: shouldRetry    // 设置是否可以重试
        });
      };
    } else {
      pc.ondatachannel = (event) => {
        const dataChannel = event.channel;
        dcRef.current = dataChannel;

        dataChannel.onopen = () => {
          console.log('[DataChannelManager] 数据通道已打开 (接收方)');
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
            console.log('[DataChannelManager] 接收方重新连接，数据通道已打开，准备同步数据');
            // 发送同步请求消息
            setTimeout(() => {
              if (dataChannel.readyState === 'open') {
                dataChannel.send(JSON.stringify({
                  type: 'sync-request',
                  payload: { timestamp: Date.now() }
                }));
                console.log('[DataChannelManager] 接收方发送数据同步请求');
              }
            }, 300); // 等待数据通道完全稳定
          }
        };

        dataChannel.onmessage = handleDataChannelMessage;

        dataChannel.onerror = (error) => {
          console.error('[DataChannelManager] 数据通道错误 (接收方):', error);
          
          // 获取更详细的错误信息
          let errorMessage = '数据通道连接失败';
          let shouldRetry = false;
          
          // 根据数据通道状态提供更具体的错误信息
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
              // 检查PeerConnection状态
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
          
          stateManager.updateState({
            error: errorMessage,
            isConnecting: false,
            isPeerConnected: false,  // 数据通道出错时，P2P连接肯定不可用
            canRetry: shouldRetry    // 设置是否可以重试
          });
        };
      };
    }

    console.log('[DataChannelManager] 数据通道创建完成，角色:', role, '是否重新连接:', isReconnect);
  }, [stateManager]);

  // 处理数据通道消息
  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data) as WebRTCMessage;
        console.log('[DataChannelManager] 收到消息:', message.type, message.channel || 'default');

        // 根据通道分发消息
        if (message.channel) {
          const handler = messageHandlers.current.get(message.channel);
          if (handler) {
            handler(message);
          }
        } else {
          // 兼容旧版本，广播给所有处理器
          messageHandlers.current.forEach(handler => handler(message));
        }
      } catch (error) {
        console.error('[DataChannelManager] 解析消息失败:', error);
      }
    } else if (event.data instanceof ArrayBuffer) {
      console.log('[DataChannelManager] 收到数据:', event.data.byteLength, 'bytes');

      // 数据优先发给文件传输处理器
      const fileHandler = dataHandlers.current.get('file-transfer');
      if (fileHandler) {
        fileHandler(event.data);
      } else {
        // 如果没有文件处理器，发给第一个处理器
        const firstHandler = dataHandlers.current.values().next().value;
        if (firstHandler) {
          firstHandler(event.data);
        }
      }
    }
  }, []);

  // 发送消息
  const sendMessage = useCallback((message: WebRTCMessage, channel?: string) => {
    const dataChannel = dcRef.current;
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('[DataChannelManager] 数据通道未准备就绪');
      return false;
    }

    try {
      const messageWithChannel = channel ? { ...message, channel } : message;
      dataChannel.send(JSON.stringify(messageWithChannel));
      console.log('[DataChannelManager] 发送消息:', message.type, channel || 'default');
      return true;
    } catch (error) {
      console.error('[DataChannelManager] 发送消息失败:', error);
      return false;
    }
  }, []);

  // 发送二进制数据
  const sendData = useCallback((data: ArrayBuffer) => {
    const dataChannel = dcRef.current;
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('[DataChannelManager] 数据通道未准备就绪');
      return false;
    }

    try {
      dataChannel.send(data);
      console.log('[DataChannelManager] 发送数据:', data.byteLength, 'bytes');
      return true;
    } catch (error) {
      console.error('[DataChannelManager] 发送数据失败:', error);
      return false;
    }
  }, []);

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

  // 获取数据通道状态
  const getChannelState = useCallback(() => {
    return dcRef.current?.readyState || 'closed';
  }, []);

  return {
    createDataChannel,
    sendMessage,
    sendData,
    registerMessageHandler,
    registerDataHandler,
    getChannelState,
    handleDataChannelMessage,
  };
}