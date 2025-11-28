import { useCallback, useEffect, useRef, useState } from 'react';
import { IWebConnection } from '../connection/types';
import { useAudioVisualizer } from './useAudioVisualizer';

interface VoiceChatState {
  isVoiceEnabled: boolean;
  isMuted: boolean;
  isRemoteVoiceActive: boolean;
  localAudioStream: MediaStream | null;
  remoteAudioStream: MediaStream | null;
  error: string | null;
}

export function useVoiceChatBusiness(connection: IWebConnection) {
  const [state, setState] = useState<VoiceChatState>({
    isVoiceEnabled: false,
    isMuted: false,
    isRemoteVoiceActive: false,
    localAudioStream: null,
    remoteAudioStream: null,
    error: null,
  });

  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const audioSenderRef = useRef<RTCRtpSender | null>(null);
  const remoteAudioRef = useRef<HTMLAudioElement | null>(null);

  // 使用音频可视化
  const localAudioVisualizer = useAudioVisualizer(state.localAudioStream);
  const remoteAudioVisualizer = useAudioVisualizer(state.remoteAudioStream);

  const updateState = useCallback((updates: Partial<VoiceChatState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // 监听远程音频轨道
  const handleRemoteAudioTrack = useCallback((event: RTCTrackEvent, currentTrackRef: { current: MediaStreamTrack | null }) => {
    if (event.track.kind !== 'audio') return;
    
    // 移除旧轨道的监听器
    if (currentTrackRef.current) {
      currentTrackRef.current.onended = null;
      currentTrackRef.current.onmute = null;
      currentTrackRef.current.onunmute = null;
    }
    currentTrackRef.current = event.track;
    
    if (event.streams.length > 0) {
      const remoteStream = event.streams[0];
      event.track.enabled = true;
      
      // 更新状态
      setState(prev => ({ 
        ...prev, 
        remoteAudioStream: remoteStream,
        isRemoteVoiceActive: true 
      }));

      // 监听轨道结束事件
      event.track.onended = () => {
        setState(prev => ({ ...prev, isRemoteVoiceActive: false }));
      };
      
      // 监听轨道静音事件
      event.track.onmute = () => {
        // 远程音频轨道被静音
      };
      
      event.track.onunmute = () => {
        // 远程音频轨道取消静音
      };

      // 在设置状态后，使用 setTimeout 确保 audio 元素更新
      setTimeout(() => {
        if (remoteAudioRef.current && remoteStream.active) {
          remoteAudioRef.current.srcObject = remoteStream;
          remoteAudioRef.current.play().catch(err => {
            // 忽略 AbortError，这是正常的竞态条件
            if (err.name !== 'AbortError') {
              console.error('[VoiceChat] 播放远程音频失败:', err);
            }
          });
        }
      }, 0);
    }
  }, []); // 空依赖数组，函数引用始终不变

  useEffect(() => {
    if (!connection) return;
    
    const currentTrackRef = { current: null as MediaStreamTrack | null };

    const trackHandler = (event: RTCTrackEvent) => {
      if (event.track.kind === 'audio') {
        handleRemoteAudioTrack(event, currentTrackRef);
      }
    };

    const cleanup = connection.onTrack(trackHandler);
    
    return () => {
      if (currentTrackRef.current) {
        currentTrackRef.current.onended = null;
        currentTrackRef.current.onmute = null;
        currentTrackRef.current.onunmute = null;
      }
      if (cleanup) {
        cleanup();
      }
    };
  }, [connection, handleRemoteAudioTrack]); // 只在 connection 或处理器变化时重新注册

  // 获取本地音频流
  const getLocalAudioStream = useCallback(async (): Promise<MediaStream> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });

      return stream;
    } catch (error) {
      console.error('[VoiceChat] 获取本地音频流失败:', error);
      
      // 根据错误类型提供更详细的错误消息
      if (error instanceof DOMException) {
        if (error.name === 'NotAllowedError') {
          throw new Error('麦克风权限被拒绝，请在浏览器设置中允许使用麦克风');
        } else if (error.name === 'NotFoundError') {
          throw new Error('未检测到麦克风设备，请连接麦克风后重试');
        } else if (error.name === 'NotReadableError') {
          throw new Error('麦克风被其他应用占用，请关闭其他使用麦克风的程序');
        } else if (error.name === 'OverconstrainedError') {
          throw new Error('麦克风不支持所需的音频设置');
        } else if (error.name === 'AbortError') {
          throw new Error('麦克风访问被中断');
        } else if (error.name === 'SecurityError') {
          throw new Error('安全限制：无法访问麦克风（请使用HTTPS）');
        }
      }
      
      throw new Error('无法获取麦克风权限，请确保允许使用麦克风');
    }
  }, []);
        
  // 启用语音通话
  const enableVoice = useCallback(async () => {
    if (state.isVoiceEnabled || !connection) {
      return;
    }

    try {
      updateState({ error: null });

      // 检查P2P连接状态
      const connectState = connection.getConnectState();
      if (!connectState.isPeerConnected) {
        throw new Error('P2P连接尚未建立，无法启用语音');
      }

      // 获取本地音频流
      const stream = await getLocalAudioStream();
      localAudioStreamRef.current = stream;
      
      console.log('[VoiceChat] ✅ 本地音频流获取成功:', {
        streamId: stream.id,
        audioTracks: stream.getAudioTracks().length,
        trackEnabled: stream.getAudioTracks()[0]?.enabled,
        trackReadyState: stream.getAudioTracks()[0]?.readyState
      });

      // 添加音频轨道到P2P连接
      const audioTrack = stream.getAudioTracks()[0];
      if (audioTrack) {
        const role = connection.currentRoom?.role;
        console.log('[VoiceChat] 📤 添加音频轨道到P2P连接, 当前角色:', role);
        
        const sender = connection.addTrack(audioTrack, stream);
        audioSenderRef.current = sender;
        
        if (sender) {
          console.log('[VoiceChat] 📊 Sender 信息:', {
            track: sender.track?.id,
            trackEnabled: sender.track?.enabled,
            trackReadyState: sender.track?.readyState
          });
        }
        
        // 重要：添加音频轨道后，本地必须主动创建 offer
        // 因为对方不知道我们添加了新轨道，必须由我们通知对方
        console.log('[VoiceChat] 📡 [' + role + '] 创建 offer 进行重新协商（添加音频轨道）');
        const negotiated = await connection.createOfferNow();
        console.log('[VoiceChat] 📡 [' + role + '] 重新协商结果:', negotiated);
      }

      updateState({
        isVoiceEnabled: true,
        localAudioStream: stream,
        isMuted: false,
      });
    } catch (error) {
      console.error('[VoiceChat] 启用语音失败:', error);
      const errorMsg = error instanceof Error ? error.message : '启用语音失败';
      updateState({ error: errorMsg });
      throw error;
    }
  }, [connection, getLocalAudioStream, state.isVoiceEnabled, updateState]);

  // 禁用语音通话
  const disableVoice = useCallback(async () => {
    if (!state.isVoiceEnabled) return;

    const role = connection.currentRoom?.role;

    // 移除音频轨道
    if (audioSenderRef.current) {
      connection.removeTrack(audioSenderRef.current);
      audioSenderRef.current = null;
      
      // 重要：移除音频轨道后，本地必须主动创建 offer
      // 因为对方不知道我们移除了轨道，必须由我们通知对方
      console.log('[VoiceChat] 📡 [' + role + '] 移除音频轨道后重新协商');
      try {
        await connection.createOfferNow();
      } catch (error) {
        console.error('[VoiceChat] 重新协商失败:', error);
      }
    }

    // 停止本地音频流
    if (localAudioStreamRef.current) {
      localAudioStreamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      localAudioStreamRef.current = null;
    }

    updateState({
      isVoiceEnabled: false,
      localAudioStream: null,
      isMuted: false,
    });
  }, [connection, state.isVoiceEnabled, updateState]);

  // 切换静音状态
  const toggleMute = useCallback(() => {
    if (!localAudioStreamRef.current) {
      return;
    }

    const audioTracks = localAudioStreamRef.current.getAudioTracks();
    if (audioTracks.length === 0) {
      return;
    }

    const newMutedState = !state.isMuted;
    audioTracks.forEach(track => {
      track.enabled = !newMutedState;
    });

    updateState({ isMuted: newMutedState });
  }, [state.isMuted, updateState]);

  // 设置远程音频元素引用
  const setRemoteAudioRef = useCallback((element: HTMLAudioElement | null) => {
    remoteAudioRef.current = element;
    if (element && state.remoteAudioStream && state.remoteAudioStream.active) {
      element.srcObject = state.remoteAudioStream;
      element.play().catch(err => {
        // 忽略 AbortError，这是正常的竞态条件
        if (err.name !== 'AbortError') {
          console.error('[VoiceChat] 播放远程音频失败:', err);
        }
      });
    }
  }, [state.remoteAudioStream]);

  // 清理
  useEffect(() => {
    return () => {
      if (localAudioStreamRef.current) {
        localAudioStreamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  return {
    // 状态
    isVoiceEnabled: state.isVoiceEnabled,
    isMuted: state.isMuted,
    isRemoteVoiceActive: state.isRemoteVoiceActive,
    error: state.error,
    
    // 音频可视化数据
    localVolume: localAudioVisualizer.volume,
    localIsSpeaking: localAudioVisualizer.isSpeaking,
    remoteVolume: remoteAudioVisualizer.volume,
    remoteIsSpeaking: remoteAudioVisualizer.isSpeaking,
    
    // 方法
    enableVoice,
    disableVoice,
    toggleMute,
    setRemoteAudioRef,
    
    // 调试信息
    _debug: {
      hasRemoteStream: !!state.remoteAudioStream,
      remoteStreamId: state.remoteAudioStream?.id,
      remoteTrackCount: state.remoteAudioStream?.getTracks().length || 0,
    }
  };
}
