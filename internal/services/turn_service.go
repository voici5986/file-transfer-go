package services

import (
	"fmt"
	"log"
	"net"
	"sync"

	"github.com/pion/turn/v3"
)

// TurnService TURN服务器结构
type TurnService struct {
	server       *turn.Server
	config       TurnServiceConfig
	stats        *TurnStats
	isRunning    bool
	mu           sync.RWMutex
}

// TurnServiceConfig TURN服务器配置
type TurnServiceConfig struct {
	Port     int
	Username string
	Password string
	Realm    string
}

// TurnStats TURN服务器统计信息
type TurnStats struct {
	ActiveAllocations int64
	TotalAllocations  int64
	BytesTransferred  int64
	PacketsTransferred int64
	Connections       int64
	mu                sync.RWMutex
}

// NewTurnService 创建新的TURN服务实例
func NewTurnService(config TurnServiceConfig) *TurnService {
	return &TurnService{
		config: config,
		stats: &TurnStats{},
	}
}

// Start 启动TURN服务器
func (ts *TurnService) Start() error {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if ts.isRunning {
		return fmt.Errorf("TURN服务器已在运行")
	}

	// 监听UDP端口
	udpListener, err := net.ListenPacket("udp4", fmt.Sprintf("0.0.0.0:%d", ts.config.Port))
	if err != nil {
		return fmt.Errorf("无法监听UDP端口: %v", err)
	}

	// 监听TCP端口  
	tcpListener, err := net.Listen("tcp4", fmt.Sprintf("0.0.0.0:%d", ts.config.Port))
	if err != nil {
		udpListener.Close()
		return fmt.Errorf("无法监听TCP端口: %v", err)
	}

	// 创建TURN服务器配置
	turnConfig := turn.ServerConfig{
		Realm:       ts.config.Realm,
		AuthHandler: ts.authHandler,
		PacketConnConfigs: []turn.PacketConnConfig{
			{
				PacketConn: udpListener,
				RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{
					RelayAddress: net.ParseIP("127.0.0.1"), // 在生产环境中应该使用公网IP
					Address:      "0.0.0.0",
				},
			},
		},
		ListenerConfigs: []turn.ListenerConfig{
			{
				Listener: tcpListener,
				RelayAddressGenerator: &turn.RelayAddressGeneratorStatic{
					RelayAddress: net.ParseIP("127.0.0.1"), // 在生产环境中应该使用公网IP
					Address:      "0.0.0.0",
				},
			},
		},
	}

	// 创建TURN服务器
	server, err := turn.NewServer(turnConfig)
	if err != nil {
		udpListener.Close()
		tcpListener.Close()
		return fmt.Errorf("创建TURN服务器失败: %v", err)
	}

	ts.server = server
	ts.isRunning = true

	log.Printf("🔄 TURN服务器启动成功，监听端口: %d", ts.config.Port)
	log.Printf("   用户名: %s, 域: %s", ts.config.Username, ts.config.Realm)

	return nil
}

// Stop 停止TURN服务器
func (ts *TurnService) Stop() error {
	ts.mu.Lock()
	defer ts.mu.Unlock()

	if !ts.isRunning {
		return fmt.Errorf("TURN服务器未运行")
	}

	if ts.server != nil {
		if err := ts.server.Close(); err != nil {
			return fmt.Errorf("关闭TURN服务器失败: %v", err)
		}
	}

	ts.isRunning = false
	log.Printf("🛑 TURN服务器已停止")

	return nil
}

// IsRunning 检查TURN服务器是否正在运行
func (ts *TurnService) IsRunning() bool {
	ts.mu.RLock()
	defer ts.mu.RUnlock()
	return ts.isRunning
}

// authHandler 认证处理器
func (ts *TurnService) authHandler(username string, realm string, srcAddr net.Addr) ([]byte, bool) {
	// 记录连接统计
	ts.stats.mu.Lock()
	ts.stats.Connections++
	ts.stats.mu.Unlock()

	log.Printf("🔐 TURN认证请求: 用户=%s, 域=%s, 地址=%s", username, realm, srcAddr.String())

	// 简单的用户名密码验证
	if username == ts.config.Username && realm == ts.config.Realm {
		// 记录分配统计
		ts.stats.mu.Lock()
		ts.stats.ActiveAllocations++
		ts.stats.TotalAllocations++
		ts.stats.mu.Unlock()
		
		log.Printf("📊 TURN认证成功: 活跃分配=%d, 总分配=%d", ts.stats.ActiveAllocations, ts.stats.TotalAllocations)
		
		// 返回密码的key
		return turn.GenerateAuthKey(username, ts.config.Realm, ts.config.Password), true
	}

	log.Printf("❌ TURN认证失败: 用户=%s", username)
	return nil, false
}

// GetStats 获取统计信息
func (ts *TurnService) GetStats() TurnStatsResponse {
	ts.stats.mu.RLock()
	defer ts.stats.mu.RUnlock()

	return TurnStatsResponse{
		IsRunning:          ts.IsRunning(),
		ActiveAllocations:  ts.stats.ActiveAllocations,
		TotalAllocations:   ts.stats.TotalAllocations,
		BytesTransferred:   ts.stats.BytesTransferred,
		PacketsTransferred: ts.stats.PacketsTransferred,
		Connections:        ts.stats.Connections,
		Port:               ts.config.Port,
		Username:           ts.config.Username,
		Realm:              ts.config.Realm,
	}
}

// GetTurnServerInfo 获取TURN服务器信息用于客户端
func (ts *TurnService) GetTurnServerInfo() TurnServerInfo {
	if !ts.IsRunning() {
		return TurnServerInfo{}
	}

	return TurnServerInfo{
		URLs:       []string{fmt.Sprintf("turn:localhost:%d", ts.config.Port)},
		Username:   ts.config.Username,
		Credential: ts.config.Password,
	}
}

// UpdateStats 更新传输统计 (可以从外部调用)
func (ts *TurnService) UpdateStats(bytes, packets int64) {
	ts.stats.mu.Lock()
	defer ts.stats.mu.Unlock()
	
	ts.stats.BytesTransferred += bytes
	ts.stats.PacketsTransferred += packets
}

// DecrementActiveAllocations 减少活跃分配数（当连接关闭时调用）
func (ts *TurnService) DecrementActiveAllocations() {
	ts.stats.mu.Lock()
	defer ts.stats.mu.Unlock()
	
	if ts.stats.ActiveAllocations > 0 {
		ts.stats.ActiveAllocations--
		log.Printf("📊 TURN分配释放: 活跃分配=%d", ts.stats.ActiveAllocations)
	}
}

// TurnStatsResponse TURN统计响应结构
type TurnStatsResponse struct {
	IsRunning          bool   `json:"isRunning"`
	ActiveAllocations  int64  `json:"activeAllocations"`
	TotalAllocations   int64  `json:"totalAllocations"`
	BytesTransferred   int64  `json:"bytesTransferred"`
	PacketsTransferred int64  `json:"packetsTransferred"`
	Connections        int64  `json:"connections"`
	Port               int    `json:"port"`
	Username           string `json:"username"`
	Realm              string `json:"realm"`
}

// TurnServerInfo TURN服务器信息结构 (用于WebRTC配置)
type TurnServerInfo struct {
	URLs       []string `json:"urls"`
	Username   string   `json:"username"`
	Credential string   `json:"credential"`
}