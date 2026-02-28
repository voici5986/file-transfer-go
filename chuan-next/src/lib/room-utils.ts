/**
 * 房间验证工具函数
 * 统一房间代码验证和房间状态检查逻辑
 */

export interface RoomValidationResult {
  success: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

/**
 * 验证房间代码格式
 */
export function validateRoomCode(code: string): string | null {
  const trimmedCode = code.trim();
  if (!trimmedCode || trimmedCode.length !== 6) {
    return '请输入正确的6位取件码';
  }
  return null;
}

/**
 * 检查房间状态（调用 /api/room-info）
 * 统一处理房间不存在、过期、已满、发送方不在线等情况
 */
export async function checkRoomStatus(code: string): Promise<RoomValidationResult> {
  try {
    const response = await fetch(`/api/room-info?code=${code}`);

    if (!response.ok) {
      return {
        success: false,
        error: `HTTP ${response.status}: 无法检查房间状态`,
      };
    }

    const result = await response.json();

    if (!result.success) {
      let errorMessage = result.message || '房间不存在或已过期';
      if (result.message?.includes('房间人数已满') || result.message?.includes('正在传输中无法加入')) {
        errorMessage = '当前房间人数已满，正在传输中无法加入，请稍后再试';
      } else if (result.message?.includes('expired')) {
        errorMessage = '房间已过期，请联系发送方重新创建';
      } else if (result.message?.includes('not found')) {
        errorMessage = '房间不存在，请检查取件码是否正确';
      }
      return { success: false, error: errorMessage };
    }

    // 检查房间是否已满
    if (result.is_room_full) {
      return {
        success: false,
        error: '当前房间人数已满，正在传输中无法加入，请稍后再试',
      };
    }

    // 检查发送方是否在线
    if (!result.sender_online) {
      return {
        success: false,
        error: '发送方不在线，请确认取件码是否正确或联系发送方',
      };
    }

    return { success: true, data: result };
  } catch (error) {
    const message =
      error instanceof Error
        ? handleNetworkError(error)
        : '检查房间状态失败';
    return { success: false, error: message };
  }
}

/**
 * 网络错误统一处理
 */
export function handleNetworkError(error: Error): string {
  if (error.message.includes('network') || error.message.includes('fetch')) {
    return '网络连接失败，请检查网络状况';
  } else if (error.message.includes('timeout')) {
    return '请求超时，请重试';
  } else if (error.message.includes('HTTP 404')) {
    return '房间不存在，请检查取件码';
  } else if (error.message.includes('HTTP 500')) {
    return '服务器错误，请稍后重试';
  } else if (error.message.includes('房间人数已满') || error.message.includes('正在传输中无法加入')) {
    return '当前房间人数已满，正在传输中无法加入，请稍后再试';
  }
  return error.message;
}
