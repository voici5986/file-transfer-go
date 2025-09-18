import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnectManager } from '../connection';

interface DesktopShareState {
  isSharing: boolean;
  isViewing: boolean;
  connectionCode: string;
  remoteStream: MediaStream | null;
  localStream: MediaStream | null;  // 添加到状态中以触发重新渲染
  error: string | null;
  isWaitingForPeer: boolean;  // 新增：是否等待对方连接
}

export function useDesktopShareBusiness() {
  const webRTC = useConnectManager();
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
    setState(prev => ({ ...prev, remoteStream: stream }));

    // 如果有视频元素引用，设置流
    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = stream;
    }
  }, []); // 移除updateState依赖，直接使用setState

  // 设置远程轨道处理器（始终监听）
  useEffect(() => {
    console.log('[DesktopShare] 🎧 设置远程轨道处理器');

    const trackHandler = (event: RTCTrackEvent) => {
      console.log('[DesktopShare] 🎥 收到远程轨道:', event.track.kind, event.track.id, '状态:', event.track.readyState);
      console.log('[DesktopShare] 远程流数量:', event.streams.length);

      if (event.streams.length > 0) {
        const remoteStream = event.streams[0];
        console.log('[DesktopShare] 🎬 设置远程流，轨道数量:', remoteStream.getTracks().length);
        remoteStream.getTracks().forEach(track => {
          console.log('[DesktopShare] 远程轨道:', track.kind, track.id, '启用:', track.enabled, '状态:', track.readyState);
        });

        // 确保轨道已启用
        remoteStream.getTracks().forEach(track => {
          if (!track.enabled) {
            console.log('[DesktopShare] 🔓 启用远程轨道:', track.id);
            track.enabled = true;
          }
        });

        // 直接使用setState而不是handleRemoteStream，避免依赖问题
        setState(prev => ({ ...prev, remoteStream }));

        // 如果有视频元素引用，设置流
        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
        }
      } else {
        console.warn('[DesktopShare] ⚠️ 收到轨道但没有关联的流');
        // 尝试从轨道创建流
        try {
          const newStream = new MediaStream([event.track]);
          console.log('[DesktopShare] 🔄 从轨道创建新流:', newStream.id);

          // 确保轨道已启用
          newStream.getTracks().forEach(track => {
            if (!track.enabled) {
              console.log('[DesktopShare] 🔓 启用新流中的轨道:', track.id);
              track.enabled = true;
            }
          });

          // 直接使用setState
          setState(prev => ({ ...prev, remoteStream: newStream }));

          // 如果有视频元素引用，设置流
          if (remoteVideoRef.current) {
            remoteVideoRef.current.srcObject = newStream;
          }
        } catch (error) {
          console.error('[DesktopShare] ❌ 从轨道创建流失败:', error);
        }
      }
    };

    webRTC.onTrack(trackHandler);
  }, [webRTC]); // 只依赖webRTC，移除handleRemoteStream依赖

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
    if (!webRTC.getConnectState().isPeerConnected) {
      console.warn('[DesktopShare] ⚠️ P2P连接尚未完全建立，等待连接稳定...');
      // 等待连接稳定
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 再次检查
      if (!webRTC.getConnectState().isPeerConnected) {
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

  // 创建房间并立即开始桌面共享
  const createRoomAndStartSharing = useCallback(async (): Promise<string> => {
    try {
      setState(prev => ({ ...prev, error: null, isWaitingForPeer: false }));

      // 从后端获取房间代码
      const roomCode = await createRoomFromBackend();
      console.log('[DesktopShare] 🚀 创建桌面共享房间，代码:', roomCode);

      // 建立WebRTC连接（作为发送方）
      console.log('[DesktopShare] 📡 正在建立WebRTC连接...');
      await webRTC.connect(roomCode, 'sender');
      console.log('[DesktopShare] ✅ WebSocket连接已建立');

      setState(prev => ({
        ...prev,
        connectionCode: roomCode,
      }));

      // 立即开始桌面共享（不等待P2P连接）
      console.log('[DesktopShare] 📺 正在请求桌面共享权限...');
      const stream = await getDesktopStream();

      // 停止之前的流（如果有）
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      localStreamRef.current = stream;
      console.log('[DesktopShare] ✅ 桌面流获取成功，流ID:', stream.id, '轨道数:', stream.getTracks().length);

      // 确保状态更新能正确触发重新渲染
      setState(prev => ({
        ...prev,
        isSharing: true,
        isWaitingForPeer: true,  // 等待观看者加入
        localStream: stream,  // 更新状态以触发组件重新渲染
      }));

      // 再次确认状态已更新（用于调试）
      console.log('[DesktopShare] 🎉 桌面共享已开始，状态已更新，等待观看者加入');
      return roomCode;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '创建房间失败';
      console.error('[DesktopShare] ❌ 创建房间失败:', error);
      setState(prev => ({ ...prev, error: errorMessage, connectionCode: '', isWaitingForPeer: false, isSharing: false }));
      throw error;
    }
  }, [webRTC, createRoomFromBackend, getDesktopStream]); // 移除updateState依赖

  // 创建房间（保留原有方法以兼容性）
  const createRoom = useCallback(async (): Promise<string> => {
    try {
      setState(prev => ({ ...prev, error: null, isWaitingForPeer: false }));

      // 从后端获取房间代码
      const roomCode = await createRoomFromBackend();
      console.log('[DesktopShare] 🚀 创建桌面共享房间，代码:', roomCode);

      // 建立WebRTC连接（作为发送方）
      console.log('[DesktopShare] 📡 正在建立WebRTC连接...');
      await webRTC.connect(roomCode, 'sender');
      console.log('[DesktopShare] ✅ WebSocket连接已建立');

      setState(prev => ({
        ...prev,
        connectionCode: roomCode,
        isWaitingForPeer: true,  // 标记为等待对方连接
      }));

      console.log('[DesktopShare] 🎯 房间创建完成，等待对方加入建立P2P连接');
      return roomCode;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '创建房间失败';
      console.error('[DesktopShare] ❌ 创建房间失败:', error);
      setState(prev => ({ ...prev, error: errorMessage, connectionCode: '', isWaitingForPeer: false }));
      throw error;
    }
  }, [webRTC, createRoomFromBackend]); // 移除updateState依赖

  // 开始桌面共享（支持有或无P2P连接状态）
  const startSharing = useCallback(async (): Promise<void> => {
    try {
      setState(prev => ({ ...prev, error: null }));
      console.log('[DesktopShare] 📺 正在请求桌面共享权限...');

      // 获取桌面流
      const stream = await getDesktopStream();

      // 停止之前的流（如果有）
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      localStreamRef.current = stream;
      console.log('[DesktopShare] ✅ 桌面流获取成功，流ID:', stream.id, '轨道数:', stream.getTracks().length);

      // 如果P2P连接已建立，立即设置视频发送
      if (webRTC.getConnectState().isPeerConnected) {
        await setupVideoSending(stream);
        console.log('[DesktopShare] ✅ 桌面共享开始完成（P2P已连接）');
        setState(prev => ({
          ...prev,
          isSharing: true,
          isWaitingForPeer: false,
          localStream: stream,
        }));
      } else {
        // P2P连接未建立，等待观看者加入
        console.log('[DesktopShare] 📱 桌面流已准备，等待观看者加入建立P2P连接');
        setState(prev => ({
          ...prev,
          isSharing: true,
          isWaitingForPeer: true,
          localStream: stream,
        }));
      }

      console.log('[DesktopShare] 🎉 桌面共享已开始');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '开始桌面共享失败';
      console.error('[DesktopShare] ❌ 开始共享失败:', error);
      setState(prev => ({
        ...prev,
        error: errorMessage,
        isSharing: false,
        localStream: null,
      }));

      // 清理资源
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
        localStreamRef.current = null;
      }

      throw error;
    }
  }, [webRTC, getDesktopStream]); // 移除setupVideoSending和updateState依赖

  // 切换桌面共享（重新选择屏幕）
  const switchDesktop = useCallback(async (): Promise<void> => {
    try {
      if (!state.isSharing) {
        throw new Error('当前未在共享桌面');
      }

      setState(prev => ({ ...prev, error: null }));
      console.log('[DesktopShare] 🔄 正在切换桌面共享...');

      // 获取新的桌面流
      const newStream = await getDesktopStream();

      // 停止之前的流
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach(track => track.stop());
      }

      localStreamRef.current = newStream;
      console.log('[DesktopShare] ✅ 新桌面流获取成功，流ID:', newStream.id, '轨道数:', newStream.getTracks().length);

      // 更新状态中的本地流
      setState(prev => ({ ...prev, localStream: newStream }));

      // 如果有P2P连接，设置新的视频发送
      if (webRTC.getConnectState().isPeerConnected) {
        await setupVideoSending(newStream);
        console.log('[DesktopShare] ✅ 桌面切换完成（已推流给观看者）');
      } else {
        console.log('[DesktopShare] ✅ 桌面切换完成（等待观看者加入）');
      }

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '切换桌面失败';
      console.error('[DesktopShare] ❌ 切换桌面失败:', error);
      setState(prev => ({ ...prev, error: errorMessage }));
      throw error;
    }
  }, [webRTC, state.isSharing, getDesktopStream]); // 移除setupVideoSending和updateState依赖

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

      setState(prev => ({
        ...prev,
        isSharing: false,
        connectionCode: '',
        error: null,
        isWaitingForPeer: false,
        localStream: null,
      }));

      console.log('[DesktopShare] 桌面共享已停止');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '停止桌面共享失败';
      console.error('[DesktopShare] 停止共享失败:', error);
      setState(prev => ({ ...prev, error: errorMessage }));
    }
  }, [webRTC]); // 移除updateState依赖，直接使用setState

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
      setState(prev => ({
        ...prev,
        isSharing: false,
        error: null,
        isWaitingForPeer: false,
        localStream: null,
      }));

      console.log('[DesktopShare] 桌面共享已重置到初始状态');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '重置桌面共享失败';
      console.error('[DesktopShare] 重置共享失败:', error);
      setState(prev => ({ ...prev, error: errorMessage }));
    }
  }, [webRTC]); // 移除updateState依赖

  // 处理P2P连接断开但保持桌面共享状态（用于接收方离开房间的情况）
  const handlePeerDisconnect = useCallback(async (): Promise<void> => {
    try {
      console.log('[DesktopShare] P2P连接断开，但保持桌面共享状态以便新用户加入');

      // 移除当前的发送器（清理P2P连接相关资源）
      if (currentSenderRef.current) {
        webRTC.removeTrack(currentSenderRef.current);
        currentSenderRef.current = null;
      }

      // 保持本地流和共享状态，只设置为等待新的对等方
      setState(prev => ({
        ...prev,
        isWaitingForPeer: true,
        error: null,
      }));

      console.log('[DesktopShare] 已清理P2P连接资源，等待新用户加入');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '处理P2P断开失败';
      console.error('[DesktopShare] 处理P2P断开失败:', error);
      setState(prev => ({ ...prev, error: errorMessage }));
    }
  }, [webRTC]); // 移除updateState依赖

  // 重新建立P2P连接并推流（用于新用户加入房间的情况）
  const resumeSharing = useCallback(async (): Promise<void> => {
    try {
      console.log('[DesktopShare] 新用户加入，重新建立P2P连接并推流');

      // 检查是否还在共享状态且有本地流
      if (!state.isSharing || !localStreamRef.current) {
        console.log('[DesktopShare] 当前没有在共享或没有本地流，无法恢复推流');
        return;
      }

      // 检查P2P连接状态
      if (!webRTC.getConnectState().isPeerConnected) {
        console.log('[DesktopShare] P2P连接未建立，等待连接完成');
        return;
      }

      // 重新设置视频发送
      await setupVideoSending(localStreamRef.current);

      updateState({
        isWaitingForPeer: false,
        error: null,
      });

      console.log('[DesktopShare] ✅ P2P连接已恢复，桌面共享流已重新建立');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '恢复桌面共享失败';
      console.error('[DesktopShare] 恢复桌面共享失败:', error);
      updateState({ error: errorMessage });
    }
  }, [webRTC, state.isSharing]); // 移除setupVideoSending和updateState依赖

  // 加入桌面共享观看
  const joinSharing = useCallback(async (code: string): Promise<void> => {
    try {
      setState(prev => ({ ...prev, error: null }));
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

      setState(prev => ({ ...prev, isViewing: true }));
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
      setState(prev => ({ ...prev, error: errorMessage, isViewing: false }));
      throw error;
    }
  }, [webRTC, state.remoteStream]); // 移除updateState依赖

  // 停止观看桌面共享
  const stopViewing = useCallback(async (): Promise<void> => {
    try {
      console.log('[DesktopShare] 停止观看桌面共享');

      // 断开WebRTC连接
      webRTC.disconnect();

      setState(prev => ({
        ...prev,
        isViewing: false,
        remoteStream: null,
        error: null,
      }));

      console.log('[DesktopShare] 已停止观看桌面共享');
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '停止观看失败';
      console.error('[DesktopShare] 停止观看失败:', error);
      setState(prev => ({ ...prev, error: errorMessage }));
    }
  }, [webRTC]); // 移除updateState依赖

  // 设置远程视频元素引用
  const setRemoteVideoRef = useCallback((videoElement: HTMLVideoElement | null) => {
    remoteVideoRef.current = videoElement;
    if (videoElement && state.remoteStream) {
      videoElement.srcObject = state.remoteStream;
    }
  }, [state.remoteStream]);

  // 监听P2P连接状态变化，自动处理重新连接
  const prevPeerConnectedForResumeRef = useRef<boolean>(false);

  useEffect(() => {
    const isPeerConnected = webRTC.getConnectState().isPeerConnected;
    const wasPreviouslyDisconnected = !prevPeerConnectedForResumeRef.current;

    // 更新ref
    prevPeerConnectedForResumeRef.current = isPeerConnected;

    // 当P2P连接从断开变为连接且正在等待对方时，自动恢复推流
    if (isPeerConnected &&
      wasPreviouslyDisconnected &&
      state.isWaitingForPeer &&
      state.isSharing) {
      console.log('[DesktopShare] 🔄 P2P连接已建立，自动恢复桌面共享推流');

      // 调用resumeSharing但不依赖它
      const handleResume = async () => {
        try {
          console.log('[DesktopShare] 新用户加入，重新建立P2P连接并推流');

          // 检查是否还在共享状态且有本地流
          if (!state.isSharing || !localStreamRef.current) {
            console.log('[DesktopShare] 当前没有在共享或没有本地流，无法恢复推流');
            return;
          }

          // 重新设置视频发送
          await setupVideoSending(localStreamRef.current);

          setState(prev => ({
            ...prev,
            isWaitingForPeer: false,
            error: null,
          }));

          console.log('[DesktopShare] ✅ P2P连接已恢复，桌面共享流已重新建立');
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : '恢复桌面共享失败';
          console.error('[DesktopShare] 恢复桌面共享失败:', error);
          setState(prev => ({ ...prev, error: errorMessage }));
        }
      };

      handleResume();
    }
  }, [webRTC.getConnectState().isPeerConnected, state.isWaitingForPeer, state.isSharing]); // 移除resumeSharing依赖

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
    localStream: state.localStream,  // 使用状态中的流
    error: state.error,
    isWaitingForPeer: state.isWaitingForPeer,
    isConnected: webRTC.getConnectState().isConnected,
    isConnecting: webRTC.getConnectState().isConnecting,
    isWebSocketConnected: webRTC.getConnectState().isWebSocketConnected,
    isPeerConnected: webRTC.getConnectState().isPeerConnected,
    // 新增：表示是否可以开始共享（WebSocket已连接且有房间代码）
    canStartSharing: webRTC.getConnectState().isWebSocketConnected && !!state.connectionCode,

    // 方法
    createRoom,        // 创建房间
    createRoomAndStartSharing, // 创建房间并立即开始桌面共享
    startSharing,      // 选择桌面并建立P2P连接
    switchDesktop,     // 新增：切换桌面
    stopSharing,
    resetSharing,      // 重置到初始状态，保留房间连接
    handlePeerDisconnect, // 处理P2P断开但保持桌面共享
    resumeSharing,     // 重新建立P2P连接并推流
    joinSharing,
    stopViewing,
    setRemoteVideoRef,

    // WebRTC连接状态
    webRTCError: webRTC.getConnectState().error,

    // 暴露WebRTC连接对象
    webRTCConnection: webRTC,
  };
}
