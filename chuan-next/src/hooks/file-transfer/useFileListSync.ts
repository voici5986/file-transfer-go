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
  getChannelState: () => any;
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
    if (mode !== 'send' || !pickupCode) {
      console.log('跳过文件列表同步: 非发送模式或无房间码', { mode, pickupCode: !!pickupCode });
      return;
    }

    // 获取当前通道状态
    const channelState = getChannelState();
    console.log(`文件列表同步检查 (${reason}):`, {
      mode,
      pickupCode: !!pickupCode,
      isConnected,
      isPeerConnected,
      channelState: channelState.state || channelState,
      fileInfosCount: fileInfos.length
    });

    // 清除之前的延时发送
    if (syncTimeoutRef.current) {
      clearTimeout(syncTimeoutRef.current);
    }

    // 延时发送，避免频繁发送
    syncTimeoutRef.current = setTimeout(() => {
      // 检查数据通道状态 - 使用更宽松的条件
      const currentState = getChannelState();
      const isChannelOpen = typeof currentState === 'object' ?
        currentState.state === 'open' || currentState.isDataChannelConnected :
        currentState === 'open';

      // 检查P2P连接状态
      const isP2PConnected = isPeerConnected || (typeof currentState === 'object' && currentState.isPeerConnected);

      console.log(`文件列表同步执行检查 (${reason}):`, {
        isChannelOpen,
        isP2PConnected,
        fileInfosCount: fileInfos.length
      });

      // 如果数据通道已打开或P2P已连接，就可以发送文件列表
      if (isChannelOpen || isP2PConnected) {
        console.log(`发送文件列表到接收方 (${reason}):`, fileInfos.map(f => f.name));
        sendFileList(fileInfos);
      } else {
        console.log(`跳过文件列表发送: 数据通道未打开或P2P未连接 (${reason})`);
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
