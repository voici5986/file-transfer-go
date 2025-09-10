import { useState, useEffect, useCallback } from 'react';

export interface IceServerConfig {
  id: string;
  urls: string;
  username?: string;
  credential?: string;
  type: 'stun' | 'turn';
  enabled: boolean;
  isDefault?: boolean; // 标记是否为默认服务器
}

const DEFAULT_ICE_SERVERS: IceServerConfig[] = [
  {
    id: 'easyvoip-stun',
    urls: 'stun:stun.easyvoip.com:3478',
    type: 'stun',
    enabled: true,
    isDefault: true,
  },
   {
    id: 'miwifi-stun',
    urls: 'stun:stun.miwifi.com:3478',
    type: 'stun',
    enabled: true,
    isDefault: true,
  },
  {
    id: 'google-stun-1',
    urls: 'stun:stun.l.google.com:19302',
    type: 'stun',
    enabled: true,
    isDefault: true,
  },
  {
    id: 'google-stun-2',
    urls: 'stun:stun1.l.google.com:19302',
    type: 'stun',
    enabled: true,
    isDefault: true,
  },
  {
    id: 'twilio-stun',
    urls: 'stun:global.stun.twilio.com:3478',
    type: 'stun',
    enabled: true,
    isDefault: true,
  }
];

const STORAGE_KEY = 'webrtc-ice-servers-config-090901';

export function useIceServersConfig() {
  const [iceServers, setIceServers] = useState<IceServerConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // 加载配置
  const loadConfig = useCallback(() => {
    try {
      const savedConfig = localStorage.getItem(STORAGE_KEY);
      if (savedConfig) {
        const parsed = JSON.parse(savedConfig);
        // 确保所有服务器都有isDefault属性
        const serversWithDefaults = parsed.map((server: any) => ({
          ...server,
          isDefault: server.isDefault !== undefined ? server.isDefault : 
            DEFAULT_ICE_SERVERS.some(defaultServer => defaultServer.id === server.id)
        }));
        setIceServers(serversWithDefaults);
      } else {
        setIceServers(DEFAULT_ICE_SERVERS);
      }
    } catch (error) {
      console.error('加载ICE服务器配置失败:', error);
      setIceServers(DEFAULT_ICE_SERVERS);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // 保存配置
  const saveConfig = useCallback((servers: IceServerConfig[]) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(servers));
      setIceServers(servers);
    } catch (error) {
      console.error('保存ICE服务器配置失败:', error);
      throw new Error('保存配置失败');
    }
  }, []);

  // 添加服务器
  const addIceServer = useCallback((config: Omit<IceServerConfig, 'id'>) => {
    const newServer: IceServerConfig = {
      ...config,
      id: `custom-${Date.now()}`,
      isDefault: false, // 用户添加的服务器不标记为默认
    };
    const updatedServers = [...iceServers, newServer];
    saveConfig(updatedServers);
  }, [iceServers, saveConfig]);

  // 更新服务器
  const updateIceServer = useCallback((id: string, updates: Partial<IceServerConfig>) => {
    const updatedServers = iceServers.map(server => 
      server.id === id ? { ...server, ...updates } : server
    );
    saveConfig(updatedServers);
  }, [iceServers, saveConfig]);

  // 删除服务器
  const removeIceServer = useCallback((id: string) => {
    // 确保至少保留一个服务器
    if (iceServers.length <= 1) {
      throw new Error('至少需要保留一个ICE服务器');
    }
    
    const updatedServers = iceServers.filter(server => server.id !== id);
    saveConfig(updatedServers);
  }, [iceServers, saveConfig]);

  // 恢复默认配置
  const resetToDefault = useCallback(() => {
    saveConfig(DEFAULT_ICE_SERVERS);
  }, [saveConfig]);

  // 获取WebRTC格式的配置
  const getWebRTCConfig = useCallback((): RTCIceServer[] => {
    return iceServers
      .filter(server => server.enabled)
      .map(server => {
        const rtcServer: RTCIceServer = {
          urls: server.urls,
        };
        
        if (server.username) {
          rtcServer.username = server.username;
        }
        
        if (server.credential) {
          rtcServer.credential = server.credential;
        }
        
        return rtcServer;
      });
  }, [iceServers]);

  // 验证服务器配置
  const validateServer = useCallback((config: Omit<IceServerConfig, 'id'>) => {
    const errors: string[] = [];

    if (!config.urls.trim()) {
      errors.push('服务器地址不能为空');
    } else {
      // 基本URL格式验证
      const urlPattern = /^(stun|turn|turns):.+/i;
      if (!urlPattern.test(config.urls)) {
        errors.push('服务器地址格式不正确（应以 stun: 或 turn: 开头）');
      }
    }

    if (config.type === 'turn') {
      if (!config.username?.trim()) {
        errors.push('TURN服务器需要用户名');
      }
      if (!config.credential?.trim()) {
        errors.push('TURN服务器需要密码');
      }
    }

    return errors;
  }, []);

  // 初始化加载
  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  return {
    iceServers,
    isLoading,
    addIceServer,
    updateIceServer,
    removeIceServer,
    resetToDefault,
    getWebRTCConfig,
    validateServer,
    saveConfig,
  };
}

// 独立的函数，用于在非React组件中获取ICE服务器配置
export function getIceServersConfig(): RTCIceServer[] {
  if (typeof window === 'undefined') {
    // 服务器端默认配置
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
  }

  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      // 返回默认配置的WebRTC格式
      return DEFAULT_ICE_SERVERS
        .filter(server => server.enabled)
        .map(server => {
          const rtcServer: RTCIceServer = {
            urls: server.urls,
          };
          
          if (server.username) {
            rtcServer.username = server.username;
          }
          
          if (server.credential) {
            rtcServer.credential = server.credential;
          }
          
          return rtcServer;
        });
    }

    const iceServers: IceServerConfig[] = JSON.parse(saved);
    return iceServers
      .filter(server => server.enabled)
      .map(server => {
        const rtcServer: RTCIceServer = {
          urls: server.urls,
        };
        
        if (server.username) {
          rtcServer.username = server.username;
        }
        
        if (server.credential) {
          rtcServer.credential = server.credential;
        }
        
        return rtcServer;
      });
  } catch (error) {
    console.error('获取ICE服务器配置失败:', error);
    // 发生错误时返回默认配置
    return [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
    ];
  }
}
