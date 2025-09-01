import { EventEmitter } from 'events';
import { WebSocketManager } from './WebSocketManager';
import { PeerConnectionManager } from './PeerConnectionManager';
import { DataChannelManager } from './DataChannelManager';
import { MessageRouter } from './MessageRouter';
import { 
  WebRTCConnectionState, 
  WebRTCMessage, 
  WebRTCConfig, 
  WebRTCError, 
  MessageHandler,
  DataHandler
} from './types';
import { getWsUrl } from '@/lib/config';

interface WebRTCManagerConfig extends Partial<WebRTCConfig> {
  dataChannelName?: string;
  enableLogging?: boolean;
}

interface SignalingMessage {
  type: string;
  payload: any;
}

export class WebRTCManager extends EventEmitter {
  private wsManager: WebSocketManager;
  private pcManager: PeerConnectionManager;
  private dcManager: DataChannelManager;
  private messageRouter: MessageRouter;
  private config: WebRTCManagerConfig;
  
  private state: WebRTCConnectionState;
  private currentRoom: { code: string; role: 'sender' | 'receiver' } | null = null;
  private isUserDisconnecting = false;
  private abortController = new AbortController();

  constructor(config: WebRTCManagerConfig = {}) {
    super();
    
    this.config = {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:global.stun.twilio.com:3478' },
      ],
      iceCandidatePoolSize: 10,
      chunkSize: 256 * 1024,
      maxRetries: 5,
      retryDelay: 1000,
      ackTimeout: 5000,
      dataChannelName: 'shared-channel',
      enableLogging: true,
      ...config
    };

    this.state = {
      isConnected: false,
      isConnecting: false,
      isWebSocketConnected: false,
      isPeerConnected: false,
      error: null,
      canRetry: false,
      currentRoom: null,
    };

    // 初始化各个管理器
    this.wsManager = new WebSocketManager({
      url: '',
      reconnectAttempts: 5,
      reconnectDelay: 1000,
      timeout: 10000,
    });

    this.pcManager = new PeerConnectionManager({
      iceServers: this.config.iceServers!,
      iceCandidatePoolSize: this.config.iceCandidatePoolSize!,
      chunkSize: this.config.chunkSize!,
      maxRetries: this.config.maxRetries!,
      retryDelay: this.config.retryDelay!,
      ackTimeout: this.config.ackTimeout!,
      onSignalingMessage: this.handleSignalingMessage.bind(this),
      onTrack: this.handleTrack.bind(this),
    });

    this.dcManager = new DataChannelManager({
      channelName: this.config.dataChannelName!,
      onMessage: this.handleDataChannelMessage.bind(this),
      onData: this.handleDataChannelData.bind(this),
    });

    this.messageRouter = new MessageRouter();

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    // WebSocket 事件处理
    this.wsManager.on('connecting', (event) => {
      this.updateState({ isConnecting: true, error: null });
    });

    this.wsManager.on('connected', (event) => {
      this.updateState({ 
        isWebSocketConnected: true, 
        isConnecting: false,
        isConnected: true 
      });
    });

    this.wsManager.on('disconnected', (event: any) => {
      this.updateState({ isWebSocketConnected: false });
      
      if (!this.isUserDisconnecting) {
        this.updateState({ 
          error: event.reason,
          canRetry: true 
        });
      }
    });

    this.wsManager.on('error', (event: any) => {
      this.updateState({ 
        error: event.error.message,
        canRetry: event.error.retryable 
      });
    });

    this.wsManager.on('message', (message: any) => {
      this.handleWebSocketMessage(message);
    });

    // PeerConnection 事件处理
    this.pcManager.on('state-change', (event: any) => {
      this.updateState(event.state);
    });

    this.pcManager.on('error', (event: any) => {
      this.updateState({ 
        error: event.error.message,
        canRetry: event.error.retryable 
      });
    });

    // DataChannel 事件处理
    this.dcManager.on('state-change', (event: any) => {
      this.updateState(event.state);
    });

    this.dcManager.on('error', (event: any) => {
      this.updateState({ 
        error: event.error.message,
        canRetry: event.error.retryable 
      });
    });
  }

  private updateState(updates: Partial<WebRTCConnectionState>): void {
    this.state = { ...this.state, ...updates };
    this.emit('state-change', { type: 'state-change', state: updates });
  }

  private handleWebSocketMessage(message: SignalingMessage): void {
    if (this.config.enableLogging) {
      console.log('[WebRTCManager] 收到信令消息:', message.type);
    }

    switch (message.type) {
      case 'peer-joined':
        this.handlePeerJoined(message.payload);
        break;
      case 'offer':
        this.handleOffer(message.payload);
        break;
      case 'answer':
        this.handleAnswer(message.payload);
        break;
      case 'ice-candidate':
        this.handleIceCandidate(message.payload);
        break;
      case 'error':
        this.handleError(message);
        break;
      case 'disconnection':
        this.handleDisconnection(message);
        break;
      default:
        if (this.config.enableLogging) {
          console.warn('[WebRTCManager] 未知消息类型:', message.type);
        }
    }
  }

  private handleSignalingMessage(message: SignalingMessage): void {
    this.wsManager.send(message);
  }

  private handleTrack(event: RTCTrackEvent): void {
    if (this.config.enableLogging) {
      console.log('[WebRTCManager] 收到媒体轨道:', event.track.kind);
    }
    // 这里可以添加轨道处理逻辑，或者通过事件传递给业务层
  }

  private handleDataChannelMessage(message: WebRTCMessage): void {
    this.messageRouter.routeMessage(message);
  }

  private handleDataChannelData(data: ArrayBuffer): void {
    // 默认路由到文件传输通道
    this.messageRouter.routeData(data, 'file-transfer');
  }

  private async handlePeerJoined(payload: any): Promise<void> {
    if (!this.currentRoom) return;

    const { role } = payload;
    const { role: currentRole } = this.currentRoom;

    if (this.config.enableLogging) {
      console.log('[WebRTCManager] 对方加入房间:', role);
    }

    if (currentRole === 'sender' && role === 'receiver') {
      this.updateState({ isPeerConnected: true });
      try {
        await this.pcManager.createOffer();
      } catch (error) {
        console.error('[WebRTCManager] 创建Offer失败:', error);
      }
    } else if (currentRole === 'receiver' && role === 'sender') {
      this.updateState({ isPeerConnected: true });
    }
  }

  private async handleOffer(payload: RTCSessionDescriptionInit): Promise<void> {
    try {
      await this.pcManager.setRemoteDescription(payload);
      const answer = await this.pcManager.createAnswer();
      this.handleSignalingMessage({ type: 'answer', payload: answer });
    } catch (error) {
      console.error('[WebRTCManager] 处理Offer失败:', error);
      this.updateState({ 
        error: '处理连接请求失败',
        canRetry: true 
      });
    }
  }

  private async handleAnswer(payload: RTCSessionDescriptionInit): Promise<void> {
    try {
      await this.pcManager.setRemoteDescription(payload);
    } catch (error) {
      console.error('[WebRTCManager] 处理Answer失败:', error);
      this.updateState({ 
        error: '处理连接响应失败',
        canRetry: true 
      });
    }
  }

  private async handleIceCandidate(payload: RTCIceCandidateInit): Promise<void> {
    try {
      await this.pcManager.addIceCandidate(payload);
    } catch (error) {
      console.warn('[WebRTCManager] 添加ICE候选失败:', error);
    }
  }

  private handleError(message: any): void {
    this.updateState({ 
      error: message.error || '信令服务器错误',
      canRetry: true 
    });
  }

  private handleDisconnection(message: any): void {
    this.updateState({ 
      isPeerConnected: false,
      error: '对方已离开房间',
      canRetry: true 
    });
    
    // 清理P2P连接但保持WebSocket连接
    this.pcManager.destroyPeerConnection();
    this.dcManager.close();
  }

  async connect(roomCode: string, role: 'sender' | 'receiver'): Promise<void> {
    if (this.state.isConnecting) {
      console.warn('[WebRTCManager] 正在连接中，跳过重复连接请求');
      return;
    }

    this.isUserDisconnecting = false;
    this.abortController = new AbortController();
    
    try {
      this.currentRoom = { code: roomCode, role };
      this.updateState({ 
        isConnecting: true, 
        error: null,
        currentRoom: { code: roomCode, role }
      });

      // 创建PeerConnection
      const pc = await this.pcManager.createPeerConnection();

      // 如果是发送方，创建数据通道
      if (role === 'sender') {
        this.dcManager.createDataChannel(pc);
      }

      // 连接WebSocket
      const baseWsUrl = getWsUrl();
      if (!baseWsUrl) {
        throw new WebRTCError('WS_URL_NOT_CONFIGURED', 'WebSocket URL未配置', false);
      }

      const wsUrl = baseWsUrl.replace('/api/ws/webrtc', `/ws/webrtc?code=${roomCode}&role=${role}&channel=shared`);
      this.wsManager = new WebSocketManager({
        url: wsUrl,
        reconnectAttempts: 5,
        reconnectDelay: 1000,
        timeout: 10000,
      });

      this.setupEventHandlers();
      await this.wsManager.connect();

    } catch (error) {
      console.error('[WebRTCManager] 连接失败:', error);
      this.updateState({ 
        error: error instanceof WebRTCError ? error.message : '连接失败',
        isConnecting: false,
        canRetry: true 
      });
      throw error;
    }
  }

  disconnect(): void {
    if (this.config.enableLogging) {
      console.log('[WebRTCManager] 主动断开连接');
    }

    this.isUserDisconnecting = true;
    this.abortController.abort();

    // 通知对方断开连接
    this.wsManager.send({
      type: 'disconnection',
      payload: { reason: '用户主动断开' }
    });

    // 清理所有连接
    this.dcManager.close();
    this.pcManager.destroyPeerConnection();
    this.wsManager.disconnect();
    this.messageRouter.clear();

    // 重置状态
    this.currentRoom = null;
    this.updateState({
      isConnected: false,
      isConnecting: false,
      isWebSocketConnected: false,
      isPeerConnected: false,
      error: null,
      canRetry: false,
      currentRoom: null,
    });
  }

  async retry(): Promise<void> {
    if (!this.currentRoom) {
      throw new WebRTCError('NO_ROOM_INFO', '没有房间信息，无法重试', false);
    }

    if (this.config.enableLogging) {
      console.log('[WebRTCManager] 重试连接:', this.currentRoom);
    }

    this.disconnect();
    await this.connect(this.currentRoom.code, this.currentRoom.role);
  }

  sendMessage(message: WebRTCMessage, channel?: string): boolean {
    const messageWithChannel = channel ? { ...message, channel } : message;
    return this.dcManager.sendMessage(messageWithChannel);
  }

  sendData(data: ArrayBuffer): boolean {
    return this.dcManager.sendData(data);
  }

  registerMessageHandler(channel: string, handler: MessageHandler): () => void {
    return this.messageRouter.registerMessageHandler(channel, handler);
  }

  registerDataHandler(channel: string, handler: DataHandler): () => void {
    return this.messageRouter.registerDataHandler(channel, handler);
  }

  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender | null {
    return this.pcManager.addTrack(track, stream);
  }

  removeTrack(sender: RTCRtpSender): void {
    this.pcManager.removeTrack(sender);
  }

  onTrack(handler: (event: RTCTrackEvent) => void): void {
    // 简化实现，直接设置处理器
    this.pcManager.on('track', (event) => {
      if (event.type === 'state-change' && 'onTrack' in this.config) {
        // 这里需要适配事件类型
      }
    });
  }

  getPeerConnection(): RTCPeerConnection | null {
    // 返回内部 PeerConnection 的引用
    return (this.pcManager as any).pc;
  }

  async createOfferNow(): Promise<boolean> {
    try {
      await this.pcManager.createOffer();
      return true;
    } catch (error) {
      console.error('[WebRTCManager] 创建Offer失败:', error);
      return false;
    }
  }

  getChannelState(): RTCDataChannelState {
    return this.dcManager.getState();
  }

  isConnectedToRoom(roomCode: string, role: 'sender' | 'receiver'): boolean {
    return this.currentRoom?.code === roomCode &&
      this.currentRoom?.role === role &&
      this.state.isConnected;
  }

  getState(): WebRTCConnectionState {
    return { ...this.state };
  }

  getConfig(): WebRTCManagerConfig {
    return { ...this.config };
  }
}
