import { useState, useRef, useCallback, useEffect } from 'react';
import type { WebRTCConnection } from '../connection/types';
import { useSharedWebRTCManager } from '../connection/useSharedWebRTCManager';

interface DesktopShareState {
  isSharing: boolean;
  isViewing: boolean;
  connectionCode: string;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;
  error: string | null;
  isWaitingForPeer: boolean;  // 新增：是否等待对方连接
}

export function useDesktopShareBusiness(externalConnection?: WebRTCConnection) {
  const internalConnection = useSharedWebRTCManager();
  const webRTC = externalConnection ?? internalConnection;
  const [state, setState] = useState<DesktopShareState>({
    isSharing: false,
    isViewing: false,
    connectionCode: '',
    remoteStream: null,
    localStream: null,
    error: null,
    isWaitingForPeer: false,
  });

  const localStreamRef = useRef<MediaStream | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const currentSenderRef = useRef<RTCRtpSender | null>(null);

  const updateState = useCallback((updates: Partial<DesktopShareState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // 处理远程流
  const handleRemoteStream = useCallback((stream: MediaStream) => {
    console.log('[DesktopShare] 收到远程流:', stream.getTracks().length, '个轨道');
    updateState({ remoteStream: stream });

    // 如果有视频元素引用，设置流
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
    }
  }, [updateState]);

  // 设置远程轨道处理器（始终监听，支持与语音通话并存）
  const registerTrackHandler = webRTC.registerTrackHandler;
  useEffect(() => {
    const unsubscribe = registerTrackHandler('desktop-share', (event: RTCTrackEvent) => {
      // 只处理视频轨道，音频由 VoiceChat 处理
      if (event.track.kind !== 'video') return;

      console.log('[DesktopShare] 🎥 收到远程视频轨道:', event.track.id, '状态:', event.track.readyState);
      
      if (event.streams.length > 0) {
        const remoteStream = event.streams[0];
        console.log('[DesktopShare] 🎬 设置远程流，轨道数量:', remoteStream.getTracks().length);
        
        // 确保轨道已启用
        remoteStream.getTracks().forEach(track => {
          if (!track.enabled) {
            track.enabled = true;
          }
        });
        
        handleRemoteStream(remoteStream);
      } else {
        console.warn('[DesktopShare] ⚠️ 收到轨道但没有关联的流');
        try {
          const newStream = new MediaStream([event.track]);
          newStream.getTracks().forEach(track => {
            if (!track.enabled) track.enabled = true;
          });
          handleRemoteStream(newStream);
        } catch (error) {
          console.error('[DesktopShare] ❌ 从轨道创建流失败:', error);
        }
      }
    });
    return unsubscribe;
  }, [registerTrackHandler, handleRemoteStream]);

  // 获取桌面共享流
  const getDesktopStream = useCallback(async (): Promise<MediaStream> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
        } as DisplayMediaStreamOptions['video'],
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        } as DisplayMediaStreamOptions['audio'],
      });

      console.log('[DesktopShare] 获取桌面流成功:', stream.getTracks().length, '个轨道');
      return stream;
    } catch (error) {
      console.error('[DesktopShare] 获取桌面流失败:', error);
      throw new Error('无法获取桌面共享权限，请确保允许屏幕共享');
    }
  }, []);

  // 设置视频轨道发送
  const setupVideoSending = useCallback(async (stream: MediaStream) => {
    console.log('[DesktopShare] 🎬 开始设置视频轨道发送...');
    
    // 检查P2P连接状态
    if (!webRTC.isPeerConnected) {
      console.warn('[DesktopShare] ⚠️ P2P连接尚未完全建立，等待连接稳定...');
      // 等待连接稳定
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // 再次检查
      if (!webRTC.isPeerConnected) {
        console.error('[DesktopShare] ❌ P2P连接仍未建立，无法开始媒体传输');
        throw new Error('P2P连接尚未建立');
      }
    }
    
    // 移除之前的轨道（如果存在）
    if (currentSenderRef.current) {
      console.log('[DesktopShare] 🗑️ 移除之前的视频轨道');
      webRTC.removeTrack(currentSenderRef.current);
      currentSenderRef.current = null;
    }
    
    // 添加新的视频轨道到PeerConnection
    const videoTrack = stream.getVideoTracks()[0];
    const audioTrack = stream.getAudioTracks()[0];

    if (videoTrack) {
      console.log('[DesktopShare] 📹 添加视频轨道:', videoTrack.id, videoTrack.readyState);
      const videoSender = webRTC.addTrack(videoTrack, stream);
      if (videoSender) {
        currentSenderRef.current = videoSender;
        console.log('[DesktopShare] ✅ 视频轨道添加成功');
      } else {
        console.warn('[DesktopShare] ⚠️ 视频轨道添加返回null');
      }
    } else {
      console.error('[DesktopShare] ❌ 未找到视频轨道');
      throw new Error('未找到视频轨道');
    }

    if (audioTrack) {
      try {
        console.log('[DesktopShare] 🎵 添加音频轨道:', audioTrack.id, audioTrack.readyState);
        const audioSender = webRTC.addTrack(audioTrack, stream);
        if (audioSender) {
          console.log('[DesktopShare] ✅ 音频轨道添加成功');
        } else {
          console.warn('[DesktopShare] ⚠️ 音频轨道添加返回null');
        }
      } catch (error) {
        console.warn('[DesktopShare] ⚠️ 音频轨道添加失败，继续视频共享:', error);
      }
    } else {
      console.log('[DesktopShare] ℹ️ 未检测到音频轨道（这通常是正常的）');
    }

    // 轨道添加完成，现在需要重新协商以包含媒体轨道
    console.log('[DesktopShare] ✅ 桌面共享轨道添加完成，开始重新协商');
    
    // 获取PeerConnection实例以便调试
    const pc = webRTC.getPeerConnection();
    if (pc) {
      console.log('[DesktopShare] 🔍 当前连接状态:', {
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        signalingState: pc.signalingState,
        senders: pc.getSenders().length
      });
    }
    
    // 等待一小段时间确保轨道完全添加
    await new Promise(resolve => setTimeout(resolve, 500));
    
    // 创建新的offer包含媒体轨道
    console.log('[DesktopShare] 📨 创建包含媒体轨道的新offer进行重新协商');
    const success = await webRTC.createOfferNow();
    if (success) {
      console.log('[DesktopShare] ✅ 媒体轨道重新协商成功');
      
      // 等待重新协商完成
      console.log('[DesktopShare] ⏳ 等待重新协商完成...');
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // 检查连接状态
      if (pc) {
        console.log('[DesktopShare] 🔍 重新协商后连接状态:', {
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          signalingState: pc.signalingState
        });
      }
    } else {
      console.error('[DesktopShare] ❌ 媒体轨道重新协商失败');
      throw new Error('媒体轨道重新协商失败');
    }

    // 监听流结束事件（用户停止共享）
    const handleStreamEnded = () => {
      console.log('[DesktopShare] 🛑 用户停止了屏幕共享');
      stopSharing();
    };

    videoTrack?.addEventListener('ended', handleStreamEnded);
    audioTrack?.addEventListener('ended', handleStreamEnded);

    return () => {
      videoTrack?.removeEventListener('ended', handleStreamEnded);
      audioTrack?.removeEventListener('ended', handleStreamEnded);
    };
  }, [webRTC]);

  // 创建房间 - 统一使用后端生成房间码
  const createRoomFromBackend = useCallback(async (): Promise<string> => {
    const response = await fetch('/api/create-room', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({}),
    });

    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || '创建房间失败');
    }

    return data.code;
  }, []);

  // 创建房间（只建立连接，等待对方加入）
  const createRoom = useCallback(async (): Promise<string> => {
    try {
      updateState({ error: null, isWaitingForPeer: false });

      // 从后端获取房间代码
      const roomCode = await createRoomFromBackend();
      console.log('[DesktopShare] 🚀 创建桌面共享房间，代码:', roomCode);

      // 建立WebRTC连接（作为发送方）
      console.log('[DesktopShare] 📡 正在建立WebRTC连接...');
      await webRTC.connect(roomCode, 'sender');
      console.log('[DesktopShare] ✅ WebSocket连接已建立');

      updateState({
        connectionCode: roomCode,
        isWaitingForPeer: true,  // 标记为等待对方连接
      });

      console.log('[DesktopShare] 🎯 房间创建完成，等待对方加入建立P2P连接');
      return roomCode;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '创建房间失败';
      console.error('[DesktopShare] ❌ 创建房间失败:', error);
      updateState({ error: errorMessage, connectionCode: '', isWaitingForPeer: false });
      throw error;
    }
  }, [webRTC, createRoomFromBackend, updateState]);

  // 开始桌面共享（在接收方加入后）
  const startSharing = useCallback(async (): Promise<void> => {
    try {
      // 中继模式不支持媒体流传输
      if (webRTC.transportMode === 'relay') {
        throw new Error('当前为中继模式，不支持桌面共享。桌面共享需要 P2P 直连，请检查网络环境后重试');
      }

      // 检查P2P连接状态（与switchDesktop保持一致）
      if (!webRTC.isPeerConnected) {
        throw new Error('P2P连接未建立');
      }

      updateState({ error: null });
      console.log('[DesktopShare] 📺 正在请求桌面共享权限...');

      // 获取桌面流
      const stream = await getDesktopStream();
      
      // 停止之前的流（如果有）- 与switchDesktop保持一致
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      localStreamRef.current = stream;
      console.log('[DesktopShare] ✅ 桌面流获取成功');

      // 设置新的视频发送 - 与switchDesktop保持一致
      await setupVideoSending(stream);
      console.log('[DesktopShare] ✅ 桌面共享开始完成');

      updateState({
        isSharing: true,
        isWaitingForPeer: false,
        localStream: stream,
      });

      console.log('[DesktopShare] 🎉 桌面共享已开始');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '开始桌面共享失败';
      console.error('[DesktopShare] ❌ 开始共享失败:', error);
      updateState({ error: errorMessage, isSharing: false });
      
      // 清理资源
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }
      
      throw error;
    }
  }, [webRTC, getDesktopStream, setupVideoSending, updateState]);

  // 切换桌面共享（重新选择屏幕）
  const switchDesktop = useCallback(async (): Promise<void> => {
    try {
      if (webRTC.transportMode === 'relay') {
        throw new Error('当前为中继模式，不支持桌面共享');
      }

      if (!webRTC.isPeerConnected) {
        throw new Error('P2P连接未建立');
      }

      if (!state.isSharing) {
        throw new Error('当前未在共享桌面');
      }

      updateState({ error: null });
      console.log('[DesktopShare] 🔄 正在切换桌面共享...');

      // 获取新的桌面流
      const newStream = await getDesktopStream();
      
      // 停止之前的流
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
      
      localStreamRef.current = newStream;
      console.log('[DesktopShare] ✅ 新桌面流获取成功');

      // 设置新的视频发送
      await setupVideoSending(newStream);
      console.log('[DesktopShare] ✅ 桌面切换完成');

      updateState({ localStream: newStream });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '切换桌面失败';
      console.error('[DesktopShare] ❌ 切换桌面失败:', error);
      updateState({ error: errorMessage });
      throw error;
    }
  }, [webRTC, state.isSharing, getDesktopStream, setupVideoSending, updateState]);

  // 停止桌面共享
  const stopSharing = useCallback(async (): Promise<void> => {
    try {
      console.log('[DesktopShare] 停止桌面共享');

      // 停止本地流
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
          console.log('[DesktopShare] 停止轨道:', track.kind);
        });
        localStreamRef.current = null;
      }

      // 移除发送器
      if (currentSenderRef.current) {
        webRTC.removeTrack(currentSenderRef.current);
        currentSenderRef.current = null;
      }

      // 断开WebRTC连接
      webRTC.disconnect();

      updateState({
        isSharing: false,
        connectionCode: '',
        localStream: null,
        error: null,
        isWaitingForPeer: false,
      });

      console.log('[DesktopShare] 桌面共享已停止');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '停止桌面共享失败';
      console.error('[DesktopShare] 停止共享失败:', error);
      updateState({ error: errorMessage });
    }
  }, [webRTC, updateState]);

  // 重置桌面共享到初始状态（让用户重新选择桌面）
  const resetSharing = useCallback(async (): Promise<void> => {
    try {
      console.log('[DesktopShare] 重置桌面共享到初始状态');

      // 停止本地流
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => {
          track.stop();
          console.log('[DesktopShare] 停止轨道:', track.kind);
        });
        localStreamRef.current = null;
      }

      // 移除发送器
      if (currentSenderRef.current) {
        webRTC.removeTrack(currentSenderRef.current);
        currentSenderRef.current = null;
      }

      // 保留WebSocket连接和房间代码，但重置共享状态
      updateState({
        isSharing: false,
        localStream: null,
        error: null,
        isWaitingForPeer: false,
      });

      console.log('[DesktopShare] 桌面共享已重置到初始状态');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '重置桌面共享失败';
      console.error('[DesktopShare] 重置共享失败:', error);
      updateState({ error: errorMessage });
    }
  }, [webRTC, updateState]);

  // 加入桌面共享观看
  const joinSharing = useCallback(async (code: string): Promise<void> => {
    try {
      updateState({ error: null });
      console.log('[DesktopShare] 🔍 正在加入桌面共享观看:', code);

      // 连接WebRTC
      console.log('[DesktopShare] 🔗 正在连接WebRTC作为接收方...');
      await webRTC.connect(code, 'receiver');
      console.log('[DesktopShare] ✅ WebRTC连接建立完成');

      // 等待连接完全建立
      console.log('[DesktopShare] ⏳ 等待连接稳定...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 检查连接状态
      const pc = webRTC.getPeerConnection();
      if (pc) {
        console.log('[DesktopShare] 🔍 连接状态:', {
          connectionState: pc.connectionState,
          iceConnectionState: pc.iceConnectionState,
          signalingState: pc.signalingState
        });
      }

      updateState({ isViewing: true });
      console.log('[DesktopShare] 👁️ 已进入桌面共享观看模式，等待接收流...');
      
      // 设置一个超时检查，如果长时间没有收到流，输出警告
      setTimeout(() => {
        if (!state.remoteStream) {
          console.warn('[DesktopShare] ⚠️ 长时间未收到远程流，可能存在连接问题');
          // 可以在这里添加一些恢复逻辑，比如尝试重新连接
        }
      }, 10000); // 10秒后检查
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '加入桌面共享失败';
      console.error('[DesktopShare] ❌ 加入观看失败:', error);
      updateState({ error: errorMessage, isViewing: false });
      throw error;
    }
  }, [webRTC, updateState, state.remoteStream]);

  // 停止观看桌面共享
  const stopViewing = useCallback(async (): Promise<void> => {
    try {
      console.log('[DesktopShare] 停止观看桌面共享');

      // 断开WebRTC连接
      webRTC.disconnect();

      updateState({
        isViewing: false,
        remoteStream: null,
        error: null,
      });

      console.log('[DesktopShare] 已停止观看桌面共享');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '停止观看失败';
      console.error('[DesktopShare] 停止观看失败:', error);
      updateState({ error: errorMessage });
    }
  }, [webRTC, updateState]);

  // 设置远程视频元素引用
  const setRemoteVideoRef = useCallback((videoElement: HTMLVideoElement | null) => {
    remoteVideoRef.current = videoElement;
    if (videoElement && state.remoteStream) {
      videoElement.srcObject = state.remoteStream;
    }
  }, [state.remoteStream]);

  // 清理资源
  useEffect(() => {
    return () => {
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    // 状态
    isSharing: state.isSharing,
    isViewing: state.isViewing,
    connectionCode: state.connectionCode,
    remoteStream: state.remoteStream,
    localStream: state.localStream,
    error: state.error,
    isWaitingForPeer: state.isWaitingForPeer,
    isConnected: webRTC.isConnected,
    isConnecting: webRTC.isConnecting,
    isWebSocketConnected: webRTC.isWebSocketConnected,
    isPeerConnected: webRTC.isPeerConnected,
    // 新增：表示是否可以开始共享（WebSocket已连接且有房间代码且非中继模式）
    canStartSharing: webRTC.isWebSocketConnected && !!state.connectionCode && webRTC.transportMode !== 'relay',
    // 传输模式
    transportMode: webRTC.transportMode,

    // 方法
    createRoom,        // 创建房间
    startSharing,      // 选择桌面并建立P2P连接
    switchDesktop,     // 新增：切换桌面
    stopSharing,
    resetSharing,      // 重置到初始状态，保留房间连接
    joinSharing,
    stopViewing,
    setRemoteVideoRef,

    // WebRTC连接状态
    webRTCError: webRTC.error,
    
    // 暴露WebRTC连接对象
    webRTCConnection: webRTC,
  };
}
