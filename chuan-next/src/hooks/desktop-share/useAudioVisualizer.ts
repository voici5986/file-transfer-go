import { useEffect, useRef, useState } from 'react';

interface AudioVisualizerState {
  volume: number; // 0-100
  isSpeaking: boolean;
}

export function useAudioVisualizer(stream: MediaStream | null) {
  const [state, setState] = useState<AudioVisualizerState>({
    volume: 0,
    isSpeaking: false,
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!stream) {
      // 清理状态
      setState({ volume: 0, isSpeaking: false });
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      return;
    }

    try {
      // 创建音频上下文
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;

      // 创建分析器节点
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.8;
      analyserRef.current = analyser;

      // 连接音频流到分析器
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      // 创建数据数组
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      // 音量检测阈值
      const SPEAKING_THRESHOLD = 10; // 说话阈值
      const SILENCE_FRAMES = 10; // 连续多少帧低于阈值才认为停止说话
      let silenceFrameCount = 0;

      // 分析音频数据
      const analyzeAudio = () => {
        if (!analyserRef.current) return;

        analyser.getByteFrequencyData(dataArray);

        // 计算平均音量
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sum += dataArray[i];
        }
        const average = sum / dataArray.length;
        
        // 归一化到 0-100
        const normalizedVolume = Math.min(100, Math.round((average / 255) * 100));

        // 判断是否在说话
        const currentlySpeaking = normalizedVolume > SPEAKING_THRESHOLD;
        
        if (currentlySpeaking) {
          silenceFrameCount = 0;
          setState(prev => ({
            volume: normalizedVolume,
            isSpeaking: true,
          }));
        } else {
          silenceFrameCount++;
          if (silenceFrameCount >= SILENCE_FRAMES) {
            setState(prev => ({
              volume: normalizedVolume,
              isSpeaking: false,
            }));
          } else {
            // 保持说话状态，但更新音量
            setState(prev => ({
              volume: normalizedVolume,
              isSpeaking: prev.isSpeaking,
            }));
          }
        }

        animationFrameRef.current = requestAnimationFrame(analyzeAudio);
      };

      // 开始分析
      analyzeAudio();

      // 清理函数
      return () => {
        
        if (animationFrameRef.current !== null) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }

        if (audioContextRef.current) {
          audioContextRef.current.close();
          audioContextRef.current = null;
        }

        analyserRef.current = null;
        setState({ volume: 0, isSpeaking: false });
      };
    } catch (error) {
      console.error('[AudioVisualizer] 初始化音频分析器失败:', error);
    }
  }, [stream]);

  return state;
}
