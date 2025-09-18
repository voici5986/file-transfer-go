"use client";

import { ConnectionStatus } from '@/components/ConnectionStatus';
import RoomInfoDisplay from '@/components/RoomInfoDisplay';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-simple';
import { useDesktopShareBusiness } from '@/hooks/desktop-share';
import { Monitor, Repeat, Share, Square } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

interface WebRTCDesktopSenderProps {
  className?: string;
  onConnectionChange?: (connection: any) => void;
}

export default function WebRTCDesktopSender({ className, onConnectionChange }: WebRTCDesktopSenderProps) {
  const [isLoading, setIsLoading] = useState(false);
  const { showToast } = useToast();

  // 使用桌面共享业务逻辑
  const desktopShare = useDesktopShareBusiness();

  // 调试：监控localStream状态变化
  useEffect(() => {
    console.log('[DesktopShareSender] localStream状态变化:', {
      hasLocalStream: !!desktopShare.localStream,
      streamId: desktopShare.localStream?.id,
      trackCount: desktopShare.localStream?.getTracks().length,
      isSharing: desktopShare.isSharing,
      canStartSharing: desktopShare.canStartSharing,
    });
  }, [desktopShare.localStream, desktopShare.isSharing, desktopShare.canStartSharing]);

  // 保持本地视频元素的引用
  const localVideoRef = useRef<HTMLVideoElement | null>(null);

  // 处理本地流变化，确保视频正确显示
  useEffect(() => {
    if (localVideoRef.current && desktopShare.localStream) {
      console.log('[DesktopShareSender] 通过useEffect设置本地流到video元素');
      localVideoRef.current.srcObject = desktopShare.localStream;
      localVideoRef.current.muted = true;

      localVideoRef.current.play().then(() => {
        console.log('[DesktopShareSender] useEffect: 本地预览播放成功');
      }).catch((e: Error) => {
        console.warn('[DesktopShareSender] useEffect: 本地预览播放失败:', e);
      });
    } else if (localVideoRef.current && !desktopShare.localStream) {
      console.log('[DesktopShareSender] 清除video元素的流');
      localVideoRef.current.srcObject = null;
    }
  }, [desktopShare.localStream]);

  // 通知父组件连接状态变化
  useEffect(() => {
    if (onConnectionChange && desktopShare.webRTCConnection) {
      onConnectionChange(desktopShare.webRTCConnection);
    }
  }, [onConnectionChange, desktopShare.isWebSocketConnected, desktopShare.isPeerConnected, desktopShare.isConnecting]);

  // 监听连接状态变化，当P2P连接断开时保持桌面共享状态
  const prevPeerConnectedRef = useRef<boolean>(false);

  useEffect(() => {
    // 只有从连接状态变为断开状态时才处理
    const wasPreviouslyConnected = prevPeerConnectedRef.current;
    const isCurrentlyConnected = desktopShare.isPeerConnected;

    // 更新ref
    prevPeerConnectedRef.current = isCurrentlyConnected;

    // 如果正在共享且从连接变为断开，保持桌面共享状态以便新用户加入
    if (desktopShare.isSharing &&
      wasPreviouslyConnected &&
      !isCurrentlyConnected &&
      desktopShare.connectionCode) {

      console.log('[DesktopShareSender] 检测到P2P连接断开，保持桌面共享状态等待新用户');

      const handleDisconnect = async () => {
        try {
          await desktopShare.handlePeerDisconnect();
          console.log('[DesktopShareSender] 已处理P2P断开，保持桌面共享状态');
        } catch (error) {
          console.error('[DesktopShareSender] 处理P2P断开失败:', error);
        }
      };

      handleDisconnect();
    }
  }, [desktopShare.isSharing, desktopShare.isPeerConnected, desktopShare.connectionCode]); // 移除handlePeerDisconnect依赖

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

  // 创建房间并开始桌面共享
  const handleCreateRoomAndStart = useCallback(async () => {
    try {
      setIsLoading(true);
      console.log('[DesktopShareSender] 用户点击创建房间并开始共享');

      const roomCode = await desktopShare.createRoomAndStartSharing();
      console.log('[DesktopShareSender] 房间创建并桌面共享开始成功:', roomCode);

      showToast(`房间创建成功！代码: ${roomCode}，桌面共享已开始`, 'success');
    } catch (error) {
      console.error('[DesktopShareSender] 创建房间并开始共享失败:', error);
      const errorMessage = error instanceof Error ? error.message : '创建房间并开始共享失败';
      showToast(errorMessage, 'error');
    } finally {
      setIsLoading(false);
    }
  }, [desktopShare, showToast]);

  // 创建房间（保留原方法）
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
        // await desktopShare.resetSharing();
        console.log('[DesktopShareSender] 已重置共享状态，用户可以重新选择桌面');
      } catch (resetError) {
        console.error('[DesktopShareSender] 重置共享状态失败:', resetError);
      }
    } finally {
      setIsLoading(false);
    }
  }, [desktopShare, showToast]);

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
                onClick={handleCreateRoomAndStart}
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
                    开始桌面共享
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

            {/* 桌面共享控制区域 */}
            {desktopShare.canStartSharing && (
              <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-slate-200 mb-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-lg font-medium text-slate-800 flex items-center">
                    <Monitor className="w-5 h-5 mr-2" />
                    桌面共享控制
                  </h4>
                  {/* 控制按钮 */}
                  {desktopShare.isSharing && (
                    <div className="flex items-center space-x-2">
                      <Button
                        onClick={handleSwitchDesktop}
                        disabled={isLoading}
                        variant="outline"
                        size="sm"
                        className="text-slate-700 border-slate-300"
                      >
                        <Repeat className="w-4 h-4 mr-1" />
                        切换桌面
                      </Button>
                      <Button
                        onClick={handleStopSharing}
                        disabled={isLoading}
                        variant="destructive"
                        size="sm"
                        className="bg-red-500 hover:bg-red-600 text-white"
                      >
                        <Square className="w-4 h-4 mr-1" />
                        停止共享
                      </Button>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  {/* 本地预览区域（显示正在共享的内容） */}
                  {desktopShare.isSharing && (
                    <div className="bg-black rounded-xl overflow-hidden relative">
                      {/* 共享状态指示器 */}
                      <div className="absolute top-2 left-2 z-10">
                        <div className="flex items-center space-x-1 bg-emerald-100 text-emerald-700 px-2 py-1 rounded-md">
                          <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                          <span className="text-xs font-medium">共享中</span>
                        </div>
                      </div>

                      {desktopShare.localStream ? (
                        <video
                          ref={localVideoRef}
                          key={desktopShare.localStream.id} // 使用key确保重新渲染
                          autoPlay
                          playsInline
                          muted
                          className="w-full aspect-video object-contain bg-black"
                          style={{ minHeight: '300px' }}
                        />
                      ) : (
                        <div className="w-full flex items-center justify-center text-white bg-black" style={{ minHeight: '300px' }}>
                          <div className="text-center">
                            <Monitor className="w-12 h-12 mx-auto mb-2 opacity-50" />
                            <p className="text-sm">正在加载屏幕流...</p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                </div>
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
