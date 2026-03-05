import { useCallback, useRef } from 'react';
import { WebRTCStateManager } from '../ui/webRTCStore';
import type { TrackHandler, Unsubscribe } from './types';

/**
 * WebRTC 媒体轨道管理器接口
 */
export interface WebRTCTrackManager {
  // 添加媒体轨道到 PeerConnection
  addTrack: (track: MediaStreamTrack, stream: MediaStream) => RTCRtpSender | null;
  
  // 移除媒体轨道
  removeTrack: (sender: RTCRtpSender) => void;
  
  /**
   * 注册轨道事件处理器（多监听器模式）
   * - 多个消费者可同时注册（桌面共享处理 video，语音通话处理 audio）
   * - 返回清理函数，组件卸载时务必调用
   */
  registerTrackHandler: (key: string, handler: TrackHandler) => Unsubscribe;
  
  // 创建并发送 SDP Offer（用于初始连接）
  createOffer: (pc: RTCPeerConnection, ws: WebSocket) => Promise<void>;
  
  // 立即创建 Offer（用于媒体轨道变更后的重新协商）
  createOfferNow: (pc: RTCPeerConnection, ws: WebSocket) => Promise<boolean>;
  
  // ── 内部方法，仅供 ConnectionCore 调用 ──
  setPeerConnection: (pc: RTCPeerConnection | null) => void;
  setWebSocket: (ws: WebSocket | null) => void;
}

/**
 * WebRTC 媒体轨道管理 Hook
 * 
 * 职责：
 * 1. 管理 RTCRtpSender（添加 / 移除轨道）
 * 2. 复合分发 ontrack 事件给多个消费者
 * 3. 创建 SDP Offer 并通过信令 WebSocket 发送
 */
export function useWebRTCTrackManager(
  stateManager: WebRTCStateManager
): WebRTCTrackManager {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  // 多监听器：key → handler（如 'desktop-share' → handler, 'voice-chat' → handler）
  const trackHandlers = useRef<Map<string, TrackHandler>>(new Map());

  // ── 复合分发：将 ontrack 事件广播给所有已注册的处理器 ──
  const dispatchTrackEvent = useCallback((event: RTCTrackEvent) => {
    const handlerCount = trackHandlers.current.size;
    if (handlerCount === 0) {
      console.warn('[TrackManager] 收到轨道事件但无处理器注册:', event.track.kind, event.track.id);
      return;
    }
    console.log(`[TrackManager] 📡 分发轨道事件 (${event.track.kind}) 给 ${handlerCount} 个处理器`);
    trackHandlers.current.forEach((handler, key) => {
      try {
        handler(event);
      } catch (error) {
        console.error(`[TrackManager] 轨道处理器 "${key}" 执行出错:`, error);
      }
    });
  }, []);

  // ── SDP Offer 创建 ──
  const createOffer = useCallback(async (pc: RTCPeerConnection, ws: WebSocket) => {
    try {
      console.log('[TrackManager] 🎬 开始创建 Offer，当前轨道数:', pc.getSenders().length);
      
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      console.log('[TrackManager] ✅ 本地描述设置完成');

      // ICE 收集超时保护
      const iceTimeout = setTimeout(() => {
        if (ws.readyState === WebSocket.OPEN && pc.localDescription) {
          ws.send(JSON.stringify({ type: 'offer', payload: pc.localDescription }));
          console.log('[TrackManager] 📤 发送 Offer (ICE 收集超时)');
        }
      }, 5000);

      if (pc.iceGatheringState === 'complete') {
        clearTimeout(iceTimeout);
        if (ws.readyState === WebSocket.OPEN && pc.localDescription) {
          ws.send(JSON.stringify({ type: 'offer', payload: pc.localDescription }));
          console.log('[TrackManager] 📤 发送 Offer (ICE 已完成)');
        }
      } else {
        pc.onicegatheringstatechange = () => {
          if (pc.iceGatheringState === 'complete') {
            clearTimeout(iceTimeout);
            if (ws.readyState === WebSocket.OPEN && pc.localDescription) {
              ws.send(JSON.stringify({ type: 'offer', payload: pc.localDescription }));
              console.log('[TrackManager] 📤 发送 Offer (ICE 收集完成)');
            }
          }
        };
        pc.onicecandidate = (event) => {
          if (event.candidate) {
            console.log('[TrackManager] 🧊 ICE 候选:', event.candidate.candidate.substring(0, 50) + '...');
          }
        };
      }
    } catch (error) {
      console.error('[TrackManager] ❌ 创建 Offer 失败:', error);
      stateManager.updateState({ error: '创建连接失败', isConnecting: false, canRetry: true });
    }
  }, [stateManager]);

  // ── 轨道操作 ──

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

  // ── 多监听器注册 ──

  const registerTrackHandler = useCallback((key: string, handler: TrackHandler): Unsubscribe => {
    console.log('[TrackManager] 注册轨道处理器:', key);
    trackHandlers.current.set(key, handler);

    return () => {
      console.log('[TrackManager] 取消注册轨道处理器:', key);
      trackHandlers.current.delete(key);
    };
  }, []);

  // ── 重新协商 ──

  const createOfferNow = useCallback(async (pc: RTCPeerConnection, ws: WebSocket) => {
    if (!pc || !ws) {
      console.error('[TrackManager] PeerConnection 或 WebSocket 不可用');
      return false;
    }
    try {
      await createOffer(pc, ws);
      return true;
    } catch (error) {
      console.error('[TrackManager] 创建 Offer 失败:', error);
      return false;
    }
  }, [createOffer]);

  // ── 内部引用设置（仅供 ConnectionCore 调用）──

  const setPeerConnection = useCallback((pc: RTCPeerConnection | null) => {
    pcRef.current = pc;
    // 新 PeerConnection 创建时，挂载复合轨道分发器
    if (pc) {
      pc.ontrack = dispatchTrackEvent;
    }
  }, [dispatchTrackEvent]);

  const setWebSocket = useCallback((ws: WebSocket | null) => {
    wsRef.current = ws;
  }, []);

  return {
    addTrack,
    removeTrack,
    registerTrackHandler,
    createOffer,
    createOfferNow,
    setPeerConnection,
    setWebSocket,
  };
}
