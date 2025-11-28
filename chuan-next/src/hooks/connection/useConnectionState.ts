import { useToast } from '@/components/ui/toast-simple';
import { useEffect, useState } from 'react';

interface UseConnectionStateProps {
  isWebSocketConnected: boolean;
  isConnected: boolean;
  isConnecting: boolean;
  error: string;
  pickupCode: string;
  fileListLength: number;
  currentTransferFile: any;
  setCurrentTransferFile: (file: any) => void;
  updateFileListStatus: (callback: (prev: any[]) => any[]) => void;
}

export const useConnectionState = ({
  isWebSocketConnected,
  isConnected,
  isConnecting,
  error,
  pickupCode,
  fileListLength,
  currentTransferFile,
  setCurrentTransferFile,
  updateFileListStatus
}: UseConnectionStateProps) => {
  const { showToast } = useToast();
  const [lastError, setLastError] = useState<string>('');

  // 处理连接错误
  useEffect(() => {
    if (error && error !== lastError) {
      console.log('=== 连接错误处理 ===');
      console.log('错误信息:', error);
      
      // 根据错误类型显示不同的提示
      let errorMessage = error;
      
      if (error.includes('WebSocket')) {
        errorMessage = '服务器连接失败，请检查网络连接或稍后重试';
      } else if (error.includes('数据通道')) {
        errorMessage = '数据通道连接失败，请重新尝试连接';
      } else if (error.includes('连接超时')) {
        errorMessage = '连接超时，请检查网络状况或重新尝试';
      } else if (error.includes('连接失败')) {
        errorMessage = 'WebRTC连接失败，可能是网络环境限制，请尝试刷新页面';
      } else if (error.includes('信令错误')) {
        errorMessage = '信令服务器错误，请稍后重试';
      } else if (error.includes('创建连接失败')) {
        errorMessage = '无法建立P2P连接，请检查网络设置';
      }
      
      // 显示错误提示
      showToast(errorMessage, "error");
      setLastError(error);
      
      // 如果是严重连接错误，清理传输状态
      if (error.includes('连接失败') || error.includes('数据通道连接失败') || error.includes('WebSocket')) {
        console.log('严重连接错误，清理传输状态');
        setCurrentTransferFile(null);
        
        // 重置所有正在传输的文件状态
        updateFileListStatus((prev: any[]) => prev.map(item => 
          item.status === 'downloading' 
            ? { ...item, status: 'ready' as const, progress: 0 }
            : item
        ));
      }
    }
  }, [error, lastError, showToast, setCurrentTransferFile, updateFileListStatus]);

  // 监听连接状态变化和清理传输状态
  useEffect(() => {
    console.log('=== 连接状态变化 ===');
    console.log('WebSocket连接状态:', isWebSocketConnected);
    console.log('WebRTC连接状态:', isConnected);
    console.log('连接中状态:', isConnecting);
    
    // 当连接断开或有错误时，清理所有传输状态
    const shouldCleanup = (!isWebSocketConnected && !isConnected && !isConnecting && pickupCode) || 
                         ((!isConnected && !isConnecting) || error);
    
    if (shouldCleanup) {
      const hasCurrentTransfer = !!currentTransferFile;
      const hasFileList = fileListLength > 0;
      
      // 只有在之前有连接活动时才显示断开提示和清理状态
      if (hasFileList || hasCurrentTransfer) {
        if (!isWebSocketConnected && pickupCode) {
          showToast('与服务器的连接已断开，请重新连接', "error");
        }
        
        console.log('连接断开，清理传输状态');
        
        if (currentTransferFile) {
          setCurrentTransferFile(null);
        }
        
        // 重置所有正在下载的文件状态
        updateFileListStatus((prev: any[]) => {
          const hasDownloadingFiles = prev.some(item => item.status === 'downloading');
          if (hasDownloadingFiles) {
            console.log('重置正在传输的文件状态');
            return prev.map(item => 
              item.status === 'downloading' 
                ? { ...item, status: 'ready' as const, progress: 0 }
                : item
            );
          }
          return prev;
        });
      }
    }
    
    // WebSocket连接成功时的提示
    if (isWebSocketConnected && isConnecting && !isConnected) {
      console.log('WebSocket已连接，正在建立P2P连接...');
    }
    
  }, [isWebSocketConnected, isConnected, isConnecting, pickupCode, error, showToast, currentTransferFile, fileListLength, setCurrentTransferFile, updateFileListStatus]);

  // 监听连接状态变化并提供日志
  useEffect(() => {
    console.log('=== WebRTC连接状态变化 ===');
    console.log('连接状态:', {
      isConnected,
      isConnecting,
      isWebSocketConnected,
      pickupCode,
      fileListLength
    });
  }, [isConnected, isConnecting, isWebSocketConnected, pickupCode, fileListLength]);

  return {
    lastError
  };
};
