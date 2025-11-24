import { useCallback, useRef } from 'react';
import { IWebConnectStateManager } from '../state/useWebConnectStateManager';
import { WebRTCTrackManager } from '../types';


/**
 * WebRTC 媒体轨道管理 Hook
 * 负责媒体轨道的添加和移除，处理轨道事件
 * 信令相关功能（如 createOffer）已移至 ConnectionCore
 */
export function useWebRTCTrackManager(
  stateManager: IWebConnectStateManager
): WebRTCTrackManager {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const retryInProgressRef = useRef<boolean>(false); // 防止多个重试循环

  // 媒体协商：通知 Core 层需要重新创建 Offer
  // 这个方法由业务层调用，用于添加媒体轨道后的重新协商
  const requestOfferRenegotiation = useCallback(async () => {
    const pc = pcRef.current;
    const ws = wsRef.current;

    if (!pc || !ws) {
      console.error('[TrackManager] PeerConnection 或 WebSocket 不可用，无法请求重新协商');
      return false;
    }

    try {
      // 触发重新协商事件（应该由 Core 层监听）
      return true;
    } catch (error) {
      console.error('[TrackManager] 请求重新协商失败:', error);
      return false;
    }
  }, []);

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

  // 存储多个轨道处理器
  const trackHandlersRef = useRef<Set<(event: RTCTrackEvent) => void>>(new Set());

  // 设置轨道处理器 - 返回清理函数
  const onTrack = useCallback((handler: (event: RTCTrackEvent) => void): (() => void) => {
    // 添加到处理器集合
    trackHandlersRef.current.add(handler);

    const pc = pcRef.current;
    if (!pc) {
      // 检查是否已有重试在进行，避免多个重试循环
      if (retryInProgressRef.current) {
        // 返回清理函数
        return () => {
          trackHandlersRef.current.delete(handler);
          console.log('[TrackManager] 🗑️ 移除轨道处理器，剩余处理器数量:', trackHandlersRef.current.size);
        };
      }

      // 检查WebSocket连接状态，只有连接后才尝试设置
      const state = stateManager.getState();
      if (!state.isWebSocketConnected) {
        // 返回清理函数
        return () => {
          trackHandlersRef.current.delete(handler);
        };
      }

      retryInProgressRef.current = true;

      // 延迟设置，等待PeerConnection准备就绪
      let retryCount = 0;
      const maxRetries = 20; // 减少重试次数到20次，即2秒

      const checkAndSetTrackHandler = () => {
        const currentPc = pcRef.current;
        if (currentPc) {
          // 设置多路复用处理器
          currentPc.ontrack = (event: RTCTrackEvent) => {
            trackHandlersRef.current.forEach(h => {
              try {
                h(event);
              } catch (error) {
                console.error('[TrackManager] 轨道处理器执行错误:', error);
              }
            });
          };
          retryInProgressRef.current = false;
        } else {
          retryCount++;
          if (retryCount < maxRetries) {
            setTimeout(checkAndSetTrackHandler, 100);
          } else {
            console.error('[TrackManager] ❌ PeerConnection 长时间未准备就绪，停止重试');
            retryInProgressRef.current = false; // 失败后也要重置标记
          }
        }
      };
      checkAndSetTrackHandler();
      
      // 返回清理函数
      return () => {
        trackHandlersRef.current.delete(handler);
      };
    }

    // 设置多路复用处理器
    pc.ontrack = (event: RTCTrackEvent) => {
      trackHandlersRef.current.forEach(h => {
        try {
          h(event);
        } catch (error) {
          console.error('[TrackManager] 轨道处理器执行错误:', error);
        }
      });
    };
    
    // 返回清理函数
    return () => {
      trackHandlersRef.current.delete(handler);
    };
  }, [stateManager]);

  // 立即触发重新协商（用于媒体轨道添加后的重新协商）
  const triggerRenegotiation = useCallback(async () => {
    const pc = pcRef.current;
    const ws = wsRef.current;

    if (!pc || !ws) {
      console.error('[TrackManager] PeerConnection 或 WebSocket 不可用');
      return false;
    }

    try {
      // 实际的 offer 创建应该由 Core 层处理
      // 这里只是一个触发器，通知需要重新协商
      return true;
    } catch (error) {
      console.error('[TrackManager] 触发重新协商失败:', error);
      return false;
    }
  }, []);

  // 设置 PeerConnection 引用
  const setPeerConnection = useCallback((pc: RTCPeerConnection | null) => {
    pcRef.current = pc;
    // 当PeerConnection设置时，重置重试标记
    if (pc) {
      retryInProgressRef.current = false;
    }
  }, []);

  // 设置 WebSocket 引用
  const setWebSocket = useCallback((ws: WebSocket | null) => {
    wsRef.current = ws;
  }, []);

  return {
    addTrack,
    removeTrack,
    onTrack,
    requestOfferRenegotiation,
    triggerRenegotiation,
    // 内部方法，供核心连接管理器调用
    setPeerConnection,
    setWebSocket,
  };
}