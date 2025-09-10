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
)

// Server 服务器结构
type Server struct {
	httpServer *http.Server
	config     *Config
}

// NewServer 创建新的服务器实例
func NewServer(config *Config, handler http.Handler) *Server {
	return &Server{
		httpServer: &http.Server{
			Addr:         fmt.Sprintf(":%d", config.Port),
			Handler:      handler,
			ReadTimeout:  30 * time.Second,
			WriteTimeout: 30 * time.Second,
			IdleTimeout:  120 * time.Second,
		},
		config: config,
	}
}

// Start 启动服务器
func (s *Server) Start() error {
	log.Printf("🚀 服务器启动在端口 :%d", s.config.Port)
	return s.httpServer.ListenAndServe()
}

// Stop 停止服务器
func (s *Server) Stop(ctx context.Context) error {
	log.Println("🛑 正在关闭服务器...")
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
func RunServer(config *Config, handler http.Handler) {
	server := NewServer(config, handler)

	// 启动服务器
	go func() {
		if err := server.Start(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("❌ 服务器启动失败: %v", err)
		}
	}()

	// 等待关闭信号
	server.WaitForShutdown()
}
