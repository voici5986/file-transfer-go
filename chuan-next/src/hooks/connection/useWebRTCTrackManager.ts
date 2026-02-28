import { useCallback, useRef } from 'react';
import { WebRTCStateManager } from '../ui/webRTCStore';

/**
 * WebRTC 媒体轨道管理器
 * 负责媒体轨道的添加和移除
 */
export interface WebRTCTrackManager {
  // 添加媒体轨道
  addTrack: (track: MediaStreamTrack, stream: MediaStream) => RTCRtpSender | null;
  
  // 移除媒体轨道
  removeTrack: (sender: RTCRtpSender) => void;
  
  // 设置轨道处理器
  onTrack: (handler: (event: RTCTrackEvent) => void) => void;
  
  // 创建 Offer
  createOffer: (pc: RTCPeerConnection, ws: WebSocket) => Promise<void>;
  
  // 立即创建offer（用于媒体轨道添加后的重新协商）
  createOfferNow: (pc: RTCPeerConnection, ws: WebSocket) => Promise<boolean>;
  
  // 内部方法，供核心连接管理器调用
  setPeerConnection: (pc: RTCPeerConnection | null) => void;
  setWebSocket: (ws: WebSocket | null) => void;
}

/**
 * WebRTC 媒体轨道管理 Hook
 * 负责媒体轨道的添加和移除，处理轨道事件，提供 createOffer 功能
 */
export function useWebRTCTrackManager(
  stateManager: WebRTCStateManager
): WebRTCTrackManager {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // 创建 Offer
  const createOffer = useCallback(async (pc: RTCPeerConnection, ws: WebSocket) => {
    try {
      console.log('[TrackManager] 🎬 开始创建offer，当前轨道数量:', pc.getSenders().length);
      
      // 确保连接状态稳定
      if (pc.connectionState !== 'connecting' && pc.connectionState !== 'new') {
        console.warn('[TrackManager] ⚠️ PeerConnection状态异常:', pc.connectionState);
      }
      
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,  // 改为true以支持音频接收
        offerToReceiveVideo: true,  // 改为true以支持视频接收
      });

      console.log('[TrackManager] 📝 Offer创建成功，设置本地描述...');
      await pc.setLocalDescription(offer);
      console.log('[TrackManager] ✅ 本地描述设置完成');

      // 增加超时时间到5秒，给ICE候选收集更多时间
      const iceTimeout = setTimeout(() => {
        console.log('[TrackManager] ⏱️ ICE收集超时，发送当前offer');
        if (ws.readyState === WebSocket.OPEN && pc.localDescription) {
          ws.send(JSON.stringify({ type: 'offer', payload: pc.localDescription }));
          console.log('[TrackManager] 📤 发送 offer (超时发送)');
        }
      }, 5000);

      // 如果ICE收集已经完成，立即发送
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(iceTimeout);
        if (ws.readyState === WebSocket.OPEN && pc.localDescription) {
          ws.send(JSON.stringify({ type: 'offer', payload: pc.localDescription }));
          console.log('[TrackManager] 📤 发送 offer (ICE收集完成)');
        }
      } else {
        console.log('[TrackManager] 🧊 等待ICE候选收集...');
        // 监听ICE收集状态变化
        pc.onicegatheringstatechange = () => {
          console.log('[TrackManager] 🧊 ICE收集状态变化:', pc.iceGatheringState);
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(iceTimeout);
            if (ws.readyState === WebSocket.OPEN && pc.localDescription) {
              ws.send(JSON.stringify({ type: 'offer', payload: pc.localDescription }));
              console.log('[TrackManager] 📤 发送 offer (ICE收集完成)');
            }
          }
        };
        
        // 同时监听ICE候选事件，用于调试
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log('[TrackManager] 🧊 收到ICE候选:', event.candidate.candidate.substring(0, 50) + '...');
          } else {
            console.log('[TrackManager] 🏁 ICE候选收集完成');
          }
        };
      }
    } catch (error) {
      console.error('[TrackManager] ❌ 创建 offer 失败:', error);
      stateManager.updateState({ error: '创建连接失败', isConnecting: false, canRetry: true });
    }
  }, [stateManager]);

  // 添加媒体轨道
  const addTrack = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
    const pc = pcRef.current;
    if (!pc) {
      console.error('[TrackManager] PeerConnection 不可用');
      return null;
    }
    
    try {
      return pc.addTrack(track, stream);
    } catch (error) {
      console.error('[TrackManager] 添加轨道失败:', error);
      return null;
    }
  }, []);

  // 移除媒体轨道
  const removeTrack = useCallback((sender: RTCRtpSender) => {
    const pc = pcRef.current;
    if (!pc) {
      console.error('[TrackManager] PeerConnection 不可用');
      return;
    }
    
    try {
      pc.removeTrack(sender);
    } catch (error) {
      console.error('[TrackManager] 移除轨道失败:', error);
    }
  }, []);

  // 设置轨道处理器
  const onTrack = useCallback((handler: (event: RTCTrackEvent) => void) => {
    const pc = pcRef.current;
    if (!pc) {
      console.warn('[TrackManager] PeerConnection 尚未准备就绪，将在连接建立后设置onTrack');
      // 检查WebSocket连接状态，只有连接后才尝试设置
      const state = stateManager.getState();
      if (!state.isWebSocketConnected) {
        console.log('[TrackManager] WebSocket未连接，等待连接建立...');
        return;
      }
      
      // 延迟设置，等待PeerConnection准备就绪
      let retryCount = 0;
      const maxRetries = 50; // 增加重试次数到50次，即5秒
      
      const checkAndSetTrackHandler = () => {
        const currentPc = pcRef.current;
        if (currentPc) {
          console.log('[TrackManager] ✅ PeerConnection 已准备就绪，设置onTrack处理器');
          currentPc.ontrack = handler;
          
          // 如果已经有远程轨道，立即触发处理
          const receivers = currentPc.getReceivers();
          console.log(`[TrackManager] 📡 当前有 ${receivers.length} 个接收器`);
          receivers.forEach(receiver => {
            if (receiver.track) {
              console.log(`[TrackManager] 🎥 发现现有轨道: ${receiver.track.kind}, ${receiver.track.id}, 状态: ${receiver.track.readyState}`);
            }
          });
        } else {
          retryCount++;
          if (retryCount < maxRetries) {
            // 每5次重试输出一次日志，减少日志数量
            if (retryCount % 5 === 0) {
              console.log(`[TrackManager] ⏳ 等待PeerConnection准备就绪... (尝试: ${retryCount}/${maxRetries})`);
            }
            setTimeout(checkAndSetTrackHandler, 100);
          } else {
            console.error('[TrackManager] ❌ PeerConnection 长时间未准备就绪，停止重试');
          }
        }
      };
      checkAndSetTrackHandler();
      return;
    }
    
    console.log('[TrackManager] ✅ 立即设置onTrack处理器');
    pc.ontrack = handler;
    
    // 检查是否已有轨道
    const receivers = pc.getReceivers();
    console.log(`[TrackManager] 📡 当前有 ${receivers.length} 个接收器`);
    receivers.forEach(receiver => {
      if (receiver.track) {
        console.log(`[TrackManager] 🎥 发现现有轨道: ${receiver.track.kind}, ${receiver.track.id}, 状态: ${receiver.track.readyState}`);
      }
    });
  }, [stateManager]);

  // 立即创建offer（用于媒体轨道添加后的重新协商）
  const createOfferNow = useCallback(async (pc: RTCPeerConnection, ws: WebSocket) => {
    if (!pc || !ws) {
      console.error('[TrackManager] PeerConnection 或 WebSocket 不可用');
      return false;
    }
    
    try {
      await createOffer(pc, ws);
      return true;
    } catch (error) {
      console.error('[TrackManager] 创建 offer 失败:', error);
      return false;
    }
  }, [createOffer]);

  // 设置 PeerConnection 引用
  const setPeerConnection = useCallback((pc: RTCPeerConnection | null) => {
    pcRef.current = pc;
  }, []);

  // 设置 WebSocket 引用
  const setWebSocket = useCallback((ws: WebSocket | null) => {
    wsRef.current = ws;
  }, []);

  return {
    addTrack,
    removeTrack,
    onTrack,
    createOffer,
    createOfferNow,
    // 内部方法，供核心连接管理器调用
    setPeerConnection,
    setWebSocket,
  };
}