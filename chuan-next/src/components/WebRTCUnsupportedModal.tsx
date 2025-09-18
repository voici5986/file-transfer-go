import { WebRTCSupport, getBrowserInfo, getRecommendedBrowsers } from '@/lib/webrtc-support';
import { AlertTriangle, Chrome, Download, Monitor, X } from 'lucide-react';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  webrtcSupport: WebRTCSupport;
}

/**
 * WebRTC 不支持提示模态框
 */
export function WebRTCUnsupportedModal({ isOpen, onClose, webrtcSupport }: Props) {
  const browserInfo = getBrowserInfo();
  const recommendedBrowsers = getRecommendedBrowsers();

  if (!isOpen) return null;

  const handleBrowserDownload = (url: string) => {
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto border border-gray-100">
        {/* 头部 */}
        <div className="flex items-center justify-between p-6 bg-gradient-to-r from-rose-50 to-orange-50 border-b border-orange-100 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-gradient-to-r from-orange-500 to-red-500 rounded-xl shadow-lg">
              <AlertTriangle className="h-6 w-6 text-white" />
            </div>
            <h2 className="text-xl font-bold bg-gradient-to-r from-orange-600 to-red-600 bg-clip-text text-transparent">
              浏览器兼容性提醒
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg p-1 transition-all duration-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 内容 */}
        <div className="p-6 space-y-6">
          {/* 当前浏览器信息 */}
          <div className="bg-gradient-to-r from-rose-50 to-orange-50 border border-orange-200 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-orange-800 mb-3 flex items-center gap-2">
              <div className="w-2 h-2 bg-orange-500 rounded-full"></div>
              当前浏览器状态
            </h3>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                <span className="text-gray-700"><strong>浏览器:</strong> {browserInfo.name} {browserInfo.version}</span>
              </div>
              <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                <span className="text-gray-700"><strong>WebRTC 支持:</strong></span>
                <span className="px-3 py-1 bg-gradient-to-r from-orange-500 to-red-500 text-white rounded-full text-xs font-medium shadow-sm">
                  不支持
                </span>
              </div>
            </div>
          </div>

          {/* 缺失的功能 */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              缺失的功能
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {webrtcSupport.missing.map((feature, index) => (
                <div key={index} className="flex items-center gap-3 p-3 bg-gradient-to-r from-gray-50 to-blue-50 rounded-lg border border-gray-200">
                  <div className="w-2 h-2 bg-gradient-to-r from-orange-400 to-red-500 rounded-full"></div>
                  <span className="text-sm text-gray-700">{feature}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 功能说明 */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-5 shadow-sm">
            <h3 className="font-semibold text-blue-800 mb-4 flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              为什么需要 WebRTC？
            </h3>
            <div className="space-y-4 text-sm">
              <div className="flex items-start gap-3 p-3 bg-white/70 rounded-lg">
                <div className="p-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg shadow-sm">
                  <Monitor className="h-4 w-4 text-white" />
                </div>
                <div>
                  <div className="font-medium text-blue-800">屏幕共享</div>
                  <div className="text-blue-600">实时共享您的桌面屏幕</div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-white/70 rounded-lg">
                <div className="p-2 bg-gradient-to-r from-green-500 to-emerald-500 rounded-lg shadow-sm">
                  <Download className="h-4 w-4 text-white" />
                </div>
                <div>
                  <div className="font-medium text-blue-800">文件传输</div>
                  <div className="text-blue-600">点对点直接传输文件，快速且安全</div>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-white/70 rounded-lg">
                <div className="p-2 bg-gradient-to-r from-purple-500 to-pink-500 rounded-lg shadow-sm">
                  <Chrome className="h-4 w-4 text-white" />
                </div>
                <div>
                  <div className="font-medium text-blue-800">文本传输</div>
                  <div className="text-blue-600">实时文本和图像传输</div>
                </div>
              </div>
            </div>
          </div>

          {/* 浏览器推荐 */}
          <div className="space-y-4">
            <h3 className="font-semibold text-gray-900 flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              推荐使用以下浏览器
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {recommendedBrowsers.map((browser, index) => (
                <div
                  key={index}
                  className="group border border-gray-200 rounded-xl p-4 hover:border-blue-300 hover:shadow-lg transition-all duration-200 cursor-pointer bg-gradient-to-br from-white to-gray-50 hover:from-blue-50 hover:to-indigo-50"
                  onClick={() => handleBrowserDownload(browser.downloadUrl)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="font-semibold text-gray-900 group-hover:text-blue-800 transition-colors">{browser.name}</h4>
                      <p className="text-sm text-gray-600 group-hover:text-blue-600 transition-colors">版本 {browser.minVersion}</p>
                    </div>
                    <div className="p-2 bg-gradient-to-r from-blue-500 to-indigo-500 rounded-lg shadow-sm group-hover:shadow-md transition-all duration-200">
                      <Download className="h-5 w-5 text-white" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 浏览器特定建议 */}
          {browserInfo.recommendations && (
            <div className="bg-gradient-to-r from-amber-50 to-yellow-50 border border-amber-200 rounded-xl p-5 shadow-sm">
              <h3 className="font-semibold text-amber-800 mb-3 flex items-center gap-2">
                <div className="w-2 h-2 bg-amber-500 rounded-full"></div>
                专属建议
              </h3>
              <ul className="space-y-2 text-sm">
                {browserInfo.recommendations.map((recommendation, index) => (
                  <li key={index} className="flex items-start gap-3 p-3 bg-white/70 rounded-lg">
                    <div className="w-1.5 h-1.5 bg-gradient-to-r from-amber-400 to-orange-500 rounded-full mt-2 flex-shrink-0"></div>
                    <span className="text-amber-700">{recommendation}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 技术详情（可折叠） */}
          <details className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
            <summary className="p-4 cursor-pointer font-semibold text-gray-900 hover:bg-gradient-to-r hover:from-gray-50 hover:to-blue-50 transition-all duration-200">
              🔧 技术详情
            </summary>
            <div className="p-4 border-t border-gray-200 bg-gradient-to-r from-gray-50 to-blue-50 space-y-3 text-sm">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-3 bg-white rounded-lg shadow-sm">
                  <div className="flex items-center justify-between">
                    <strong className="text-gray-700">RTCPeerConnection</strong>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${webrtcSupport.details.rtcPeerConnection
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                        : 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                      }`}>
                      {webrtcSupport.details.rtcPeerConnection ? '✓ 支持' : '✗ 不支持'}
                    </span>
                  </div>
                </div>
                <div className="p-3 bg-white rounded-lg shadow-sm">
                  <div className="flex items-center justify-between">
                    <strong className="text-gray-700">DataChannel</strong>
                    <span className={`px-3 py-1 rounded-full text-xs font-medium ${webrtcSupport.details.dataChannel
                        ? 'bg-gradient-to-r from-green-500 to-emerald-500 text-white'
                        : 'bg-gradient-to-r from-orange-500 to-red-500 text-white'
                      }`}>
                      {webrtcSupport.details.dataChannel ? '✓ 支持' : '✗ 不支持'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </details>
        </div>

        {/* 底部按钮 */}
        <div className="flex justify-end gap-3 p-6 border-t border-gray-200 bg-gradient-to-r from-gray-50 to-blue-50 rounded-b-2xl">
          <button
            onClick={onClose}
            className="px-6 py-2 text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 rounded-lg transition-all duration-200 shadow-sm hover:shadow-md"
          >
            我知道了
          </button>
          <button
            onClick={() => handleBrowserDownload('https://www.google.com/chrome/')}
            className="px-6 py-2 text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 rounded-lg transition-all duration-200 shadow-md hover:shadow-lg transform hover:-translate-y-0.5"
          >
            下载 Chrome 浏览器
          </button>
        </div>
      </div>
    </div>
  );
}
