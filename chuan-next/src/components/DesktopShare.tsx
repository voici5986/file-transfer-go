"use client";

import React, { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useURLHandler } from '@/hooks/ui';
import { Button } from '@/components/ui/button';
import { Share, Monitor, AlertTriangle, ExternalLink } from 'lucide-react';
import WebRTCDesktopReceiver from '@/components/webrtc/WebRTCDesktopReceiver';
import WebRTCDesktopSender from '@/components/webrtc/WebRTCDesktopSender';


interface DesktopShareProps {
  // 保留向后兼容性的props（已废弃，但保留接口）
  onJoinSharing?: (code: string) => Promise<void>;
}

// 检测是否支持屏幕分享
function useScreenShareSupport() {
  const [isSupported, setIsSupported] = useState(true);
  const [reason, setReason] = useState<string>('');

  useEffect(() => {
    const checkScreenShareSupport = async () => {
      try {
        // 首先检查是否存在 getDisplayMedia API
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
          setIsSupported(false);
          setReason('api-not-supported');
          const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
          if (isMobile) {
            setIsSupported(false);
            setReason('mobile');
            return;
          }

          // 检查安全上下文 - getDisplayMedia 需要安全上下文（HTTPS 或 localhost）
          if (!window.isSecureContext) {
            const isLocalhost = window.location.hostname === 'localhost' ||
              window.location.hostname === '127.0.0.1' ||
              window.location.hostname === '[::1]';

            if (!isLocalhost) {
              setIsSupported(false);
              setReason('insecure-context');
              return;
            }
            return
          }
          setIsSupported(true);
          setReason('');

        }
      }
      catch (error) {
        console.error('Error checking screen share support:', error);
        setIsSupported(false);
        setReason('unknown-error');
      }
    };

    checkScreenShareSupport();
  }, []);

  return { isSupported, reason };
}

export default function DesktopShare({
  onJoinSharing
}: DesktopShareProps) {
  const [mode, setMode] = useState<'share' | 'view'>('share');
  const { isSupported, reason } = useScreenShareSupport();

  // 使用统一的URL处理器，带模式转换
  const { updateMode, getCurrentRoomCode } = useURLHandler({
    featureType: 'desktop',
    onModeChange: setMode,
    onAutoJoinRoom: onJoinSharing,
    modeConverter: {
      fromURL: (urlMode) => urlMode === 'send' ? 'share' : 'view',
      toURL: (componentMode) => componentMode === 'share' ? 'send' : 'receive'
    }
  });

  // 获取初始房间代码（用于接收者模式）
  const getInitialCode = useCallback(() => {
    const code = getCurrentRoomCode();
    console.log('[DesktopShare] getInitialCode 返回:', code);
    return code;
  }, [getCurrentRoomCode]);

  // 连接状态变化处理 - 为了兼容现有的子组件接口，保留它
  const handleConnectionChange = useCallback((connection: { isConnected: boolean; isWebSocketConnected: boolean }) => {
    console.log('桌面共享连接状态变化:', connection);
  }, []);

  // 获取提示信息
  const getWarningInfo = () => {
    switch (reason) {
      case 'mobile':
        return {
          title: '移动端不支持屏幕分享',
          message: '移动端浏览器不支持获取桌面视频流，请使用桌面设备进行屏幕共享。'
        };
      case 'api-not-supported':
        return {
          title: '浏览器不支持屏幕分享',
          message: '当前浏览器不支持 getDisplayMedia API，请使用支持屏幕分享的现代浏览器（如 Chrome、Firefox、Edge 等）。'
        };
      case 'insecure-context':
        return {
          title: '需要安全上下文',
          message: '屏幕分享功能需要在安全上下文中使用（HTTPS协议或localhost），当前环境不支持。'
        };
      case 'detection-failed':
        return {
          title: '检测屏幕分享支持失败',
          message: '无法检测屏幕分享支持情况，这可能是由于浏览器限制或权限问题。'
        };
      case 'unknown-error':
        return {
          title: '未知错误',
          message: '检测屏幕分享支持时发生未知错误，请尝试刷新页面或使用其他浏览器。'
        };
      case 'ip-http':
        return {
          title: '当前环境不支持屏幕分享',
          message: '使用IP地址访问时，浏览器要求HTTPS协议才能进行屏幕分享。请配置HTTPS或使用localhost访问。'
        };
      case 'non-https':
        return {
          title: '需要HTTPS协议',
          message: '屏幕分享功能需要在HTTPS环境下使用，请使用HTTPS协议访问或在本地环境测试。'
        };
      default:
        return null;
    }
  };

  const warningInfo = getWarningInfo();

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 环境不支持提示 */}
      {!isSupported && warningInfo && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <h3 className="font-semibold text-amber-900 mb-1">{warningInfo.title}</h3>
              <p className="text-amber-800 text-sm mb-3">{warningInfo.message}</p>
              <Link
                href="/help#desktop-share"
                className="inline-flex items-center gap-2 text-sm text-amber-700 hover:text-amber-900 underline"
              >
                <ExternalLink className="w-4 h-4" />
                查看详细解决方案
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* 模式选择器 */}
      <div className="flex justify-center mb-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-1 shadow-lg">
          <Button
            variant={mode === 'share' ? 'default' : 'ghost'}
            onClick={() => updateMode('share')}
            className="px-6 py-2 rounded-lg"
            disabled={!isSupported && mode === 'share'}
          >
            <Share className="w-4 h-4 mr-2" />
            共享桌面
          </Button>
          <Button
            variant={mode === 'view' ? 'default' : 'ghost'}
            onClick={() => updateMode('view')}
            className="px-6 py-2 rounded-lg"
          >
            <Monitor className="w-4 h-4 mr-2" />
            观看桌面
          </Button>
        </div>
      </div>

      {/* 根据模式渲染对应的组件 */}
      <div>
        {mode === 'share' ? (
          <WebRTCDesktopSender onConnectionChange={handleConnectionChange} />
        ) : (
          <WebRTCDesktopReceiver
            initialCode={getInitialCode()}
            onConnectionChange={handleConnectionChange}
          />
        )}
      </div>
    </div>
  );
}
