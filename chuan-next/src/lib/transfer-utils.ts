/**
 * 传输速度和时间计算工具
 */

export interface TransferSpeed {
  bytesPerSecond: number;
  displaySpeed: string;
  unit: string;
}

export interface TransferProgress {
  totalBytes: number;
  transferredBytes: number;
  percentage: number;
  speed: TransferSpeed;
  remainingTime: {
    seconds: number;
    display: string;
  };
  elapsedTime: {
    seconds: number;
    display: string;
  };
}

/**
 * 格式化传输速度显示
 * @param bytesPerSecond 每秒传输的字节数
 * @returns 格式化的速度显示
 */
export function formatTransferSpeed(bytesPerSecond: number): TransferSpeed {
  if (bytesPerSecond < 1024) {
    return {
      bytesPerSecond,
      displaySpeed: `${bytesPerSecond.toFixed(0)}`,
      unit: 'B/s'
    };
  } else if (bytesPerSecond < 1024 * 1024) {
    const kbps = bytesPerSecond / 1024;
    return {
      bytesPerSecond,
      displaySpeed: `${kbps.toFixed(1)}`,
      unit: 'KB/s'
    };
  } else {
    const mbps = bytesPerSecond / (1024 * 1024);
    return {
      bytesPerSecond,
      displaySpeed: `${mbps.toFixed(1)}`,
      unit: 'MB/s'
    };
  }
}

/**
 * 格式化时间显示
 * @param seconds 秒数
 * @returns 格式化的时间显示
 */
export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) {
    return '--:--';
  }

  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  } else {
    return `${minutes}:${secs.toString().padStart(2, '0')}`;
  }
}

/**
 * 传输进度跟踪器
 */
export class TransferProgressTracker {
  private startTime: number;
  private lastUpdateTime: number;
  private lastSpeedUpdateTime: number;
  private lastProgressUpdateTime: number;
  private lastTransferredBytes: number;
  private speedHistory: number[] = [];
  private readonly maxHistorySize = 10; // 保持最近10个速度样本
  private readonly speedUpdateInterval = 300; // 速度更新间隔：0.3秒
  private readonly progressUpdateInterval = 50; // 进度更新间隔：0.3秒
  private cachedProgress: TransferProgress | null = null;
  private lastDisplayedSpeed: TransferSpeed;
  private lastDisplayedPercentage: number = 0;

  constructor(
    private totalBytes: number,
    private initialTransferredBytes: number = 0
  ) {
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    this.lastSpeedUpdateTime = this.startTime;
    this.lastProgressUpdateTime = this.startTime;
    this.lastTransferredBytes = initialTransferredBytes;
    this.lastDisplayedSpeed = formatTransferSpeed(0);
  }

  /**
   * 更新传输进度
   * @param transferredBytes 已传输的字节数
   * @returns 传输进度信息
   */
  update(transferredBytes: number): TransferProgress {
    const now = Date.now();
    const elapsedTimeMs = now - this.startTime;
    const timeSinceLastUpdate = now - this.lastUpdateTime;
    const timeSinceLastSpeedUpdate = now - this.lastSpeedUpdateTime;
    const timeSinceLastProgressUpdate = now - this.lastProgressUpdateTime;
    
    // 计算即时速度（基于最近的更新）
    let instantSpeed = 0;
    if (timeSinceLastUpdate > 0) {
      const bytesDiff = transferredBytes - this.lastTransferredBytes;
      instantSpeed = (bytesDiff * 1000) / timeSinceLastUpdate; // bytes per second
    }

    // 只有当距离上次速度更新超过指定间隔时才更新速度显示
    let shouldUpdateSpeed = timeSinceLastSpeedUpdate >= this.speedUpdateInterval;
    
    // 只有当距离上次进度更新超过指定间隔时才更新进度显示
    let shouldUpdateProgress = timeSinceLastProgressUpdate >= this.progressUpdateInterval;
    
    // 如果是第一次更新或者传输完成，立即更新速度和进度
    if (this.cachedProgress === null || transferredBytes >= this.totalBytes) {
      shouldUpdateSpeed = true;
      shouldUpdateProgress = true;
    }

    if (shouldUpdateSpeed) {
      // 更新速度历史
      if (instantSpeed > 0) {
        this.speedHistory.push(instantSpeed);
        if (this.speedHistory.length > this.maxHistorySize) {
          this.speedHistory.shift();
        }
      }

      // 计算平均速度
      let averageSpeed = 0;
      if (this.speedHistory.length > 0) {
        averageSpeed = this.speedHistory.reduce((sum, speed) => sum + speed, 0) / this.speedHistory.length;
      } else if (elapsedTimeMs > 0) {
        // 如果没有即时速度历史，使用总体平均速度
        averageSpeed = (transferredBytes * 1000) / elapsedTimeMs;
      }

      // 更新显示的速度
      this.lastDisplayedSpeed = formatTransferSpeed(averageSpeed);
      this.lastSpeedUpdateTime = now;
    }

    // 更新显示的进度百分比
    if (shouldUpdateProgress) {
      const currentPercentage = this.totalBytes > 0 ? (transferredBytes / this.totalBytes) * 100 : 0;
      this.lastDisplayedPercentage = Math.min(currentPercentage, 100);
      this.lastProgressUpdateTime = now;
    }

    // 计算剩余时间（使用当前显示的速度）
    const remainingBytes = this.totalBytes - transferredBytes;
    const remainingTimeSeconds = this.lastDisplayedSpeed.bytesPerSecond > 0 
      ? remainingBytes / this.lastDisplayedSpeed.bytesPerSecond 
      : Infinity;

    // 更新跟踪状态
    this.lastUpdateTime = now;
    this.lastTransferredBytes = transferredBytes;

    // 创建进度对象（使用稳定的进度值）
    const progress: TransferProgress = {
      totalBytes: this.totalBytes,
      transferredBytes,
      percentage: this.lastDisplayedPercentage,
      speed: this.lastDisplayedSpeed,
      remainingTime: {
        seconds: remainingTimeSeconds,
        display: formatTime(remainingTimeSeconds)
      },
      elapsedTime: {
        seconds: elapsedTimeMs / 1000,
        display: formatTime(elapsedTimeMs / 1000)
      }
    };

    // 缓存进度信息
    this.cachedProgress = progress;
    
    return progress;
  }

  /**
   * 重置跟踪器
   */
  reset(totalBytes?: number, initialTransferredBytes: number = 0) {
    if (totalBytes !== undefined) {
      this.totalBytes = totalBytes;
    }
    this.startTime = Date.now();
    this.lastUpdateTime = this.startTime;
    this.lastSpeedUpdateTime = this.startTime;
    this.lastProgressUpdateTime = this.startTime;
    this.lastTransferredBytes = initialTransferredBytes;
    this.speedHistory = [];
    this.cachedProgress = null;
    this.lastDisplayedSpeed = formatTransferSpeed(0);
    this.lastDisplayedPercentage = 0;
  }

  /**
   * 获取总字节数
   */
  getTotalBytes(): number {
    return this.totalBytes;
  }

  /**
   * 获取平均速度（整个传输过程）
   */
  getOverallAverageSpeed(): number {
    const elapsedTimeMs = Date.now() - this.startTime;
    if (elapsedTimeMs > 0) {
      return (this.lastTransferredBytes * 1000) / elapsedTimeMs;
    }
    return 0;
  }
}

/**
 * 创建传输进度跟踪器
 * @param totalBytes 总字节数
 * @param initialTransferredBytes 初始已传输字节数
 * @returns 传输进度跟踪器实例
 */
export function createTransferTracker(totalBytes: number, initialTransferredBytes: number = 0): TransferProgressTracker {
  return new TransferProgressTracker(totalBytes, initialTransferredBytes);
}

/**
 * 简单的传输速度计算（无状态）
 * @param transferredBytes 已传输字节数
 * @param elapsedTimeMs 经过的时间（毫秒）
 * @returns 格式化的速度
 */
export function calculateSpeed(transferredBytes: number, elapsedTimeMs: number): TransferSpeed {
  if (elapsedTimeMs <= 0) {
    return formatTransferSpeed(0);
  }
  
  const bytesPerSecond = (transferredBytes * 1000) / elapsedTimeMs;
  return formatTransferSpeed(bytesPerSecond);
}

/**
 * 计算剩余时间
 * @param remainingBytes 剩余字节数
 * @param bytesPerSecond 每秒传输字节数
 * @returns 格式化的剩余时间
 */
export function calculateRemainingTime(remainingBytes: number, bytesPerSecond: number): string {
  if (bytesPerSecond <= 0 || remainingBytes <= 0) {
    return '--:--';
  }
  
  const remainingSeconds = remainingBytes / bytesPerSecond;
  return formatTime(remainingSeconds);
}
