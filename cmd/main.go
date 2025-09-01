package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"chuan/internal/handlers"
	"chuan/internal/web"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

func main() {
	// 定义命令行参数
	var port = flag.Int("port", 8080, "服务器监听端口")
	var help = flag.Bool("help", false, "显示帮助信息")
	flag.Parse()

	// 显示帮助信息
	if *help {
		fmt.Println("文件传输服务器")
		fmt.Println("用法:")
		flag.PrintDefaults()
		os.Exit(0)
	}

	// 初始化处理器
	h := handlers.NewHandler()

	// 创建路由
	r := chi.NewRouter()

	// 中间件
	r.Use(middleware.Logger)
	r.Use(middleware.Recoverer)
	r.Use(middleware.Compress(5))

	// CORS 配置
	r.Use(cors.Handler(cors.Options{
		AllowedOrigins:   []string{"*"},
		AllowedMethods:   []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowedHeaders:   []string{"Accept", "Authorization", "Content-Type", "X-CSRF-Token"},
		ExposedHeaders:   []string{"Link"},
		AllowCredentials: true,
		MaxAge:           300,
	}))

	// 嵌入式前端文件服务
	r.Handle("/*", web.CreateFrontendHandler())

	// WebRTC信令WebSocket路由
	r.Get("/api/ws/webrtc", h.HandleWebRTCWebSocket)
	r.Get("/ws/webrtc", h.HandleWebRTCWebSocket)

	// WebRTC房间API
	r.Post("/api/create-room", h.CreateRoomHandler)
	r.Get("/api/room-info", h.WebRTCRoomStatusHandler)
	r.Get("/api/webrtc-room-status", h.WebRTCRoomStatusHandler)

	// 构建服务器地址
	addr := fmt.Sprintf(":%d", *port)

	// 启动服务器
	srv := &http.Server{
		Addr:         addr,
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 30 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	// 优雅关闭
	go func() {
		log.Printf("服务器启动在端口 %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("服务器启动失败: %v", err)
		}
	}()

	// 等待中断信号
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit
	log.Println("正在关闭服务器...")

	// 设置关闭超时
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	if err := srv.Shutdown(ctx); err != nil {
		log.Fatal("服务器强制关闭:", err)
	}

	log.Println("服务器已退出")
}
