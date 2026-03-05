"use client";

import React, { useCallback, useRef, useEffect } from 'react';
import { Mic, MicOff, PhoneCall, PhoneOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { VoiceIndicator } from '@/components/VoiceIndicator';
import { useVoiceChatBusiness } from '@/hooks/desktop-share';
import type { WebRTCConnection } from '@/hooks/connection/useSharedWebRTCManager';

interface VoiceChatPanelProps {
  connection: WebRTCConnection;
  isPeerConnected: boolean;
  className?: string;
}

export default function VoiceChatPanel({
  connection,
  isPeerConnected,
  className = '',
}: VoiceChatPanelProps) {
  const voiceChat = useVoiceChatBusiness(connection);
  const remoteAudioRef = useRef<HTMLAudioElement>(null);

  // 设置远程音频元素引用
  useEffect(() => {
    if (remoteAudioRef.current) {
      voiceChat.setRemoteAudioRef(remoteAudioRef.current);
    }
  }, [voiceChat.setRemoteAudioRef]);

  // 启用/禁用语音
  const handleToggleVoice = useCallback(async () => {
    try {
      if (voiceChat.isVoiceEnabled) {
        await voiceChat.disableVoice();
      } else {
        await voiceChat.enableVoice();
      }
    } catch (error) {
      console.error('[VoiceChatPanel] 语音切换失败:', error);
    }
  }, [voiceChat]);

  // 切换静音
  const handleToggleMute = useCallback(() => {
    voiceChat.toggleMute();
  }, [voiceChat]);

  return (
    <div className={`bg-white/90 backdrop-blur-sm rounded-xl p-3 sm:p-4 border border-slate-200 ${className}`}>
      {/* 隐藏的音频元素用于播放远程音频 */}
      <audio ref={remoteAudioRef} autoPlay playsInline />

      <div className="flex items-center justify-between">
        {/* 左侧：语音状态和可视化 */}
        <div className="flex items-center space-x-3">
          <div className="flex items-center space-x-2">
            <PhoneCall className="w-4 h-4 text-slate-500" />
            <span className="text-sm font-medium text-slate-700">语音发言</span>
          </div>

          {/* 本地语音可视化 */}
          {voiceChat.isVoiceEnabled && (
            <div className="flex items-center space-x-2">
              <span className="text-xs text-slate-500">我</span>
              <VoiceIndicator
                volume={voiceChat.localVolume}
                isSpeaking={voiceChat.localIsSpeaking}
                isMuted={voiceChat.isMuted}
              />
            </div>
          )}

          {/* 远程语音可视化 */}
          {voiceChat.isRemoteVoiceActive && (
            <div className="flex items-center space-x-2">
              <div className="w-px h-4 bg-slate-300" />
              <span className="text-xs text-slate-500">对方</span>
              <VoiceIndicator
                volume={voiceChat.remoteVolume}
                isSpeaking={voiceChat.remoteIsSpeaking}
              />
            </div>
          )}
        </div>

        {/* 右侧：控制按钮 */}
        <div className="flex items-center space-x-2">
          {voiceChat.isVoiceEnabled && (
            <Button
              onClick={handleToggleMute}
              variant="ghost"
              size="sm"
              className={`rounded-lg ${
                voiceChat.isMuted
                  ? 'text-red-500 hover:bg-red-50 hover:text-red-600'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
              title={voiceChat.isMuted ? '取消静音' : '静音'}
            >
              {voiceChat.isMuted ? (
                <MicOff className="w-4 h-4" />
              ) : (
                <Mic className="w-4 h-4" />
              )}
            </Button>
          )}

          <Button
            onClick={handleToggleVoice}
            disabled={!isPeerConnected}
            variant={voiceChat.isVoiceEnabled ? 'destructive' : 'default'}
            size="sm"
            className={`rounded-lg ${
              !voiceChat.isVoiceEnabled
                ? 'bg-gradient-to-r from-emerald-500 to-teal-500 hover:from-emerald-600 hover:to-teal-600 text-white'
                : ''
            }`}
            title={voiceChat.isVoiceEnabled ? '停止发言' : '语音发言'}
          >
            {voiceChat.isVoiceEnabled ? (
              <>
                <PhoneOff className="w-4 h-4 mr-1" />
                <span className="text-xs">停止发言</span>
              </>
            ) : (
              <>
                <Mic className="w-4 h-4 mr-1" />
                <span className="text-xs">语音发言</span>
              </>
            )}
          </Button>
        </div>
      </div>

      {/* 错误提示 */}
      {voiceChat.error && (
        <div className="mt-2 text-xs text-red-500 bg-red-50 rounded-lg px-3 py-1.5">
          {voiceChat.error}
        </div>
      )}

      {/* 未连接提示 */}
      {!isPeerConnected && (
        <div className="mt-2 text-xs text-slate-400 text-center">
          等待P2P连接建立后可使用语音发言
        </div>
      )}
    </div>
  );
}
