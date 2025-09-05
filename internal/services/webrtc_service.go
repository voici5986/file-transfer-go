package services

import (
	"fmt"
	"log"
	"math/rand"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type WebRTCService struct {
	rooms    map[string]*WebRTCRoom
	roomsMux sync.RWMutex
	upgrader websocket.Upgrader
}

type WebRTCRoom struct {
	Code      string
	Sender    *WebRTCClient
	Receiver  *WebRTCClient
	CreatedAt time.Time
	ExpiresAt time.Time      // 添加过期时间
}

type WebRTCClient struct {
	ID         string
	Role       string // "sender" or "receiver"
	Connection *websocket.Conn
	Room       string
}

func NewWebRTCService() *WebRTCService {
	service := &WebRTCService{
		rooms:    make(map[string]*WebRTCRoom),
		roomsMux: sync.RWMutex{},
		upgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // 允许所有来源，生产环境应当限制
			},
		},
	}

	// 启动房间清理任务
	go service.cleanupExpiredRooms()

	return service
}

type WebRTCMessage struct {
	Type    string      `json:"type"`
	From    string      `json:"from"`
	To      string      `json:"to"`
	Payload interface{} `json:"payload"`
}

// HandleWebSocket 处理WebRTC信令WebSocket连接
func (ws *WebRTCService) HandleWebSocket(w http.ResponseWriter, r *http.Request) {
	log.Printf("收到WebRTC WebSocket连接请求: %s", r.URL.String())

	conn, err := ws.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebRTC WebSocket升级失败: %v", err)
		return
	}
	defer conn.Close()

	// 获取房间码和角色
	code := r.URL.Query().Get("code")
	role := r.URL.Query().Get("role")

	log.Printf("WebRTC连接参数: code=%s, role=%s", code, role)

	if code == "" || (role != "sender" && role != "receiver") {
		log.Printf("WebRTC连接参数无效: code=%s, role=%s", code, role)
		conn.WriteJSON(map[string]interface{}{
			"type":    "error",
			"message": "连接参数无效",
		})
		return
	}

	// 验证房间是否存在
	ws.roomsMux.RLock()
	room := ws.rooms[code]
	ws.roomsMux.RUnlock()

	if room == nil {
		log.Printf("房间不存在: %s", code)
		conn.WriteJSON(map[string]interface{}{
			"type":    "error",
			"message": "房间不存在或已过期",
		})
		return
	}

	// 检查房间是否已过期
	if time.Now().After(room.ExpiresAt) {
		log.Printf("房间已过期: %s", code)
		conn.WriteJSON(map[string]interface{}{
			"type":    "error",
			"message": "房间已过期",
		})
		return
	}

	// 检查房间是否已满（两个连接都已存在）
	ws.roomsMux.RLock()
	isRoomFull := room.Sender != nil && room.Receiver != nil
	ws.roomsMux.RUnlock()

	if isRoomFull {
		log.Printf("房间已满，拒绝连接: %s", code)
		conn.WriteJSON(map[string]interface{}{
			"type":    "error",
			"message": "当前房间人数已满，正在传输中无法加入",
		})
		return
	}

	// 生成客户端ID
	clientID := ws.generateClientID()
	client := &WebRTCClient{
		ID:         clientID,
		Role:       role,
		Connection: conn,
		Room:       code,
	}

	log.Printf("WebRTC客户端已创建: ID=%s, Role=%s, Room=%s", clientID, role, code)

	// 添加客户端到房间
	ws.addClientToRoom(code, client)
	log.Printf("WebRTC %s连接到房间: %s (客户端ID: %s)", role, code, clientID)

	// 连接关闭时清理
	defer func() {
		ws.removeClientFromRoom(code, clientID)
		log.Printf("WebRTC客户端断开连接: %s (房间: %s)", clientID, code)

		// 通知房间内其他客户端对方已断开连接
		ws.notifyRoomDisconnection(code, clientID, client.Role)
	}()

	// 处理消息
	for {
		var msg WebRTCMessage
		err := conn.ReadJSON(&msg)
		if err != nil {
			log.Printf("读取WebRTC WebSocket消息失败: %v", err)
			break
		}

		msg.From = clientID
		log.Printf("收到WebRTC信令: 类型=%s, 来自=%s, 房间=%s", msg.Type, clientID, code)

		// 转发信令消息给对方
		ws.forwardMessage(code, clientID, &msg)
	}
}

// 添加客户端到房间
func (ws *WebRTCService) addClientToRoom(code string, client *WebRTCClient) {
	ws.roomsMux.Lock()
	defer ws.roomsMux.Unlock()

	room := ws.rooms[code]
	if room == nil {
		log.Printf("尝试加入不存在的WebRTC房间: %s", code)
		return
	}

	if client.Role == "sender" {
		room.Sender = client
		// 如果发送方连接，检查是否有接收方在等待，通知接收方
		if room.Receiver != nil {
			log.Printf("通知接收方：发送方已连接")
			peerJoinedMsg := &WebRTCMessage{
				Type: "peer-joined",
				From: client.ID,
				Payload: map[string]interface{}{
					"role": "sender",
				},
			}
			room.Receiver.Connection.WriteJSON(peerJoinedMsg)
		}
	} else {
		room.Receiver = client
		// 如果接收方连接，通知发送方可以开始建立P2P连接
		if room.Sender != nil {
			log.Printf("通知发送方：接收方已连接，可以开始建立P2P连接")
			peerJoinedMsg := &WebRTCMessage{
				Type: "peer-joined",
				From: client.ID,
				Payload: map[string]interface{}{
					"role": "receiver",
				},
			}
			room.Sender.Connection.WriteJSON(peerJoinedMsg)
		}
	}
}

// 从房间移除客户端
func (ws *WebRTCService) removeClientFromRoom(code string, clientID string) {
	ws.roomsMux.Lock()
	defer ws.roomsMux.Unlock()

	room := ws.rooms[code]
	if room == nil {
		return
	}

	if room.Sender != nil && room.Sender.ID == clientID {
		room.Sender = nil
	}
	if room.Receiver != nil && room.Receiver.ID == clientID {
		room.Receiver = nil
	}

	// 如果房间为空，删除房间
	if room.Sender == nil && room.Receiver == nil {
		delete(ws.rooms, code)
		log.Printf("清理WebRTC房间: %s", code)
	}
}

// 转发信令消息
func (ws *WebRTCService) forwardMessage(roomCode string, fromClientID string, msg *WebRTCMessage) {
	ws.roomsMux.Lock()
	defer ws.roomsMux.Unlock()

	room := ws.rooms[roomCode]
	if room == nil {
		return
	}

	var targetClient *WebRTCClient
	if room.Sender != nil && room.Sender.ID == fromClientID {
		// 消息来自sender，转发给receiver
		targetClient = room.Receiver
	} else if room.Receiver != nil && room.Receiver.ID == fromClientID {
		// 消息来自receiver，转发给sender
		targetClient = room.Sender
	}

	if targetClient != nil && targetClient.Connection != nil {
		msg.To = targetClient.ID
		err := targetClient.Connection.WriteJSON(msg)
		if err != nil {
			log.Printf("转发WebRTC信令失败: %v", err)
		} else {
			log.Printf("转发WebRTC信令: 类型=%s, 从=%s到=%s", msg.Type, fromClientID, targetClient.ID)
		}
	} else {
		log.Printf("目标客户端不在线，消息类型=%s", msg.Type)
	}
}

// CreateRoom 创建或获取房间
func (ws *WebRTCService) CreateRoom(code string) {
	ws.roomsMux.Lock()
	defer ws.roomsMux.Unlock()

	if _, exists := ws.rooms[code]; !exists {
		ws.rooms[code] = &WebRTCRoom{
			Code:      code,
			CreatedAt: time.Now(),
			ExpiresAt: time.Now().Add(time.Hour), // 1小时后过期
		}
		log.Printf("创建WebRTC房间: %s", code)
	}
}

// CreateNewRoom 创建新房间并返回房间码 - 确保不重复
func (ws *WebRTCService) CreateNewRoom() string {
	var code string

	// 生成唯一房间码，确保不重复
	for {
		code = ws.generatePickupCode()
		ws.roomsMux.RLock()
		_, exists := ws.rooms[code]
		ws.roomsMux.RUnlock()

		if !exists {
			break // 找到了不重复的代码
		}
		// 如果重复了，继续生成新的
	}

	ws.CreateRoom(code)
	return code
}

// generatePickupCode 生成6位取件码 - 统一规则：只使用大写字母和数字，排除0和O避免混淆
func (ws *WebRTCService) generatePickupCode() string {
	// 只使用大写字母和数字，排除容易混淆的字符：数字0和字母O
	chars := "123456789ABCDEFGHIJKLMNPQRSTUVWXYZ"
	source := rand.NewSource(time.Now().UnixNano())
	rng := rand.New(source)

	result := make([]byte, 6)
	for i := 0; i < 6; i++ {
		result[i] = chars[rng.Intn(len(chars))]
	}
	return string(result)
}

// cleanupExpiredRooms 定期清理过期房间
func (ws *WebRTCService) cleanupExpiredRooms() {
	ticker := time.NewTicker(5 * time.Minute)
	defer ticker.Stop()

	for range ticker.C {
		ws.roomsMux.Lock()
		now := time.Now()
		for code, room := range ws.rooms {
			// 房间过期或无客户端连接则删除
			if now.After(room.ExpiresAt) || (room.Sender == nil && room.Receiver == nil) {
				delete(ws.rooms, code)
				log.Printf("清理过期WebRTC房间: %s", code)
			}
		}
		ws.roomsMux.Unlock()
	}
}

// generateClientID 生成客户端ID
func (ws *WebRTCService) generateClientID() string {
	return fmt.Sprintf("webrtc_client_%d", rand.Int63())
}

// 通知房间内客户端有人断开连接
func (ws *WebRTCService) notifyRoomDisconnection(roomCode string, disconnectedClientID string, disconnectedRole string) {
	ws.roomsMux.Lock()
	defer ws.roomsMux.Unlock()

	room := ws.rooms[roomCode]
	if room == nil {
		return
	}

	// 构建断开连接通知消息
	disconnectionMsg := &WebRTCMessage{
		Type: "disconnection",
		From: disconnectedClientID,
		Payload: map[string]interface{}{
			"role":    disconnectedRole,
			"message": "对方已停止传输",
		},
	}

	// 通知房间内其他客户端
	if room.Sender != nil && room.Sender.ID != disconnectedClientID {
		err := room.Sender.Connection.WriteJSON(disconnectionMsg)
		if err != nil {
			log.Printf("通知发送方断开连接失败: %v", err)
		} else {
			log.Printf("已通知发送方: 对方已断开连接")
		}
	}

	if room.Receiver != nil && room.Receiver.ID != disconnectedClientID {
		err := room.Receiver.Connection.WriteJSON(disconnectionMsg)
		if err != nil {
			log.Printf("通知接收方断开连接失败: %v", err)
		} else {
			log.Printf("已通知接收方: 对方已断开连接")
		}
	}
}

func (ws *WebRTCService) GetRoomStatus(code string) map[string]interface{} {
	ws.roomsMux.RLock()
	defer ws.roomsMux.RUnlock()

	room := ws.rooms[code]
	if room == nil {
		return map[string]interface{}{
			"success": false,
			"exists":  false,
			"message": "房间不存在或已过期",
		}
	}

	// 检查房间是否已满（两个连接都已存在）
	isRoomFull := room.Sender != nil && room.Receiver != nil

	return map[string]interface{}{
		"success":         true,
		"exists":          true,
		"sender_online":   room.Sender != nil,
		"receiver_online": room.Receiver != nil,
		"is_room_full":    isRoomFull,
		"created_at":      room.CreatedAt,
	}
}
