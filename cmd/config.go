package main

import (
	"bufio"
	"flag"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
)

// Config 应用配置结构
type Config struct {
	Port        int
	FrontendDir string
}

// loadEnvFile 加载环境变量文件
func loadEnvFile(filename string) error {
	file, err := os.Open(filename)
	if err != nil {
		return err
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		
		// 跳过空行和注释行
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		
		// 解析 KEY=VALUE 格式
		parts := strings.SplitN(line, "=", 2)
		if len(parts) == 2 {
			key := strings.TrimSpace(parts[0])
			value := strings.TrimSpace(parts[1])
			
			// 移除值两端的引号
			if (strings.HasPrefix(value, "\"") && strings.HasSuffix(value, "\"")) ||
			   (strings.HasPrefix(value, "'") && strings.HasSuffix(value, "'")) {
				value = value[1 : len(value)-1]
			}
			
			// 只有当环境变量不存在时才设置
			if os.Getenv(key) == "" {
				os.Setenv(key, value)
			}
		}
	}
	
	return scanner.Err()
}

// showHelp 显示帮助信息
func showHelp() {
	fmt.Println("文件传输服务器")
	fmt.Println("用法:")
	fmt.Println("  配置文件:")
	fmt.Println("    .chuan.env             - 自动加载的配置文件")
	fmt.Println("  环境变量:")
	fmt.Println("    PORT=8080              - 服务器监听端口")
	fmt.Println("    FRONTEND_DIR=/path     - 外部前端文件目录 (可选)")
	fmt.Println("  命令行参数:")
	flag.PrintDefaults()
	fmt.Println("")
	fmt.Println("配置优先级: 命令行参数 > 环境变量 > 配置文件 > 默认值")
	fmt.Println("")
	fmt.Println("示例:")
	fmt.Println("  ./file-transfer-server")
	fmt.Println("  ./file-transfer-server -port 3000")
	fmt.Println("  PORT=8080 FRONTEND_DIR=./dist ./file-transfer-server")
}

// loadConfig 加载应用配置
func loadConfig() *Config {
	// 首先尝试加载 .chuan.env 文件
	if err := loadEnvFile(".chuan.env"); err == nil {
		log.Printf("📄 已加载配置文件: .chuan.env")
	}

	// 从环境变量获取配置，如果没有则使用默认值
	defaultPort := 8080
	if envPort := os.Getenv("PORT"); envPort != "" {
		if port, err := strconv.Atoi(envPort); err == nil {
			defaultPort = port
		}
	}

	// 定义命令行参数
	var port = flag.Int("port", defaultPort, "服务器监听端口 (可通过 PORT 环境变量设置)")
	var help = flag.Bool("help", false, "显示帮助信息")
	flag.Parse()

	// 显示帮助信息
	if *help {
		showHelp()
		os.Exit(0)
	}

	config := &Config{
		Port:        *port,
		FrontendDir: os.Getenv("FRONTEND_DIR"),
	}

	return config
}

// logConfig 记录配置信息
func logConfig(config *Config) {
	// 记录前端配置信息
	if config.FrontendDir != "" {
		if info, err := os.Stat(config.FrontendDir); err == nil && info.IsDir() {
			log.Printf("✅ 使用外部前端目录: %s", config.FrontendDir)
		} else {
			log.Printf("⚠️ 外部前端目录不可用: %s, 回退到内嵌文件", config.FrontendDir)
		}
	} else {
		log.Printf("📦 使用内嵌前端文件")
	}
}
