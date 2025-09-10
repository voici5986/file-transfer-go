"use client";

import React, { useState } from 'react';
import { 
  Settings, 
  Plus, 
  Trash2, 
  RotateCcw, 
  Save,
  Info,
  Server,
  Eye,
  EyeOff,
  AlertTriangle,
  Shield,
  Database,
  X,
  Wifi
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useIceServersConfig, IceServerConfig } from '@/hooks/settings/useIceServersConfig';
import { useToast } from '@/components/ui/toast-simple';
import { useWebRTCStore } from '@/hooks/ui/webRTCStore';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface AddServerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (config: Omit<IceServerConfig, 'id'>) => void;
  validateServer: (config: Omit<IceServerConfig, 'id'>) => string[];
}

function AddServerModal({ isOpen, onClose, onSubmit, validateServer }: AddServerModalProps) {
  const [formData, setFormData] = useState({
    urls: '',
    username: '',
    credential: '',
    type: 'stun' as 'stun' | 'turn',
    enabled: true,
  });
  const [errors, setErrors] = useState<string[]>([]);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const validationErrors = validateServer(formData);
    
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      return;
    }

    onSubmit(formData);
    onClose();
    // 重置表单
    setFormData({
      urls: '',
      username: '',
      credential: '',
      type: 'stun',
      enabled: true,
    });
    setErrors([]);
  };

  const handleTypeChange = (type: 'stun' | 'turn') => {
    setFormData(prev => ({
      ...prev,
      type,
      username: type === 'stun' ? '' : prev.username,
      credential: type === 'stun' ? '' : prev.credential,
    }));
    setErrors([]);
  };

  const handleClose = () => {
    onClose();
    setErrors([]);
    setFormData({
      urls: '',
      username: '',
      credential: '',
      type: 'stun',
      enabled: true,
    });
  };

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/20 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onClick={(e) => {
        // 点击背景关闭弹窗
        if (e.target === e.currentTarget) {
          handleClose();
        }
      }}
    >
      <div 
        className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] overflow-y-auto border border-gray-200 mx-4"
        onClick={(e) => e.stopPropagation()} // 防止点击弹窗内容时关闭
      >
        <div className="p-4 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg sm:text-xl font-semibold text-gray-900 flex items-center gap-2">
              <Plus className="w-5 h-5 text-blue-600" />
              <span className="hidden sm:inline">添加ICE服务器</span>
              <span className="sm:hidden">添加服务器</span>
            </h3>
            <button
              onClick={handleClose}
              className="text-gray-400 hover:text-gray-600 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 服务器类型 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                服务器类型
              </label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="stun"
                    checked={formData.type === 'stun'}
                    onChange={(e) => handleTypeChange(e.target.value as 'stun' | 'turn')}
                    className="text-blue-600"
                  />
                  <span className="text-sm">STUN</span>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="radio"
                    value="turn"
                    checked={formData.type === 'turn'}
                    onChange={(e) => handleTypeChange(e.target.value as 'stun' | 'turn')}
                    className="text-blue-600"
                  />
                  <span className="text-sm">TURN</span>
                </label>
              </div>
            </div>

            {/* 服务器地址 */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                服务器地址 *
              </label>
              <Input
                value={formData.urls}
                onChange={(e) => setFormData(prev => ({ ...prev, urls: e.target.value }))}
                placeholder={formData.type === 'stun' ? 'stun:your-server.com:3478' : 'turn:your-server.com:3478'}
                className="w-full"
              />
              <p className="text-xs text-gray-500 mt-1">
                {formData.type === 'stun' ? 
                  '格式: stun:服务器地址:端口' :
                  '格式: turn:服务器地址:端口'
                }
              </p>
            </div>

            {/* TURN服务器认证信息 */}
            {formData.type === 'turn' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    用户名 *
                  </label>
                  <Input
                    value={formData.username}
                    onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                    placeholder="输入TURN服务器用户名"
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    密码 *
                  </label>
                  <div className="relative">
                    <Input
                      type={showPassword ? 'text' : 'password'}
                      value={formData.credential}
                      onChange={(e) => setFormData(prev => ({ ...prev, credential: e.target.value }))}
                      placeholder="输入TURN服务器密码"
                      className="w-full pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 min-h-[44px] min-w-[44px] flex items-center justify-center"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>
              </>
            )}

            {/* 错误信息 */}
            {errors.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-red-800">配置错误</p>
                    <ul className="text-sm text-red-700 mt-1 space-y-1">
                      {errors.map((error, index) => (
                        <li key={index}>• {error}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex flex-col sm:flex-row gap-3 pt-2">
              <Button type="submit" className="flex-1 min-h-[44px] justify-center">
                <Save className="w-4 h-4 mr-2" />
                添加服务器
              </Button>
              <Button 
                type="button" 
                variant="outline" 
                onClick={handleClose}
                className="sm:w-auto min-h-[44px] justify-center"
              >
                取消
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

interface ServerItemProps {
  server: IceServerConfig;
  onRemove: (id: string) => void;
  canRemove: boolean;
}

function ServerItem({ server, onRemove, canRemove }: ServerItemProps) {
  return (
    <div className="border rounded-lg p-3 sm:p-4 bg-white">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-2">
            <span className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded whitespace-nowrap">
              {server.type?.toUpperCase() || 'STUN'}
            </span>
            {server.isDefault && (
              <span className="text-xs bg-green-100 text-green-600 px-2 py-1 rounded whitespace-nowrap">
                默认
              </span>
            )}
            <span className="text-sm text-gray-700 break-all">
              {server.urls}
            </span>
          </div>

          {server.username && (
            <p className="text-xs text-gray-500">
              用户名: {server.username}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end sm:justify-start sm:ml-4">
          {canRemove && (
            <Button
              variant="outline"
              onClick={() => onRemove(server.id)}
              className="text-red-600 hover:text-red-700 hover:bg-red-50 min-h-[44px] min-w-[44px] px-3 py-2 sm:min-h-[36px] sm:min-w-[36px]"
            >
              <Trash2 className="w-4 h-4" />
              <span className="ml-2 sm:hidden">删除</span>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function WebRTCSettings() {
  const {
    iceServers,
    isLoading,
    addIceServer,
    removeIceServer,
    resetToDefault,
    validateServer,
  } = useIceServersConfig();

  const [showAddModal, setShowAddModal] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [serverToDelete, setServerToDelete] = useState<string | null>(null);
  const { showToast } = useToast();
  
  // 获取WebRTC连接状态
  const { 
    isConnected, 
    isConnecting, 
    isPeerConnected,
    currentRoom 
  } = useWebRTCStore();

  // 检查是否有活跃连接
  const hasActiveConnection = isConnected || isConnecting || isPeerConnected;

  const handleAddServer = (config: Omit<IceServerConfig, 'id'>) => {
    try {
      addIceServer(config);
      showToast('ICE服务器添加成功', 'success');
    } catch (error) {
      showToast('添加失败，请重试', 'error');
    }
  };

  const handleRemoveServer = (id: string) => {
    setServerToDelete(id);
    setShowDeleteDialog(true);
  };

  const confirmDeleteServer = () => {
    if (serverToDelete) {
      try {
        removeIceServer(serverToDelete);
        showToast('ICE服务器删除成功', 'success');
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : '删除失败';
        showToast(errorMessage, 'error');
      } finally {
        setServerToDelete(null);
        setShowDeleteDialog(false);
      }
    }
  };

  const cancelDeleteServer = () => {
    setServerToDelete(null);
    setShowDeleteDialog(false);
  };

  const handleResetToDefault = () => {
    try {
      resetToDefault();
      showToast('已恢复默认配置', 'success');
    } catch (error) {
      showToast('恢复默认配置失败', 'error');
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-12">
        <div className="animate-spin w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4"></div>
        <p className="text-gray-600">加载设置中...</p>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6 px-4 sm:px-0">
      {/* 头部 */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="p-2 sm:p-3 bg-blue-100 rounded-xl">
            <Settings className="w-6 h-6 sm:w-8 sm:h-8 text-blue-600" />
          </div>
          <h2 className="text-xl sm:text-2xl font-bold text-gray-900">WebRTC 设置</h2>
        </div>
        <p className="text-sm sm:text-base text-gray-600">
          配置STUN/TURN服务器以优化网络连接性能
        </p>
      </div>

      {/* 隐私提示 */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <Shield className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-blue-900 mb-1 text-sm sm:text-base">隐私保护</h3>
            <p className="text-blue-800 text-xs sm:text-sm">
              所有配置数据仅存储在您的浏览器本地，不会同步到服务器
            </p>
          </div>
        </div>
      </div>

      {/* 连接状态警告 */}
      {hasActiveConnection && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 sm:p-4">
          <div className="flex items-start gap-3">
            <Wifi className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-amber-900 mb-1 text-sm sm:text-base">连接状态提醒</h3>
              <div className="text-amber-800 text-xs sm:text-sm">
                <p>检测到当前有活跃的WebRTC连接</p>
                {currentRoom && (
                  <p className="mt-1">
                    房间: <span className="font-mono text-xs">{currentRoom.code}</span> 
                    ({currentRoom.role === 'sender' ? '发送方' : '接收方'})
                  </p>
                )}
                <p className="mt-2 text-xs">
                  修改ICE服务器配置不会影响现有连接，新配置将在下次建立连接时生效
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ICE服务器列表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="p-3 sm:p-4 border-b border-gray-200">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <Server className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600" />
              <div>
                <h3 className="text-base sm:text-lg font-semibold text-gray-900">ICE 服务器配置</h3>
                <p className="text-xs sm:text-sm text-gray-600">
                  共 {iceServers.length} 个服务器配置
                </p>
              </div>
            </div>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <Button
                variant="outline"
                onClick={handleResetToDefault}
                className="flex items-center justify-center gap-2 min-h-[44px] px-4 py-2"
              >
                <RotateCcw className="w-4 h-4" />
                <span className="hidden sm:inline">恢复默认</span>
                <span className="sm:hidden">恢复</span>
              </Button>
              
              <Button
                onClick={() => setShowAddModal(true)}
                className="flex items-center justify-center gap-2 min-h-[44px] px-4 py-2"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">添加服务器</span>
                <span className="sm:hidden">添加</span>
              </Button>
            </div>
          </div>
        </div>

        <div className="p-3 sm:p-4">
          {/* 服务器列表 */}
          <div className="space-y-3">
            {iceServers.map((server) => (
              <ServerItem
                key={server.id}
                server={server}
                onRemove={handleRemoveServer}
                canRemove={iceServers.length > 1}
              />
            ))}
          </div>

          {/* 空状态 */}
          {iceServers.length === 0 && (
            <div className="text-center py-8">
              <Database className="w-12 h-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">暂无ICE服务器配置</p>
              <Button 
                onClick={() => setShowAddModal(true)}
                className="min-h-[44px] px-6"
              >
                <Plus className="w-4 h-4 mr-2" />
                添加第一个服务器
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* 配置说明 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-3 sm:p-4">
        <div className="flex items-start gap-3">
          <Info className="w-4 h-4 sm:w-5 sm:h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="font-semibold text-gray-900 mb-2 text-sm sm:text-base">配置说明</h3>
            
            <div className="space-y-3 text-xs sm:text-sm text-gray-700">
              <div>
                <h4 className="font-medium text-gray-900 mb-1">STUN:</h4>
                <p className="text-gray-600">
                  用于检测公网IP地址和端口，帮助建立P2P连接。
                </p>
                <p className="text-gray-600 mt-1">
                  格式：<code className="bg-gray-100 px-1 py-0.5 rounded text-xs">stun:服务器地址:端口</code>
                </p>
              </div>
              
              <div>
                <h4 className="font-medium text-gray-900 mb-1">TURN:</h4>
                <p className="text-gray-600">
                  当P2P连接失败时，通过中继服务器转发数据，需要用户名和密码认证。
                </p>
                <p className="text-gray-600 mt-1">
                  格式：<code className="bg-gray-100 px-1 py-0.5 rounded text-xs">turn:服务器地址:端口</code>
                </p>
              </div>

              <div>
                <h4 className="font-medium text-gray-900 mb-1">默认服务器:</h4>
                <p className="text-gray-600">
                  系统预置的可靠ICE服务器，建议保留以确保连接稳定性。可以根据需要删除或添加自定义服务器。
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* 添加服务器弹窗 */}
      <AddServerModal
        isOpen={showAddModal}
        onClose={() => setShowAddModal(false)}
        onSubmit={handleAddServer}
        validateServer={validateServer}
      />

      {/* 删除确认对话框 */}
      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={cancelDeleteServer}
        onConfirm={confirmDeleteServer}
        title="删除ICE服务器"
        message={(() => {
          if (!serverToDelete) return "确定要删除这个ICE服务器吗？";
          
          const serverToDeleteInfo = iceServers.find(s => s.id === serverToDelete);
          
          if (iceServers.length <= 1) {
            return "这是最后一个ICE服务器，删除后将无法建立WebRTC连接。确定要删除吗？";
          } else if (serverToDeleteInfo?.isDefault) {
            return "这是一个默认ICE服务器，删除后可能需要手动添加其他服务器。确定要删除吗？";
          } else {
            return "确定要删除这个ICE服务器吗？删除后将无法恢复。";
          }
        })()}
        confirmText="删除"
        cancelText="取消"
        type="danger"
      />
    </div>
  );
}
