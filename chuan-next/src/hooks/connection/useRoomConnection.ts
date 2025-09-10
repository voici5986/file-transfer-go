import { useState, useCallback } from 'react';
import { useToast } from '@/components/ui/toast-simple';

interface UseRoomConnectionProps {
  connect: (code: string, role: 'sender' | 'receiver') => void;
  isConnecting: boolean;
  isConnected: boolean;
}

export const useRoomConnection = ({ connect, isConnecting, isConnected }: UseRoomConnectionProps) => {
  const { showToast } = useToast();
  const [isJoiningRoom, setIsJoiningRoom] = useState(false);

  const validateRoomCode = (code: string): string | null => {
    const trimmedCode = code.trim();
    if (!trimmedCode || trimmedCode.length !== 6) {
      return '请输入正确的6位取件码';
    }
    return null;
  };

  const checkRoomStatus = async (code: string) => {
    const response = await fetch(`/api/room-info?code=${code}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: 无法检查房间状态`);
    }
    
    const result = await response.json();
    
    if (!result.success) {
      let errorMessage = result.message || '房间不存在或已过期';
      if (result.message?.includes('expired')) {
        errorMessage = '房间已过期，请联系发送方重新创建';
      } else if (result.message?.includes('not found')) {
        errorMessage = '房间不存在，请检查取件码是否正确';
      }
      throw new Error(errorMessage);
    }
    
    // 检查房间是否已满
    if (result.is_room_full) {
      throw new Error('当前房间人数已满，正在传输中无法加入');
    }
    
    if (!result.sender_online) {
      throw new Error('发送方不在线，请确认取件码是否正确或联系发送方');
    }

    return result;
  };

  const handleNetworkError = (error: Error): string => {
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return '网络连接失败，请检查网络状况';
    } else if (error.message.includes('timeout')) {
      return '请求超时，请重试';
    } else if (error.message.includes('HTTP 404')) {
      return '房间不存在，请检查取件码';
    } else if (error.message.includes('HTTP 500')) {
      return '服务器错误，请稍后重试';
    } else if (error.message.includes('房间人数已满') || error.message.includes('正在传输中无法加入')) {
      return '当前房间人数已满，正在传输中无法加入，请稍后再试';
    } else {
      return error.message;
    }
  };

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
      await checkRoomStatus(code.trim());
      
      console.log('房间状态检查通过，开始连接...');
      connect(code.trim(), 'receiver');
      showToast(`正在连接到房间: ${code.trim()}`, "success");
      
    } catch (error) {
      console.error('检查房间状态失败:', error);
      const errorMessage = error instanceof Error ? handleNetworkError(error) : '检查房间状态失败';
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
