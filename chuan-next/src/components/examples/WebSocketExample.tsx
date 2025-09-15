import React, { useState } from 'react';
import { IWebMessage } from '../../hooks/connection/types';
import { useWebSocketConnection } from '../../hooks/connection/ws/useWebSocketConnection';

/**
 * WebSocket 连接示例组件
 * 展示如何使用 WebSocket 实现的 IWebConnection 接口
 */
export function WebSocketExample() {
  const [roomCode, setRoomCode] = useState('');
  const [role, setRole] = useState<'sender' | 'receiver'>('sender');
  const [message, setMessage] = useState('');
  
  // 使用 WebSocket 连接
  const connection = useWebSocketConnection();
  const state = connection.getConnectState();

  // 连接到房间
  const handleConnect = async () => {
    if (roomCode.trim()) {
      await connection.connect(roomCode.trim(), role);
    }
  };

  // 发送消息
  const handleSendMessage = () => {
    if (message.trim()) {
      connection.sendMessage({
        type: 'text',
        payload: { text: message.trim() }
      });
      setMessage('');
    }
  };

  // 注册消息处理器
  React.useEffect(() => {
    const unsubscribe = connection.registerMessageHandler('text', (msg: IWebMessage) => {
      console.log('收到文本消息:', msg.payload.text);
    });

    return unsubscribe;
  }, [connection]);

  return (
    <div className="p-4 max-w-md mx-auto bg-white rounded-lg shadow">
      <h2 className="text-xl font-bold mb-4">WebSocket 连接示例</h2>
      
      {/* 连接状态 */}
      <div className="mb-4 p-2 bg-gray-100 rounded">
        <p><strong>连接状态:</strong> {state.isConnected ? '已连接' : '未连接'}</p>
        <p><strong>传输类型:</strong> {connection.connectType}</p>
        {state.error && (
          <p className="text-red-600"><strong>错误:</strong> {state.error}</p>
        )}
        {state.currentRoom && (
          <p><strong>房间:</strong> {state.currentRoom.code} ({state.currentRoom.role})</p>
        )}
      </div>

      {/* 连接控制 */}
      {!state.isConnected ? (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">房间代码:</label>
            <input
              type="text"
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded"
              placeholder="输入房间代码"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium mb-1">角色:</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'sender' | 'receiver')}
              className="w-full px-3 py-2 border border-gray-300 rounded"
            >
              <option value="sender">发送方</option>
              <option value="receiver">接收方</option>
            </select>
          </div>
          
          <button
            onClick={handleConnect}
            disabled={state.isConnecting || !roomCode.trim()}
            className="w-full px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {state.isConnecting ? '连接中...' : '连接'}
          </button>
          
          {state.canRetry && (
            <button
              onClick={connection.retry}
              className="w-full px-4 py-2 bg-orange-500 text-white rounded hover:bg-orange-600"
            >
              重试连接
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {/* 消息发送 */}
          <div>
            <label className="block text-sm font-medium mb-1">发送消息:</label>
            <div className="flex space-x-2">
              <input
                type="text"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="flex-1 px-3 py-2 border border-gray-300 rounded"
                placeholder="输入消息内容"
                onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
              />
              <button
                onClick={handleSendMessage}
                disabled={!message.trim()}
                className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
              >
                发送
              </button>
            </div>
          </div>
          
          {/* 断开连接 */}
          <button
            onClick={connection.disconnect}
            className="w-full px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600"
          >
            断开连接
          </button>
        </div>
      )}
      
      {/* 功能说明 */}
      <div className="mt-4 p-2 bg-blue-50 rounded text-sm">
        <p><strong>支持的功能:</strong></p>
        <ul className="list-disc list-inside space-y-1">
          <li>✅ WebSocket 连接管理</li>
          <li>✅ 消息发送和接收</li>
          <li>✅ 二进制数据传输</li>
          <li>✅ 多通道消息处理</li>
          <li>✅ 自动重连机制</li>
          <li>❌ 媒体轨道（WebSocket 不支持）</li>
          <li>❌ P2P 直连（WebSocket 不支持）</li>
        </ul>
      </div>
    </div>
  );
}