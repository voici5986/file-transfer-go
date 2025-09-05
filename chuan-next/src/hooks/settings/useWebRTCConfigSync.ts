import { useEffect, useCallback } from 'react';
import { useToast } from '@/components/ui/toast-simple';

export function useWebRTCConfigSync() {
  const { showToast } = useToast();

  // 监听存储变化事件
  const handleStorageChange = useCallback((event: StorageEvent) => {
    if (event.key === 'webrtc-ice-servers-config') {
      showToast(
        '检测到WebRTC配置更改，请重新建立连接以应用新配置', 
        'info'
      );
    }
  }, [showToast]);

  useEffect(() => {
    // 监听localStorage变化
    window.addEventListener('storage', handleStorageChange);
    
    return () => {
      window.removeEventListener('storage', handleStorageChange);
    };
  }, [handleStorageChange]);

  return {
    // 可以在这里添加其他配置同步相关的方法
  };
}
