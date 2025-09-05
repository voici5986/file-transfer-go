"use client";

import React, { useState, useEffect } from 'react';
import { 
  Book, 
  Server, 
  Download, 
  Code, 
  Container, 
  Globe, 
  ChevronRight,
  ExternalLink,
  Copy,
  Check,
  AlertTriangle,
  Info,
  Lightbulb,
  HelpCircle,
  Upload,
  MessageSquare,
  Monitor,
  Settings,
  Shield,
  Smartphone,
  Wifi,
  Users,
  Home,
  ArrowLeft
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import Link from 'next/link';

interface SectionProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}

function Section({ id, title, icon, children }: SectionProps) {
  return (
    <section id={id} className="mb-6 scroll-mt-16 lg:scroll-mt-20">
      <div className="flex items-center gap-3 mb-4 lg:mb-6">
        <div className="p-2 lg:p-3 bg-blue-100 rounded-lg">
          {icon}
        </div>
        <h2 className="text-xl lg:text-2xl font-bold text-gray-900">{title}</h2>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 lg:p-6">
        {children}
      </div>
    </section>
  );
}

interface CodeBlockProps {
  code: string;
  language?: string;
}

function CodeBlock({ code, language = "bash" }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error('复制失败:', error);
    }
  };

  return (
    <div className="relative">
      <div className="bg-gray-900 rounded-lg p-4 overflow-x-auto">
        <pre className="text-green-400 text-sm font-mono">
          <code>{code}</code>
        </pre>
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={handleCopy}
        className="absolute top-2 right-2 text-gray-400 hover:text-white"
      >
        {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      </Button>
    </div>
  );
}

interface InfoBoxProps {
  type: 'info' | 'warning' | 'tip' | 'error';
  title: string;
  children: React.ReactNode;
}

function InfoBox({ type, title, children }: InfoBoxProps) {
  const styles = {
    info: {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      icon: <Info className="w-5 h-5 text-blue-600" />,
      titleColor: 'text-blue-900'
    },
    warning: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-200',
      icon: <AlertTriangle className="w-5 h-5 text-yellow-600" />,
      titleColor: 'text-yellow-900'
    },
    tip: {
      bg: 'bg-green-50',
      border: 'border-green-200',
      icon: <Lightbulb className="w-5 h-5 text-green-600" />,
      titleColor: 'text-green-900'
    },
    error: {
      bg: 'bg-red-50',
      border: 'border-red-200',
      icon: <AlertTriangle className="w-5 h-5 text-red-600" />,
      titleColor: 'text-red-900'
    }
  };

  const style = styles[type];

  return (
    <div className={`${style.bg} ${style.border} border rounded-lg p-4 my-4`}>
      <div className="flex items-start gap-3">
        {style.icon}
        <div className="flex-1">
          <h4 className={`font-semibold ${style.titleColor} mb-2`}>{title}</h4>
          <div className="text-sm text-gray-700">{children}</div>
        </div>
      </div>
    </div>
  );
}

export default function HelpPage() {
  const [activeSection, setActiveSection] = useState('deployment');
  const [sidebarLeft, setSidebarLeft] = useState(0);

  const sections = [
    { 
      id: 'deployment', 
      title: '部署指南', 
      icon: <Server className="w-5 h-5 text-blue-600" />,
      children: [
        { id: 'docker-deployment', title: 'Docker 部署', icon: <Container className="w-4 h-4 text-blue-500" /> },
        { id: 'binary-deployment', title: '二进制部署', icon: <Download className="w-4 h-4 text-green-500" /> },
        { id: 'build-deployment', title: '自行构建', icon: <Code className="w-4 h-4 text-purple-500" /> },
      ]
    },
    { id: 'desktop-share', title: '桌面共享权限问题', icon: <Monitor className="w-5 h-5 text-blue-600" /> },
    { id: 'port-config', title: '自定义端口配置', icon: <Settings className="w-5 h-5 text-blue-600" /> },
    { id: 'security', title: '全局域网部署', icon: <Shield className="w-5 h-5 text-blue-600" /> },
    { id: 'data-transfer', title: '数据传输机制', icon: <Wifi className="w-5 h-5 text-blue-600" /> },
    { id: 'contact', title: '交流反馈群', icon: <Users className="w-5 h-5 text-blue-600" /> },
  ];

  const scrollToSection = (sectionId: string) => {
    const element = document.getElementById(sectionId);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth' });
      setActiveSection(sectionId);
      // 更新 URL hash
      window.history.pushState(null, '', `#${sectionId}`);
    }
  };

  // 初始化时检查 URL hash 并滚动到对应位置
  useEffect(() => {
    const hash = window.location.hash.replace('#', '');
    if (hash) {
      // 延迟一下确保 DOM 已经渲染完成
      setTimeout(() => {
        const element = document.getElementById(hash);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth' });
          setActiveSection(hash);
        }
      }, 100);
    }
  }, []);

  // 监听滚动事件来更新活跃的章节和 URL hash
  useEffect(() => {
    const handleScroll = () => {
      const scrollPosition = window.scrollY + 100;
      
      // 检查所有可能的section ID（包括子目录）
      const allSectionIds = sections.reduce<string[]>((acc, section) => {
        acc.push(section.id);
        if (section.children) {
          acc.push(...section.children.map(child => child.id));
        }
        return acc;
      }, []);

      for (const sectionId of allSectionIds) {
        const element = document.getElementById(sectionId);
        if (element) {
          const { offsetTop, offsetHeight } = element;
          if (scrollPosition >= offsetTop && scrollPosition < offsetTop + offsetHeight) {
            setActiveSection(sectionId);
            // 更新 URL hash，但不触发页面滚动
            if (window.location.hash !== `#${sectionId}`) {
              window.history.replaceState(null, '', `#${sectionId}`);
            }
            break;
          }
        }
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, [sections]);

  // 计算侧边栏的位置
  useEffect(() => {
    const updateSidebarPosition = () => {
      const container = document.querySelector('.w-\\[95\\%\\]');
      if (container) {
        const containerRect = container.getBoundingClientRect();
        const containerLeft = containerRect.left;
        // 计算第一列的位置（24px padding + grid gap）
        setSidebarLeft(containerLeft + 24);
      }
    };

    updateSidebarPosition();
    window.addEventListener('resize', updateSidebarPosition);
    return () => window.removeEventListener('resize', updateSidebarPosition);
  }, []);

  return (
    <div className="w-[95%] lg:w-[70%] max-w-none mx-auto p-4 lg:p-6">
      {/* Header */}
      <div className="text-center mb-8 lg:mb-12">
        <div className="flex items-center justify-center gap-3 mb-4">
          <div className="p-3 bg-blue-100 rounded-xl">
            <Book className="w-8 h-8 text-blue-600" />
          </div>
          <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">使用帮助</h1>
        </div>
        <p className="text-base lg:text-lg text-gray-600 max-w-2xl mx-auto">
          详细的部署指南和使用说明，帮助您快速上手文件传输工具
        </p>
      </div>

      <div className="relative">
        {/* 返回首页按钮 - 桌面端固定定位 */}
        <div className="hidden lg:block">
          <div 
            className="fixed bg-white rounded-xl shadow-lg border border-gray-200 p-4 z-20"
            style={{ left: `${sidebarLeft}px`, top: '2rem', width: '256px' }}
          >
            <Link 
              href="/" 
              className="flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors hover:bg-blue-50 text-blue-600 hover:text-blue-700"
            >
              <ArrowLeft className="w-5 h-5" />
              <span className="text-sm font-medium">返回首页</span>
            </Link>
          </div>
        </div>

        {/* 返回首页按钮 - 移动端固定定位 */}
        <div className="lg:hidden">
          <div className="fixed left-4 top-4 z-20">
            <Link 
              href="/" 
              className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-lg border border-gray-200 text-blue-600 hover:text-blue-700 hover:bg-blue-50 transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
              <span className="text-xs font-medium">返回首页</span>
            </Link>
          </div>
        </div>

        {/* 侧边栏目录 - 桌面端固定定位 */}
        <div className="hidden lg:block">
          <div 
            className="fixed w-64 bg-white rounded-xl shadow-lg border border-gray-200 p-6 max-h-[calc(100vh-10rem)] overflow-y-auto z-10"
            style={{ left: `${sidebarLeft}px`, top: '7rem' }}
          >
            <h3 className="text-lg font-semibold text-gray-900 mb-4">目录</h3>
            <nav className="space-y-2">
              {sections.map((section) => (
                <div key={section.id}>
                  <button
                    onClick={() => scrollToSection(section.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      activeSection === section.id
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    {section.icon}
                    <span className="text-sm font-medium">{section.title}</span>
                    <ChevronRight className="w-4 h-4 ml-auto" />
                  </button>
                  
                  {/* 子目录 */}
                  {section.children && (
                    <div className="ml-8 mt-1 space-y-1">
                      {section.children.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => scrollToSection(child.id)}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors ${
                            activeSection === child.id
                              ? 'bg-blue-100 text-blue-600 border border-blue-200'
                              : 'hover:bg-gray-50 text-gray-600'
                          }`}
                        >
                          {child.icon}
                          <span className="text-xs text-gray-700">{child.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          </div>
        </div>

        {/* 移动端目录 - 粘性定位 */}
        <div className="lg:hidden mb-6 mt-16">
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 sticky top-4 max-h-[calc(100vh-2rem)] overflow-y-auto">
            <h3 className="text-base font-semibold text-gray-900 mb-3">目录</h3>
            <nav className="space-y-1">
              {sections.map((section) => (
                <div key={section.id}>
                  <button
                    onClick={() => scrollToSection(section.id)}
                    className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-colors ${
                      activeSection === section.id
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'hover:bg-gray-50 text-gray-700'
                    }`}
                  >
                    {section.icon}
                    <span className="text-xs font-medium">{section.title}</span>
                    <ChevronRight className="w-3 h-3 ml-auto" />
                  </button>
                  
                  {/* 子目录 */}
                  {section.children && (
                    <div className="ml-6 mt-1 space-y-1">
                      {section.children.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => scrollToSection(child.id)}
                          className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors ${
                            activeSection === child.id
                              ? 'bg-blue-100 text-blue-600 border border-blue-200'
                              : 'hover:bg-gray-50 text-gray-600'
                          }`}
                        >
                          {child.icon}
                          <span className="text-xs text-gray-700">{child.title}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </nav>
          </div>
        </div>

        {/* 主要内容 */}
        <div className="lg:ml-72 lg:mr-4">
          {/* 部署指南 */}
          <Section id="deployment" title="部署指南" icon={<Server className="w-6 h-6 text-blue-600" />}>
            <div className="space-y-8">
              <div>
                <p className="text-gray-700 mb-6">
                  文件传输工具支持多种部署方式，您可以根据自己的需求选择最适合的部署方案。
                </p>
              </div>

              {/* Docker 部署 */}
              <div className="scroll-mt-20" id="docker-deployment">
                <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Container className="w-6 h-6 text-blue-600" />
                  Docker 部署
                </h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-lg font-semibold mb-3">方法一：使用 Docker Compose（推荐）</h4>
                    <CodeBlock code={`git clone https://github.com/MatrixSeven/file-transfer-go.git
cd file-transfer-go
docker-compose up -d`} />
                  </div>

                  <div>
                    <h4 className="text-lg font-semibold mb-3">方法二：直接使用 Docker 镜像</h4>
                    <CodeBlock code={`docker run -d -p 8080:8080 --name file-transfer-go matrixseven/file-transfer-go:latest`} />
                  </div>

                  <InfoBox type="tip" title="部署提示">
                    <ul className="list-disc list-inside space-y-1">
                      <li>Docker Compose 方式会自动处理依赖和网络配置</li>
                      <li>服务启动后访问 <code className="bg-gray-100 px-2 py-1 rounded">http://localhost:8080</code></li>
                      <li>可以通过修改 <code className="bg-gray-100 px-2 py-1 rounded">docker-compose.yml</code> 自定义端口</li>
                    </ul>
                  </InfoBox>
                </div>
              </div>

              {/* 二进制部署 */}
              <div className="scroll-mt-20" id="binary-deployment">
                <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Download className="w-6 h-6 text-green-600" />
                  二进制部署
                </h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-lg font-semibold mb-3">下载预编译版本</h4>
                    <p className="text-gray-700 mb-3">
                      前往 <a 
                        href="https://github.com/MatrixSeven/file-transfer-go/releases/" 
                        className="text-blue-600 hover:underline inline-flex items-center gap-1"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        GitHub Releases 页面 <ExternalLink className="w-4 h-4" />
                      </a> 下载对应系统的二进制包
                    </p>
                    
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h5 className="font-semibold mb-2">支持的平台：</h5>
                      <ul className="list-disc list-inside space-y-1 text-gray-700">
                        <li>Linux (AMD64/ARM64)</li>
                        <li>Windows (AMD64)</li>
                        <li>macOS (AMD64/ARM64)</li>
                      </ul>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-lg font-semibold mb-3">启动服务</h4>
                    <p className="text-gray-700 mb-3">下载后直接运行可执行文件即可：</p>
                    <CodeBlock code={`# Linux/macOS
chmod +x file-transfer-server-linux-amd64
./file-transfer-server-linux-amd64

# Windows
file-transfer-server-windows-amd64.exe`} />
                  </div>

                  <InfoBox type="info" title="注意事项">
                    <ul className="list-disc list-inside space-y-1">
                      <li>首次运行可能需要防火墙授权</li>
                      <li>默认端口为 8080，可通过参数修改</li>
                      <li>建议在生产环境使用 systemd 等进程管理工具</li>
                    </ul>
                  </InfoBox>
                </div>
              </div>

              {/* 自行构建 */}
              <div className="scroll-mt-20" id="build-deployment">
                <h3 className="text-xl font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Code className="w-6 h-6 text-purple-600" />
                  自行构建
                </h3>
                <div className="space-y-6">
                  <div>
                    <h4 className="text-lg font-semibold mb-3">环境要求</h4>
                    <div className="bg-gray-50 rounded-lg p-4">
                      <ul className="list-disc list-inside space-y-1 text-gray-700">
                        <li>Go 1.21 或更高版本</li>
                        <li>Node.js 18 或更高版本</li>
                        <li>Git</li>
                      </ul>
                    </div>
                  </div>

                  <div>
                    <h4 className="text-lg font-semibold mb-3">构建步骤</h4>
                    <CodeBlock code={`git clone https://github.com/MatrixSeven/file-transfer-go.git
cd file-transfer-go
./build-fullstack.sh 
./dist/file-transfer-go`} />
                  </div>

                  <InfoBox type="warning" title="构建注意事项">
                    <ul className="list-disc list-inside space-y-1">
                      <li>确保网络畅通，需要下载 Go 模块和 npm 包</li>
                      <li>首次构建可能需要较长时间</li>
                      <li>构建脚本会自动处理前后端的编译和打包</li>
                    </ul>
                  </InfoBox>
                </div>
              </div>
            </div>
          </Section>

          {/* 桌面共享权限 */}
          <Section id="desktop-share" title="桌面共享权限问题" icon={<Monitor className="w-6 h-6 text-blue-600" />}>
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Smartphone className="w-5 h-5" />
                  移动端无法共享桌面？
                </h3>
                <InfoBox type="error" title="移动端限制">
                  <p>这是移动端浏览器的限制，WebRTC 没有在移动浏览器端实现获取桌面视频流的功能，所以这个能力无法在移动浏览器端实现。</p>
                  <p className="mt-2 font-semibold">解决方案：请使用桌面设备进行屏幕共享。</p>
                </InfoBox>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Monitor className="w-5 h-5" />
                  PC 端无法共享桌面？
                </h3>
                
                <InfoBox type="warning" title="HTTPS 要求">
                  <p>如果是自行部署，无论是部署在局域网/公网，如果要实现桌面分享，需要必须保证服务访问地址是 TLS 加密，也就是 <code className="bg-gray-100 px-2 py-1 rounded">https</code> 方式访问。</p>
                  <ul className="list-disc list-inside space-y-1 mt-2">
                    <li><code className="bg-gray-100 px-2 py-1 rounded">localhost</code> 地址可以直接分享桌面</li>
                    <li>其他地址需要配置反向代理（如 nginx）启用 HTTPS</li>
                    <li>这是浏览器的安全限制，直接 IP 无法分享桌面</li>
                  </ul>
                </InfoBox>

                <InfoBox type="tip" title="临时解决方案">
                  <p>如果一定要用 IP+端口 的方式进行桌面分享，可以在浏览器设置中：</p>
                  <ol className="list-decimal list-inside space-y-1 mt-2">
                    <li>打开浏览器设置</li>
                    <li>搜索 WebRTC 相关设置</li>
                    <li>开启 <code className="bg-gray-100 px-2 py-1 rounded">Anonymize local IPs exposed by WebRTC</code></li>
                    <li>设置为 <code className="bg-gray-100 px-2 py-1 rounded">Enabled</code> 状态</li>
                  </ol>
                </InfoBox>
              </div>
            </div>
          </Section>

          {/* 端口配置 */}
          <Section id="port-config" title="端口配置" icon={<Settings className="w-6 h-6 text-blue-600" />}>
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-3">修改服务端口</h3>
                <p className="text-gray-700 mb-3">以 Linux 为例，将服务绑定到 18080 端口：</p>
                <CodeBlock code="./file-transfer-server-linux-amd64 -port 18080" />
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">Docker 端口映射</h3>
                <p className="text-gray-700 mb-3">使用 Docker 时修改端口映射：</p>
                <CodeBlock code="docker run -d -p 18080:8080 matrixseven/file-transfer-go:latest" />
              </div>

              <InfoBox type="info" title="端口选择建议">
                <ul className="list-disc list-inside space-y-1">
                  <li>避免使用系统保留端口（1-1024）</li>
                  <li>确保选择的端口未被其他服务占用</li>
                  <li>防火墙需要开放对应端口</li>
                  <li>建议使用 8080, 3000, 8000 等常用端口</li>
                </ul>
              </InfoBox>
            </div>
          </Section>

          {/* 安全内网部署 */}
          <Section id="security" title="安全内网部署" icon={<Shield className="w-6 h-6 text-blue-600" />}>
            <div className="space-y-6">
              <InfoBox type="warning" title="实验性功能">
                <p>以下方案理论可行，但未经充分验证，请在测试环境中验证后再用于生产。</p>
              </InfoBox>

              <div>
                <h3 className="text-lg font-semibold mb-3">内网部署方案</h3>
                <div className="space-y-4">
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-semibold mb-2">1. 部署内网 DNS 服务</h4>
                    <p className="text-gray-700">配置内网域名解析，避免直接使用 IP 地址访问</p>
                  </div>
                  
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-semibold mb-2">2. 配置 STUN/TURN 服务</h4>
                    <p className="text-gray-700">部署内网 STUN/TURN 服务器，处理 NAT 穿透</p>
                  </div>
                  
                  <div className="border-l-4 border-blue-500 pl-4">
                    <h4 className="font-semibold mb-2">3. 更新服务配置</h4>
                    <p className="text-gray-700">在应用设置中配置自定义 STUN/TURN 服务器地址</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">STUN/TURN 服务器推荐</h3>
                <div className="bg-gray-50 rounded-lg p-4">
                  <ul className="list-disc list-inside space-y-1 text-gray-700">
                    <li><strong>Coturn</strong>：开源 TURN/STUN 服务器</li>
                    <li><strong>Janus</strong>：WebRTC 网关，包含 STUN/TURN 功能</li>
                    <li><strong>自建方案</strong>：基于 Docker 快速部署</li>
                  </ul>
                </div>
              </div>

              <InfoBox type="tip" title="配置提示">
                <p>在应用的 设置 页面中，可以添加自定义 ICE 服务器：</p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>STUN 服务器格式：<code className="bg-gray-100 px-2 py-1 rounded">stun:your-server.local:3478</code></li>
                  <li>TURN 服务器格式：<code className="bg-gray-100 px-2 py-1 rounded">turn:your-server.local:3478</code></li>
                  <li>TURN 服务器需要用户名和密码认证</li>
                </ul>
              </InfoBox>
            </div>
          </Section>

          {/* 数据传输说明 */}
          <Section id="data-transfer" title="数据传输机制" icon={<Wifi className="w-6 h-6 text-blue-600" />}>
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-3">传输方式</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border rounded-lg p-4">
                    <h4 className="font-semibold mb-2 text-green-600">✓ 点对点传输</h4>
                    <p className="text-sm text-gray-600">通过 WebRTC 建立直接连接，数据不经过服务器</p>
                  </div>
                  <div className="border rounded-lg p-4">
                    <h4 className="font-semibold mb-2 text-blue-600">✓ 中继传输</h4>
                    <p className="text-sm text-gray-600">当直连失败时，通过 TURN 服务器中继数据</p>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">传输流程</h3>
                <div className="space-y-4">
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold text-sm">1</div>
                    <div>
                      <h4 className="font-semibold">建立信令连接</h4>
                      <p className="text-gray-600">通过 WebSocket 服务器交换连接信息</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold text-sm">2</div>
                    <div>
                      <h4 className="font-semibold">NAT 穿透</h4>
                      <p className="text-gray-600">使用 STUN 服务器检测网络环境，尝试直连</p>
                    </div>
                  </div>
                  <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-8 h-8 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center font-semibold text-sm">3</div>
                    <div>
                      <h4 className="font-semibold">数据传输</h4>
                      <p className="text-gray-600">建立 P2P 连接后直接传输，或通过 TURN 中继</p>
                    </div>
                  </div>
                </div>
              </div>

              <InfoBox type="info" title="隐私保护">
                <ul className="list-disc list-inside space-y-1">
                  <li>所有文件数据通过点对点传输，服务器不存储任何文件内容</li>
                  <li>房间码具有时效性，连接断开后自动失效</li>
                  <li>支持端到端加密，确保传输安全</li>
                  <li>即使使用 TURN 中继，数据也是加密传输的</li>
                </ul>
              </InfoBox>
            </div>
          </Section>

          {/* 交流反馈 */}
          <Section id="contact" title="交流反馈" icon={<Users className="w-6 h-6 text-blue-600" />}>
            <div className="space-y-6">
              <div>
                <h3 className="text-lg font-semibold mb-3">交流群组</h3>
                <div className="flex flex-col md:flex-row gap-6 items-start">
                  <div className="flex-1">
                    <p className="text-gray-700 mb-4">
                      欢迎加入我们的交流群，获取最新更新、技术支持和经验分享：
                    </p>
                    <ul className="list-disc list-inside space-y-2 text-gray-700">
                      <li>报告问题和建议</li>
                      <li>获取使用帮助</li>
                      <li>分享部署经验</li>
                      <li>了解新功能动态</li>
                    </ul>
                  </div>
                  <div className="flex-shrink-0">
                    <div className="bg-gray-50 rounded-lg p-4 text-center">
                      <img 
                        src="https://cdn-img.luxika.cc//i/2025/09/04/68b8f0d135edc.png" 
                        alt="交流反馈群二维码" 
                        className="w-32 h-32 mx-auto rounded-lg"
                      />
                      <p className="text-sm text-gray-600 mt-2">扫码加入交流群</p>
                    </div>
                  </div>
                </div>
              </div>

              <div>
                <h3 className="text-lg font-semibold mb-3">其他联系方式</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="border rounded-lg p-4">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <ExternalLink className="w-5 h-5 text-blue-600" />
                      GitHub Issues
                    </h4>
                    <p className="text-sm text-gray-600 mb-2">提交 Bug 报告和功能请求</p>
                    <a 
                      href="https://github.com/MatrixSeven/file-transfer-go/issues" 
                      className="text-blue-600 hover:underline text-sm"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      前往 Issues 页面 →
                    </a>
                  </div>
                  <div className="border rounded-lg p-4">
                    <h4 className="font-semibold mb-2 flex items-center gap-2">
                      <Book className="w-5 h-5 text-green-600" />
                      项目文档
                    </h4>
                    <p className="text-sm text-gray-600 mb-2">查看详细的技术文档</p>
                    <a 
                      href="https://github.com/MatrixSeven/file-transfer-go" 
                      className="text-blue-600 hover:underline text-sm"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      前往项目主页 →
                    </a>
                  </div>
                </div>
              </div>

              <InfoBox type="tip" title="反馈建议">
                <p>为了更好地帮助您解决问题，请在反馈时提供：</p>
                <ul className="list-disc list-inside space-y-1 mt-2">
                  <li>详细的问题描述和复现步骤</li>
                  <li>部署环境信息（Docker/二进制/自构建）</li>
                  <li>浏览器类型和版本</li>
                  <li>网络环境（内网/公网/NAT类型）</li>
                  <li>相关的错误日志或截图</li>
                </ul>
              </InfoBox>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
}
