
import { useRef, useCallback } from 'react';
import { getWsUrl } from '@/lib/config';
import { getIceServersConfig } from '../settings/useIceServersConfig';
import { WebRTCStateManager } from '../ui/webRTCStore';
import { WebRTCDataChannelManager } from './useWebRTCDataChannelManager';
import { WebRTCTrackManager } from './useWebRTCTrackManager';

/**
 * WebRTC 核心连接管理器
 * 负责基础的 WebRTC 连接管理，支持 P2P → WS Relay 自动降级
 */
export interface WebRTCConnectionCore {
  // 连接到房间
  connect: (roomCode: string, role: 'sender' | 'receiver') => Promise<void>;
  
  // 断开连接
  disconnect: (shouldNotifyDisconnect?: boolean) => void;
  
  // 重试连接
  retry: () => Promise<void>;
  
  // 获取 PeerConnection 实例
  getPeerConnection: () => RTCPeerConnection | null;
  
  // 获取 WebSocket 实例
  getWebSocket: () => WebSocket | null;
  
  // 获取当前房间信息
  getCurrentRoom: () => { code: string; role: 'sender' | 'receiver' } | null;
}

/**
 * WebRTC 核心连接管理 Hook
 * 负责基础的 WebRTC 连接管理，包括 WebSocket 连接、PeerConnection 创建和管理
 */
export function useWebRTCConnectionCore(
  stateManager: WebRTCStateManager,
  dataChannelManager: WebRTCDataChannelManager,
  trackManager: WebRTCTrackManager
): WebRTCConnectionCore {
  const wsRef = useRef<WebSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 当前连接的房间信息
  const currentRoom = useRef<{ code: string; role: 'sender' | 'receiver' } | null>(null);
  
  // 用于跟踪是否是用户主动断开连接
  const isUserDisconnecting = useRef<boolean>(false);
  
  // 中继降级相关
  const relayWsRef = useRef<WebSocket | null>(null);
  const isRelayFallbackInProgress = useRef<boolean>(false);
  const p2pFailureTimeout = useRef<NodeJS.Timeout | null>(null);
  // 标记是否已经发送过 relay-request（避免重复发送）
  const relayRequestSent = useRef<boolean>(false);

  // 清理连接
  const cleanup = useCallback((shouldNotifyDisconnect: boolean = false) => {
    console.log('[ConnectionCore] 清理连接, 是否发送断开通知:', shouldNotifyDisconnect);
    
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    
    if (p2pFailureTimeout.current) {
      clearTimeout(p2pFailureTimeout.current);
      p2pFailureTimeout.current = null;
    }

    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }

    // 关闭中继连接
    dataChannelManager.closeRelay();
    if (relayWsRef.current) {
      relayWsRef.current.close();
      relayWsRef.current = null;
    }
    isRelayFallbackInProgress.current = false;
    relayRequestSent.current = false;

    // 在清理 WebSocket 之前发送断开通知
    if (shouldNotifyDisconnect && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      try {
        wsRef.current.send(JSON.stringify({ 
          type: 'disconnection', 
          payload: { reason: '用户主动断开' }
        }));
        console.log('[ConnectionCore] 📤 清理时已通知对方断开连接');
      } catch (error) {
        console.warn('[ConnectionCore] 清理时发送断开通知失败:', error);
      }
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    currentRoom.current = null;
    // 注意：不在此处重置 isUserDisconnecting，
    // 因为 ws.onclose 是异步触发的，需要保持标志直到 onclose 处理完毕
  }, [dataChannelManager]);

  // ===== 连接到中继服务器（实际的 WS 连接逻辑） =====
  const connectToRelay = useCallback(() => {
    const room = currentRoom.current;
    if (!room) {
      console.warn('[ConnectionCore] 没有房间信息，无法连接中继');
      return;
    }

    if (isRelayFallbackInProgress.current) {
      console.log('[ConnectionCore] ⏭️ 中继连接已在进行中，跳过');
      return;
    }

    if (isUserDisconnecting.current) {
      console.log('[ConnectionCore] 用户正在主动断开，跳过中继');
      return;
    }

    isRelayFallbackInProgress.current = true;
    console.log('[ConnectionCore] 🔄 连接到中继服务器...');
    
    // 更新状态：正在降级
    stateManager.updateState({
      error: null,
      isConnecting: true,
      canRetry: false,
    });

    const baseWsUrl = getWsUrl();
    if (!baseWsUrl) {
      console.error('[ConnectionCore] 无法获取 WS URL，中继连接失败');
      isRelayFallbackInProgress.current = false;
      stateManager.updateState({
        error: '中继连接失败：无法获取服务器地址',
        isConnecting: false,
        canRetry: true,
      });
      return;
    }

    const relayUrl = `${baseWsUrl}/api/ws/relay?code=${room.code}&role=${room.role}`;
    console.log('[ConnectionCore] 🌐 连接中继服务器:', relayUrl);

    try {
      const relayWs = new WebSocket(relayUrl);
      relayWsRef.current = relayWs;

      relayWs.binaryType = 'arraybuffer';

      relayWs.onopen = () => {
        console.log('[ConnectionCore] ✅ 中继 WebSocket 连接已建立');
      };

      // 统一的消息处理器：控制消息在这里处理，数据消息转发给 dataChannelManager
      relayWs.onmessage = (event: MessageEvent) => {
        // 文本消息：先检查是否是中继控制消息
        if (typeof event.data === 'string') {
          try {
            const msg = JSON.parse(event.data);
            
            // 中继服务的控制消息
            if (msg.type === 'relay-ready') {
              console.log('[ConnectionCore] 📡 中继已就绪, 对方在线:', msg.peer_connected);
              if (msg.peer_connected) {
                console.log('[ConnectionCore] 🎉 双方已通过中继连接，切换传输通道');
                dataChannelManager.switchToRelay(relayWs);
                isRelayFallbackInProgress.current = false;
                stateManager.updateState({
                  isConnected: true,
                  isConnecting: false,
                  isPeerConnected: true,
                  error: null,
                  canRetry: false,
                  transportMode: 'relay',
                });
              }
              // peer_connected === false: 等待对方也连接到中继
              return;
            }
            
            if (msg.type === 'relay-peer-joined') {
              console.log('[ConnectionCore] 🎉 对方已加入中继房间，切换传输通道');
              dataChannelManager.switchToRelay(relayWs);
              isRelayFallbackInProgress.current = false;
              stateManager.updateState({
                isConnected: true,
                isConnecting: false,
                isPeerConnected: true,
                error: null,
                canRetry: false,
                transportMode: 'relay',
              });
              return;
            }

            if (msg.type === 'relay-peer-left') {
              console.log('[ConnectionCore] 🔌 对方离开中继房间');
              stateManager.updateState({
                isPeerConnected: false,
                isConnected: false,
                error: '对方已离开房间',
                canRetry: true,
              });
              return;
            }

            if (msg.type === 'error') {
              console.error('[ConnectionCore] 中继服务错误:', msg.error);
              isRelayFallbackInProgress.current = false;
              stateManager.updateState({
                error: `中继连接失败: ${msg.error}`,
                isConnecting: false,
                canRetry: true,
              });
              return;
            }
          } catch {
            // 不是合法 JSON 或不是控制消息，当作数据消息处理
          }
        }

        // 非控制消息 → 交给 dataChannelManager 分发给业务层
        dataChannelManager.handleRelayMessage(event);
      };

      relayWs.onerror = (error) => {
        console.error('[ConnectionCore] ❌ 中继 WebSocket 错误:', error);
        isRelayFallbackInProgress.current = false;
        stateManager.updateState({
          error: 'WS 中继连接失败，请重试',
          isConnecting: false,
          canRetry: true,
        });
      };

      relayWs.onclose = (event) => {
        console.log('[ConnectionCore] 🔌 中继 WebSocket 关闭:', event.code, event.reason);
        if (relayWsRef.current === relayWs) {
          relayWsRef.current = null;
        }
        isRelayFallbackInProgress.current = false;
        
        // 如果不是用户主动断开，且当前是中继模式
        if (!isUserDisconnecting.current && stateManager.getState().transportMode === 'relay') {
          stateManager.updateState({
            isConnected: false,
            isPeerConnected: false,
            error: '中继连接断开',
            canRetry: true,
          });
        }
      };

    } catch (error) {
      console.error('[ConnectionCore] 创建中继连接失败:', error);
      isRelayFallbackInProgress.current = false;
      stateManager.updateState({
        error: '无法建立中继连接，请重试',
        isConnecting: false,
        canRetry: true,
      });
    }
  }, [stateManager, dataChannelManager]);

  // ===== 发起中继降级（通知对方 + 自己连接） =====
  const initiateRelayFallback = useCallback(() => {
    if (relayRequestSent.current || isRelayFallbackInProgress.current) {
      console.log('[ConnectionCore] ⏭️ 中继降级已发起/进行中，跳过');
      return;
    }
    
    const room = currentRoom.current;
    if (!room) {
      console.warn('[ConnectionCore] 没有房间信息，无法降级');
      return;
    }

    if (isUserDisconnecting.current) {
      console.log('[ConnectionCore] 用户正在主动断开，跳过降级');
      return;
    }

    console.log('[ConnectionCore] 🔄 P2P 连接失败，通过信令通知对方切换中继...');
    relayRequestSent.current = true;

    // 通过信令 WS 通知对方也连接到中继
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        type: 'relay-request',
        payload: { reason: 'P2P连接失败' }
      }));
      console.log('[ConnectionCore] 📤 已通过信令通知对方切换中继');
    }

    // 自己也连接到中继
    connectToRelay();
  }, [connectToRelay]);

  // 创建 PeerConnection 和相关设置
  const createPeerConnection = useCallback((ws: WebSocket, role: 'sender' | 'receiver', isReconnect: boolean = false) => {
    console.log('[ConnectionCore] 🔧 创建PeerConnection...', { role, isReconnect });
    
    // 如果已经存在PeerConnection，先关闭它
    if (pcRef.current) {
      console.log('[ConnectionCore] 🔧 关闭已存在的PeerConnection');
      pcRef.current.close();
    }
    
    // 获取用户配置的ICE服务器
    const iceServers = getIceServersConfig();
    console.log('[ConnectionCore] 🧊 使用ICE服务器配置:', iceServers);
    
    // 创建 PeerConnection
    const pc = new RTCPeerConnection({
      iceServers: iceServers,
      iceCandidatePoolSize: 10,
    });
    pcRef.current = pc;

    // 设置轨道接收处理（对于接收方）
    pc.ontrack = (event) => {
      console.log('[ConnectionCore] 🎥 PeerConnection收到轨道:', event.track.kind, event.track.id, '状态:', event.track.readyState);
      console.log('[ConnectionCore] 关联的流数量:', event.streams.length);
      
      // 这里不处理轨道，让业务逻辑的onTrack处理器处理
      // 业务逻辑会在useEffect中设置自己的处理器
      // 这样可以确保重新连接时轨道能够被正确处理
    };

    // PeerConnection 事件处理
    pc.onicecandidate = (event) => {
      if (event.candidate && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'ice-candidate',
          payload: event.candidate
        }));
        console.log('[ConnectionCore] 📤 发送 ICE 候选:', event.candidate.candidate.substring(0, 50) + '...');
      } else if (!event.candidate) {
        console.log('[ConnectionCore] 🏁 ICE 收集完成');
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[ConnectionCore] 🧊 ICE连接状态变化:', pc.iceConnectionState);
      switch (pc.iceConnectionState) {
        case 'checking':
          console.log('[ConnectionCore] 🔍 正在检查ICE连接...');
          break;
        case 'connected':
        case 'completed':
          console.log('[ConnectionCore] ✅ ICE连接成功');
          // ICE 连接成功，清除降级定时器
          if (p2pFailureTimeout.current) {
            clearTimeout(p2pFailureTimeout.current);
            p2pFailureTimeout.current = null;
          }
          break;
        case 'failed':
          console.error('[ConnectionCore] ❌ ICE连接失败，启动中继降级');
          initiateRelayFallback();
          break;
        case 'disconnected':
          console.log('[ConnectionCore] 🔌 ICE连接断开');
          break;
        case 'closed':
          console.log('[ConnectionCore] 🚫 ICE连接已关闭');
          break;
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[ConnectionCore] 🔗 WebRTC连接状态变化:', pc.connectionState);
      switch (pc.connectionState) {
        case 'connecting':
          console.log('[ConnectionCore] 🔄 WebRTC正在连接中...');
          stateManager.updateState({ isPeerConnected: false });
          
          // 设置 P2P 连接超时：15 秒后如果还没连上就降级
          if (p2pFailureTimeout.current) {
            clearTimeout(p2pFailureTimeout.current);
          }
          p2pFailureTimeout.current = setTimeout(() => {
            if (pcRef.current && pcRef.current.connectionState !== 'connected') {
              console.log('[ConnectionCore] ⏰ P2P 连接超时（15秒），启动中继降级');
              initiateRelayFallback();
            }
          }, 15000);
          break;
        case 'connected':
          console.log('[ConnectionCore] 🎉 WebRTC P2P连接已完全建立，可以进行媒体传输');
          // 清除降级定时器
          if (p2pFailureTimeout.current) {
            clearTimeout(p2pFailureTimeout.current);
            p2pFailureTimeout.current = null;
          }
          // 确保所有连接状态都正确更新
          stateManager.updateState({
            isWebSocketConnected: true,
            isConnected: true,
            isPeerConnected: true,
            error: null,
            canRetry: false,
            transportMode: 'p2p',
          });
          
          // 如果是重新连接，触发数据同步
          if (isReconnect) {
            console.log('[ConnectionCore] 🔄 检测到重新连接，触发数据同步');
            setTimeout(() => {
              const dc = pcRef.current?.createDataChannel('sync-channel');
              if (dc && dc.readyState === 'open') {
                dc.send(JSON.stringify({
                  type: 'sync-request',
                  payload: { timestamp: Date.now() }
                }));
                console.log('[ConnectionCore] 📤 发送数据同步请求');
                dc.close();
              }
            }, 500);
          }
          break;
        case 'failed':
          console.error('[ConnectionCore] ❌ WebRTC连接失败');
          if (!isUserDisconnecting.current) {
            console.log('[ConnectionCore] 启动中继降级');
            stateManager.updateState({ isPeerConnected: false });
            initiateRelayFallback();
          }
          break;
        case 'disconnected':
          console.log('[ConnectionCore] 🔌 WebRTC连接已断开');
          if (!isUserDisconnecting.current) {
            stateManager.updateState({ isPeerConnected: false });
          }
          break;
        case 'closed':
          console.log('[ConnectionCore] 🚫 WebRTC连接已关闭');
          if (!isUserDisconnecting.current) {
            stateManager.updateState({ isPeerConnected: false });
          }
          break;
      }
    };

    // 创建数据通道
    dataChannelManager.createDataChannel(pc, role, isReconnect);

    console.log('[ConnectionCore] ✅ PeerConnection创建完成，角色:', role, '是否重新连接:', isReconnect);
    return pc;
  }, [stateManager, dataChannelManager, initiateRelayFallback]);

  // 连接到房间
  const connect = useCallback(async (roomCode: string, role: 'sender' | 'receiver') => {
    console.log('[ConnectionCore] 🚀 开始连接到房间:', roomCode, role);

    // 如果正在连接中，避免重复连接
    const state = stateManager.getState();
    if (state.isConnecting) {
      console.warn('[ConnectionCore] ⚠️ 正在连接中，跳过重复连接请求');
      return;
    }

    // 检查是否是重新连接（页面关闭后重新打开）
    const isReconnect = currentRoom.current?.code === roomCode && currentRoom.current?.role === role;
    if (isReconnect) {
      console.log('[ConnectionCore] 🔄 检测到重新连接，清理旧连接');
    }

    // 清理之前的连接
    cleanup();
    currentRoom.current = { code: roomCode, role };
    stateManager.setCurrentRoom({ code: roomCode, role });
    stateManager.updateState({ isConnecting: true, error: null });
    
    // 重置主动断开标志
    isUserDisconnecting.current = false;

    try {
      // 连接 WebSocket - 使用动态URL
      const baseWsUrl = getWsUrl();
      if (!baseWsUrl) {
        throw new Error('WebSocket URL未配置');
      }
      
      // 构建完整的WebSocket URL
      const wsUrl = `${baseWsUrl}/api/ws/webrtc?code=${roomCode}&role=${role}&channel=shared`;
      console.log('[ConnectionCore] 🌐 连接WebSocket:', wsUrl);
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      // 保存重新连接状态，供后续使用
      const reconnectState = { isReconnect, role };

      // WebSocket 事件处理
      ws.onopen = () => {
        console.log('[ConnectionCore] ✅ WebSocket 连接已建立，房间准备就绪');
        stateManager.updateState({
          isWebSocketConnected: true,
          isConnecting: false,  // WebSocket连接成功即表示初始连接完成
          isConnected: true     // 可以开始后续操作
        });
        
        // 如果是重新连接且是发送方，检查是否有接收方在等待
        if (reconnectState.isReconnect && reconnectState.role === 'sender') {
          console.log('[ConnectionCore] 🔄 发送方重新连接，检查是否有接收方在等待');
          // 这里不需要立即创建PeerConnection，等待接收方加入的通知
        }
      };

      ws.onmessage = async (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[ConnectionCore] 📨 收到信令消息:', message.type);

          switch (message.type) {
            case 'peer-joined':
              // 对方加入房间的通知
              console.log('[ConnectionCore] 👥 对方已加入房间，角色:', message.payload?.role);
              if (role === 'sender' && message.payload?.role === 'receiver') {
                console.log('[ConnectionCore] 🚀 接收方已连接，发送方开始建立P2P连接');
                // 标记对方已加入，但 isPeerConnected 在 P2P/Relay 真正连通后才设为 true
                stateManager.updateState({
                  isWebSocketConnected: true,
                  isConnected: true,
                });
                
                // 如果是重新连接，先清理旧的PeerConnection
                if (reconnectState.isReconnect && pcRef.current) {
                  console.log('[ConnectionCore] 🔄 重新连接：清理旧的PeerConnection');
                  pcRef.current.close();
                  pcRef.current = null;
                }
                
                // 对方加入后，创建PeerConnection
                const pc = createPeerConnection(ws, role, reconnectState.isReconnect);
                
                // 设置轨道管理器的引用
                trackManager.setPeerConnection(pc);
                trackManager.setWebSocket(ws);
                
                // 发送方创建offer建立基础P2P连接
                try {
                  console.log('[ConnectionCore] 📡 创建基础P2P连接offer');
                  await trackManager.createOffer(pc, ws);
                } catch (error) {
                  console.error('[ConnectionCore] 创建基础P2P连接失败:', error);
                }
              } else if (role === 'receiver' && message.payload?.role === 'sender') {
                console.log('[ConnectionCore] 🚀 发送方已连接，接收方准备接收P2P连接');
                // 标记对方已加入，但 isPeerConnected 在 P2P/Relay 真正连通后才设为 true
                stateManager.updateState({
                  isWebSocketConnected: true,
                  isConnected: true,
                });
                
                // 如果是重新连接，先清理旧的PeerConnection
                if (reconnectState.isReconnect && pcRef.current) {
                  console.log('[ConnectionCore] 🔄 重新连接：清理旧的PeerConnection');
                  pcRef.current.close();
                  pcRef.current = null;
                }
                
                // 对方加入后，立即创建PeerConnection，准备接收offer
                const pc = createPeerConnection(ws, role, reconnectState.isReconnect);
                
                // 设置轨道管理器的引用
                trackManager.setPeerConnection(pc);
                trackManager.setWebSocket(ws);
                
                // 等待一小段时间确保PeerConnection完全初始化
                setTimeout(() => {
                  console.log('[ConnectionCore] ✅ 接收方PeerConnection已准备就绪');
                }, 100);
              }
              break;

            case 'offer':
              console.log('[ConnectionCore] 📬 处理offer...');
              // 如果PeerConnection不存在，先创建它
              let pcOffer = pcRef.current;
              if (!pcOffer) {
                console.log('[ConnectionCore] 🔧 PeerConnection不存在，先创建它');
                pcOffer = createPeerConnection(ws, role, reconnectState.isReconnect);
                
                // 设置轨道管理器的引用
                trackManager.setPeerConnection(pcOffer);
                trackManager.setWebSocket(ws);
                
                // 等待一小段时间确保PeerConnection完全初始化
                await new Promise(resolve => setTimeout(resolve, 100));
              }
              
              if (pcOffer && pcOffer.signalingState === 'stable') {
                await pcOffer.setRemoteDescription(new RTCSessionDescription(message.payload));
                console.log('[ConnectionCore] ✅ 设置远程描述完成');
                
                const answer = await pcOffer.createAnswer();
                await pcOffer.setLocalDescription(answer);
                console.log('[ConnectionCore] ✅ 创建并设置answer完成');
                
                ws.send(JSON.stringify({ type: 'answer', payload: answer }));
                console.log('[ConnectionCore] 📤 发送 answer');
              } else {
                console.warn('[ConnectionCore] ⚠️ PeerConnection状态不是stable或不存在:', pcOffer?.signalingState);
              }
              break;

            case 'answer':
              console.log('[ConnectionCore] 📬 处理answer...');
              let pcAnswer = pcRef.current;
              try {
                // 如果PeerConnection不存在，先创建它
                if (!pcAnswer) {
                  console.log('[ConnectionCore] 🔧 PeerConnection不存在，先创建它');
                  pcAnswer = createPeerConnection(ws, role, reconnectState.isReconnect);
                  
                  // 设置轨道管理器的引用
                  trackManager.setPeerConnection(pcAnswer);
                  trackManager.setWebSocket(ws);
                  
                  // 等待一小段时间确保PeerConnection完全初始化
                  await new Promise(resolve => setTimeout(resolve, 100));
                }
                
                if (pcAnswer) {
                  const signalingState = pcAnswer.signalingState;
                  // 如果状态是stable，可能是因为之前的offer已经完成，需要重新创建offer
                  if (signalingState === 'stable') {
                    console.log('[ConnectionCore] 🔄 PeerConnection状态为stable，重新创建offer');
                    try {
                      await trackManager.createOffer(pcAnswer, ws);
                      // 等待一段时间让ICE候选收集完成
                      await new Promise(resolve => setTimeout(resolve, 500));
                      
                      // 现在状态应该是have-local-offer，可以处理answer
                      if (pcAnswer.signalingState === 'have-local-offer') {
                        await pcAnswer.setRemoteDescription(new RTCSessionDescription(message.payload));
                        console.log('[ConnectionCore] ✅ answer 处理完成');
                      } else {
                        console.warn('[ConnectionCore] ⚠️ 重新创建offer后状态仍然不是have-local-offer:', pcAnswer.signalingState);
                      }
                    } catch (error) {
                      console.error('[ConnectionCore] ❌ 重新创建offer失败:', error);
                    }
                  } else if (signalingState === 'have-local-offer') {
                    await pcAnswer.setRemoteDescription(new RTCSessionDescription(message.payload));
                    console.log('[ConnectionCore] ✅ answer 处理完成');
                  } else {
                    console.warn('[ConnectionCore] ⚠️ PeerConnection状态异常:', signalingState);
                  }
                }
              } catch (error) {
                console.error('[ConnectionCore] ❌ 处理answer失败:', error);
                if (error instanceof Error && error.message.includes('Failed to set local answer sdp')) {
                  console.warn('[ConnectionCore] ⚠️ Answer处理失败，可能是连接状态变化导致的');
                  // 清理连接状态，让客户端重新连接
                  stateManager.updateState({ error: 'WebRTC连接状态异常，请重新连接', isPeerConnected: false });
                }
              }
              break;

            case 'ice-candidate':
              let pcIce = pcRef.current;
              if (!pcIce) {
                console.log('[ConnectionCore] 🔧 PeerConnection不存在，先创建它');
                pcIce = createPeerConnection(ws, role, reconnectState.isReconnect);
                
                // 等待一小段时间确保PeerConnection完全初始化
                await new Promise(resolve => setTimeout(resolve, 100));
              }
              
              if (pcIce && message.payload) {
                try {
                  // 即使远程描述未设置，也可以先缓存ICE候选
                  if (pcIce.remoteDescription) {
                    await pcIce.addIceCandidate(new RTCIceCandidate(message.payload));
                    console.log('[ConnectionCore] ✅ 添加 ICE 候选成功');
                  } else {
                    console.log('[ConnectionCore] 📝 远程描述未设置，缓存ICE候选');
                    // 可以在这里实现ICE候选缓存机制，等远程描述设置后再添加
                  }
                } catch (err) {
                  console.warn('[ConnectionCore] ⚠️ 添加 ICE 候选失败:', err);
                }
              } else {
                console.warn('[ConnectionCore] ⚠️ ICE候选无效或PeerConnection不存在');
              }
              break;

            case 'error':
              console.error('[ConnectionCore] ❌ 信令服务器错误:', message.error);
              stateManager.updateState({ error: message.error, isConnecting: false, canRetry: true });
              break;

            case 'relay-request':
              // 对方的 P2P 失败，请求双方都切换到中继模式
              console.log('[ConnectionCore] 📨 收到对方的中继降级请求');
              connectToRelay();
              break;

            case 'disconnection':
              console.log('[ConnectionCore] 🔌 对方主动断开连接');
              // 标记为主动断开，避免后续WS关闭和PC状态变化显示异常错误
              isUserDisconnecting.current = true;
              // 对方断开连接的处理
              stateManager.updateState({
                isPeerConnected: false,
                isConnected: false,
                error: '对方已退出共享',
                canRetry: false
              });
              // 清理P2P连接
              if (pcRef.current) {
                pcRef.current.close();
                pcRef.current = null;
              }
              // 延迟重置标志
              setTimeout(() => {
                isUserDisconnecting.current = false;
              }, 2000);
              break;

            default:
              console.warn('[ConnectionCore] ⚠️ 未知消息类型:', message.type);
          }
        } catch (error) {
          console.error('[ConnectionCore] ❌ 处理信令消息失败:', error);
          stateManager.updateState({ error: '信令处理失败: ' + error, isConnecting: false, canRetry: true });
        }
      };

      ws.onerror = (error) => {
        console.error('[ConnectionCore] ❌ WebSocket 错误:', error);
        stateManager.updateState({ error: 'WebSocket连接失败', isConnecting: false, canRetry: true });
      };

      ws.onclose = (event) => {
        console.log('[ConnectionCore] 🔌 WebSocket 连接已关闭, 代码:', event.code, '原因:', event.reason);
        stateManager.updateState({ isWebSocketConnected: false });
        
        // 检查是否是主动断开（自己或对方断开触发）
        if (isUserDisconnecting.current) {
          console.log('[ConnectionCore] ✅ 主动断开流程，正常关闭');
          isUserDisconnecting.current = false;
          return;
        }
        
        // 只有在非正常关闭且不是主动断开时才显示错误
        if (event.code !== 1000 && event.code !== 1001) {
          stateManager.updateState({ error: `WebSocket异常关闭 (${event.code}): ${event.reason || '连接意外断开'}`, isConnecting: false, canRetry: true });
        }
      };

    } catch (error) {
      console.error('[ConnectionCore] 连接失败:', error);
      stateManager.updateState({
        error: error instanceof Error ? error.message : '连接失败',
        isConnecting: false,
        canRetry: true
      });
    }
  }, [stateManager, cleanup, createPeerConnection, connectToRelay]);

  // 断开连接
  const disconnect = useCallback((shouldNotifyDisconnect: boolean = false) => {
    console.log('[ConnectionCore] 主动断开连接');
    
    // 设置主动断开标志
    isUserDisconnecting.current = true;
    
    // 清理连接并发送断开通知
    cleanup(shouldNotifyDisconnect);
    
    // 主动断开时，将状态完全重置为初始状态（没有任何错误或消息）
    stateManager.resetToInitial();
    
    // 延迟重置标志，确保异步的 onclose 回调能读到它
    setTimeout(() => {
      isUserDisconnecting.current = false;
    }, 1000);
    
    console.log('[ConnectionCore] ✅ 连接已断开并清理完成');
  }, [cleanup, stateManager]);

  // 重试连接
  const retry = useCallback(async () => {
    const room = currentRoom.current;
    if (!room) {
      console.warn('[ConnectionCore] 没有当前房间信息，无法重试');
      stateManager.updateState({ error: '无法重试连接：缺少房间信息', canRetry: false });
      return;
    }
    
    console.log('[ConnectionCore] 🔄 重试连接到房间:', room.code, room.role);
    
    // 清理当前连接
    cleanup();
    
    // 重新连接
    await connect(room.code, room.role);
  }, [cleanup, connect, stateManager]);

  // 获取 PeerConnection 实例
  const getPeerConnection = useCallback(() => {
    return pcRef.current;
  }, []);

  // 获取 WebSocket 实例
  const getWebSocket = useCallback(() => {
    return wsRef.current;
  }, []);

  // 获取当前房间信息
  const getCurrentRoom = useCallback(() => {
    return currentRoom.current;
  }, []);

  return {
    connect,
    disconnect,
    retry,
    getPeerConnection,
    getWebSocket,
    getCurrentRoom,
  };
}