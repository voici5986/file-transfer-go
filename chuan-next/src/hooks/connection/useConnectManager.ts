import { getWsUrl } from '@/lib/config';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useReadConnectState } from './state/useWebConnectStateManager';
import { WebConnectState } from "./state/webConnectStore";
import { ConnectType, DataHandler, IGetConnectState, IRegisterEventHandler, IWebConnection, IWebMessage, MessageHandler, Role } from "./types";
import { useSharedWebRTCManagerImpl } from './webrtc/useSharedWebRTCManager';
import { useWebSocketConnection } from './ws/useWebSocketConnection';


/**
 * 连接管理器 - 统一管理 WebSocket 和 WebRTC 连接
 * 提供统一的连接接口，内部可以在不同传输方式之间切换
 * 统一管理 WebSocket 连接，为 WebRTC 和 WebSocket 传输提供共享的 WebSocket 实例
 */
export function useConnectManager(): IWebConnection & IRegisterEventHandler & IGetConnectState {
    // 当前连接类型
    const [currentConnectType, setCurrentConnectType] = useState<ConnectType>('webrtc');

    // 统一的 WebSocket 连接引用
    const wsRef = useRef<WebSocket | null>(null);

    // 当前房间信息
    const currentRoomRef = useRef<{ code: string; role: Role } | null>(null);

    // 连接实例 - 初始化时不传入 WebSocket
    const wsConnection = useWebSocketConnection();
    const webrtcConnection = useSharedWebRTCManagerImpl();

    // 当前活跃连接的引用 - 默认使用 WebRTC
    const currentConnectionRef = useRef<IWebConnection>(webrtcConnection);

    const { getConnectState: innerState } = useReadConnectState();

    // 确保连接引用与连接类型保持一致
    useEffect(() => {
        const targetConnection = currentConnectType === 'webrtc' ? webrtcConnection : wsConnection;
        if (currentConnectionRef.current !== targetConnection) {
            console.log('[ConnectManager] 🔄 同步连接引用到:', currentConnectType);
            currentConnectionRef.current = targetConnection;
        }
    }, [currentConnectType, webrtcConnection, wsConnection]);


    // 连接状态管理
    const connectionStateRef = useRef<WebConnectState>({
        isConnected: false,
        isConnecting: false,
        isWebSocketConnected: false,
        isPeerConnected: false,
        isDataChannelConnected: false,
        isMediaStreamConnected: false,
        isJoinedRoom: false,
        currentConnectType: 'webrtc',
        state: 'closed',
        error: null,
        canRetry: false,
        currentRoom: null,
        stateMsg: null,
        currentIsLocalNetWork: false
    });

    // 更新连接状态
    const updateConnectionState = useCallback((updates: Partial<WebConnectState>) => {
        connectionStateRef.current = {
            ...connectionStateRef.current,
            ...updates
        };
    }, []);

    // 创建并管理 WebSocket 连接
    const createWebSocketConnection = useCallback(async (roomCode: string, role: Role) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
            console.log('[ConnectManager] 已存在 WebSocket 连接，先断开');
            wsRef.current.close();
        }

        try {
            // 构建 WebSocket URL
            const baseWsUrl = getWsUrl();
            if (!baseWsUrl) {
                throw new Error('WebSocket URL未配置');
            }

            // 构建完整的WebSocket URL
            const wsUrl = `${baseWsUrl}/api/ws/webrtc?code=${roomCode}&role=${role}&channel=shared`;
            console.log('[ConnectManager] 创建 WebSocket 连接:', wsUrl);

            const ws = new WebSocket(wsUrl);
            // 设置二进制数据类型为 ArrayBuffer，避免默认的 Blob 类型
            ws.binaryType = 'arraybuffer';
            wsRef.current = ws;
            currentRoomRef.current = { code: roomCode, role };

            // WebSocket 事件处理
            ws.onopen = () => {
                console.log('[ConnectManager] WebSocket 连接成功');
                updateConnectionState({
                    isWebSocketConnected: true,
                    error: null
                });
            };

            ws.onerror = (error) => {
                console.error('[ConnectManager] WebSocket 连接错误:', error);
                updateConnectionState({
                    isWebSocketConnected: false,
                    error: 'WebSocket 连接失败'
                });
            };

            ws.onclose = (event) => {
                console.log('[ConnectManager] WebSocket 连接关闭:', event.code, event.reason);
                updateConnectionState({
                    isWebSocketConnected: false,
                    error: event.wasClean ? null : 'WebSocket 连接意外断开'
                });
            };

            return ws;
        } catch (error) {
            console.error('[ConnectManager] 创建 WebSocket 连接失败:', error);
            updateConnectionState({
                isWebSocketConnected: false,
                error: '无法建立 WebSocket 连接'
            });
            throw error;
        }
    }, [updateConnectionState]);

    // 获取 WebSocket 连接
    const getWebSocketConnection = useCallback(() => {
        return wsRef.current;
    }, []);

    // 切换连接类型
    const switchConnectionType = useCallback((type: ConnectType) => {
        console.log('[ConnectManager] 切换连接类型:', currentConnectType, '->', type);

        // 如果当前有连接，先断开
        if (connectionStateRef.current.isConnected) {
            currentConnectionRef.current.disconnect();
        }

        // 切换到新的连接类型
        setCurrentConnectType(type);
        currentConnectionRef.current = type === 'websocket' ? wsConnection : webrtcConnection;

        updateConnectionState({
            currentConnectType: type,
            error: null
        });
    }, [currentConnectType, wsConnection, webrtcConnection, updateConnectionState]);

    // 连接到房间
    const connect = useCallback(async (roomCode: string, role: Role) => {
        console.log('[ConnectManager] 连接到房间:', roomCode, '角色:', role, '类型:', currentConnectType);

        updateConnectionState({
            isConnecting: true,
            error: null,
            currentRoom: { code: roomCode, role }
        });

        try {
            // 首先创建统一的 WebSocket 连接
            const ws = await createWebSocketConnection(roomCode, role);

            if (currentConnectType === 'webrtc') {
                // 将 WebSocket 注入到 WebRTC 连接中
                webrtcConnection.injectWebSocket(ws);
                currentConnectionRef.current = webrtcConnection;
                await currentConnectionRef.current.connect(roomCode, role);
            } else {
                // WebSocket 连接也使用统一的 WebSocket 实例
                wsConnection.injectWebSocket(ws);
                currentConnectionRef.current = wsConnection;
                await currentConnectionRef.current.connect(roomCode, role);
            }

        } catch (error) {
            console.error('[ConnectManager] 连接失败:', error);
            updateConnectionState({
                isConnecting: false,
                error: error instanceof Error ? error.message : '连接失败'
            });
        }
    }, [currentConnectType, createWebSocketConnection, webrtcConnection, wsConnection, updateConnectionState]);

    // 断开连接
    const disconnect = useCallback(() => {
        console.log('[ConnectManager] 断开连接');
        currentConnectionRef.current.disconnect();

        // 断开 WebSocket 连接
        if (wsRef.current) {
            wsRef.current.close(1000, '用户主动断开');
            wsRef.current = null;
        }
        currentRoomRef.current = null;

        updateConnectionState({
            isConnected: false,
            isConnecting: false,
            isWebSocketConnected: false,
            isPeerConnected: false,
            isDataChannelConnected: false,
            isMediaStreamConnected: false,
            error: null,
            canRetry: false,
            currentRoom: null
        });
    }, [updateConnectionState]);

    // 重试连接
    const retry = useCallback(async () => {
        console.log('[ConnectManager] 重试连接');
        if (connectionStateRef.current.currentRoom) {
            const { code, role } = connectionStateRef.current.currentRoom;
            await connect(code, role);
        }
    }, [connect]);

    // 发送消息
    const sendMessage = useCallback((message: IWebMessage, channel?: string) => {
        return currentConnectionRef.current.sendMessage(message, channel);
    }, []);

    // 发送数据
    const sendData = useCallback((data: ArrayBuffer) => {
        return currentConnectionRef.current.sendData(data);
    }, []);



    // 获取连接状态
    const getConnectState = useCallback((): WebConnectState => {
        // 合并当前连接的状态和管理器的状态
        return innerState();
    }, [innerState]);

    // 检查是否连接到指定房间
    const isConnectedToRoom = useCallback((roomCode: string, role: Role) => {
        return currentConnectionRef.current.isConnectedToRoom(roomCode, role);
    }, []);

    // 媒体轨道方法（代理到当前连接）
    const addTrack = useCallback((track: MediaStreamTrack, stream: MediaStream) => {
        return currentConnectionRef.current.addTrack(track, stream);
    }, []);

    const removeTrack = useCallback((sender: RTCRtpSender) => {
        currentConnectionRef.current.removeTrack(sender);
    }, []);

    const onTrack = useCallback((callback: (event: RTCTrackEvent) => void) => {
        console.log('[ConnectManager] 🎧 设置 onTrack 处理器，当前连接类型:', currentConnectType);
        console.log('[ConnectManager] 当前连接引用:', currentConnectionRef.current === webrtcConnection ? 'WebRTC' : 'WebSocket');
        currentConnectionRef.current.onTrack(callback);
    }, [currentConnectType, webrtcConnection]);

    const getPeerConnection = useCallback(() => {
        return currentConnectionRef.current.getPeerConnection();
    }, []);

    const createOfferNow = useCallback(async () => {
        return currentConnectionRef.current.createOfferNow();
    }, []);

    // 设置断开连接回调
    const setOnDisconnectCallback = useCallback((callback: () => void) => {
        currentConnectionRef.current.setOnDisconnectCallback(callback);
    }, []);

    // 扩展方法：切换连接类型
    const switchToWebSocket = useCallback(() => {
        switchConnectionType('websocket');
    }, [switchConnectionType]);

    const switchToWebRTC = useCallback(() => {
        switchConnectionType('webrtc');
    }, [switchConnectionType]);

    // 获取连接统计信息
    const getConnectionStats = useCallback(() => {
        const state = getConnectState();
        return {
            currentType: currentConnectType,
            isConnected: state.isConnected,
            hasWebSocket: state.isWebSocketConnected,
            hasWebRTC: state.isPeerConnected,
            hasDataChannel: state.isDataChannelConnected,
            hasMediaStream: state.isMediaStreamConnected,
            room: state.currentRoom,
            error: state.error,
            canRetry: state.canRetry
        };
    }, [currentConnectType, innerState]);




    // 注册消息处理器
    const registerMessageHandler = useCallback((channel: string, handler: MessageHandler) => {
        console.log('[DataChannelManager] 注册消息处理器:', channel);
        const webrtcConnectionUninstall = webrtcConnection.registerMessageHandler(channel, handler);
        const wsConnectionUninstall = wsConnection.registerMessageHandler(channel, handler);

        return () => {
            console.log('[DataChannelManager] 取消注册消息处理器:', channel);
            webrtcConnectionUninstall();
            wsConnectionUninstall();
        };
    }, []);

    // 注册数据处理器
    const registerDataHandler = useCallback((channel: string, handler: DataHandler) => {
        console.log('[DataChannelManager] 注册数据处理器:', channel);
        const webrtcConnectionUninstall = webrtcConnection.registerDataHandler(channel, handler);
        const wsConnectionUninstall = wsConnection.registerDataHandler(channel, handler);

        return () => {
            console.log('[DataChannelManager] 取消注册数据处理器:', channel);
            webrtcConnectionUninstall();
            wsConnectionUninstall();
        };
    }, []);



    return {
        connectType: currentConnectType,
        connect,
        disconnect,
        retry,
        sendMessage,
        sendData,
        registerMessageHandler,
        registerDataHandler,
        getConnectState,
        isConnectedToRoom,
        currentRoom: connectionStateRef.current.currentRoom,
        addTrack,
        removeTrack,
        onTrack,
        getPeerConnection,
        createOfferNow,
        setOnDisconnectCallback,

        // 扩展方法
        switchToWebSocket,
        switchToWebRTC,
        getConnectionStats,
    } as IWebConnection & {
        switchToWebSocket: () => void;
        switchToWebRTC: () => void;
        getConnectionStats: () => any;
    };
}
