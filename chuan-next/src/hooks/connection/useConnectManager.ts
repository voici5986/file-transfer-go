import { useCallback, useRef, useState } from 'react';
import { useReadConnectState } from './state/useWebConnectStateManager';
import { WebConnectState } from "./state/webConnectStore";
import { ConnectType, DataHandler, IGetConnectState, IRegisterEventHandler, IWebConnection, IWebMessage, MessageHandler, Role } from "./types";
import { useSharedWebRTCManagerImpl } from './webrtc/useSharedWebRTCManager';
import { useWebSocketConnection } from './ws/useWebSocketConnection';


/**
 * 连接管理器 - 代理 WebSocket 和 WebRTC 连接
 * 提供统一的连接接口，内部可以在不同传输方式之间切换
 */
export function useSharedWebRTCManager(): IWebConnection & IRegisterEventHandler & IGetConnectState {
    // 当前连接类型
    const [currentConnectType, setCurrentConnectType] = useState<ConnectType>('webrtc');

    // 连接实例
    const wsConnection = useWebSocketConnection();
    const webrtcConnection = useSharedWebRTCManagerImpl();

    // 当前活跃连接的引用
    const currentConnectionRef = useRef<IWebConnection>(wsConnection);

    const { getConnectState: innerState } = useReadConnectState();


    // 连接状态管理
    const connectionStateRef = useRef<WebConnectState>({
        isConnected: false,
        isConnecting: false,
        isWebSocketConnected: false,
        isPeerConnected: false,
        isDataChannelConnected: false,
        isMediaStreamConnected: false,
        currentConnectType: 'webrtc',
        state: 'closed',
        error: null,
        canRetry: false,
        currentRoom: null
    });

    // 更新连接状态
    const updateConnectionState = useCallback((updates: Partial<WebConnectState>) => {
        connectionStateRef.current = {
            ...connectionStateRef.current,
            ...updates
        };
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
            isConnected: false,
            isConnecting: false,
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
            if (currentConnectType === 'webrtc') {
                // 使用当前选择的连接类型进行连接
                currentConnectionRef.current = webrtcConnection;
                await currentConnectionRef.current.connect(roomCode, role);

            }

        } catch (error) {
            console.error('[ConnectManager] 连接失败:', error);

        }
    }, [currentConnectType]);

    // 断开连接
    const disconnect = useCallback(() => {
        console.log('[ConnectManager] 断开连接');
        currentConnectionRef.current.disconnect();

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
        currentConnectionRef.current.onTrack(callback);
    }, []);

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
