package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"chuan/internal/services"
)

// Server 服务器结构
type Server struct {
	httpServer  *http.Server
	config      *Config
	turnService *services.TurnService
}

// NewServer 创建新的服务器实例
func NewServer(config *Config, routerSetup *RouterSetup) *Server {
	server := &Server{
		httpServer: &http.Server{
			Addr:         fmt.Sprintf(":%d", config.Port),
			Handler:      routerSetup.Router,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 30 * time.Second,
			IdleTimeout:  120 * time.Second,
		},
		config: config,
	}

	// 如果启用了TURN服务器，创建TURN服务实例
	if config.TurnConfig.Enabled {
		turnConfig := services.TurnServiceConfig{
			Port:     config.TurnConfig.Port,
			Username: config.TurnConfig.Username,
			Password: config.TurnConfig.Password,
			Realm:    config.TurnConfig.Realm,
		}
		server.turnService = services.NewTurnService(turnConfig)
		
		// 将TURN服务设置到处理器中
		routerSetup.Handler.SetTurnService(server.turnService)
	}

	return server
}

// Start 启动服务器
func (s *Server) Start() error {
	// 启动TURN服务器（如果启用）
	if s.turnService != nil {
		if err := s.turnService.Start(); err != nil {
			return fmt.Errorf("启动TURN服务器失败: %v", err)
		}
	}

	log.Printf("🚀 服务器启动在端口 :%d", s.config.Port)
	return s.httpServer.ListenAndServe()
}

// Stop 停止服务器
func (s *Server) Stop(ctx context.Context) error {
	log.Println("🛑 正在关闭服务器...")
	
	// 停止TURN服务器（如果启用）
	if s.turnService != nil {
		if err := s.turnService.Stop(); err != nil {
			log.Printf("⚠️ 停止TURN服务器失败: %v", err)
		}
	}
	
	return s.httpServer.Shutdown(ctx)
}

// WaitForShutdown 等待关闭信号并优雅关闭
func (s *Server) WaitForShutdown() {
	// 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	// 设置关闭超时
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := s.Stop(ctx); err != nil {
		log.Fatal("❌ 服务器强制关闭:", err)
	}

	log.Println("✅ 服务器已退出")
}

// RunServer 运行服务器（包含启动和优雅关闭）
func RunServer(config *Config, routerSetup *RouterSetup) {
	server := NewServer(config, routerSetup)

	// 启动服务器
	go func() {
		if err := server.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("❌ 服务器启动失败: %v", err)
		}
	}()

	// 等待关闭信号
	server.WaitForShutdown()
}
