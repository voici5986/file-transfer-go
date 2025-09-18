package handlers

import (
	"encoding/json"
	"log"
	"net/http"

	"chuan/internal/services"
)

type Handler struct {
	webrtcService *services.WebRTCService
	turnService   *services.TurnService
}

func NewHandler() *Handler {
	return &Handler{
		webrtcService: services.NewWebRTCService(),
	}
}

// SetTurnService 设置TURN服务实例
func (h *Handler) SetTurnService(turnService *services.TurnService) {
	h.turnService = turnService
}

// HandleWebRTCWebSocket 处理WebRTC信令WebSocket连接
func (h *Handler) HandleWebRTCWebSocket(w http.ResponseWriter, r *http.Request) {
	h.webrtcService.HandleWebSocket(w, r)
}

// CreateRoomHandler 创建房间API - 简化版本，不处理无用参数
func (h *Handler) CreateRoomHandler(w http.ResponseWriter, r *http.Request) {
	// 设置响应为JSON格式
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodPost {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "方法不允许",
		})
		return
	}

	// 创建新房间（忽略请求体中的无用参数）
	code := h.webrtcService.CreateNewRoom()
	log.Printf("创建房间成功: %s", code)

	// 构建响应
	response := map[string]interface{}{
		"success": true,
		"code":    code,
		"message": "房间创建成功",
	}

	json.NewEncoder(w).Encode(response)
}

// WebRTCRoomStatusHandler WebRTC房间状态API
func (h *Handler) WebRTCRoomStatusHandler(w http.ResponseWriter, r *http.Request) {
	// 设置响应为JSON格式
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "方法不允许",
		})
		return
	}

	// 从查询参数获取房间代码
	code := r.URL.Query().Get("code")
	if code == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "缺少房间代码",
		})
		return
	}

	// 获取房间状态
	status := h.webrtcService.GetRoomStatus(code)

	json.NewEncoder(w).Encode(status)
}

// GetRoomStatusHandler 获取房间状态API
func (h *Handler) GetRoomStatusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "方法不允许",
		})
		return
	}

	// 获取房间码
	code := r.URL.Query().Get("code")
	if code == "" {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "房间码不能为空",
		})
		return
	}

	// 获取房间状态
	status := h.webrtcService.GetRoomStatus(code)
	json.NewEncoder(w).Encode(status)
}

// TurnStatsHandler 获取TURN服务器统计信息API
func (h *Handler) TurnStatsHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "方法不允许",
		})
		return
	}

	if h.turnService == nil {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "TURN服务器未启用",
		})
		return
	}

	stats := h.turnService.GetStats()
	response := map[string]interface{}{
		"success": true,
		"data":    stats,
	}

	json.NewEncoder(w).Encode(response)
}

// TurnConfigHandler 获取TURN服务器配置信息API（用于前端WebRTC配置）
func (h *Handler) TurnConfigHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "方法不允许",
		})
		return
	}

	if h.turnService == nil || !h.turnService.IsRunning() {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "TURN服务器未启用或未运行",
		})
		return
	}

	turnInfo := h.turnService.GetTurnServerInfo()
	response := map[string]interface{}{
		"success": true,
		"data":    turnInfo,
	}

	json.NewEncoder(w).Encode(response)
}

// AdminStatusHandler 获取服务器总体状态API
func (h *Handler) AdminStatusHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	if r.Method != http.MethodGet {
		json.NewEncoder(w).Encode(map[string]interface{}{
			"success": false,
			"message": "方法不允许",
		})
		return
	}

	// 获取WebRTC服务状态
	// 这里简化，实际可以从WebRTC服务获取更多信息
	webrtcStatus := map[string]interface{}{
		"isRunning": true, // WebRTC服务总是运行的
	}

	// 获取TURN服务状态
	var turnStatus interface{}
	if h.turnService != nil {
		turnStatus = h.turnService.GetStats()
	} else {
		turnStatus = map[string]interface{}{
			"isRunning": false,
			"message":   "TURN服务器未启用",
		}
	}

	response := map[string]interface{}{
		"success": true,
		"data": map[string]interface{}{
			"webrtc": webrtcStatus,
			"turn":   turnStatus,
		},
	}

	json.NewEncoder(w).Encode(response)
}
