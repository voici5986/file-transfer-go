package main

import (
	"os"
)

func main() {
	// 检查是否需要显示帮助
	if len(os.Args) > 1 && (os.Args[1] == "-h" || os.Args[1] == "--help") {
		showHelp()
		return
	}

	// 加载配置
	config := loadConfig()

	// 记录配置信息
	logConfig(config)

	// 设置路由
	router := setupRouter()

	// 运行服务器（包含启动和优雅关闭）
	RunServer(config, router)
}
