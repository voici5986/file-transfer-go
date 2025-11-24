import React from 'react';
import { Mic, MicOff } from 'lucide-react';

interface VoiceIndicatorProps {
  volume: number; // 0-100
  isSpeaking: boolean;
  isMuted?: boolean;
  className?: string;
}

export function VoiceIndicator({
  volume,
  isSpeaking,
  isMuted = false,
  className = '',
}: VoiceIndicatorProps) {
  // 根据音量计算波纹大小
  const rippleScale = 1 + (volume / 100) * 0.8; // 1.0 到 1.8
  
  // 音量条数量（5条）
  const barCount = 5;
  const activeBars = Math.ceil((volume / 100) * barCount);

  return (
    <div className={`flex items-center space-x-2 ${className}`}>
      {/* 麦克风图标和波纹效果 */}
      <div className="relative flex items-center justify-center">
        {/* 波纹动画 - 只在说话时显示 */}
        {isSpeaking && !isMuted && (
          <>
            <div
              className="absolute w-10 h-10 rounded-full bg-green-500 opacity-20 animate-ping"
              style={{
                animationDuration: '1s',
                transform: `scale(${rippleScale})`,
              }}
            />
            <div
              className="absolute w-10 h-10 rounded-full bg-green-400 opacity-30"
              style={{
                transform: `scale(${rippleScale})`,
                transition: 'transform 0.1s ease-out',
              }}
            />
          </>
        )}
        
        {/* 麦克风图标 */}
        <div
          className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
            isMuted
              ? 'bg-red-100 text-red-600'
              : isSpeaking
              ? 'bg-green-100 text-green-600'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {isMuted ? (
            <MicOff className="w-4 h-4" />
          ) : (
            <Mic className="w-4 h-4" />
          )}
        </div>
      </div>

      {/* 音量条 - 10个等级 */}
      <div className="flex items-center space-x-0.5">
        {Array.from({ length: barCount }).map((_, index) => {
          const isActive = index < activeBars && !isMuted;
          const height = 8 + index * 1.5; // 递增高度: 8, 9.5, 11, 12.5... 到 21.5
          
          return (
            <div
              key={index}
              className={`w-1 rounded-full transition-all duration-150 ${
                isActive
                  ? isSpeaking
                    ? 'bg-green-500'
                    : 'bg-slate-400'
                  : 'bg-slate-200'
              }`}
              style={{
                height: `${height}px`,
                opacity: isActive ? 1 : 0.3,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
