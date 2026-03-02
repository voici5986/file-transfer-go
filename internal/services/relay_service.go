package services

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

// RelayService 处理 WebSocket 数据中继（当 P2P 失败时的降级方案）
type RelayService struct {
	rooms    map[string]*RelayRoom
	roomsMux sync.RWMutex
	upgrader websocket.Upgrader
	// 复用 WebRTCService 来验证房间
	webrtcService *WebRTCService
}

// RelayRoom 中继房间
type RelayRoom struct {
	Code      string
	Sender    *RelayClient
	Receiver  *RelayClient
	CreatedAt time.Time
	mu        sync.Mutex
}

// RelayClient 中继客户端
type RelayClient struct {
	ID         string
	Role       string // "sender" or "receiver"
	Connection *websocket.Conn
	mu         sync.Mutex
}

// RelayMessage 中继消息的包装格式
type RelayMessage struct {
	Type    string          `json:"type"`              // "relay-data" | "relay-binary" | "relay-ready" | "relay-ping" | "relay-pong"
	Channel string          `json:"channel,omitempty"` // 逻辑通道：file-transfer, text-transfer
	Payload json.RawMessage `json:"payload,omitempty"` // JSON 消息体
}

func NewRelayService(webrtcService *WebRTCService) *RelayService {
	return &RelayService{
		rooms:         make(map[string]*RelayRoom),
		roomsMux:      sync.RWMutex{},
		webrtcService: webrtcService,
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true
			},
			// 增大消息尺寸限制以支持文件传输（10MB）
			ReadBufferSize:  10 * 1024 * 1024,
			WriteBufferSize: 10 * 1024 * 1024,
		},
	}
}

// HandleRelayWebSocket 处理中继 WebSocket 连接
func (rs *RelayService) HandleRelayWebSocket(w http.ResponseWriter, r *http.Request) {
	log.Printf("[Relay] 收到中继 WebSocket 连接请求: %s", r.URL.String())

	conn, err := rs.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[Relay] WebSocket 升级失败: %v", err)
		return
	}
	// 设置最大消息大小为 10MB
	conn.SetReadLimit(10 * 1024 * 1024)
	defer conn.Close()

	// 获取参数
	code := r.URL.Query().Get("code")
	role := r.URL.Query().Get("role")

	log.Printf("[Relay] 连接参数: code=%s, role=%s", code, role)

	if code == "" || (role != "sender" && role != "receiver") {
		log.Printf("[Relay] 参数无效: code=%s, role=%s", code, role)
		conn.WriteJSON(map[string]interface{}{
			"type":  "error",
			"error": "连接参数无效",
		})
		return
	}

	// 验证房间是否存在（通过 WebRTC service 验证）
	status := rs.webrtcService.GetRoomStatus(code)
	exists, _ := status["exists"].(bool)
	if !exists {
		log.Printf("[Relay] 房间不存在: %s", code)
		conn.WriteJSON(map[string]interface{}{
			"type":  "error",
			"error": "房间不存在或已过期",
		})
		return
	}

	// 创建或获取中继房间
	rs.roomsMux.Lock()
	room, ok := rs.rooms[code]
	if !ok {
		room = &RelayRoom{
			Code:      code,
			CreatedAt: time.Now(),
		}
		rs.rooms[code] = room
	}
	rs.roomsMux.Unlock()

	// 创建客户端
	client := &RelayClient{
		ID:         rs.webrtcService.generateClientID(),
		Role:       role,
		Connection: conn,
	}

	// 添加到房间
	room.mu.Lock()
	if role == "sender" {
		// 关闭旧的 sender 连接
		if room.Sender != nil {
			room.Sender.Connection.Close()
		}
		room.Sender = client
	} else {
		// 关闭旧的 receiver 连接
		if room.Receiver != nil {
			room.Receiver.Connection.Close()
		}
		room.Receiver = client
	}

	// 检查对方是否已连接，通知双方 relay 已就绪
	peerConnected := false
	if role == "sender" && room.Receiver != nil {
		peerConnected = true
	} else if role == "receiver" && room.Sender != nil {
		peerConnected = true
	}
	room.mu.Unlock()

	log.Printf("[Relay] 客户端加入中继房间: ID=%s, Role=%s, Room=%s, 对方是否在线=%v", client.ID, role, code, peerConnected)

	// 通知自己已就绪
	conn.WriteJSON(map[string]interface{}{
		"type":           "relay-ready",
		"role":           role,
		"peer_connected": peerConnected,
	})

	// 如果对方已连接，通知对方
	if peerConnected {
		room.mu.Lock()
		var peer *RelayClient
		if role == "sender" {
			peer = room.Receiver
		} else {
			peer = room.Sender
		}
		room.mu.Unlock()

		if peer != nil {
			peer.mu.Lock()
			peer.Connection.WriteJSON(map[string]interface{}{
				"type":      "relay-peer-joined",
				"peer_role": role,
			})
			peer.mu.Unlock()
		}
	}

	// 连接关闭时清理
	defer func() {
		room.mu.Lock()
		if role == "sender" && room.Sender != nil && room.Sender.ID == client.ID {
			room.Sender = nil
		} else if role == "receiver" && room.Receiver != nil && room.Receiver.ID == client.ID {
			room.Receiver = nil
		}

		// 通知对方断开
		var peer *RelayClient
		if role == "sender" {
			peer = room.Receiver
		} else {
			peer = room.Sender
		}

		// 如果房间空了，清理
		isEmpty := room.Sender == nil && room.Receiver == nil
		room.mu.Unlock()

		if peer != nil {
			peer.mu.Lock()
			peer.Connection.WriteJSON(map[string]interface{}{
				"type":      "relay-peer-left",
				"peer_role": role,
			})
			peer.mu.Unlock()
		}

		if isEmpty {
			rs.roomsMux.Lock()
			delete(rs.rooms, code)
			rs.roomsMux.Unlock()
			log.Printf("[Relay] 清理空的中继房间: %s", code)
		}

		log.Printf("[Relay] 客户端断开中继: ID=%s, Room=%s", client.ID, code)
	}()

	// 消息转发循环 - 带统计日志
	var textMsgCount, binaryMsgCount int64
	var totalTextBytes, totalBinaryBytes int64
	startTime := time.Now()
	lastLogTime := startTime

	log.Printf("[Relay] ▶ 开始消息转发: Room=%s, Role=%s", code, role)

	for {
		msgType, data, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				log.Printf("[Relay] 读取消息错误: Room=%s, Role=%s, err=%v", code, role, err)
			}
			break
		}

		dataLen := int64(len(data))

		// 统计消息类型
		if msgType == websocket.TextMessage {
			textMsgCount++
			totalTextBytes += dataLen

			// 解析文本消息类型用于日志
			var peek struct {
				Type    string `json:"type"`
				Channel string `json:"channel"`
			}
			if json.Unmarshal(data, &peek) == nil {
				log.Printf("[Relay] 📨 转发文本消息: Room=%s, %s→%s, type=%s, channel=%s, size=%d bytes",
					code, role, peerRole(role), peek.Type, peek.Channel, dataLen)
			} else {
				log.Printf("[Relay] 📨 转发文本消息: Room=%s, %s→%s, size=%d bytes",
					code, role, peerRole(role), dataLen)
			}
		} else if msgType == websocket.BinaryMessage {
			binaryMsgCount++
			totalBinaryBytes += dataLen

			// 二进制消息只在每 10 个包或每 5 秒输出一次摘要，避免日志过多
			if binaryMsgCount%10 == 1 || time.Since(lastLogTime) > 5*time.Second {
				log.Printf("[Relay] 📦 转发二进制数据: Room=%s, %s→%s, size=%d bytes (累计: %d 包, %s)",
					code, role, peerRole(role), dataLen, binaryMsgCount, formatBytes(totalBinaryBytes))
				lastLogTime = time.Now()
			}
		}

		// 获取对方客户端
		room.mu.Lock()
		var peer *RelayClient
		if role == "sender" {
			peer = room.Receiver
		} else {
			peer = room.Sender
		}
		room.mu.Unlock()

		if peer == nil {
			log.Printf("[Relay] ⚠ 对方不在线，丢弃消息: Room=%s, Role=%s, size=%d bytes", code, role, dataLen)
			continue
		}

		// 直接转发消息（文本或二进制）
		peer.mu.Lock()
		err = peer.Connection.WriteMessage(msgType, data)
		peer.mu.Unlock()

		if err != nil {
			log.Printf("[Relay] ❌ 转发消息失败: Room=%s, %s→%s, err=%v", code, role, peerRole(role), err)
			break
		}
	}

	elapsed := time.Since(startTime)
	log.Printf("[Relay] ■ 消息转发结束: Room=%s, Role=%s, 持续=%v, 文本消息=%d(%s), 二进制消息=%d(%s)",
		code, role, elapsed.Round(time.Second),
		textMsgCount, formatBytes(totalTextBytes),
		binaryMsgCount, formatBytes(totalBinaryBytes))
}

// peerRole 返回对方角色名
func peerRole(role string) string {
	if role == "sender" {
		return "receiver"
	}
	return "sender"
}

// formatBytes 人性化格式化字节数
func formatBytes(b int64) string {
	const (
		KB = 1024
		MB = 1024 * KB
		GB = 1024 * MB
	)
	switch {
	case b >= GB:
		return fmt.Sprintf("%.2f GB", float64(b)/float64(GB))
	case b >= MB:
		return fmt.Sprintf("%.2f MB", float64(b)/float64(MB))
	case b >= KB:
		return fmt.Sprintf("%.2f KB", float64(b)/float64(KB))
	default:
		return fmt.Sprintf("%d B", b)
	}
}
