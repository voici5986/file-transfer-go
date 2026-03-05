"use client";

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Share, Monitor, Play, Square, Repeat } from 'lucide-react';
import { useToast } from '@/components/ui/toast-simple';
import { useDesktopShareBusiness } from '@/hooks/desktop-share';
import RoomInfoDisplay from '@/components/RoomInfoDisplay';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import VoiceChatPanel from '@/components/VoiceChatPanel';

interface WebRTCDesktopSenderProps {
  className?: string;
  onConnectionChange?: (connection: any) => void;
}

export default function WebRTCDesktopSender({ className, onConnectionChange }: WebRTCDesktopSenderProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();
  const hasAutoStartedRef = useRef(false);

  // 使用桌面共享业务逻辑
  const desktopShare = useDesktopShareBusiness();

  // 通知父组件连接状态变化
  useEffect(() => {
    if (onConnectionChange && desktopShare.webRTCConnection) {
      onConnectionChange(desktopShare.webRTCConnection);
    }
  }, [onConnectionChange, desktopShare.isWebSocketConnected, desktopShare.isPeerConnected, desktopShare.isConnecting]);

  // 监听连接状态变化，当P2P连接断开时重置共享状态
  useEffect(() => {
    // 如果正在共享但P2P连接断开，自动重置共享状态
    if (desktopShare.isSharing && !desktopShare.isPeerConnected && desktopShare.connectionCode) {
      console.log('[DesktopShareSender] 检测到P2P连接断开，自动重置共享状态');
      
      const resetState = async () => {
        try {
          await desktopShare.resetSharing();
          console.log('[DesktopShareSender] 已自动重置共享状态');
        } catch (error) {
          console.error('[DesktopShareSender] 自动重置共享状态失败:', error);
        }
      };
      
      resetState();
    }
  }, [desktopShare.isSharing, desktopShare.isPeerConnected, desktopShare.connectionCode, desktopShare.resetSharing]);

  // 复制房间代码
  const copyCode = useCallback(async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      showToast('房间代码已复制到剪贴板', 'success');
    } catch (error) {
      console.error('复制失败:', error);
      showToast('复制失败，请手动复制', 'error');
    }
  }, [showToast]);

  // 创建房间
  const handleCreateRoom = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('[DesktopShareSender] 用户点击创建房间');
      
      const roomCode = await desktopShare.createRoom();
      console.log('[DesktopShareSender] 房间创建成功:', roomCode);
      
      showToast(`房间创建成功！代码: ${roomCode}`, 'success');
    } catch (error) {
      console.error('[DesktopShareSender] 创建房间失败:', error);
      const errorMessage = error instanceof Error ? error.message : '创建房间失败';
      showToast(errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [desktopShare, showToast]);

  // 开始桌面共享
  const handleStartSharing = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('[DesktopShareSender] 用户点击开始桌面共享');
      
      await desktopShare.startSharing();
      console.log('[DesktopShareSender] 桌面共享开始成功');
      
      showToast('桌面共享已开始', 'success');
    } catch (error) {
      console.error('[DesktopShareSender] 开始桌面共享失败:', error);
      const errorMessage = error instanceof Error ? error.message : '开始桌面共享失败';
      showToast(errorMessage, 'error');
      
      // 分享失败时重置状态，让用户重新选择桌面
      try {
        await desktopShare.resetSharing();
        console.log('[DesktopShareSender] 已重置共享状态，用户可以重新选择桌面');
      } catch (resetError) {
        console.error('[DesktopShareSender] 重置共享状态失败:', resetError);
      }
    } finally {
      setIsLoading(false);
    }
  }, [desktopShare, showToast]);

  // P2P连接建立后自动弹出桌面选择（仅 P2P 模式）
  useEffect(() => {
    if (
      desktopShare.isPeerConnected &&
      desktopShare.canStartSharing &&
      desktopShare.transportMode !== 'relay' &&
      !desktopShare.isSharing &&
      !isLoading &&
      !hasAutoStartedRef.current
    ) {
      hasAutoStartedRef.current = true;
      console.log('[DesktopShareSender] P2P连接已建立，自动弹出桌面选择');
      handleStartSharing();
    }
  }, [desktopShare.isPeerConnected, desktopShare.canStartSharing, desktopShare.transportMode, desktopShare.isSharing, isLoading, handleStartSharing]);

  // 切换桌面
  const handleSwitchDesktop = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('[DesktopShareSender] 用户点击切换桌面');
      
      await desktopShare.switchDesktop();
      console.log('[DesktopShareSender] 桌面切换成功');
      
      showToast('桌面切换成功', 'success');
    } catch (error) {
      console.error('[DesktopShareSender] 切换桌面失败:', error);
      const errorMessage = error instanceof Error ? error.message : '切换桌面失败';
      showToast(errorMessage, 'error');
      
      // 切换桌面失败时重置状态，让用户重新选择桌面
      try {
        await desktopShare.resetSharing();
        console.log('[DesktopShareSender] 已重置共享状态，用户可以重新选择桌面');
      } catch (resetError) {
        console.error('[DesktopShareSender] 重置共享状态失败:', resetError);
      }
    } finally {
      setIsLoading(false);
    }
  }, [desktopShare, showToast]);

  // 停止桌面共享
  const handleStopSharing = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('[DesktopShareSender] 用户点击停止桌面共享');
      
      await desktopShare.stopSharing();
      console.log('[DesktopShareSender] 桌面共享停止成功');
      
      showToast('桌面共享已停止', 'success');
    } catch (error) {
      console.error('[DesktopShareSender] 停止桌面共享失败:', error);
      const errorMessage = error instanceof Error ? error.message : '停止桌面共享失败';
      showToast(errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [desktopShare, showToast]);

  return (
    <div className={`space-y-4 sm:space-y-6 ${className || ''}`}>
      <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 sm:p-6 shadow-lg border border-white/20 animate-fade-in-up">
        {!desktopShare.connectionCode ? (
          // 创建房间前的界面
          <div className="space-y-6">
            {/* 功能标题和状态 */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center">
                  <Monitor className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">共享桌面</h2>
                  <p className="text-sm text-slate-600">分享您的屏幕给其他人</p>
                </div>
              </div>
              
              <ConnectionStatus 
                currentRoom={desktopShare.connectionCode ? { code: desktopShare.connectionCode, role: 'sender' } : null}
              />
            </div>

            <div className="text-center py-12">
              <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-purple-100 to-indigo-100 rounded-full flex items-center justify-center">
                <Monitor className="w-10 h-10 text-purple-500" />
              </div>
              <h3 className="text-lg font-semibold text-slate-800 mb-4">创建桌面共享房间</h3>
              <p className="text-slate-600 mb-8">创建房间后将生成分享码，等待接收方加入后即可开始桌面共享</p>
              
              <Button
                onClick={handleCreateRoom}
                disabled={isLoading || desktopShare.isConnecting}
                className="px-8 py-3 bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white text-lg font-medium rounded-xl shadow-lg"
              >
                {isLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                    创建中...
                  </>
                ) : (
                  <>
                    <Share className="w-5 h-5 mr-2" />
                    创建桌面共享房间
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          // 房间已创建，显示取件码和等待界面
          <div className="space-y-6">
            {/* 功能标题和状态 */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-500 rounded-xl flex items-center justify-center">
                  <Monitor className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-800">共享桌面</h2>
                  <p className="text-sm text-slate-600">房间代码: {desktopShare.connectionCode}</p>
                </div>
              </div>
              
              <ConnectionStatus 
                currentRoom={{ code: desktopShare.connectionCode, role: 'sender' }}
              />
            </div>

            {/* 中继模式提示（在控制区域外面，确保可见） */}
            {desktopShare.transportMode === 'relay' && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-8">
                <div className="text-center">
                  <Monitor className="w-16 h-16 mx-auto text-amber-400 mb-4" />
                  <p className="text-amber-700 font-medium mb-2">⚠️ 当前为中继模式</p>
                  <p className="text-sm text-amber-600">中继模式（WS 转发）不支持桌面视频流传输，桌面共享需要 P2P 直连。</p>
                  <p className="text-sm text-amber-600 mt-1">请检查网络环境或尝试重新连接。</p>
                </div>
              </div>
            )}

            {/* 桌面共享控制区域 */}
            {desktopShare.canStartSharing && (
              <div className="space-y-4">
                {!desktopShare.isSharing ? (
                  // 未共享：显示开始按钮
                  <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-slate-200">
                    <div className="space-y-3">
                      <Button
                        onClick={handleStartSharing}
                        disabled={isLoading || !desktopShare.isPeerConnected}
                        className={`w-full px-8 py-3 text-lg font-medium rounded-xl shadow-lg ${
                          desktopShare.isPeerConnected 
                            ? 'bg-gradient-to-r from-purple-500 to-indigo-500 hover:from-purple-600 hover:to-indigo-600 text-white' 
                            : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        }`}
                      >
                        <Play className="w-5 h-5 mr-2" />
                        {isLoading ? '启动中...' : '选择并开始共享桌面'}
                      </Button>
                      
                      {!desktopShare.isPeerConnected && desktopShare.transportMode !== 'relay' && (
                        <div className="text-center">
                          <p className="text-sm text-gray-500 mb-2">
                            等待接收方加入房间建立P2P连接...
                          </p>
                          <div className="flex items-center justify-center space-x-2">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-purple-500"></div>
                            <span className="text-sm text-purple-600">正在等待连接</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  // 共享中：显示桌面预览 + 叠加控制栏
                  <div className="relative bg-black rounded-xl overflow-hidden">
                    {/* 本地桌面预览 */}
                    <SenderDesktopPreview stream={desktopShare.localStream} />

                    {/* 叠加控制栏 */}
                    <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent p-3 sm:p-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2 text-white">
                          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                          <span className="text-sm font-medium">桌面共享中</span>
                        </div>
                        <div className="flex items-center space-x-2">
                          <Button
                            onClick={handleSwitchDesktop}
                            disabled={isLoading}
                            size="sm"
                            className="bg-white/20 text-white hover:bg-white/30 border border-white/30 rounded-lg px-3 py-1.5"
                          >
                            <Repeat className="w-4 h-4 mr-1.5" />
                            <span className="text-sm">{isLoading ? '切换中...' : '切换桌面'}</span>
                          </Button>
                          <Button
                            onClick={handleStopSharing}
                            disabled={isLoading}
                            size="sm"
                            className="bg-red-500/80 text-white hover:bg-red-600 border border-red-400/50 rounded-lg px-3 py-1.5"
                          >
                            <Square className="w-4 h-4 mr-1.5" />
                            <span className="text-sm">{isLoading ? '停止中...' : '停止共享'}</span>
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* 语音发言面板 */}
                {desktopShare.webRTCConnection && (
                  <VoiceChatPanel
                    connection={desktopShare.webRTCConnection}
                    isPeerConnected={desktopShare.isPeerConnected}
                  />
                )}
              </div>
            )}

            {/* 房间信息显示 */}
            <RoomInfoDisplay
              code={desktopShare.connectionCode}
              link={`${typeof window !== 'undefined' ? window.location.origin : ''}?type=desktop&mode=receive&code=${desktopShare.connectionCode}`}
              icon={Monitor}
              iconColor="from-emerald-500 to-teal-500"
              codeColor="from-purple-600 to-indigo-600"
              title="房间码生成成功！"
              subtitle="分享以下信息给观看方"
              codeLabel="房间代码"
              qrLabel="扫码观看"
              copyButtonText="复制房间代码"
              copyButtonColor="bg-purple-500 hover:bg-purple-600"
              qrButtonText="使用手机扫码快速观看"
              linkButtonText="复制链接"
              onCopyCode={() => copyCode(desktopShare.connectionCode)}
              onCopyLink={() => {
                const link = `${window.location.origin}?type=desktop&mode=receive&code=${desktopShare.connectionCode}`;
                navigator.clipboard.writeText(link);
                showToast('观看链接已复制', 'success');
              }}
            />
          </div>
        )}
      </div>

    </div>
  );
}

// 发送方桌面预览子组件
function SenderDesktopPreview({ stream }: { stream: MediaStream | null }) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
      videoRef.current.play().catch(() => {
        // 自动播放被阻止时静默处理
      });
    } else if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, [stream]);

  if (!stream) {
    return (
      <div className="flex items-center justify-center h-52 text-white/60">
        <Monitor className="w-10 h-10" />
      </div>
    );
  }

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted
      className="w-full object-contain"
      style={{ aspectRatio: '16/9', minHeight: '240px', maxHeight: '480px' }}
    />
  );
}
