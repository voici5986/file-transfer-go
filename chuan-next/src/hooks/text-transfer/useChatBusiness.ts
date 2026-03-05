import { useState, useCallback, useRef, useEffect } from 'react';
import type { WebRTCConnection } from '../connection/types';

// ── 类型定义 ──

export interface ChatMessage {
  id: string;
  type: 'text' | 'image';
  content: string;           // 文本内容 或 blob URL (图片)
  timestamp: number;
  sender: 'me' | 'peer';
  status: 'sending' | 'sent' | 'failed';
  fileName?: string;         // 图片文件名
}

interface ImageAssembly {
  messageId: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  totalChunks: number;
  receivedChunks: Map<number, string>;
  timestamp: number;
}

// ── 常量 ──

const CHANNEL_NAME = 'chat';
const IMAGE_CHUNK_SIZE = 64 * 1024;   // 64KB raw → ~85KB base64 per chunk
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5MB
const TYPING_TIMEOUT_MS = 2000;

// ── 工具函数 ──

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunks: string[] = [];
  // 分批处理避免 call stack 溢出
  const BATCH = 8192;
  for (let i = 0; i < bytes.length; i += BATCH) {
    const slice = bytes.subarray(i, i + BATCH);
    chunks.push(String.fromCharCode(...slice));
  }
  return btoa(chunks.join(''));
}

function base64ToBlob(base64: string, mimeType: string): Blob {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return new Blob([bytes], { type: mimeType });
}

// ── Hook ──

export function useChatBusiness(connection: WebRTCConnection) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peerTyping, setPeerTyping] = useState(false);

  // 图片分块组装缓冲区
  const imageAssemblyRef = useRef<Map<string, ImageAssembly>>(new Map());
  // 打字状态定时器
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // 对方打字状态超时清除
  const peerTypingTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // ── 接收消息处理 ──

  const handleMessage = useCallback((message: any) => {
    const { type, payload } = message;

    switch (type) {
      // ── 文本消息 ──
      case 'chat-text': {
        const newMsg: ChatMessage = {
          id: payload.id,
          type: 'text',
          content: payload.content,
          timestamp: payload.timestamp,
          sender: 'peer',
          status: 'sent',
        };
        setMessages(prev => [...prev, newMsg]);
        break;
      }

      // ── 打字状态 ──
      case 'chat-typing': {
        setPeerTyping(payload.typing);
        // 自动清除打字状态（防止对方异常断开后一直显示）
        if (payload.typing) {
          if (peerTypingTimeoutRef.current) clearTimeout(peerTypingTimeoutRef.current);
          peerTypingTimeoutRef.current = setTimeout(() => setPeerTyping(false), 5000);
        }
        break;
      }

      // ── 图片传输开始 ──
      case 'chat-image-start': {
        const { id, fileName, fileSize, mimeType, totalChunks, timestamp } = payload;
        imageAssemblyRef.current.set(id, {
          messageId: id,
          fileName,
          mimeType,
          fileSize,
          totalChunks,
          receivedChunks: new Map(),
          timestamp,
        });

        // 添加占位消息（显示加载状态）
        const placeholderMsg: ChatMessage = {
          id,
          type: 'image',
          content: '', // 空 content 表示加载中
          timestamp,
          sender: 'peer',
          status: 'sending',
          fileName,
        };
        setMessages(prev => [...prev, placeholderMsg]);
        break;
      }

      // ── 图片分块数据 ──
      case 'chat-image-chunk': {
        const { id, chunkIndex, data } = payload;
        const assembly = imageAssemblyRef.current.get(id);
        if (!assembly) break;

        assembly.receivedChunks.set(chunkIndex, data);

        // 检查是否接收完全
        if (assembly.receivedChunks.size === assembly.totalChunks) {
          // 按顺序拼接 base64
          const sortedChunks = Array.from(assembly.receivedChunks.entries())
            .sort(([a], [b]) => a - b)
            .map(([, d]) => d);
          const base64Full = sortedChunks.join('');

          // 转换为 Blob URL
          const blob = base64ToBlob(base64Full, assembly.mimeType);
          const blobUrl = URL.createObjectURL(blob);

          // 更新占位消息
          setMessages(prev =>
            prev.map(m =>
              m.id === id ? { ...m, content: blobUrl, status: 'sent' as const } : m
            )
          );

          imageAssemblyRef.current.delete(id);
        }
        break;
      }
    }
  }, []);

  // 注册消息处理器
  const registerMessageHandler = connection.registerMessageHandler;
  useEffect(() => {
    return registerMessageHandler(CHANNEL_NAME, handleMessage);
  }, [registerMessageHandler, handleMessage]);

  // ── 发送文本消息 ──

  const sendTextMessage = useCallback((text: string) => {
    const trimmed = text.trim();
    if (!trimmed || !connection.isPeerConnected) return;

    const id = generateId('msg');
    const timestamp = Date.now();

    // 本地添加
    setMessages(prev => [...prev, {
      id,
      type: 'text',
      content: trimmed,
      timestamp,
      sender: 'me',
      status: 'sent',
    }]);

    // 发送到对方
    connection.sendMessage({
      type: 'chat-text',
      payload: { id, content: trimmed, timestamp },
    }, CHANNEL_NAME);

    // 停止打字状态
    connection.sendMessage({
      type: 'chat-typing',
      payload: { typing: false },
    }, CHANNEL_NAME);
  }, [connection]);

  // ── 发送图片 ──

  const sendImage = useCallback(async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    if (file.size > MAX_IMAGE_SIZE) return;
    if (!connection.isPeerConnected) return;

    const id = generateId('img');
    const timestamp = Date.now();

    // 本地预览（立即显示）
    const localUrl = URL.createObjectURL(file);
    setMessages(prev => [...prev, {
      id,
      type: 'image',
      content: localUrl,
      timestamp,
      sender: 'me',
      status: 'sending',
      fileName: file.name,
    }]);

    try {
      // 读取文件为 base64
      const arrayBuffer = await file.arrayBuffer();
      const base64Full = arrayBufferToBase64(arrayBuffer);

      // 分块
      const CHUNK_STR_SIZE = Math.ceil(IMAGE_CHUNK_SIZE * 4 / 3); // base64 编码后的块大小
      const chunks: string[] = [];
      for (let i = 0; i < base64Full.length; i += CHUNK_STR_SIZE) {
        chunks.push(base64Full.slice(i, i + CHUNK_STR_SIZE));
      }

      // 发送开始标记
      connection.sendMessage({
        type: 'chat-image-start',
        payload: {
          id,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type,
          totalChunks: chunks.length,
          timestamp,
        },
      }, CHANNEL_NAME);

      // 逐块发送（带流控）
      for (let i = 0; i < chunks.length; i++) {
        // 等待缓冲区排空
        await connection.waitForBufferDrain(256 * 1024);

        connection.sendMessage({
          type: 'chat-image-chunk',
          payload: { id, chunkIndex: i, data: chunks[i] },
        }, CHANNEL_NAME);
      }

      // 更新本地状态
      setMessages(prev =>
        prev.map(m => m.id === id ? { ...m, status: 'sent' as const } : m)
      );
    } catch (error) {
      console.error('[Chat] 图片发送失败:', error);
      setMessages(prev =>
        prev.map(m => m.id === id ? { ...m, status: 'failed' as const } : m)
      );
    }
  }, [connection]);

  // ── 打字状态通知 ──

  const sendTypingStatus = useCallback(() => {
    if (!connection.isPeerConnected) return;

    connection.sendMessage({
      type: 'chat-typing',
      payload: { typing: true },
    }, CHANNEL_NAME);

    // 自动停止打字状态
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      if (connection.isPeerConnected) {
        connection.sendMessage({
          type: 'chat-typing',
          payload: { typing: false },
        }, CHANNEL_NAME);
      }
    }, TYPING_TIMEOUT_MS);
  }, [connection]);

  // ── 清理 ──

  const clearMessages = useCallback(() => {
    messages.forEach(m => {
      if (m.type === 'image' && m.content.startsWith('blob:')) {
        URL.revokeObjectURL(m.content);
      }
    });
    setMessages([]);
    imageAssemblyRef.current.clear();
  }, [messages]);

  // 组件卸载时清理定时器
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
      if (peerTypingTimeoutRef.current) clearTimeout(peerTypingTimeoutRef.current);
    };
  }, []);

  return {
    messages,
    peerTyping,
    sendTextMessage,
    sendImage,
    sendTypingStatus,
    clearMessages,
    isConnected: connection.isConnected,
    isConnecting: connection.isConnecting,
    isWebSocketConnected: connection.isWebSocketConnected,
    isPeerConnected: connection.isPeerConnected,
    connectionError: connection.error,
  };
}
