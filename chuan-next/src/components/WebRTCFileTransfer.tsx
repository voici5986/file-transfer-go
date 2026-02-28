"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSharedWebRTCManager, useRoomConnection } from '@/hooks/connection';
import { useFileTransferBusiness, useFileListSync, useFileStateManager } from '@/hooks/file-transfer';
import { useURLHandler } from '@/hooks/ui';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-simple';
import { Upload, Download } from 'lucide-react';
import { WebRTCFileUpload } from '@/components/webrtc/WebRTCFileUpload';
import { WebRTCFileReceive } from '@/components/webrtc/WebRTCFileReceive';
import type { FileInfo } from '@/types';

export const WebRTCFileTransfer: React.FC = () => {
  const { showToast } = useToast();
  
  // 基础状态
  const [mode, setMode] = useState<'send' | 'receive'>('send');
  const [pickupCode, setPickupCode] = useState('');
  const [currentTransferFile, setCurrentTransferFile] = useState<{
    fileId: string;
    fileName: string;
    progress: number;
  } | null>(null);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 创建共享连接
  const connection = useSharedWebRTCManager();
  const stableConnection = useMemo(() => connection, [connection.isConnected, connection.isConnecting, connection.isWebSocketConnected, connection.error]);
  
  // 使用共享连接创建业务层
  const {
    isConnected,
    isConnecting,
    isWebSocketConnected,
    error,
    connect,
    disconnect,
    sendFile,
    sendFileList,
    requestFile: requestFileFromHook,
    onFileReceived,
    onFileListReceived,
    onFileRequested,
    onFileProgress
  } = useFileTransferBusiness(stableConnection);

  // 使用自定义 hooks
  const { syncFileListToReceiver } = useFileListSync({
    sendFileList,
    mode,
    pickupCode,
    isConnected,
    isPeerConnected: connection.isPeerConnected,
    getChannelState: connection.getChannelState
  });

  const {
    selectedFiles,
    setSelectedFiles,
    fileList,
    setFileList,
    downloadedFiles,
    setDownloadedFiles,
    handleFileSelect,
    clearFiles,
    resetFiles,
    updateFileStatus,
    updateFileProgress
  } = useFileStateManager({
    mode,
    pickupCode,
    syncFileListToReceiver,
    isPeerConnected: connection.isPeerConnected
  });

  const { joinRoom: originalJoinRoom } = useRoomConnection({
    connect,
    isConnecting,
    isConnected
  });

  // 包装joinRoom函数以便设置pickupCode
  const joinRoom = useCallback(async (code: string) => {
    setPickupCode(code);
    await originalJoinRoom(code);
  }, [originalJoinRoom]);

  const { updateMode } = useURLHandler({
    featureType: 'webrtc',
    onModeChange: setMode,
    onAutoJoinRoom: joinRoom
  });

  // 创建房间 (发送模式)
  const generateCode = async () => {
    if (selectedFiles.length === 0) {
      showToast("需要选择文件才能创建传输房间", "error");
      return;
    }

    try {
      console.log('=== 创建房间 ===');
      console.log('选中文件数:', selectedFiles.length);
      
      // 创建后端房间 - 简化版本，不发送无用的文件信息
      const response = await fetch('/api/create-room', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        // 不再发送文件列表，因为后端不使用这些信息
        body: JSON.stringify({}),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '创建房间失败');
      }

      const code = data.code;
      console.log('房间创建成功，取件码:', code);
      
      // 先连接WebRTC作为发送方，再设置取件码
      // 这样可以确保UI状态与连接状态同步
      await connect(code, 'sender');
      setPickupCode(code);
      
      showToast(`房间创建成功，取件码: ${code}`, "success");
    } catch (error) {
      console.error('创建房间失败:', error);
      let errorMessage = '创建房间失败';
      
      if (error instanceof Error) {
        if (error.message.includes('network') || error.message.includes('fetch')) {
          errorMessage = '网络连接失败，请检查网络后重试';
        } else if (error.message.includes('timeout')) {
          errorMessage = '请求超时，请重试';
        } else if (error.message.includes('server') || error.message.includes('500')) {
          errorMessage = '服务器错误，请稍后重试';
        } else {
          errorMessage = error.message;
        }
      }
      
      showToast(errorMessage, "error");
    }
  };

  // 重置连接状态 (用于连接失败后重新输入)
  const resetConnection = () => {
    console.log('=== 重置连接状态 ===');
    
    // 断开当前连接
    disconnect();
    
    // 清空状态
    setPickupCode('');
    resetFiles();
    
    // 如果是接收模式，需要手动更新URL
    // URL处理逻辑已经移到 hook 中
  };

  // === 注册所有数据通道回调 ===
  useEffect(() => {
    const cleanups = [
      onFileListReceived((fileInfos: FileInfo[]) => {
        if (mode === 'receive') setFileList(fileInfos);
      }),
      onFileReceived((fileData: { id: string; file: File }) => {
        setDownloadedFiles(prev => new Map(prev.set(fileData.id, fileData.file)));
        updateFileStatus(fileData.id, 'completed', 100);
      }),
      onFileProgress((progressInfo) => {
        if (!isConnected || error) return;
        setCurrentTransferFile({
          fileId: progressInfo.fileId,
          fileName: progressInfo.fileName,
          progress: progressInfo.progress
        });
        updateFileProgress(progressInfo.fileId, progressInfo.fileName, progressInfo.progress);
        if (progressInfo.progress >= 100 && mode === 'send') {
          setCurrentTransferFile(null);
        }
      }),
      onFileRequested((fileId: string, fileName: string) => {
        if (mode !== 'send') return;
        if (!isConnected || error) {
          showToast('连接已断开，无法发送文件', "error");
          return;
        }
        const file = selectedFiles.find(f => f.name === fileName);
        if (!file) {
          showToast(`无法找到文件: ${fileName}`, "error");
          return;
        }
        updateFileStatus(fileId, 'downloading', 0);
        try {
          sendFile(file, fileId);
        } catch (sendError) {
          console.error('发送文件失败:', sendError);
          showToast(`发送文件失败: ${fileName}`, "error");
          updateFileStatus(fileId, 'ready', 0);
        }
      })
    ];
    return () => cleanups.forEach(cleanup => cleanup());
  }, [onFileListReceived, onFileReceived, onFileProgress, onFileRequested,
      mode, isConnected, error, selectedFiles, sendFile, showToast,
      updateFileStatus, updateFileProgress]);

  // === 错误处理和连接状态清理 ===
  const lastErrorRef = useRef<string>('');
  useEffect(() => {
    // 处理新错误
    if (error && error !== lastErrorRef.current) {
      lastErrorRef.current = error;
      const errorMap: [string, string][] = [
        ['WebSocket', '服务器连接失败，请检查网络连接或稍后重试'],
        ['数据通道', '数据通道连接失败，请重新尝试连接'],
        ['连接超时', '连接超时，请检查网络状况或重新尝试'],
        ['连接失败', 'WebRTC连接失败，可能是网络环境限制，请尝试刷新页面'],
        ['信令错误', '信令服务器错误，请稍后重试'],
        ['创建连接失败', '无法建立P2P连接，请检查网络设置'],
      ];
      const matched = errorMap.find(([key]) => error.includes(key));
      showToast(matched ? matched[1] : error, "error");
    }

    // 连接断开时清理传输状态
    const isDisconnected = pickupCode && !isConnecting && (!isConnected || error);
    if (isDisconnected && (fileList.length > 0 || currentTransferFile)) {
      if (!error && !isWebSocketConnected) {
        showToast('与服务器的连接已断开，请重新连接', "error");
      }
      setCurrentTransferFile(null);
      setFileList(prev => {
        const hasDownloading = prev.some(item => item.status === 'downloading');
        return hasDownloading
          ? prev.map(item => item.status === 'downloading' ? { ...item, status: 'ready' as const, progress: 0 } : item)
          : prev;
      });
    }
  }, [error, isConnected, isConnecting, isWebSocketConnected, pickupCode, showToast, currentTransferFile, fileList.length]);

  // 请求下载文件（接收方调用）
  const requestFile = (fileId: string) => {
    if (mode !== 'receive') {
      console.error('requestFile只能在接收模式下调用');
      return;
    }

    // 检查连接状态
    if (!isConnected || error) {
      showToast('连接已断开，请重新连接后再试', "error");
      return;
    }

    const fileInfo = fileList.find(f => f.id === fileId);
    if (!fileInfo) {
      console.error('找不到文件信息:', fileId);
      showToast('找不到文件信息', "error");
      return;
    }
    
    console.log('=== 开始请求文件 ===');
    console.log('文件信息:', { name: fileInfo.name, id: fileId, size: fileInfo.size });
    console.log('当前文件状态:', fileInfo.status);
    console.log('WebRTC连接状态:', { isConnected, isTransferring: !!currentTransferFile });
    
    // 更新文件状态为下载中
    setFileList(prev => {
      const updated = prev.map(item => 
        item.id === fileId 
          ? { ...item, status: 'downloading' as const, progress: 0 }
          : item
      );
      console.log('更新后的文件列表:', updated.find(f => f.id === fileId));
      return updated;
    });
    
    // 使用hook的requestFile功能
    console.log('调用hook的requestFile...');
    try {
      requestFileFromHook(fileId, fileInfo.name);
      // 移除不必要的Toast - 请求状态在UI中已经显示
    } catch (requestError) {
      console.error('请求文件失败:', requestError);
      showToast(`请求文件失败: ${fileInfo.name}`, "error");
      
      // 重置文件状态
      setFileList(prev => prev.map(item => 
        item.id === fileId 
          ? { ...item, status: 'ready' as const, progress: 0 }
          : item
      ));
    }
  };

  // 复制取件码
  const copyCode = () => {
    navigator.clipboard.writeText(pickupCode);
    showToast("取件码已复制", "success");
  };

  // 复制链接
  const copyLink = () => {
    const link = `${window.location.origin}?type=webrtc&mode=receive&code=${pickupCode}`;
    navigator.clipboard.writeText(link);
    showToast("取件链接已复制", "success");
  };

  // 重置状态
  const resetRoom = () => {
    console.log('=== 重置房间 ===');
    disconnect();
    setPickupCode('');
    setSelectedFiles([]);
    setFileList([]);
    setDownloadedFiles(new Map());
  };

  // 添加更多文件
  const addMoreFiles = () => {
    fileInputRef.current?.click();
  };

  // 下载文件到本地
  const downloadFile = (fileId: string) => {
    const file = downloadedFiles.get(fileId);
    if (!file) return;
    
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    showToast(`${file.name} 已保存到下载文件夹`, "success");
  };

  // 处理下载请求（接收模式）
  const handleDownloadRequest = (fileId: string) => {
    const file = downloadedFiles.get(fileId);
    if (file) {
      // 文件已下载完成，保存到本地
      downloadFile(fileId);
    } else {
      // 文件未下载，请求传输
      requestFile(fileId);
    }
  };

  const pickupLink = pickupCode ? `${typeof window !== 'undefined' ? window.location.origin : ''}?type=webrtc&mode=receive&code=${pickupCode}` : '';

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 模式切换 */}
      <div className="flex justify-center mb-6">
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-1 shadow-lg">
          <Button
            variant={mode === 'send' ? 'default' : 'ghost'}
            onClick={() => updateMode('send')}
            className="px-6 py-2 rounded-lg"
          >
            <Upload className="w-4 h-4 mr-2" />
            发送文件
          </Button>
          <Button
            variant={mode === 'receive' ? 'default' : 'ghost'}
            onClick={() => updateMode('receive')}
            className="px-6 py-2 rounded-lg"
          >
            <Download className="w-4 h-4 mr-2" />
            接收文件
          </Button>
        </div>
      </div>

      {mode === 'send' ? (
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 sm:p-6 shadow-lg border border-white/20 animate-fade-in-up">
          {/* 连接状态显示 */}

          <WebRTCFileUpload
            selectedFiles={selectedFiles}
            fileList={fileList}
            onFilesChange={setSelectedFiles}
            onGenerateCode={generateCode}
            pickupCode={pickupCode}
            pickupLink={pickupLink}
            onCopyCode={copyCode}
            onCopyLink={copyLink}
            onAddMoreFiles={addMoreFiles}
            onRemoveFile={setSelectedFiles}
            onClearFiles={clearFiles}
            onReset={resetRoom}
            disabled={!!currentTransferFile}
          />
        </div>
      ) : (
        <div className="bg-white/80 backdrop-blur-sm rounded-xl p-4 sm:p-6 shadow-lg border border-white/20 animate-fade-in-up">
         
          
          <WebRTCFileReceive
            onJoinRoom={joinRoom}
            files={fileList}
            onDownloadFile={handleDownloadRequest}
            isConnected={isConnected}
            isConnecting={isConnecting}
            isWebSocketConnected={isWebSocketConnected}
            downloadedFiles={downloadedFiles}
            error={error}
            onReset={resetConnection}
            pickupCode={pickupCode}
          />
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        multiple
        onChange={(e) => handleFileSelect(Array.from(e.target.files || []))}
        className="hidden"
      />
    </div>
  );
};
