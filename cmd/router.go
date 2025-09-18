package main

import (
	"net/http"

	"chuan/internal/handlers"
	"chuan/internal/web"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-chi/cors"
)

// RouterSetup 路由设置结果
type RouterSetup struct {
	Handler *handlers.Handler
	Router  http.Handler
}

// setupRouter 设置路由和中间件
func setupRouter(config *Config) *RouterSetup {
	// 初始化处理器
	h := handlers.NewHandler()

	router := chi.NewRouter()

	// 设置中间件
	setupMiddleware(router)

	// 设置API路由
	setupAPIRoutes(router, h, config)

	// 设置前端路由
	router.Handle("/*", web.CreateFrontendHandler())

	return &RouterSetup{
		Handler: h,
		Router:  router,
	}
}

// setupMiddleware 设置中间件
func setupMiddleware(r *chi.Mux) {
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
}

// setupAPIRoutes 设置API路由
func setupAPIRoutes(r *chi.Mux, h *handlers.Handler, config *Config) {
	// WebRTC信令WebSocket路由
	r.Get("/api/ws/webrtc", h.HandleWebRTCWebSocket)

	// WebRTC房间API
	r.Post("/api/create-room", h.CreateRoomHandler)
	r.Get("/api/room-info", h.WebRTCRoomStatusHandler)

	// TURN服务器API（仅在启用时可用）
	if config.TurnConfig.Enabled {
		r.Get("/api/turn/stats", h.TurnStatsHandler)
		r.Get("/api/turn/config", h.TurnConfigHandler)
	}

	// 管理API
	r.Get("/api/admin/status", h.AdminStatusHandler)
}
