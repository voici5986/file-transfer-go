import { useRef, useCallback } from 'react';
import { WebRTCStateManager } from '../ui/webRTCStore';
import type { WebRTCMessage, MessageHandler, DataHandler, Unsubscribe } from './types';

// Re-export types for backward compatibility
export type { WebRTCMessage, MessageHandler, DataHandler };

/**
 * WebRTC 数据通道管理器接口
 * 负责数据通道的创建和管理，支持 P2P DataChannel 和 WS Relay 两种传输模式
 */
export interface WebRTCDataChannelManager {
  // ── 通道生命周期 ──

  /** 创建 P2P 数据通道 */
  createDataChannel: (pc: RTCPeerConnection, role: 'sender' | 'receiver', isReconnect?: boolean) => void;
  /** 切换到 WS 中继模式（仅设置发送引用）*/
  switchToRelay: (relayWs: WebSocket) => void;
  /** 关闭中继连接 */
  closeRelay: () => void;

  // ── 消息收发 ──

  /** 发送 JSON 消息（自动选择可用通道：P2P 优先，Relay 降级）*/
  sendMessage: (message: WebRTCMessage, channel?: string) => boolean;
  /** 发送二进制数据（自动选择可用通道）*/
  sendData: (data: ArrayBuffer) => boolean;
  /** 处理中继收到的数据（由 ConnectionCore 的 onmessage 转发）*/
  handleRelayMessage: (event: MessageEvent) => void;

  // ── 处理器注册 ──

  /** 注册 JSON 消息处理器，返回清理函数 */
  registerMessageHandler: (channel: string, handler: MessageHandler) => Unsubscribe;
  /** 注册二进制数据处理器，返回清理函数 */
  registerDataHandler: (channel: string, handler: DataHandler) => Unsubscribe;

  // ── 状态查询 ──

  /** 获取通道状态（综合 P2P + Relay）*/
  getChannelState: () => RTCDataChannelState;
  /** 获取当前发送缓冲区大小 */
  getBufferedAmount: () => number;
  /** 等待缓冲区排空到指定阈值以下 */
  waitForBufferDrain: (threshold?: number) => Promise<void>;
}

/**
 * WebRTC 数据通道管理 Hook
 *
 * 核心职责：
 * 1. P2P DataChannel 创建（sender createDataChannel / receiver ondatachannel）
 * 2. Relay WebSocket 透明切换
 * 3. 统一的消息 / 二进制分发（Map<channel, handler>）
 * 4. 背压控制（bufferedAmount + waitForBufferDrain）
 */
export function useWebRTCDataChannelManager(
  stateManager: WebRTCStateManager
): WebRTCDataChannelManager {
  const dcRef = useRef<RTCDataChannel | null>(null);
  const relayWsRef = useRef<WebSocket | null>(null);

  // 处理器注册表
  const messageHandlers = useRef<Map<string, MessageHandler>>(new Map());
  const dataHandlers = useRef<Map<string, DataHandler>>(new Map());

  // ────────────────────────────────────────
  // 内部工具
  // ────────────────────────────────────────

  const isRelayMode = useCallback(() => {
    return relayWsRef.current !== null && relayWsRef.current.readyState === WebSocket.OPEN;
  }, []);

  const isP2PAvailable = useCallback(() => {
    return dcRef.current !== null && dcRef.current.readyState === 'open';
  }, []);

  // ── 统一消息分发 ──

  const dispatchJsonMessage = useCallback((message: WebRTCMessage) => {
    if (message.channel) {
      const handler = messageHandlers.current.get(message.channel);
      if (handler) handler(message);
    } else {
      // 无 channel 标记则广播给所有处理器
      messageHandlers.current.forEach(handler => handler(message));
    }
  }, []);

  const dispatchBinaryData = useCallback((data: ArrayBuffer) => {
    // 优先分发给 file-transfer 处理器（最常见的二进制消费者）
    const fileHandler = dataHandlers.current.get('file-transfer');
    if (fileHandler) {
      fileHandler(data);
      return;
    }
    // 降级：分发给第一个注册的处理器
    const firstHandler = dataHandlers.current.values().next().value;
    if (firstHandler) {
      firstHandler(data);
    }
  }, []);

  /**
   * 统一入站消息处理（P2P 和 Relay 共用）
   */
  const dispatchIncoming = useCallback((event: MessageEvent) => {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data) as WebRTCMessage;
        dispatchJsonMessage(message);
      } catch (error) {
        console.error('[DataChannel] 解析消息失败:', error);
      }
    } else if (event.data instanceof ArrayBuffer) {
      dispatchBinaryData(event.data);
    } else if (event.data instanceof Blob) {
      // WebSocket 某些浏览器 / 环境下返回 Blob 而非 ArrayBuffer
      event.data.arrayBuffer().then((buffer: ArrayBuffer) => {
        dispatchBinaryData(buffer);
      });
    }
  }, [dispatchJsonMessage, dispatchBinaryData]);

  // ────────────────────────────────────────
  // DataChannel 生命周期（去重 sender/receiver 共享逻辑）
  // ────────────────────────────────────────

  /**
   * 数据通道打开后的统一处理
   */
  const handleChannelOpen = useCallback((
    dataChannel: RTCDataChannel,
    role: string,
    isReconnect: boolean
  ) => {
    console.log(`[DataChannel] 数据通道已打开 (${role})`);

    // P2P 恢复时关闭中继
    if (relayWsRef.current) {
      console.log('[DataChannel] P2P 恢复，关闭中继通道');
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
      canRetry: false,
    });

    // 重连后请求数据同步
    if (isReconnect) {
      console.log(`[DataChannel] ${role} 重连，发送数据同步请求`);
      setTimeout(() => {
        if (dataChannel.readyState === 'open') {
          dataChannel.send(JSON.stringify({
            type: 'sync-request',
            payload: { timestamp: Date.now() },
          }));
        }
      }, 300);
    }
  }, [stateManager]);

  /**
   * 数据通道错误的统一处理
   */
  const handleChannelError = useCallback((
    dataChannel: RTCDataChannel,
    pc: RTCPeerConnection | null,
    role: string
  ) => {
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
        errorMessage = '数据通道已关闭，P2P 连接失败';
        shouldRetry = true;
        break;
      default:
        if (pc) {
          switch (pc.connectionState) {
            case 'failed':
              errorMessage = 'P2P 连接失败，可能是网络防火墙阻止了连接';
              shouldRetry = true;
              break;
            case 'disconnected':
              errorMessage = 'P2P 连接已断开，网络可能不稳定';
              shouldRetry = true;
              break;
            default:
              errorMessage = '数据通道连接失败，可能是网络环境受限';
              shouldRetry = true;
          }
        }
    }

    console.error(`[DataChannel] 错误 (${role}) - 状态: ${dataChannel.readyState}, ${errorMessage}`);

    // 已在中继模式则不更新错误状态
    if (!isRelayMode()) {
      stateManager.updateState({
        error: errorMessage,
        isConnecting: false,
        isPeerConnected: false,
        canRetry: shouldRetry,
      });
    }
  }, [stateManager, isRelayMode]);

  /**
   * 为 DataChannel 绑定事件处理器（sender / receiver 共用）
   */
  const setupChannelHandlers = useCallback((
    dataChannel: RTCDataChannel,
    pc: RTCPeerConnection,
    role: string,
    isReconnect: boolean
  ) => {
    dataChannel.onopen = () => handleChannelOpen(dataChannel, role, isReconnect);
    dataChannel.onmessage = dispatchIncoming;
    dataChannel.onerror = () => handleChannelError(dataChannel, pc, role);
  }, [handleChannelOpen, dispatchIncoming, handleChannelError]);

  // ── 创建数据通道 ──

  const createDataChannel = useCallback((
    pc: RTCPeerConnection,
    role: 'sender' | 'receiver',
    isReconnect: boolean = false,
  ) => {
    console.log('[DataChannel] 创建数据通道...', { role, isReconnect });

    // 关闭已有通道
    if (dcRef.current) {
      console.log('[DataChannel] 关闭已存在的数据通道');
      dcRef.current.close();
      dcRef.current = null;
    }

    if (role === 'sender') {
      const dc = pc.createDataChannel('shared-channel', { ordered: true });
      dcRef.current = dc;
      setupChannelHandlers(dc, pc, '发送方', isReconnect);
    } else {
      pc.ondatachannel = (event) => {
        const dc = event.channel;
        dcRef.current = dc;
        setupChannelHandlers(dc, pc, '接收方', isReconnect);
      };
    }

    console.log('[DataChannel] 数据通道创建完成，角色:', role);
  }, [setupChannelHandlers]);

  // ── Relay 管理 ──

  const switchToRelay = useCallback((relayWs: WebSocket) => {
    console.log('[DataChannel] 🔄 切换到 WS 中继模式');
    relayWsRef.current = relayWs;
  }, []);

  const closeRelay = useCallback(() => {
    if (relayWsRef.current) {
      console.log('[DataChannel] 关闭中继连接');
      relayWsRef.current.close();
      relayWsRef.current = null;
    }
  }, []);

  const handleRelayMessage = useCallback((event: MessageEvent) => {
    dispatchIncoming(event);
  }, [dispatchIncoming]);

  // ────────────────────────────────────────
  // 消息发送（P2P 优先，Relay 降级）
  // ────────────────────────────────────────

  const sendMessage = useCallback((message: WebRTCMessage, channel?: string) => {
    const messageWithChannel = channel ? { ...message, channel } : message;
    const jsonStr = JSON.stringify(messageWithChannel);

    if (isP2PAvailable()) {
      try {
        dcRef.current!.send(jsonStr);
        return true;
      } catch (error) {
        console.error('[DataChannel:P2P] 发送消息失败:', error);
      }
    }

    if (isRelayMode()) {
      try {
        relayWsRef.current!.send(jsonStr);
        return true;
      } catch (error) {
        console.error('[DataChannel:Relay] 发送消息失败:', error);
        return false;
      }
    }

    console.error('[DataChannel] 没有可用的传输通道');
    return false;
  }, [isP2PAvailable, isRelayMode]);

  const sendData = useCallback((data: ArrayBuffer) => {
    if (isP2PAvailable()) {
      try {
        dcRef.current!.send(data);
        return true;
      } catch (error) {
        console.error('[DataChannel:P2P] 发送数据失败:', error);
      }
    }

    if (isRelayMode()) {
      try {
        relayWsRef.current!.send(data);
        return true;
      } catch (error) {
        console.error('[DataChannel:Relay] 发送数据失败:', error);
        return false;
      }
    }

    console.error('[DataChannel] 没有可用的传输通道');
    return false;
  }, [isP2PAvailable, isRelayMode]);

  // ────────────────────────────────────────
  // 处理器注册
  // ────────────────────────────────────────

  const registerMessageHandler = useCallback((channel: string, handler: MessageHandler): Unsubscribe => {
    console.log('[DataChannel] 注册消息处理器:', channel);
    messageHandlers.current.set(channel, handler);
    return () => {
      console.log('[DataChannel] 取消注册消息处理器:', channel);
      messageHandlers.current.delete(channel);
    };
  }, []);

  const registerDataHandler = useCallback((channel: string, handler: DataHandler): Unsubscribe => {
    console.log('[DataChannel] 注册数据处理器:', channel);
    dataHandlers.current.set(channel, handler);
    return () => {
      console.log('[DataChannel] 取消注册数据处理器:', channel);
      dataHandlers.current.delete(channel);
    };
  }, []);

  // ────────────────────────────────────────
  // 状态查询与背压控制
  // ────────────────────────────────────────

  const getChannelState = useCallback((): RTCDataChannelState => {
    if (dcRef.current?.readyState === 'open') return 'open';
    if (relayWsRef.current?.readyState === WebSocket.OPEN) return 'open';
    if (dcRef.current?.readyState === 'connecting') return 'connecting';
    return dcRef.current?.readyState || 'closed';
  }, []);

  const getBufferedAmount = useCallback((): number => {
    if (dcRef.current?.readyState === 'open') return dcRef.current.bufferedAmount;
    if (relayWsRef.current?.readyState === WebSocket.OPEN) return relayWsRef.current.bufferedAmount;
    return 0;
  }, []);

  const waitForBufferDrain = useCallback((threshold: number = 1 * 1024 * 1024): Promise<void> => {
    // P2P DataChannel — 使用 bufferedamountlow 事件
    if (dcRef.current?.readyState === 'open') {
      if (dcRef.current.bufferedAmount <= threshold) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const dc = dcRef.current!;
        dc.bufferedAmountLowThreshold = threshold;
        const onLow = () => {
          dc.removeEventListener('bufferedamountlow', onLow);
          resolve();
        };
        dc.addEventListener('bufferedamountlow', onLow);
        setTimeout(() => { dc.removeEventListener('bufferedamountlow', onLow); resolve(); }, 5000);
      });
    }

    // Relay WebSocket — 轮询 bufferedAmount
    if (relayWsRef.current?.readyState === WebSocket.OPEN) {
      if (relayWsRef.current.bufferedAmount <= threshold) return Promise.resolve();
      return new Promise<void>((resolve) => {
        const checkInterval = setInterval(() => {
          if (!relayWsRef.current || relayWsRef.current.readyState !== WebSocket.OPEN ||
              relayWsRef.current.bufferedAmount <= threshold) {
            clearInterval(checkInterval);
            resolve();
          }
        }, 50);
        setTimeout(() => { clearInterval(checkInterval); resolve(); }, 5000);
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
  };
}
