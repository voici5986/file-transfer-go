import { useState, useRef, useCallback } from 'react';
import { getWsUrl } from '@/lib/config';
import { useWebRTCStore } from '../ui/webRTCStore';

// 基础连接状态
interface WebRTCState {
  isConnected: boolean;
  isConnecting: boolean;
  isWebSocketConnected: boolean;
  isPeerConnected: boolean;  // 新增：P2P连接状态
  error: string | null;
  canRetry: boolean;  // 新增：是否可以重试
}

// 消息类型
interface WebRTCMessage {
  type: string;
  payload: any;
  channel?: string;
}

// 消息和数据处理器类型
type MessageHandler = (message: WebRTCMessage) => void;
type DataHandler = (data: ArrayBuffer) => void;

// WebRTC 连接接口
export interface WebRTCConnection {
  // 状态
  isConnected: boolean;
  isConnecting: boolean;
  isWebSocketConnected: boolean;
  isPeerConnected: boolean;  // 新增：P2P连接状态
  error: string | null;
  canRetry: boolean;  // 新增：是否可以重试

  // 操作方法
  connect: (roomCode: string, role: 'sender' | 'receiver') => Promise<void>;
  disconnect: () => void;
  retry: () => Promise<void>;  // 新增：重试连接方法
  sendMessage: (message: WebRTCMessage, channel?: string) => boolean;
  sendData: (data: ArrayBuffer) => boolean;

  // 处理器注册
  registerMessageHandler: (channel: string, handler: MessageHandler) => () => void;
  registerDataHandler: (channel: string, handler: DataHandler) => () => void;

  // 工具方法
  getChannelState: () => RTCDataChannelState;
  isConnectedToRoom: (roomCode: string, role: 'sender' | 'receiver') => boolean;

  // 当前房间信息
  currentRoom: { code: string; role: 'sender' | 'receiver' } | null;

  // 媒体轨道方法
  addTrack: (track: MediaStreamTrack, stream: MediaStream) => RTCRtpSender | null;
  removeTrack: (sender: RTCRtpSender) => void;
  onTrack: (callback: (event: RTCTrackEvent) => void) => void;
  getPeerConnection: () => RTCPeerConnection | null;
  createOfferNow: () => Promise<boolean>;
}

/**
 * 共享 WebRTC 连接管理器
 * 创建单一的 WebRTC 连接实例，供多个业务模块共享使用
 */
export function useSharedWebRTCManager(): WebRTCConnection {
  // 使用全局状态 store
  const webrtcStore = useWebRTCStore();

  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 当前连接的房间信息
  const currentRoom = useRef<{ code: string; role: 'sender' | 'receiver' } | null>(null);
  
  // 用于跟踪是否是用户主动断开连接
  const isUserDisconnecting = useRef<boolean>(false);

  // 多通道消息处理器
  const messageHandlers = useRef<Map<string, MessageHandler>>(new Map());
  const dataHandlers = useRef<Map<string, DataHandler>>(new Map());

  // STUN 服务器配置 - 使用更稳定的服务器
  const STUN_SERVERS = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
  ];

  const updateState = useCallback((updates: Partial<WebRTCState>) => {
    webrtcStore.updateState(updates);
  }, [webrtcStore]);

  // 清理连接
  const cleanup = useCallback(() => {
    console.log('[SharedWebRTC] 清理连接');
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    if (dcRef.current) {
      dcRef.current.close();
      dcRef.current = null;
    }

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    currentRoom.current = null;
    isUserDisconnecting.current = false;  // 重置主动断开标志
  }, []);

  // 创建 Offer
  const createOffer = useCallback(async (pc: RTCPeerConnection, ws: WebSocket) => {
    try {
      console.log('[SharedWebRTC] 🎬 开始创建offer，当前轨道数量:', pc.getSenders().length);
      
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,  // 改为true以支持音频接收
        offerToReceiveVideo: true,  // 改为true以支持视频接收
      });

      console.log('[SharedWebRTC] 📝 Offer创建成功，设置本地描述...');
      await pc.setLocalDescription(offer);

      const iceTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'offer', payload: pc.localDescription }));
          console.log('[SharedWebRTC] 📤 发送 offer (超时发送)');
        }
      }, 3000);

      if (pc.iceGatheringState === 'complete') {
        clearTimeout(iceTimeout);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'offer', payload: pc.localDescription }));
          console.log('[SharedWebRTC] 📤 发送 offer (ICE收集完成)');
        }
      } else {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(iceTimeout);
            if (ws.readyState === WebSocket.OPEN) {
              ws.send(JSON.stringify({ type: 'offer', payload: pc.localDescription }));
              console.log('[SharedWebRTC] 📤 发送 offer (ICE收集完成)');
            }
          }
        };
      }
    } catch (error) {
      console.error('[SharedWebRTC] ❌ 创建 offer 失败:', error);
      updateState({ error: '创建连接失败', isConnecting: false, canRetry: true });
    }
  }, [updateState]);

  // 处理数据通道消息
  const handleDataChannelMessage = useCallback((event: MessageEvent) => {
    if (typeof event.data === 'string') {
      try {
        const message = JSON.parse(event.data) as WebRTCMessage;
        console.log('[SharedWebRTC] 收到消息:', message.type, message.channel || 'default');

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
        console.error('[SharedWebRTC] 解析消息失败:', error);
      }
    } else if (event.data instanceof ArrayBuffer) {
      console.log('[SharedWebRTC] 收到数据:', event.data.byteLength, 'bytes');

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

  // 连接到房间
  const connect = useCallback(async (roomCode: string, role: 'sender' | 'receiver') => {
    console.log('[SharedWebRTC] 🚀 开始连接到房间:', roomCode, role);

    // 如果正在连接中，避免重复连接
    if (webrtcStore.isConnecting) {
      console.warn('[SharedWebRTC] ⚠️ 正在连接中，跳过重复连接请求');
      return;
    }

    // 清理之前的连接
    cleanup();
    currentRoom.current = { code: roomCode, role };
    webrtcStore.setCurrentRoom({ code: roomCode, role });
    updateState({ isConnecting: true, error: null });
    
    // 重置主动断开标志
    isUserDisconnecting.current = false;

    // 注意：不在这里设置超时，因为WebSocket连接很快，
    // WebRTC连接的建立是在后续添加轨道时进行的

    try {
      console.log('[SharedWebRTC] 🔧 创建PeerConnection...');
      // 创建 PeerConnection
      const pc = new RTCPeerConnection({
        iceServers: STUN_SERVERS,
        iceCandidatePoolSize: 10,
      });
      pcRef.current = pc;

      // 连接 WebSocket - 使用动态URL
      const baseWsUrl = getWsUrl();
      if (!baseWsUrl) {
        throw new Error('WebSocket URL未配置');
      }
      
      // 构建完整的WebSocket URL
      const wsUrl = `${baseWsUrl}/api/ws/webrtc?code=${roomCode}&role=${role}&channel=shared`;
      console.log('[SharedWebRTC] 🌐 连接WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // WebSocket 事件处理
      ws.onopen = () => {
        console.log('[SharedWebRTC] ✅ WebSocket 连接已建立，房间准备就绪');
        updateState({ 
          isWebSocketConnected: true,
          isConnecting: false,  // WebSocket连接成功即表示初始连接完成
          isConnected: true     // 可以开始后续操作
        });
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[SharedWebRTC] 📨 收到信令消息:', message.type);

          switch (message.type) {
            case 'peer-joined':
              // 对方加入房间的通知
              console.log('[SharedWebRTC] 👥 对方已加入房间，角色:', message.payload?.role);
              if (role === 'sender' && message.payload?.role === 'receiver') {
                console.log('[SharedWebRTC] 🚀 接收方已连接，发送方自动建立P2P连接');
                updateState({ isPeerConnected: true }); // 标记对方已加入，可以开始P2P
                
                // 发送方自动创建offer建立基础P2P连接
                try {
                  console.log('[SharedWebRTC] 📡 自动创建基础P2P连接offer');
                  await createOffer(pc, ws);
                } catch (error) {
                  console.error('[SharedWebRTC] 自动创建基础P2P连接失败:', error);
                }
              } else if (role === 'receiver' && message.payload?.role === 'sender') {
                console.log('[SharedWebRTC] 🚀 发送方已连接，接收方准备接收P2P连接');
                updateState({ isPeerConnected: true }); // 标记对方已加入
              }
              break;

            case 'offer':
              console.log('[SharedWebRTC] 📬 处理offer...');
              if (pc.signalingState === 'stable') {
                await pc.setRemoteDescription(new RTCSessionDescription(message.payload));
                console.log('[SharedWebRTC] ✅ 设置远程描述完成');
                
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                console.log('[SharedWebRTC] ✅ 创建并设置answer完成');
                
                ws.send(JSON.stringify({ type: 'answer', payload: answer }));
                console.log('[SharedWebRTC] 📤 发送 answer');
              } else {
                console.warn('[SharedWebRTC] ⚠️ PeerConnection状态不是stable:', pc.signalingState);
              }
              break;

            case 'answer':
              console.log('[SharedWebRTC] 📬 处理answer...');
              try {
                if (pc.signalingState === 'have-local-offer') {
                  await pc.setRemoteDescription(new RTCSessionDescription(message.payload));
                  console.log('[SharedWebRTC] ✅ answer 处理完成');
                } else {
                  console.warn('[SharedWebRTC] ⚠️ PeerConnection状态不是have-local-offer:', pc.signalingState);
                  // 如果状态不对，尝试重新创建 offer
                  if (pc.connectionState === 'connected' || pc.connectionState === 'connecting') {
                    console.log('[SharedWebRTC] 🔄 连接状态正常但信令状态异常，尝试重新创建offer');
                    // 这里不直接处理，让连接自然建立
                  }
                }
              } catch (error) {
                console.error('[SharedWebRTC] ❌ 处理answer失败:', error);
                if (error instanceof Error && error.message.includes('Failed to set local answer sdp')) {
                  console.warn('[SharedWebRTC] ⚠️ Answer处理失败，可能是连接状态变化导致的');
                  // 清理连接状态，让客户端重新连接
                  updateState({ error: 'WebRTC连接状态异常，请重新连接', isPeerConnected: false });
                }
              }
              break;

            case 'ice-candidate':
              if (message.payload && pc.remoteDescription) {
                try {
                  await pc.addIceCandidate(new RTCIceCandidate(message.payload));
                  console.log('[SharedWebRTC] ✅ 添加 ICE 候选成功');
                } catch (err) {
                  console.warn('[SharedWebRTC] ⚠️ 添加 ICE 候选失败:', err);
                }
              } else {
                console.warn('[SharedWebRTC] ⚠️ ICE候选无效或远程描述未设置');
              }
              break;

            case 'error':
              console.error('[SharedWebRTC] ❌ 信令服务器错误:', message.error);
              updateState({ error: message.error, isConnecting: false, canRetry: true });
              break;

            case 'disconnection':
              console.log('[SharedWebRTC] 🔌 对方主动断开连接');
              // 对方断开连接的处理
              updateState({ 
                isPeerConnected: false,
                isConnected: false,  // 添加这个状态
                error: '对方已离开房间',
                canRetry: true 
              });
              // 清理P2P连接但保持WebSocket连接，允许重新连接
              if (pcRef.current) {
                pcRef.current.close();
                pcRef.current = null;
              }
              if (dcRef.current) {
                dcRef.current.close();
                dcRef.current = null;
              }
              break;

            default:
              console.warn('[SharedWebRTC] ⚠️ 未知消息类型:', message.type);
          }
        } catch (error) {
          console.error('[SharedWebRTC] ❌ 处理信令消息失败:', error);
          updateState({ error: '信令处理失败: ' + error, isConnecting: false, canRetry: true });
        }
      };

      ws.onerror = (error) => {
        console.error('[SharedWebRTC] ❌ WebSocket 错误:', error);
        updateState({ error: 'WebSocket连接失败', isConnecting: false, canRetry: true });
      };

      ws.onclose = (event) => {
        console.log('[SharedWebRTC] 🔌 WebSocket 连接已关闭, 代码:', event.code, '原因:', event.reason);
        updateState({ isWebSocketConnected: false });
        
        // 检查是否是用户主动断开
        if (isUserDisconnecting.current) {
          console.log('[SharedWebRTC] ✅ 用户主动断开，正常关闭');
          // 用户主动断开时不显示错误消息
          return;
        }
        
        // 只有在非正常关闭且不是用户主动断开时才显示错误
        if (event.code !== 1000 && event.code !== 1001) { // 非正常关闭
          updateState({ error: `WebSocket异常关闭 (${event.code}): ${event.reason || '连接意外断开'}`, isConnecting: false, canRetry: true });
        }
      };

      // PeerConnection 事件处理
      pc.onicecandidate = (event) => {
        if (event.candidate && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            type: 'ice-candidate',
            payload: event.candidate
          }));
          console.log('[SharedWebRTC] 📤 发送 ICE 候选:', event.candidate.candidate.substring(0, 50) + '...');
        } else if (!event.candidate) {
          console.log('[SharedWebRTC] 🏁 ICE 收集完成');
        }
      };

      pc.oniceconnectionstatechange = () => {
        console.log('[SharedWebRTC] 🧊 ICE连接状态变化:', pc.iceConnectionState);
        switch (pc.iceConnectionState) {
          case 'checking':
            console.log('[SharedWebRTC] 🔍 正在检查ICE连接...');
            break;
          case 'connected':
          case 'completed':
            console.log('[SharedWebRTC] ✅ ICE连接成功');
            break;
          case 'failed':
            console.error('[SharedWebRTC] ❌ ICE连接失败');
            updateState({ error: 'ICE连接失败，可能是网络防火墙阻止了连接', isConnecting: false, canRetry: true });
            break;
          case 'disconnected':
            console.log('[SharedWebRTC] 🔌 ICE连接断开');
            break;
          case 'closed':
            console.log('[SharedWebRTC] 🚫 ICE连接已关闭');
            break;
        }
      };

      pc.onconnectionstatechange = () => {
        console.log('[SharedWebRTC] 🔗 WebRTC连接状态变化:', pc.connectionState);
        switch (pc.connectionState) {
          case 'connecting':
            console.log('[SharedWebRTC] 🔄 WebRTC正在连接中...');
            updateState({ isPeerConnected: false });
            break;
          case 'connected':
            console.log('[SharedWebRTC] 🎉 WebRTC P2P连接已完全建立，可以进行媒体传输');
            updateState({ isPeerConnected: true, error: null, canRetry: false });
            break;
          case 'failed':
            // 只有在数据通道也未打开的情况下才认为连接真正失败
            const currentDc = dcRef.current;
            if (!currentDc || currentDc.readyState !== 'open') {
              console.error('[SharedWebRTC] ❌ WebRTC连接失败，数据通道未建立');
              updateState({ error: 'WebRTC连接失败，请检查网络设置或重试', isPeerConnected: false, canRetry: true });
            } else {
              console.log('[SharedWebRTC] ⚠️ WebRTC连接状态为failed，但数据通道正常，忽略此状态');
            }
            break;
          case 'disconnected':
            console.log('[SharedWebRTC] 🔌 WebRTC连接已断开');
            updateState({ isPeerConnected: false });
            break;
          case 'closed':
            console.log('[SharedWebRTC] 🚫 WebRTC连接已关闭');
            updateState({ isPeerConnected: false });
            break;
        }
      };

      // 数据通道处理
      if (role === 'sender') {
        const dataChannel = pc.createDataChannel('shared-channel', {
          ordered: true,
          maxRetransmits: 3
        });
        dcRef.current = dataChannel;

        dataChannel.onopen = () => {
          console.log('[SharedWebRTC] 数据通道已打开 (发送方)');
          updateState({ isPeerConnected: true, error: null, isConnecting: false, canRetry: false });
        };

        dataChannel.onmessage = handleDataChannelMessage;

        dataChannel.onerror = (error) => {
          console.error('[SharedWebRTC] 数据通道错误:', error);
          
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
              const pc = pcRef.current;
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
          
          console.error(`[SharedWebRTC] 数据通道详细错误 - 状态: ${dataChannel.readyState}, 消息: ${errorMessage}, 建议重试: ${shouldRetry}`);
          
          updateState({ 
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
            console.log('[SharedWebRTC] 数据通道已打开 (接收方)');
            updateState({ isPeerConnected: true, error: null, isConnecting: false, canRetry: false });
          };

          dataChannel.onmessage = handleDataChannelMessage;

          dataChannel.onerror = (error) => {
            console.error('[SharedWebRTC] 数据通道错误 (接收方):', error);
            
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
                const pc = pcRef.current;
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
            
            console.error(`[SharedWebRTC] 数据通道详细错误 (接收方) - 状态: ${dataChannel.readyState}, 消息: ${errorMessage}, 建议重试: ${shouldRetry}`);
            
            updateState({ 
              error: errorMessage, 
              isConnecting: false,
              isPeerConnected: false,  // 数据通道出错时，P2P连接肯定不可用
              canRetry: shouldRetry    // 设置是否可以重试
            });
          };
        };
      }

      // 设置轨道接收处理（对于接收方）
      pc.ontrack = (event) => {
        console.log('[SharedWebRTC] 🎥 PeerConnection收到轨道:', event.track.kind, event.track.id);
        console.log('[SharedWebRTC] 关联的流数量:', event.streams.length);
        
        if (event.streams.length > 0) {
          console.log('[SharedWebRTC] 🎬 轨道关联到流:', event.streams[0].id);
        }
        
        // 这里不处理，让具体的业务逻辑处理
        // onTrack会被业务逻辑重新设置
      };

    } catch (error) {
      console.error('[SharedWebRTC] 连接失败:', error);
      updateState({
        error: error instanceof Error ? error.message : '连接失败',
        isConnecting: false,
        canRetry: true
      });
    }
  }, [updateState, cleanup, createOffer, handleDataChannelMessage, webrtcStore.isConnecting, webrtcStore.isConnected]);

  // 断开连接
  const disconnect = useCallback(() => {
    console.log('[SharedWebRTC] 主动断开连接');
    
    // 设置主动断开标志
    isUserDisconnecting.current = true;
    
    // 在断开之前通知对方
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify({ 
          type: 'disconnection', 
          payload: { reason: '用户主动断开' }
        }));
        console.log('[SharedWebRTC] 📤 已通知对方断开连接');
      } catch (error) {
        console.warn('[SharedWebRTC] 发送断开通知失败:', error);
      }
    }
    
    // 清理连接
    cleanup();
    
    // 主动断开时，将状态完全重置为初始状态（没有任何错误或消息）
    webrtcStore.resetToInitial();
  }, [cleanup, webrtcStore]);

  // 重试连接
  const retry = useCallback(async () => {
    const room = currentRoom.current;
    if (!room) {
      console.warn('[SharedWebRTC] 没有当前房间信息，无法重试');
      updateState({ error: '无法重试连接：缺少房间信息', canRetry: false });
      return;
    }
    
    console.log('[SharedWebRTC] 🔄 重试连接到房间:', room.code, room.role);
    
    // 清理当前连接
    cleanup();
    
    // 重新连接
    await connect(room.code, room.role);
  }, [cleanup, connect, updateState]);

  // 发送消息
  const sendMessage = useCallback((message: WebRTCMessage, channel?: string) => {
    const dataChannel = dcRef.current;
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('[SharedWebRTC] 数据通道未准备就绪');
      return false;
    }

    try {
      const messageWithChannel = channel ? { ...message, channel } : message;
      dataChannel.send(JSON.stringify(messageWithChannel));
      console.log('[SharedWebRTC] 发送消息:', message.type, channel || 'default');
      return true;
    } catch (error) {
      console.error('[SharedWebRTC] 发送消息失败:', error);
      return false;
    }
  }, []);

  // 发送二进制数据
  const sendData = useCallback((data: ArrayBuffer) => {
    const dataChannel = dcRef.current;
    if (!dataChannel || dataChannel.readyState !== 'open') {
      console.error('[SharedWebRTC] 数据通道未准备就绪');
      return false;
    }

    try {
      dataChannel.send(data);
      console.log('[SharedWebRTC] 发送数据:', data.byteLength, 'bytes');
      return true;
    } catch (error) {
      console.error('[SharedWebRTC] 发送数据失败:', error);
      return false;
    }
  }, []);

  // 注册消息处理器
  const registerMessageHandler = useCallback((channel: string, handler: MessageHandler) => {
    console.log('[SharedWebRTC] 注册消息处理器:', channel);
    messageHandlers.current.set(channel, handler);

    return () => {
      console.log('[SharedWebRTC] 取消注册消息处理器:', channel);
      messageHandlers.current.delete(channel);
    };
  }, []);

  // 注册数据处理器
  const registerDataHandler = useCallback((channel: string, handler: DataHandler) => {
    console.log('[SharedWebRTC] 注册数据处理器:', channel);
    dataHandlers.current.set(channel, handler);

    return () => {
      console.log('[SharedWebRTC] 取消注册数据处理器:', channel);
      dataHandlers.current.delete(channel);
    };
  }, []);

  // 获取数据通道状态
  const getChannelState = useCallback(() => {
    return dcRef.current?.readyState || 'closed';
  }, []);

  // 检查是否已连接到指定房间
  const isConnectedToRoom = useCallback((roomCode: string, role: 'sender' | 'receiver') => {
    return currentRoom.current?.code === roomCode &&
      currentRoom.current?.role === role &&
      webrtcStore.isConnected;
  }, [webrtcStore.isConnected]);

  // 添加媒体轨道
  const addTrack = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
    const pc = pcRef.current;
    if (!pc) {
      console.error('[SharedWebRTC] PeerConnection 不可用');
      return null;
    }
    
    try {
      return pc.addTrack(track, stream);
    } catch (error) {
      console.error('[SharedWebRTC] 添加轨道失败:', error);
      return null;
    }
  }, []);

  // 移除媒体轨道
  const removeTrack = useCallback((sender: RTCRtpSender) => {
    const pc = pcRef.current;
    if (!pc) {
      console.error('[SharedWebRTC] PeerConnection 不可用');
      return;
    }
    
    try {
      pc.removeTrack(sender);
    } catch (error) {
      console.error('[SharedWebRTC] 移除轨道失败:', error);
    }
  }, []);

  // 设置轨道处理器
  const onTrack = useCallback((handler: (event: RTCTrackEvent) => void) => {
    const pc = pcRef.current;
    if (!pc) {
      console.warn('[SharedWebRTC] PeerConnection 尚未准备就绪，将在连接建立后设置onTrack');
      // 检查WebSocket连接状态，只有连接后才尝试设置
      if (!webrtcStore.isWebSocketConnected) {
        console.log('[SharedWebRTC] WebSocket未连接，等待连接建立...');
        return;
      }
      
      // 延迟设置，等待PeerConnection准备就绪
      let retryCount = 0;
      const maxRetries = 30; // 最多重试30次，即3秒
      
      const checkAndSetTrackHandler = () => {
        const currentPc = pcRef.current;
        if (currentPc) {
          console.log('[SharedWebRTC] ✅ PeerConnection 已准备就绪，设置onTrack处理器');
          currentPc.ontrack = handler;
        } else {
          retryCount++;
          if (retryCount < maxRetries) {
            // 只在偶数次重试时输出日志，减少日志数量
            if (retryCount % 2 === 0) {
              console.log(`[SharedWebRTC] ⏳ 等待PeerConnection准备就绪... (尝试: ${retryCount}/${maxRetries})`);
            }
            setTimeout(checkAndSetTrackHandler, 100);
          } else {
            console.error('[SharedWebRTC] ❌ PeerConnection 长时间未准备就绪，停止重试');
          }
        }
      };
      checkAndSetTrackHandler();
      return;
    }
    
    console.log('[SharedWebRTC] ✅ 立即设置onTrack处理器');
    pc.ontrack = handler;
  }, [webrtcStore.isWebSocketConnected]);

  // 获取PeerConnection实例
  const getPeerConnection = useCallback(() => {
    return pcRef.current;
  }, []);

  // 立即创建offer（用于媒体轨道添加后的重新协商）
  const createOfferNow = useCallback(async () => {
    const pc = pcRef.current;
    const ws = wsRef.current;
    if (!pc || !ws) {
      console.error('[SharedWebRTC] PeerConnection 或 WebSocket 不可用');
      return false;
    }
    
    try {
      await createOffer(pc, ws);
      return true;
    } catch (error) {
      console.error('[SharedWebRTC] 创建 offer 失败:', error);
      return false;
    }
  }, [createOffer]);

  return {
    // 状态
    isConnected: webrtcStore.isConnected,
    isConnecting: webrtcStore.isConnecting,
    isWebSocketConnected: webrtcStore.isWebSocketConnected,
    isPeerConnected: webrtcStore.isPeerConnected,
    error: webrtcStore.error,
    canRetry: webrtcStore.canRetry,

    // 操作方法
    connect,
    disconnect,
    retry,
    sendMessage,
    sendData,

    // 处理器注册
    registerMessageHandler,
    registerDataHandler,

    // 工具方法
    getChannelState,
    isConnectedToRoom,

    // 媒体轨道方法
    addTrack,
    removeTrack,
    onTrack,
    getPeerConnection,
    createOfferNow,

    // 当前房间信息
    currentRoom: currentRoom.current,
  };
}
