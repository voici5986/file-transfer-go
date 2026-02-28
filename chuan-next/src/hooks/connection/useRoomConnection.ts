import { useState, useCallback } from 'react';
import { useToast } from '@/components/ui/toast-simple';
import { validateRoomCode, checkRoomStatus } from '@/lib/room-utils';

interface UseRoomConnectionProps {
  connect: (code: string, role: 'sender' | 'receiver') => void;
  isConnecting: boolean;
  isConnected: boolean;
}

export const useRoomConnection = ({ connect, isConnecting, isConnected }: UseRoomConnectionProps) => {
  const { showToast } = useToast();
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);

  // 加入房间 (接收模式)
  const joinRoom = useCallback(async (code: string) => {
    console.log('=== 加入房间 ===');
    console.log('取件码:', code);
    
    // 验证输入
    const validationError = validateRoomCode(code);
    if (validationError) {
      showToast(validationError, "error");
      return;
    }

    // 防止重复调用
    if (isConnecting || isConnected || isJoiningRoom) {
      console.log('已在连接中或已连接，跳过重复的房间状态检查');
      return;
    }
    
    setIsJoiningRoom(true);
    
    try {
      console.log('检查房间状态...');
      const result = await checkRoomStatus(code.trim());
      
      if (!result.success) {
        showToast(result.error || '检查房间状态失败', "error");
        return;
      }
      
      console.log('房间状态检查通过，开始连接...');
      connect(code.trim(), 'receiver');
      showToast(`正在连接到房间: ${code.trim()}`, "success");
      
    } catch (error) {
      console.error('检查房间状态失败:', error);
      const errorMessage = error instanceof Error ? error.message : '检查房间状态失败';
      showToast(errorMessage, "error");
    } finally {
      setIsJoiningRoom(false);
    }
  }, [isConnecting, isConnected, isJoiningRoom, showToast, connect]);

  return {
    joinRoom,
    isJoiningRoom
  };
};
