import { useToast } from '@/components/ui/toast-simple';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useWebRTCStore } from '../connection/state/webConnectStore';
import { useConfirmDialog } from './useConfirmDialog';

// 支持的功能类型
export type FeatureType = 'webrtc' | 'message' | 'desktop';

// 功能类型的显示名称
const FEATURE_NAMES: Record<FeatureType, string> = {
  webrtc: '文件传输',
  message: '文字传输',
  desktop: '桌面共享'
};

interface UseURLHandlerProps<T = string> {
  featureType: FeatureType;
  onModeChange: (mode: T) => void;
  onAutoJoinRoom?: (code: string) => void;
  onDisconnect?: () => void; // 新增：断开连接的回调
  modeConverter?: {
    // 将URL模式转换为组件内部模式
    fromURL: (urlMode: 'send' | 'receive') => T;
    // 将组件内部模式转换为URL模式  
    toURL: (componentMode: T) => 'send' | 'receive';
  };
}

export const useURLHandler = <T = 'send' | 'receive'>({ 
  featureType, 
  onModeChange, 
  onAutoJoinRoom,
  onDisconnect,
  modeConverter
}: UseURLHandlerProps<T>) => {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { showToast } = useToast();
  const { showConfirmDialog, dialogState, closeDialog } = useConfirmDialog();
  const [hasProcessedInitialUrl, setHasProcessedInitialUrl] = useState(false);
  const urlProcessedRef = useRef(false);
  
  // 获取WebRTC全局状态
  const { 
    isConnected, 
    isConnecting, 
    isPeerConnected,
    currentRoom,
    reset: resetWebRTCState 
  } = useWebRTCStore();

  // 检查是否有活跃连接
  const hasActiveConnection = useCallback(() => {
    return isConnected || isConnecting || isPeerConnected;
  }, [isConnected, isConnecting, isPeerConnected]);

  // 功能切换确认
  const switchToFeature = useCallback(async (targetFeatureType: FeatureType, mode?: 'send' | 'receive', code?: string) => {
    // 如果是同一个功能，直接切换
    if (targetFeatureType === featureType) {
      if (mode) {
        const params = new URLSearchParams(searchParams.toString());
        params.set('type', targetFeatureType);
        params.set('mode', mode);
        if (code) {
          params.set('code', code);
        } else if (mode === 'send') {
          params.delete('code');
        }
        router.push(`?${params.toString()}`, { scroll: false });
      }
      return true;
    }

    // 如果有活跃连接，需要确认
    if (hasActiveConnection()) {
      const currentFeatureName = FEATURE_NAMES[featureType];
      const targetFeatureName = FEATURE_NAMES[targetFeatureType];
      
      const confirmed = await showConfirmDialog({
        title: '切换功能确认',
        message: `切换到${targetFeatureName}功能需要关闭当前的${currentFeatureName}连接，是否继续？`,
        confirmText: '确认切换',
        cancelText: '取消',
        type: 'warning'
      });
      
      if (!confirmed) {
        return false;
      }

      // 用户确认后，断开当前连接
      try {
        if (onDisconnect) {
          await onDisconnect();
        }
        resetWebRTCState();
        showToast(`已断开${currentFeatureName}连接`, 'info');
      } catch (error) {
        console.error('断开连接时出错:', error);
        showToast('断开连接时出错，但将继续切换功能', 'error');
      }
    }

    // 切换到新功能
    const params = new URLSearchParams();
    params.set('type', targetFeatureType);
    if (mode) {
      params.set('mode', mode);
    }
    if (code) {
      params.set('code', code);
    }
    
    router.push(`?${params.toString()}`, { scroll: false });
    return true;
  }, [featureType, hasActiveConnection, onDisconnect, resetWebRTCState, showToast, router, searchParams, showConfirmDialog]);

  // 从URL参数中获取初始模式（仅在首次加载时处理）
  useEffect(() => {
    // 使用 ref 确保只处理一次，避免严格模式的重复调用
    if (urlProcessedRef.current) {
      console.log('URL已处理过，跳过重复处理');
      return;
    }

    const urlMode = searchParams.get('mode') as 'send' | 'receive';
    const type = searchParams.get('type') as FeatureType;
    const code = searchParams.get('code');
    
    // 只在首次加载且URL中有对应功能类型时处理
    if (!hasProcessedInitialUrl && type === featureType && urlMode && ['send', 'receive'].includes(urlMode)) {
      console.log(`=== 处理初始URL参数 [${featureType}] ===`);
      console.log('URL模式:', urlMode, '类型:', type, '取件码:', code);
      
      // 立即标记为已处理，防止重复
      urlProcessedRef.current = true;
      
      // 转换模式（如果有转换器的话）
      const componentMode = modeConverter ? modeConverter.fromURL(urlMode) : urlMode as T;
      onModeChange(componentMode);
      setHasProcessedInitialUrl(true);
      
      // 自动加入房间（只在receive模式且有code时）
      if (code && urlMode === 'receive' && onAutoJoinRoom) {
        console.log('URL中有取件码，自动加入房间');
        onAutoJoinRoom(code);
      }
    }
  }, [searchParams, hasProcessedInitialUrl, featureType, onModeChange, onAutoJoinRoom, modeConverter]);

  // 更新URL参数
  const updateMode = useCallback((newMode: T) => {
    console.log(`=== 手动切换模式 [${featureType}] ===`);
    console.log('新模式:', newMode);
    
    onModeChange(newMode);
    
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', featureType);
    
    // 转换模式（如果有转换器的话）
    const urlMode = modeConverter ? modeConverter.toURL(newMode) : newMode as string;
    params.set('mode', urlMode);
    
    // 如果切换到发送模式，移除code参数
    if (urlMode === 'send') {
      params.delete('code');
    }
    
    router.push(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router, featureType, onModeChange, modeConverter]);

  // 更新URL中的房间代码
  const updateRoomCode = useCallback((code: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('type', featureType);
    params.set('code', code);
    router.push(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router, featureType]);

  // 获取当前URL中的房间代码
  const getCurrentRoomCode = useCallback(() => {
    return searchParams.get('code') || '';
  }, [searchParams]);

  // 清除URL参数
  const clearURLParams = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete('type');
    params.delete('mode');
    params.delete('code');
    
    const newURL = params.toString() ? `?${params.toString()}` : '/';
    router.push(newURL, { scroll: false });
  }, [searchParams, router]);

  return {
    updateMode,
    updateRoomCode,
    getCurrentRoomCode,
    clearURLParams,
    switchToFeature,
    hasActiveConnection,
    // 导出对话框状态供组件使用
    confirmDialogState: dialogState,
    closeConfirmDialog: closeDialog
  };
};
