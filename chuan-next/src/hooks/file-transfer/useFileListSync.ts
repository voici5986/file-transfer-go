import { useCallback, useEffect, useRef } from 'react';

interface FileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'ready' | 'downloading' | 'completed';
  progress: number;
}

interface UseFileListSyncProps {
  sendFileList: (fileInfos: FileInfo[]) => void;
  mode: 'send' | 'receive';
  pickupCode: string;
  isConnected: boolean;
  isPeerConnected: boolean;
  getChannelState: () => string;
}

export const useFileListSync = ({
  sendFileList,
  mode,
  pickupCode,
  isConnected,
  isPeerConnected,
  getChannelState
}: UseFileListSyncProps) => {
  const syncTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 统一的文件列表同步函数，带防抖功能
  const syncFileListToReceiver = useCallback((fileInfos: FileInfo[], reason: string) => {
    // 只有在发送模式、连接已建立且有房间时才发送文件列表
    if (mode !== 'send' || !pickupCode || !isConnected || !isPeerConnected) {
      console.log('跳过文件列表同步:', { mode, pickupCode: !!pickupCode, isConnected, isPeerConnected });
      return;
    }

    // 清除之前的延时发送
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    // 延时发送，避免频繁发送
    syncTimeoutRef.current = setTimeout(() => {
      if (isPeerConnected && getChannelState() === 'open') {
        console.log(`发送文件列表到接收方 (${reason}):`, fileInfos.map(f => f.name));
        sendFileList(fileInfos);
      }
    }, 150);
  }, [mode, pickupCode, isConnected, isPeerConnected, getChannelState, sendFileList]);

  // 清理防抖定时器
  useEffect(() => {
    return () => {
      if (syncTimeoutRef.current) {
        clearTimeout(syncTimeoutRef.current);
      }
    };
  }, []);

  return {
    syncFileListToReceiver
  };
};
