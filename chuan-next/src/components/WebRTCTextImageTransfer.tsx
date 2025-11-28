"use client";

import { Button } from '@/components/ui/button';
import { WebRTCTextReceiver } from '@/components/webrtc/WebRTCTextReceiver';
import { WebRTCTextSender } from '@/components/webrtc/WebRTCTextSender';
import { useWebRTCStore } from '@/hooks/connection/state/webConnectStore';
import { useURLHandler } from '@/hooks/ui';
import { Download, Send, X } from 'lucide-react';
import React, { useCallback, useState } from 'react';

export const WebRTCTextImageTransfer: React.FC = () => {
  // 状态管理
  const [mode, setMode] = useState<'send' | 'receive'>('send');
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  
  // 使用全局WebRTC状态
  const webrtcState = useWebRTCStore();

  // 使用统一的URL处理器
  const { updateMode, getCurrentRoomCode, clearURLParams } = useURLHandler({
    featureType: 'message',
    onModeChange: setMode
  });

  // 重新开始函数
  const handleRestart = useCallback(() => {
    setPreviewImage(null);
    clearURLParams();
  }, [clearURLParams]);

  const code = getCurrentRoomCode();

  // 连接状态变化处理 - 现在不需要了，因为使用全局状态
  const handleConnectionChange = useCallback((connection: any) => {
    // 这个函数现在可能不需要了，但为了兼容现有的子组件接口，保留它
    console.log('连接状态变化:', connection);
  }, []);

  // 关闭图片预览
  const closePreview = useCallback(() => {
    setPreviewImage(null);
  }, []);

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 模式切换 */}
      <div className="flex justify-center mb-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-1 shadow-lg">
          <Button
            variant={mode === 'send' ? 'default' : 'ghost'}
            onClick={() => updateMode('send')}
            className="px-6 py-2 rounded-lg"
          >
            <Send className="w-4 h-4 mr-2" />
            发送文字
          </Button>
          <Button
            variant={mode === 'receive' ? 'default' : 'ghost'}
            onClick={() => updateMode('receive')}
            className="px-6 py-2 rounded-lg"
          >
            <Download className="w-4 h-4 mr-2" />
            加入房间
          </Button>
        </div>
      </div>

      <div className="bg-white/80 backdrop-blur-sm rounded-xl shadow-lg p-4 sm:p-6 animate-fade-in-up">
   
        
        {mode === 'send' ? (
          <WebRTCTextSender 
            onRestart={handleRestart} 
            onPreviewImage={setPreviewImage} 
            onConnectionChange={handleConnectionChange}
          />
        ) : (
          <WebRTCTextReceiver 
            initialCode={code} 
            onPreviewImage={setPreviewImage} 
            onRestart={handleRestart}
            onConnectionChange={handleConnectionChange}
          />
        )}
      </div>

      {/* 图片预览模态框 */}
      {previewImage && (
        <div className="fixed inset-0 bg-black bg-opacity-75 flex items-center justify-center z-50" onClick={closePreview}>
          <div className="relative max-w-4xl max-h-4xl">
            <img src={previewImage} alt="预览" className="max-w-full max-h-full" />
            <Button
              onClick={closePreview}
              className="absolute top-4 right-4 bg-white text-black hover:bg-gray-200"
              size="sm"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
