import { useState, useCallback, useRef, useEffect } from 'react';
import type { WebRTCConnection } from '../connection/useSharedWebRTCManager';
import type { FileInfo } from '@/types';

// 文件传输状态
interface FileTransferState {
  isConnecting: boolean;
  isConnected: boolean;
  isWebSocketConnected: boolean;
  connectionError: string | null;
  isTransferring: boolean;
  progress: number;
  error: string | null;
  receivedFiles: Array<{ id: string; file: File }>;
}

// 单个文件的接收进度
interface FileReceiveProgress {
  fileId: string;
  fileName: string;
  totalChunks: number;
  progress: number;
  fileSize: number;          // 文件总大小 bytes
  startTime: number;         // 开始接收时间
  lastChunkTime: number;     // 上一个块接收时间
  // 滑动窗口测速
  speedWindowBytes: number;  // 窗口内累计字节数
  speedWindowStart: number;  // 窗口开始时间
  lastReportedSpeed: number; // 上次上报的速度 bytes/s
  lastReportedEta: number;   // 上次上报的 ETA 秒
  lastSpeedReportTime: number; // 上次上报速度的时间
}

// 文件元数据
interface FileMetadata {
  id: string;
  name: string;
  size: number;
  type: string;
}

// 文件块信息
interface FileChunk {
  fileId: string;
  chunkIndex: number;
  totalChunks: number;
  checksum?: string; // 数据校验和
}

// 块确认信息
interface ChunkAck {
  fileId: string;
  chunkIndex: number;
  success: boolean;
  checksum?: string;
}

// 传输状态
interface TransferStatus {
  fileId: string;
  fileName: string;
  totalChunks: number;
  sentChunks: Set<number>;
  acknowledgedChunks: Set<number>;
  failedChunks: Set<number>;
  lastChunkTime: number;
  retryCount: Map<number, number>;
  averageSpeed: number; // KB/s
  // 滑动窗口测速
  speedWindowBytes: number;  // 窗口内累计字节数
  speedWindowStart: number;  // 窗口开始时间
  lastReportedSpeed: number; // 上次上报的速度 bytes/s
  lastReportedEta: number;   // 上次上报的 ETA 秒
  lastSpeedReportTime: number; // 上次上报速度的时间
}

// 回调类型
type FileReceivedCallback = (fileData: { id: string; file: File }) => void;
type FileRequestedCallback = (fileId: string, fileName: string) => void;
type FileProgressCallback = (progressInfo: { fileId: string; fileName: string; progress: number; speed?: number; eta?: number }) => void;
type FileListReceivedCallback = (fileList: FileInfo[]) => void;

const CHANNEL_NAME = 'file-transfer';
const CHUNK_SIZE = 256 * 1024; // 256KB — WebRTC DataChannel 单次发送上限
const MAX_RETRIES = 5; // 最大重试次数（仅用于连接恢复）
const RETRY_DELAY = 1000; // 重试延迟（毫秒）
const ACK_TIMEOUT = 5000; // 完成确认超时（毫秒）
const SPEED_WINDOW_MS = 2000; // 速度计算滑动窗口 2 秒
const SPEED_REPORT_INTERVAL_MS = 1000; // 速度上报最小间隔 1 秒
const BUFFER_HIGH_WATER = 2 * 1024 * 1024; // 2MB — 发送背压阈值
const PROGRESS_LOG_INTERVAL = 50; // 每 50 个块打印一次日志

/**
 * 文件传输业务层
 * 必须传入共享的 WebRTC 连接
 */
export function useFileTransferBusiness(connection: WebRTCConnection) {

  const [state, setState] = useState<FileTransferState>({
    isConnecting: false,
    isConnected: false,
    isWebSocketConnected: false,
    connectionError: null,
    isTransferring: false,
    progress: 0,
    error: null,
    receivedFiles: [],
  });

  // 接收文件缓存
  const receivingFiles = useRef<Map<string, {
    metadata: FileMetadata;
    chunks: ArrayBuffer[];
    receivedChunks: number;
  }>>(new Map());

  // 当前期望的文件块
  const expectedChunk = useRef<FileChunk | null>(null);

  // 回调存储
  const fileReceivedCallbacks = useRef<Set<FileReceivedCallback>>(new Set());
  const fileRequestedCallbacks = useRef<Set<FileRequestedCallback>>(new Set());
  const fileProgressCallbacks = useRef<Set<FileProgressCallback>>(new Set());
  const fileListCallbacks = useRef<Set<FileListReceivedCallback>>(new Set());

  // 传输状态管理
  const transferStatus = useRef<Map<string, TransferStatus>>(new Map());

  // 接收文件进度跟踪
  const receiveProgress = useRef<Map<string, FileReceiveProgress>>(new Map());
  const activeReceiveFile = useRef<string | null>(null);

  const updateState = useCallback((updates: Partial<FileTransferState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  // 消息处理器
  const handleMessage = useCallback((message: any) => {
    if (!message.type.startsWith('file-')) return;

    console.log('文件传输收到消息:', message.type); switch (message.type) {
      case 'file-metadata':
        const metadata: FileMetadata = message.payload;
        console.log('开始接收文件:', metadata.name);

        receivingFiles.current.set(metadata.id, {
          metadata,
          chunks: [],
          receivedChunks: 0,
        });

        // 初始化接收进度跟踪
        const totalChunks = Math.ceil(metadata.size / CHUNK_SIZE);
        const nowInit = Date.now();
        receiveProgress.current.set(metadata.id, {
          fileId: metadata.id,
          fileName: metadata.name,
          totalChunks,
          progress: 0,
          fileSize: metadata.size,
          startTime: nowInit,
          lastChunkTime: nowInit,
          speedWindowBytes: 0,
          speedWindowStart: nowInit,
          lastReportedSpeed: 0,
          lastReportedEta: 0,
          lastSpeedReportTime: 0
        });

        // 设置当前活跃的接收文件
        activeReceiveFile.current = metadata.id;
        updateState({ isTransferring: true, progress: 0 });
        break;

      case 'file-chunk-info':
        expectedChunk.current = message.payload;
        console.log('准备接收文件块:', message.payload);
        break;

      case 'file-complete':
        const { fileId } = message.payload;
        const fileInfo = receivingFiles.current.get(fileId);

        if (fileInfo) {
          // 组装文件
          const blob = new Blob(fileInfo.chunks, { type: fileInfo.metadata.type });
          const file = new File([blob], fileInfo.metadata.name, {
            type: fileInfo.metadata.type
          });

          console.log('文件接收完成:', file.name);

          setState(prev => ({
            ...prev,
            receivedFiles: [...prev.receivedFiles, { id: fileId, file }],
            isTransferring: false,
            progress: 100
          }));

          fileReceivedCallbacks.current.forEach(cb => cb({ id: fileId, file }));
          receivingFiles.current.delete(fileId);
          receiveProgress.current.delete(fileId);

          // 清除活跃文件
          if (activeReceiveFile.current === fileId) {
            activeReceiveFile.current = null;
          }
        }
        break;

      case 'file-list':
        console.log('收到文件列表:', message.payload);
        fileListCallbacks.current.forEach(cb => cb(message.payload));
        break;

      case 'file-request':
        const { fileId: requestedFileId, fileName } = message.payload;
        console.log('收到文件请求:', fileName, requestedFileId);
        fileRequestedCallbacks.current.forEach(cb => cb(requestedFileId, fileName));
        break;

      case 'file-chunk-ack':
        const ack: ChunkAck = message.payload;
        console.log('收到块确认:', ack);

        // 清除超时定时器
      case 'file-chunk-ack':
        // 保留消息处理以兼容旧版对端，但不再依赖逐块 ACK 做可靠性
        break;
    }
  }, [updateState]);

  // 处理文件块数据 — 流式接收，无 CRC32（SCTP 已保证完整性）
  const handleData = useCallback((data: ArrayBuffer) => {
    if (!expectedChunk.current) {
      console.warn('收到数据但没有对应的块信息');
      return;
    }

    const { fileId, chunkIndex } = expectedChunk.current;
    const fileInfo = receivingFiles.current.get(fileId);

    if (fileInfo) {
      // 检查是否已经接收过这个块，避免重复计数
      const alreadyReceived = fileInfo.chunks[chunkIndex] !== undefined;
      
      // 保存到缓存
      fileInfo.chunks[chunkIndex] = data;
      
      if (!alreadyReceived) {
        fileInfo.receivedChunks++;
      }

      // 更新接收进度跟踪
      const progressInfo = receiveProgress.current.get(fileId);
      if (progressInfo) {
        progressInfo.progress = progressInfo.totalChunks > 0 ?
          (fileInfo.receivedChunks / progressInfo.totalChunks) * 100 : 0;

        // 滑动窗口累计字节
        const now = Date.now();
        progressInfo.speedWindowBytes += data.byteLength;
        progressInfo.lastChunkTime = now;

        const windowElapsed = now - progressInfo.speedWindowStart;

        if (windowElapsed >= SPEED_WINDOW_MS && windowElapsed > 0) {
          const speedBps = (progressInfo.speedWindowBytes / windowElapsed) * 1000;
          const receivedBytes = fileInfo.receivedChunks * CHUNK_SIZE;
          const remainingBytes = Math.max(0, progressInfo.fileSize - receivedBytes);
          const eta = speedBps > 0 ? remainingBytes / speedBps : 0;
          progressInfo.speedWindowBytes = 0;
          progressInfo.speedWindowStart = now;
          progressInfo.lastReportedSpeed = speedBps;
          progressInfo.lastReportedEta = Math.max(0, eta);
        }

        // 只有当这个文件是当前活跃文件时才更新全局进度
        if (activeReceiveFile.current === fileId) {
          updateState({ progress: progressInfo.progress });
        }

        // 节流上报
        const timeSinceLastReport = now - progressInfo.lastSpeedReportTime;
        const reportSpeed = timeSinceLastReport >= SPEED_REPORT_INTERVAL_MS;

        fileProgressCallbacks.current.forEach(cb => cb({
          fileId: fileId,
          fileName: progressInfo.fileName,
          progress: progressInfo.progress,
          speed: reportSpeed ? progressInfo.lastReportedSpeed : undefined,
          eta: reportSpeed ? progressInfo.lastReportedEta : undefined
        }));

        if (reportSpeed) {
          progressInfo.lastSpeedReportTime = now;
        }

        // 稀疏日志
        if (fileInfo.receivedChunks % PROGRESS_LOG_INTERVAL === 0) {
          console.log(`接收 ${progressInfo.fileName}: ${progressInfo.progress.toFixed(1)}%`);
        }
      }

      expectedChunk.current = null;
    }
  }, [updateState]);

  const connectionRef = useRef(connection);
  useEffect(() => {
    connectionRef.current = connection;
  }, [connection]);

  useEffect(() => {
    // 使用共享连接的注册方式
    const unregisterMessage = connectionRef.current.registerMessageHandler(CHANNEL_NAME, handleMessage);
    const unregisterData = connectionRef.current.registerDataHandler(CHANNEL_NAME, handleData);

    return () => {
      unregisterMessage();
      unregisterData();
    };
  }, []); // 只依赖 connection 对象，不依赖处理函数

  // 监听连接状态变化 (直接使用 connection 的状态)
  useEffect(() => {
    // 同步连接状态
    updateState({
      isConnecting: connection.isConnecting,
      isConnected: connection.isConnected,
      isWebSocketConnected: connection.isWebSocketConnected,
      connectionError: connection.error
    });
  }, [connection.isConnecting, connection.isConnected, connection.isWebSocketConnected, connection.error, updateState]);

  // 连接
  const connect = useCallback((roomCode: string, role: 'sender' | 'receiver') => {
    return connection.connect(roomCode, role);
  }, [connection]);

  // 安全发送文件 — 流式传输 + bufferedAmount 背压控制
  // DataChannel ordered+reliable 模式下 SCTP 保证按序可靠交付，无需逐块 ACK
  const sendFileSecure = useCallback(async (file: File, fileId?: string) => {
    if (connection.getChannelState() !== 'open') {
      updateState({ error: '连接未就绪' });
      return;
    }

    const actualFileId = fileId || `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    console.log('开始安全发送文件:', file.name, '文件ID:', actualFileId, '总块数:', totalChunks);

    updateState({ isTransferring: true, progress: 0, error: null });

    // 初始化传输状态
    const nowInit = Date.now();
    const status: TransferStatus = {
      fileId: actualFileId,
      fileName: file.name,
      totalChunks,
      sentChunks: new Set(),
      acknowledgedChunks: new Set(),
      failedChunks: new Set(),
      lastChunkTime: nowInit,
      retryCount: new Map(),
      averageSpeed: 0,
      speedWindowBytes: 0,
      speedWindowStart: nowInit,
      lastReportedSpeed: 0,
      lastReportedEta: 0,
      lastSpeedReportTime: 0
    };
    transferStatus.current.set(actualFileId, status);

    try {
      // 1. 发送文件元数据
      connection.sendMessage({
        type: 'file-metadata',
        payload: {
          id: actualFileId,
          name: file.name,
          size: file.size,
          type: file.type
        }
      }, CHANNEL_NAME);

      // 2. 流式分块发送 — 使用 bufferedAmount 背压控制，不等待逐块 ACK
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        // 检查数据通道状态
        const channelState = connection.getChannelState();
        if (channelState === 'closed') {
          throw new Error('数据通道已关闭');
        }

        // 背压控制：等待缓冲区排空到阈值以下
        await connection.waitForBufferDrain(BUFFER_HIGH_WATER);

        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);
        const arrayBuffer = await chunk.arrayBuffer();

        // 发送块信息（不含校验和 — SCTP 层保证完整性）
        connection.sendMessage({
          type: 'file-chunk-info',
          payload: {
            fileId: actualFileId,
            chunkIndex,
            totalChunks
          }
        }, CHANNEL_NAME);

        // 发送块数据
        connection.sendData(arrayBuffer);

        // 标记已发送
        status.sentChunks.add(chunkIndex);

        // 滑动窗口测速
        const now = Date.now();
        status.speedWindowBytes += arrayBuffer.byteLength;
        const windowElapsed = now - status.speedWindowStart;

        if (windowElapsed >= SPEED_WINDOW_MS && windowElapsed > 0) {
          const speedBps = (status.speedWindowBytes / windowElapsed) * 1000;
          status.averageSpeed = speedBps / 1024;
          status.lastReportedSpeed = speedBps;
          const remainingBytes = Math.max(0, file.size - (chunkIndex + 1) * CHUNK_SIZE);
          status.lastReportedEta = speedBps > 0 ? Math.max(0, remainingBytes / speedBps) : 0;
          status.speedWindowBytes = 0;
          status.speedWindowStart = now;
        }
        status.lastChunkTime = now;

        // 更新进度
        const progress = ((chunkIndex + 1) / totalChunks) * 100;
        updateState({ progress });

        // 节流上报速度/ETA
        const timeSinceLastReport = now - status.lastSpeedReportTime;
        const reportSpeed = timeSinceLastReport >= SPEED_REPORT_INTERVAL_MS;

        fileProgressCallbacks.current.forEach(cb => cb({
          fileId: actualFileId,
          fileName: file.name,
          progress,
          speed: reportSpeed ? status.lastReportedSpeed : undefined,
          eta: reportSpeed ? status.lastReportedEta : undefined
        }));

        if (reportSpeed) {
          status.lastSpeedReportTime = now;
        }

        // 稀疏日志
        if (chunkIndex % PROGRESS_LOG_INTERVAL === 0 || chunkIndex === totalChunks - 1) {
          console.log(`发送进度 ${chunkIndex + 1}/${totalChunks} (${progress.toFixed(1)}%)`);
        }
      }

      // 3. 等待缓冲区完全排空，确保所有数据已发出
      await connection.waitForBufferDrain(0);

      // 4. 发送完成信号
      connection.sendMessage({
        type: 'file-complete',
        payload: { fileId: actualFileId }
      }, CHANNEL_NAME);

      updateState({ isTransferring: false, progress: 100 });
      const totalTime = (Date.now() - status.speedWindowStart) / 1000 || 1;
      console.log(`文件发送完成: ${file.name}, 平均速度: ${(file.size / 1024 / totalTime).toFixed(0)} KB/s`);
      transferStatus.current.delete(actualFileId);

    } catch (error) {
      console.error('安全发送文件失败:', error);
      updateState({
        error: error instanceof Error ? error.message : '发送失败',
        isTransferring: false
      });
      transferStatus.current.delete(actualFileId);
    }
  }, [connection, updateState]);

  // 保持原有的 sendFile 方法用于向后兼容
  const sendFile = useCallback(async (file: File, fileId?: string) => {
    // 默认使用新的安全发送方法
    return sendFileSecure(file, fileId);
  }, [sendFileSecure]);

  // 发送文件列表
  const sendFileList = useCallback((fileList: FileInfo[]) => {
    // 检查连接状态 - 优先检查数据通道状态，因为 P2P 连接可能已经建立但状态未及时更新
    const channelState = connection.getChannelState();
    const peerConnected = connection.isPeerConnected;

    console.log('发送文件列表检查:', {
      channelState,
      peerConnected,
      fileListLength: fileList.length
    });

    // 如果数据通道已打开或者 P2P 已连接，就可以发送文件列表
    if (channelState === 'open' || peerConnected) {
      console.log('发送文件列表:', fileList);

      connection.sendMessage({
        type: 'file-list',
        payload: fileList
      }, CHANNEL_NAME);
    } else {
      console.log('P2P连接未建立，等待连接后再发送文件列表');
    }
  }, [connection]);

  // 请求文件
  const requestFile = useCallback((fileId: string, fileName: string) => {
    if (connection.getChannelState() !== 'open') {
      console.error('数据通道未准备就绪，无法请求文件');
      return;
    }

    console.log('请求文件:', fileName, fileId);

    connection.sendMessage({
      type: 'file-request',
      payload: { fileId, fileName }
    }, CHANNEL_NAME);
  }, [connection]);

  // 注册回调函数
  const onFileReceived = useCallback((callback: FileReceivedCallback) => {
    fileReceivedCallbacks.current.add(callback);
    return () => { fileReceivedCallbacks.current.delete(callback); };
  }, []);

  const onFileRequested = useCallback((callback: FileRequestedCallback) => {
    fileRequestedCallbacks.current.add(callback);
    return () => { fileRequestedCallbacks.current.delete(callback); };
  }, []);

  const onFileProgress = useCallback((callback: FileProgressCallback) => {
    fileProgressCallbacks.current.add(callback);
    return () => { fileProgressCallbacks.current.delete(callback); };
  }, []);

  const onFileListReceived = useCallback((callback: FileListReceivedCallback) => {
    fileListCallbacks.current.add(callback);
    return () => { fileListCallbacks.current.delete(callback); };
  }, []);

  return {
    // 文件传输状态（包括连接状态）
    ...state,

    // 操作方法
    connect,
    disconnect: connection.disconnect,
    sendFile,
    sendFileList,
    requestFile,

    // 回调注册
    onFileReceived,
    onFileRequested,
    onFileProgress,
    onFileListReceived,
  };
}
