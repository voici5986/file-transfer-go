import { useState, useCallback, useEffect } from 'react';

interface FileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'ready' | 'downloading' | 'completed';
  progress: number;
  transferSpeed?: number; // bytes per second
  startTime?: number; // 传输开始时间
}

interface UseFileStateManagerProps {
  mode: 'send' | 'receive';
  pickupCode: string;
  syncFileListToReceiver: (fileInfos: FileInfo[], reason: string) => void;
  isPeerConnected: boolean;
}

export const useFileStateManager = ({
  mode,
  pickupCode,
  syncFileListToReceiver,
  isPeerConnected
}: UseFileStateManagerProps) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileList, setFileList] = useState<FileInfo[]>([]);
  const [downloadedFiles, setDownloadedFiles] = useState<Map<string, File>>(new Map());

  // 生成文件ID
  const generateFileId = useCallback(() => {
    return Date.now().toString(36) + Math.random().toString(36).substr(2);
  }, []);

  // 文件选择处理
  const handleFileSelect = useCallback((files: File[]) => {
    console.log('=== 文件选择 ===');
    console.log('新文件:', files.map(f => f.name));
    
    // 更新选中的文件
    setSelectedFiles(prev => [...prev, ...files]);
    
    // 创建对应的文件信息
    const newFileInfos: FileInfo[] = files.map(file => ({
      id: generateFileId(),
      name: file.name,
      size: file.size,
      type: file.type,
      status: 'ready',
      progress: 0
    }));
    
    setFileList(prev => {
      const updatedList = [...prev, ...newFileInfos];
      console.log('更新后的文件列表:', updatedList);
      return updatedList;
    });
  }, [generateFileId]);

  // 清空文件
  const clearFiles = useCallback(() => {
    console.log('=== 清空文件 ===');
    setSelectedFiles([]);
    setFileList([]);
  }, []);

  // 重置状态
  const resetFiles = useCallback(() => {
    console.log('=== 重置文件状态 ===');
    setSelectedFiles([]);
    setFileList([]);
    setDownloadedFiles(new Map());
  }, []);

  // 更新文件状态
  const updateFileStatus = useCallback((fileId: string, status: FileInfo['status'], progress?: number, transferSpeed?: number) => {
    setFileList(prev => prev.map(item => 
      item.id === fileId 
        ? { 
            ...item, 
            status, 
            progress: progress ?? item.progress,
            transferSpeed: transferSpeed ?? item.transferSpeed,
            startTime: status === 'downloading' && !item.startTime ? Date.now() : item.startTime
          }
        : item
    ));
  }, []);

  // 更新文件进度
  const updateFileProgress = useCallback((fileId: string, fileName: string, progress: number, transferSpeed?: number) => {
    const newStatus = progress >= 100 ? 'completed' as const : 'downloading' as const;
    setFileList(prev => prev.map(item => {
      if (item.id === fileId || item.name === fileName) {
        console.log(`更新文件 ${item.name} 进度: ${item.progress} -> ${progress}${transferSpeed ? `, 速度: ${transferSpeed} B/s` : ''}`);
        return { 
          ...item, 
          progress, 
          status: newStatus,
          transferSpeed: transferSpeed ?? item.transferSpeed,
          startTime: newStatus === 'downloading' && !item.startTime ? Date.now() : item.startTime
        };
      }
      return item;
    }));
  }, []);

  // 数据通道第一次打开时初始化
  useEffect(() => {
    if (isPeerConnected && mode === 'send' && fileList.length > 0) {
      console.log('P2P连接已建立，数据通道首次打开，初始化文件列表');
      syncFileListToReceiver(fileList, '数据通道初始化');
    }
  }, [isPeerConnected, mode, syncFileListToReceiver]);

  // 监听fileList大小变化并同步
  useEffect(() => {
    if (isPeerConnected && mode === 'send' && pickupCode) {
      console.log('fileList大小变化，同步到接收方:', fileList.length);
      syncFileListToReceiver(fileList, 'fileList大小变化');
    }
  }, [fileList.length, isPeerConnected, mode, pickupCode, syncFileListToReceiver]);

  // 监听selectedFiles变化，同步更新fileList
  useEffect(() => {
    // 只有在发送模式下且已有房间时才处理文件列表同步
    if (mode !== 'send' || !pickupCode) return;

    console.log('=== selectedFiles变化，同步文件列表 ===', {
      selectedFilesCount: selectedFiles.length,
      selectedFileNames: selectedFiles.map(f => f.name)
    });

    // 使用函数式更新获取当前fileList，避免依赖fileList
    setFileList(currentFileList => {
      // 根据selectedFiles创建新的文件信息列表
      const newFileInfos: FileInfo[] = selectedFiles.map(file => {
        // 尝试在当前fileList中找到现有的文件信息，保持已有的状态
        const existingFileInfo = currentFileList.find(info => info.name === file.name && info.size === file.size);
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
        newFileInfos.length !== currentFileList.length ||
        newFileInfos.some(newFile => 
          !currentFileList.find(oldFile => oldFile.name === newFile.name && oldFile.size === newFile.size)
        );

      if (fileListChanged) {
        console.log('文件列表发生变化，更新:', {
          before: currentFileList.map(f => f.name),
          after: newFileInfos.map(f => f.name)
        });
        
        return newFileInfos;
      }

      // 如果没有变化，返回当前的fileList
      return currentFileList;
    });
  }, [selectedFiles, mode, pickupCode, generateFileId]); // 移除fileList依赖，避免无限循环

  return {
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
  };
};
