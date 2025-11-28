"use client";

import { ConnectionStatus } from '@/components/ConnectionStatus';
import RoomInfoDisplay from '@/components/RoomInfoDisplay';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-simple';
import { useConnectManager } from '@/hooks/connection';
import { useFileTransferBusiness } from '@/hooks/file-transfer';
import { useTextTransferBusiness } from '@/hooks/text-transfer';
import { Image, MessageSquare, Send } from 'lucide-react';
import React, { useCallback, useEffect, useRef, useState } from 'react';

interface WebRTCTextSenderProps {
  onRestart?: () => void;
  onPreviewImage?: (imageUrl: string) => void;
  onConnectionChange?: (connection: any) => void;
}

export const WebRTCTextSender: React.FC<WebRTCTextSenderProps> = ({ onRestart, onPreviewImage, onConnectionChange }) => {
  const { showToast } = useToast();
  
  // 状态管理
  const [pickupCode, setPickupCode] = useState('');
  const [textInput, setTextInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [sentImages, setSentImages] = useState<Array<{id: string, url: string, fileName: string}>>([]);
  
  // Refs
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // 创建共享连接
  const connection = useConnectManager();

  const { getConnectState } = connection;

  // 使用共享连接创建业务层
  const textTransfer = useTextTransferBusiness(connection);
  const fileTransfer = useFileTransferBusiness(connection);

  // 连接所有传输通道
  const connectAll = useCallback(async (code: string, role: 'sender' | 'receiver') => {
    console.log('=== 连接所有传输通道 ===', { code, role });
    // 只需要连接一次，因为使用的是共享连接
    await connection.connect(code, role);
  }, [connection]);
  
  // 是否正在连接
  const isAnyConnecting = textTransfer.isConnecting || fileTransfer.isConnecting;

  // 通知父组件连接状态变化
  useEffect(() => {
    if (onConnectionChange) {
      onConnectionChange(connection);
    }
  }, [onConnectionChange, getConnectState().isConnected, getConnectState().isConnecting, getConnectState().isPeerConnected]);


  // 重新开始
  const restart = () => {
    setPickupCode('');
    setTextInput('');
    setIsTyping(false);
    
    // 清理发送的图片URL
    sentImages.forEach(img => URL.revokeObjectURL(img.url));
    setSentImages([]);
    
    // 断开连接（只需要断开一次）
    connection.disconnect();
    
    if (onRestart) {
      onRestart();
    }
  };

  // 监听实时文本同步（发送方可以看到自己发的内容被对方接收）
  useEffect(() => {
    const cleanup = textTransfer.onTextSync((text: string) => {
      // 这里可以处理对方的实时文本，但通常发送方不需要监听自己发送的内容
      console.log('收到对方的实时文本同步:', text);
    });

    return cleanup;
  }, [textTransfer.onTextSync]);

  // 监听打字状态
  useEffect(() => {
    const cleanup = textTransfer.onTypingStatus((typing: boolean) => {
      setIsTyping(typing);
    });

    return cleanup;
  }, [textTransfer.onTypingStatus]);

  // 监听文件（图片）接收
  useEffect(() => {
    const cleanup = fileTransfer.onFileReceived((fileData) => {
      if (fileData.file.type.startsWith('image/')) {
        // 只显示toast提示，不保存消息记录
        showToast(`收到图片: ${fileData.file.name}`, "success");
      }
    });

    return cleanup;
  }, [fileTransfer.onFileReceived]);

  // 创建空房间
  const createRoom = useCallback(async () => {
    try {
      console.log('=== 开始创建房间 ===');
      const currentText = textInput.trim();
      
      // 创建后端房间 - 简化版本，不发送无用的文本信息
      const response = await fetch('/api/create-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // 不再发送文本内容，因为后端不使用这些信息
        body: JSON.stringify({}),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '创建房间失败');
      }

      const code = data.code;
      console.log('=== 房间创建成功 ===', code);
      setPickupCode(code);
      
      await connectAll(code, 'sender');
      
      // 如果有初始文本，发送它
      if (currentText) {
        setTimeout(() => {
          if (getConnectState().isPeerConnected && textTransfer.isConnected) {
            // 发送实时文本同步
            textTransfer.sendTextSync(currentText);
            
            // 重置自动调整高度
            if (textareaRef.current) {
              textareaRef.current.style.height = '40px';
            }
          }
        }, 1000);
      }
      
      showToast(`消息房间创建成功！取件码: ${code}`, "success");
    } catch (error) {
      console.error('创建房间失败:', error);
      showToast(error instanceof Error ? error.message : '创建房间失败', "error");
    }
  }, [textInput, connectAll, showToast, textTransfer]);

  // 处理文本输入变化（实时同步）
  const handleTextInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setTextInput(value);
    
    // 自动调整高度 - 修复高度计算
    const textarea = e.target;
    textarea.style.height = 'auto'; // 先重置为auto
    const newHeight = Math.min(Math.max(textarea.scrollHeight, 100), 300); // 最小100px，最大300px
    textarea.style.height = `${newHeight}px`;
    
    // 实时同步文本内容（如果P2P连接已建立）
    if (getConnectState().isPeerConnected && textTransfer.isConnected) {
      // 发送实时文本同步
      textTransfer.sendTextSync(value);
      
      // 发送打字状态
      textTransfer.sendTypingStatus(value.length > 0);
      
      // 清除之前的定时器
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      
      // 设置新的定时器来停止打字状态
      if (value.length > 0) {
        typingTimeoutRef.current = setTimeout(() => {
          textTransfer.sendTypingStatus(false);
        }, 1000); // 缩短到1秒
      }
    }
  };

  // 处理图片发送（文件选择或粘贴）
  const handleImageSend = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      showToast('请选择图片文件', "error");
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) {
      showToast('图片文件大小不能超过5MB', "error");
      return;
    }
    
    // 创建预览URL并添加到显示列表
    const imageUrl = URL.createObjectURL(file);
    const imageId = `img_${Date.now()}`;
    setSentImages(prev => [...prev, {
      id: imageId,
      url: imageUrl,
      fileName: file.name
    }]);
    
    // 发送文件
    if (getConnectState().isPeerConnected && fileTransfer.isConnected) {
      fileTransfer.sendFile(file);
      showToast('图片发送中...', "success");
    } else if (!getConnectState().isPeerConnected) {
      showToast('等待对方加入P2P网络...', "error");
    } else {
      showToast('请先连接到房间', "error");
    }
  };

  // 处理图片选择
  const handleImageSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    handleImageSend(file);
    event.target.value = '';
  };

  // 处理键盘粘贴
  const handlePaste = async (event: React.ClipboardEvent) => {
    const items = event.clipboardData?.items;
    if (!items) return;

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.indexOf('image') !== -1) {
        event.preventDefault();
        const file = item.getAsFile();
        if (file) {
          await handleImageSend(file);
        }
        break;
      }
    }
  };

  // 复制分享链接
  const copyShareLink = () => {
    const baseUrl = window.location.origin + window.location.pathname;
    const shareLink = `${baseUrl}?type=message&mode=receive&code=${pickupCode}`;
    
    navigator.clipboard.writeText(shareLink).then(() => {
      showToast('分享链接已复制', "success");
    }).catch(() => {
      showToast('复制失败，请手动复制', "error");
    });
  };

  // 复制取件码
  const copyCode = () => {
    navigator.clipboard.writeText(pickupCode);
    showToast("取件码已复制", "success");
  };

  const pickupLink = pickupCode ? `${typeof window !== 'undefined' ? window.location.origin : ''}?type=message&mode=receive&code=${pickupCode}` : '';

  return (
    <div className="space-y-6">
      {!pickupCode ? (
        // 创建房间前的界面
        <div className="space-y-6">
          {/* 功能标题和状态 */}
          <div className="flex items-center mb-6">
            <div className="flex items-center space-x-3 flex-1">
              <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-white" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-800">传送文字</h2>
                <p className="text-sm text-slate-600">输入要传输的文本内容</p>
              </div>
            </div>
            
            {/* 连接状态 */}
            <ConnectionStatus 
              currentRoom={pickupCode ? { code: pickupCode, role: 'sender' } : null}
            />
          </div>

          <div className="text-center py-12">
            <div className="w-20 h-20 mx-auto mb-6 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full flex items-center justify-center">
              <MessageSquare className="w-10 h-10 text-blue-500" />
            </div>
            <h3 className="text-lg font-semibold text-slate-800 mb-4">创建文字传输房间</h3>
            <p className="text-slate-600 mb-8">创建房间后可以实时同步文字内容</p>
            
            <Button
              onClick={createRoom}
              disabled={isAnyConnecting}
              className="px-8 py-3 bg-gradient-to-r from-blue-500 to-indigo-500 hover:from-blue-600 hover:to-indigo-600 text-white text-lg font-medium rounded-xl shadow-lg"
            >
              {isAnyConnecting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
                  创建中...
                </>
              ) : (
                <>
                  <Send className="w-5 h-5 mr-2" />
                  创建文字传输房间
                </>
              )}
            </Button>
          </div>
        </div>
      ) : (
        // 房间已创建，显示取件码和文本传输界面
        <div className="space-y-6">
          {/* 功能标题和状态 */}
      {/* 功能标题和状态 */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-teal-500 rounded-xl flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">发送文本</h2>
            <p className="text-sm text-slate-600">输入您想要传输的文本内容</p>
          </div>
        </div>
        
        <ConnectionStatus 
          currentRoom={pickupCode ? { code: pickupCode, role: 'sender' } : null}
        />
      </div>          {/* 文字编辑区域 - 移到最上面 */}
          <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 border border-slate-200">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-lg font-medium text-slate-800 flex items-center">
                <MessageSquare className="w-5 h-5 mr-2" />
                文字内容
              </h4>
              <div className="flex items-center space-x-3 text-sm">
                <span className="text-slate-500">{textInput.length} / 50,000 字符</span>
                {textTransfer.isConnected && (
                  <div className="flex items-center space-x-1 bg-emerald-100 text-emerald-700 px-2 py-1 rounded-md">
                    <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                    <span className="font-medium">WebRTC实时同步</span>
                  </div>
                )}
                {textTransfer.isWebSocketConnected && !textTransfer.isConnected && (
                  <div className="flex items-center space-x-1 bg-blue-100 text-blue-700 px-2 py-1 rounded-md">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                    <span className="font-medium">建立数据通道中</span>
                  </div>
                )}
              </div>
            </div>
            <textarea
              ref={textareaRef}
              value={textInput}
              onChange={handleTextInputChange}
              onPaste={handlePaste}
              disabled={!getConnectState().isPeerConnected}
              placeholder={getConnectState().isPeerConnected 
                ? "在这里编辑文字内容...&#10;&#10;💡 支持实时同步编辑，对方可以看到你的修改&#10;💡 可以直接粘贴图片 (Ctrl+V)"
                : "等待对方加入P2P网络...&#10;&#10;📡 建立连接后即可开始输入文字"
              }
              className={`w-full h-40 px-4 py-3 border rounded-lg resize-none text-slate-700 ${
                getConnectState().isPeerConnected
                  ? "border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent placeholder-slate-400" 
                  : "border-slate-200 bg-slate-50 cursor-not-allowed placeholder-slate-300"
              }`}
            />
            
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center space-x-2">
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  size="sm"
                  disabled={!getConnectState().isPeerConnected}
                  className={`flex items-center space-x-1 ${
                    !getConnectState().isPeerConnected ? 'cursor-not-allowed opacity-50' : ''
                  }`}
                >
                  <Image className="w-4 h-4" />
                  <span>添加图片</span>
                </Button>
                
                {isTyping && (
                  <span className="text-sm text-slate-500 italic">对方正在输入...</span>
                )}
                
                {textTransfer.isConnected && (
                  <div className="flex items-center space-x-1 bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm">
                    <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                    <span className="font-medium">实时同步中</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 发送的图片显示 */}
          {sentImages.length > 0 && (
            <div className="border-t border-slate-200 pt-6">
              <h4 className="text-lg font-semibold text-slate-800 mb-4">已发送的图片</h4>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                {sentImages.map((image) => (
                  <div key={image.id} className="relative">
                    <img 
                      src={image.url} 
                      alt={image.fileName}
                      className="w-full h-32 object-cover rounded-lg border cursor-pointer hover:opacity-80 transition-opacity"
                      onClick={() => onPreviewImage?.(image.url)}
                    />
                    <div className="absolute bottom-1 left-1 right-1 bg-black/50 text-white text-xs px-2 py-1 rounded truncate">
                      {image.fileName}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 取件码显示 */}
          <RoomInfoDisplay
            code={pickupCode}
            link={pickupLink}
            icon={MessageSquare}
            iconColor="from-emerald-500 to-teal-500"
            codeColor="from-emerald-600 to-teal-600"
            title="取件码生成成功！"
            subtitle="分享以下信息给接收方"
            codeLabel="取件码"
            qrLabel="扫码传输"
            copyButtonText="复制取件码"
            copyButtonColor="bg-emerald-500 hover:bg-emerald-600"
            qrButtonText="使用手机扫码快速访问"
            linkButtonText="复制链接"
            onCopyCode={copyCode}
            onCopyLink={copyShareLink}
          />
        </div>
      )}

      {/* 隐藏的文件输入 */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleImageSelect}
        className="hidden"
      />
    </div>
  );
};
