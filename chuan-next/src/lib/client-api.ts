/**
 * 客户端 API 工具类
 * 用于在静态导出模式下直接与 Go 后端通信
 */

import { config } from './config';

interface ApiResponse {
  success: boolean;
  message?: string;
  data?: unknown;
}

export class ClientAPI {
  private baseUrl: string;

  constructor() {
    // 根据环境选择合适的API地址
    if (config.isStatic) {
      // 静态模式：直接连接 Go 后端
      this.baseUrl = config.api.directBackendUrl;
    } else {
      // 开发模式：通过 Next.js API 路由
      this.baseUrl = config.api.baseUrl;
    }
  }

  /**
   * 发送 POST 请求
   */
  async post(endpoint: string, data: unknown): Promise<ApiResponse> {
    const url = this.baseUrl.replace(/\/$/, '') + (endpoint.startsWith('/') ? endpoint : `/${endpoint}`);
    
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json() as ApiResponse;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * 发送 GET 请求
   */
  async get(endpoint: string): Promise<ApiResponse> {
    const url = this.baseUrl.replace(/\/$/, '') + (endpoint.startsWith('/') ? endpoint : `/${endpoint}`);
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      return await response.json() as ApiResponse;
    } catch (error) {
      console.error('API request failed:', error);
      throw error;
    }
  }

  /**
   * 创建房间（简化版本）- 后端会忽略传入的参数
   */
  async createRoom(): Promise<ApiResponse> {
    return this.post('/api/create-room', {});
  }

  /**
   * 获取文本内容
   */
  async getTextContent(code: string): Promise<ApiResponse> {
    return this.get(`/api/get-text-content?code=${code}`);
  }

  /**
   * 更新文本内容
   */
  async updateTextContent(code: string, content: string): Promise<ApiResponse> {
    return this.post('/api/update-text-content', {
      code: code,
      content: content
    });
  }

  /**
   * 获取房间信息
   */
  async getRoomInfo(code: string): Promise<ApiResponse> {
    return this.get(`/api/room-info?code=${code}`);
  }
}

// 导出单例实例
export const clientAPI = new ClientAPI();
