"use client";

import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast-simple';
import { WebRTCFileReceive } from '@/components/webrtc/WebRTCFileReceive';
import { WebRTCFileUpload } from '@/components/webrtc/WebRTCFileUpload';
import { useConnectionState, useRoomConnection, useSharedWebRTCManager } from '@/hooks/connection';
import { useFileListSync, useFileStateManager, useFileTransferBusiness } from '@/hooks/file-transfer';
import { useURLHandler } from '@/hooks/ui';
import { Download, Upload } from 'lucide-react';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface FileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'ready' | 'downloading' | 'completed';
  progress: number;
}

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
  const stableConnection = useMemo(() => connection, [connection.getConnectState().isConnected, connection.getConnectState().isConnecting, connection.getConnectState().isWebSocketConnected, connection.getConnectState().error]);
  
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
    isPeerConnected: connection.getConnectState().isPeerConnected,
    getChannelState: () => connection.getConnectState().state
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
    isPeerConnected: connection.getConnectState().isPeerConnected
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

  useConnectionState({
    isWebSocketConnected,
    isConnected,
    isConnecting,
    error: error || '',
    pickupCode,
    fileListLength: fileList.length,
    currentTransferFile,
    setCurrentTransferFile,
    updateFileListStatus: setFileList
  });

  // 生成文件ID
  const generateFileId = () => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  };

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

    // 处理文件列表更新
  useEffect(() => {
    const cleanup = onFileListReceived((fileInfos: FileInfo[]) => {
      console.log('=== 收到文件列表更新 ===');
      console.log('文件列表:', fileInfos);
      
      if (mode === 'receive') {
        setFileList(fileInfos);
      }
    });

    return cleanup;
  }, [onFileListReceived, mode]);

  // 处理文件接收
  useEffect(() => {
    const cleanup = onFileReceived((fileData: { id: string; file: File }) => {
      console.log('=== 接收到文件 ===');
      console.log('文件:', fileData.file.name, 'ID:', fileData.id);
      
      // 更新下载的文件
      setDownloadedFiles(prev => new Map(prev.set(fileData.id, fileData.file)));
      
      // 更新文件状态
      updateFileStatus(fileData.id, 'completed', 100);
    });

    return cleanup;
  }, [onFileReceived, updateFileStatus]);

  // 监听文件级别的进度更新
  useEffect(() => {
    const cleanup = onFileProgress((progressInfo) => {
      // 检查连接状态，如果连接断开则忽略进度更新
      if (!isConnected || error) {
        console.log('连接已断开，忽略进度更新:', progressInfo.fileName);
        return;
      }

      console.log('=== 文件进度更新 ===');
      console.log('文件:', progressInfo.fileName, 'ID:', progressInfo.fileId, '进度:', progressInfo.progress);
      
      // 更新当前传输文件信息
      setCurrentTransferFile({
        fileId: progressInfo.fileId,
        fileName: progressInfo.fileName,
        progress: progressInfo.progress
      });
      
      // 更新文件进度
      updateFileProgress(progressInfo.fileId, progressInfo.fileName, progressInfo.progress);
      
      // 当传输完成时清理
      if (progressInfo.progress >= 100 && mode === 'send') {
        setCurrentTransferFile(null);
      }
    });

    return cleanup;
  }, [onFileProgress, mode, isConnected, error, updateFileProgress]);

  // 处理文件请求（发送方监听）
  useEffect(() => {
    const cleanup = onFileRequested((fileId: string, fileName: string) => {
      console.log('=== 收到文件请求 ===');
      console.log('文件:', fileName, 'ID:', fileId, '当前模式:', mode);
      
      if (mode === 'send') {
        // 检查连接状态
        if (!isConnected || error) {
          console.log('连接已断开，无法发送文件');
          showToast('连接已断开，无法发送文件', "error");
          return;
        }

        console.log('当前选中的文件列表:', selectedFiles.map(f => f.name));
        
        // 在发送方的selectedFiles中查找对应文件
        const file = selectedFiles.find(f => f.name === fileName);
        
        if (!file) {
          console.error('找不到匹配的文件:', fileName);
          console.log('可用文件:', selectedFiles.map(f => `${f.name} (${f.size} bytes)`));
          showToast(`无法找到文件: ${fileName}`, "error");
          return;
        }
        
        console.log('找到匹配文件，开始发送:', file.name, 'ID:', fileId, '文件大小:', file.size);
        
        // 更新发送方文件状态为downloading - 统一使用updateFileStatus
        updateFileStatus(fileId, 'downloading', 0);
        
        // 发送文件
        try {
          sendFile(file, fileId);
          
          // 移除不必要的Toast - 传输开始状态在UI中已经显示
        } catch (sendError) {
          console.error('发送文件失败:', sendError);
          showToast(`发送文件失败: ${fileName}`, "error");
          
          // 重置文件状态 - 统一使用updateFileStatus
          updateFileStatus(fileId, 'ready', 0);
        }
      } else {
        console.warn('接收模式下收到文件请求，忽略');
      }
    });

    return cleanup;
  }, [onFileRequested, mode, selectedFiles, sendFile, isConnected, error, showToast, updateFileStatus]);

  // 处理连接错误
  const [lastError, setLastError] = useState<string>('');
  useEffect(() => {
    if (error && error !== lastError) {
      console.log('=== 连接错误处理 ===');
      console.log('错误信息:', error);
      console.log('当前模式:', mode);
      
      // 根据错误类型显示不同的提示
      let errorMessage = error;
      
      if (error.includes('WebSocket')) {
        errorMessage = '服务器连接失败，请检查网络连接或稍后重试';
      } else if (error.includes('数据通道')) {
        errorMessage = '数据通道连接失败，请重新尝试连接';
      } else if (error.includes('连接超时')) {
        errorMessage = '连接超时，请检查网络状况或重新尝试';
      } else if (error.includes('连接失败')) {
        errorMessage = 'WebRTC连接失败，可能是网络环境限制，请尝试刷新页面';
      } else if (error.includes('信令错误')) {
        errorMessage = '信令服务器错误，请稍后重试';
      } else if (error.includes('创建连接失败')) {
        errorMessage = '无法建立P2P连接，请检查网络设置';
      }
      
      // 显示错误提示
      showToast(errorMessage, "error");
      setLastError(error);
      
      // 如果是严重连接错误，清理传输状态
      if (error.includes('连接失败') || error.includes('数据通道连接失败') || error.includes('WebSocket')) {
        console.log('严重连接错误，清理传输状态');
        setCurrentTransferFile(null);
        
        // 重置所有正在传输的文件状态
        setFileList(prev => prev.map(item => 
          item.status === 'downloading' 
            ? { ...item, status: 'ready' as const, progress: 0 }
            : item
        ));
      }
    }
  }, [error, mode, showToast, lastError]);



  // 监听连接状态变化和清理传输状态
  useEffect(() => {
    console.log('=== 连接状态变化 ===');
    console.log('WebSocket连接状态:', isWebSocketConnected);
    console.log('WebRTC连接状态:', isConnected);
    console.log('连接中状态:', isConnecting);
    
    // 当连接断开或有错误时，清理所有传输状态
    const shouldCleanup = (!isWebSocketConnected && !isConnected && !isConnecting && pickupCode) || 
                         ((!isConnected && !isConnecting) || error);
    
    if (shouldCleanup) {
      const hasCurrentTransfer = !!currentTransferFile;
      const hasFileList = fileList.length > 0;
      
      // 只有在之前有连接活动时才显示断开提示和清理状态
      if (hasFileList || hasCurrentTransfer) {
        if (!isWebSocketConnected && pickupCode) {
          showToast('与服务器的连接已断开，请重新连接', "error");
        }
        
        console.log('连接断开，清理传输状态');
        
        if (currentTransferFile) {
          setCurrentTransferFile(null);
        }
        
        // 重置所有正在下载的文件状态
        setFileList(prev => {
          const hasDownloadingFiles = prev.some(item => item.status === 'downloading');
          if (hasDownloadingFiles) {
            console.log('重置正在传输的文件状态');
            return prev.map(item => 
              item.status === 'downloading' 
                ? { ...item, status: 'ready' as const, progress: 0 }
                : item
            );
          }
          return prev;
        });
      }
    }
    
    // WebSocket连接成功时的提示
    if (isWebSocketConnected && isConnecting && !isConnected) {
      console.log('WebSocket已连接，正在建立P2P连接...');
    }
    
  }, [isWebSocketConnected, isConnected, isConnecting, pickupCode, error, showToast, currentTransferFile, fileList.length]);

  // 监听连接状态变化并提供日志
  useEffect(() => {
    console.log('=== WebRTC连接状态变化 ===');
    console.log('连接状态:', {
      isConnected,
      isConnecting,
      isWebSocketConnected,
      pickupCode,
      mode,
      selectedFilesCount: selectedFiles.length,
      fileListCount: fileList.length
    });
  }, [isConnected, connection.getConnectState().isPeerConnected, isConnecting, isWebSocketConnected, pickupCode, mode, selectedFiles.length, fileList.length]);

  // 监听P2P连接建立时的状态变化
  useEffect(() => {
    if (connection.getConnectState().isPeerConnected && mode === 'send' && fileList.length > 0) {
      console.log('P2P连接已建立，数据通道首次打开，初始化文件列表');
      // 数据通道第一次打开时进行初始化
      syncFileListToReceiver(fileList, '数据通道初始化');
    }
  }, [connection.getConnectState().isPeerConnected, mode, syncFileListToReceiver]);

  // 监听fileList大小变化并同步
  useEffect(() => {
    if (connection.getConnectState().isPeerConnected && mode === 'send' && pickupCode) {
      console.log('fileList大小变化，同步到接收方:', fileList.length);
      syncFileListToReceiver(fileList, 'fileList大小变化');
    }
  }, [fileList.length, connection.getConnectState().isPeerConnected, mode, pickupCode, syncFileListToReceiver]);

  // 监听selectedFiles变化，同步更新fileList并发送给接收方
  useEffect(() => {
    // 只有在发送模式下且已有房间时才处理文件列表同步
    if (mode !== 'send' || !pickupCode) return;

    console.log('=== selectedFiles变化，同步文件列表 ===', {
      selectedFilesCount: selectedFiles.length,
      fileListCount: fileList.length,
      selectedFileNames: selectedFiles.map(f => f.name)
    });

    // 根据selectedFiles创建新的文件信息列表
    const newFileInfos: FileInfo[] = selectedFiles.map(file => {
      // 尝试找到现有的文件信息，保持已有的状态
      const existingFileInfo = fileList.find(info => info.name === file.name && info.size === file.size);
      return existingFileInfo || {
        id: generateFileId(),
        name: file.name,
        size: file.size,
        type: file.type,
        status: 'ready' as const,
        progress: 0
      };
    });

    // 检查文件列表是否真正发生变化
    const fileListChanged = 
      newFileInfos.length !== fileList.length ||
      newFileInfos.some(newFile => 
        !fileList.find(oldFile => oldFile.name === newFile.name && oldFile.size === newFile.size)
      );

    if (fileListChanged) {
      console.log('文件列表发生变化，更新:', {
        before: fileList.map(f => f.name),
        after: newFileInfos.map(f => f.name)
      });
      
      setFileList(newFileInfos);
    }
  }, [selectedFiles, mode, pickupCode]);

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
