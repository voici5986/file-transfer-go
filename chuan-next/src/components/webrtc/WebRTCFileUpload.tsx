"use client";

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, FileText, Image, Video, Music, Archive, X, Clock, Zap } from 'lucide-react';
import RoomInfoDisplay from '@/components/RoomInfoDisplay';
import { ConnectionStatus } from '@/components/ConnectionStatus';
import { TransferProgressTracker, formatTransferSpeed, formatTime } from '@/lib/transfer-utils';


interface FileInfo {
  id: string;
  name: string;
  size: number;
  type: string;
  status: 'ready' | 'downloading' | 'completed';
  progress: number;
  transferSpeed?: number; // bytes per second
  startTime?: number; // 传输开始时间
}

const getFileIcon = (mimeType: string) => {
  if (mimeType.startsWith('image/')) return <Image className="w-5 h-5 text-white" />;
  if (mimeType.startsWith('video/')) return <Video className="w-5 h-5 text-white" />;
  if (mimeType.startsWith('audio/')) return <Music className="w-5 h-5 text-white" />;
  if (mimeType.includes('zip') || mimeType.includes('rar')) return <Archive className="w-5 h-5 text-white" />;
  return <FileText className="w-5 h-5 text-white" />;
};

const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

interface WebRTCFileUploadProps {
  selectedFiles: File[];
  fileList?: FileInfo[]; // 添加文件列表信息（包含状态和进度）
  onFilesChange: (files: File[]) => void;
  onGenerateCode: () => void;
  pickupCode?: string;
  pickupLink?: string;
  onCopyCode?: () => void;
  onCopyLink?: () => void;
  onAddMoreFiles?: () => void;
  onRemoveFile?: (updatedFiles: File[]) => void;
  onClearFiles?: () => void;
  onReset?: () => void;
  disabled?: boolean;
}

export function WebRTCFileUpload({
  selectedFiles,
  fileList = [],
  onFilesChange,
  onGenerateCode,
  pickupCode,
  pickupLink,
  onCopyCode,
  onCopyLink,
  onAddMoreFiles,
  onRemoveFile,
  onClearFiles,
  onReset,
  disabled = false
}: WebRTCFileUploadProps) {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // 用于跟踪传输进度的trackers
  const transferTrackers = useRef<Map<string, TransferProgressTracker>>(new Map());

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      onFilesChange([...selectedFiles, ...files]);
    }
  }, [selectedFiles, onFilesChange]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 0) {
      onFilesChange([...selectedFiles, ...files]);
    }
  }, [selectedFiles, onFilesChange]);

  const removeFile = useCallback((index: number) => {
    const updatedFiles = selectedFiles.filter((_, i) => i !== index);
    onFilesChange(updatedFiles);
    if (onRemoveFile) {
      onRemoveFile(updatedFiles);
    }
  }, [selectedFiles, onFilesChange, onRemoveFile]);

  const handleClick = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  }, []);

  // 如果没有选择文件，显示上传区域
  if (selectedFiles.length === 0 && !pickupCode) {
    return (
      <div className="space-y-6">
        {/* 功能标题 */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-xl flex items-center justify-center">
              <Upload className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-800">选择文件</h2>
              <p className="text-sm text-slate-600">拖拽文件到下方区域或点击选择文件</p>
            </div>
          </div>
          
          <ConnectionStatus 
            currentRoom={null}
          />
        </div>
        
        <div
          className={`upload-area rounded-xl p-6 sm:p-8 md:p-12 text-center cursor-pointer ${
            isDragOver ? 'drag-active' : ''
          }`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={handleClick}
        >
          <div className={`transition-all duration-300 ${isDragOver ? 'scale-110' : ''}`}>
            <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 sm:mb-6 bg-gradient-to-br from-blue-100 to-indigo-100 rounded-full flex items-center justify-center">
              <Upload className={`w-8 h-8 sm:w-10 sm:h-10 transition-colors duration-300 ${
                isDragOver ? 'text-blue-600' : 'text-slate-400'
              }`} />
            </div>
            <div className="space-y-2">
              <p className="text-lg sm:text-xl font-medium text-slate-700">
                {isDragOver ? '释放文件' : '拖拽文件到这里'}
              </p>
              <p className="text-sm sm:text-base text-slate-500">
                或者 <span className="text-blue-600 font-medium underline">点击选择文件</span>
              </p>
              <p className="text-xs sm:text-sm text-slate-400 mt-4">
                支持多个文件同时上传，WebRTC点对点传输
              </p>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={handleFileSelect}
            disabled={disabled}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      {/* 文件列表 */}
      <div>
        {/* 功能标题和状态 */}
        <div className="flex items-center justify-between mb-6">
          {/* 标题部分 */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-gradient-to-br from-emerald-500 to-teal-500 rounded-xl flex items-center justify-center flex-shrink-0">
              <FileText className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-slate-800">已选择文件</h3>
              <p className="text-sm text-slate-600">{selectedFiles.length} 个文件准备传输</p>
            </div>
          </div>
          
          {/* 使用 ConnectionStatus 组件 */}
          <ConnectionStatus 
            currentRoom={pickupCode ? { code: pickupCode, role: 'sender' } : null}
          />
        </div>

        <div className="space-y-3 mb-4 sm:mb-6">
          {selectedFiles.map((file, index) => {
            // 查找对应的文件信息（包含状态和进度）
            const fileInfo = fileList.find(f => f.name === file.name && f.size === file.size);
            const isTransferringThisFile = fileInfo?.status === 'downloading';
            const fileStatus = fileInfo?.status || 'ready';
            
            // 计算传输进度信息
            let transferInfo = null;
            let currentProgress = 0; // 使用稳定的进度值
            
            if (isTransferringThisFile && fileInfo) {
              const fileKey = `${file.name}-${file.size}`;
              let tracker = transferTrackers.current.get(fileKey);
              
              // 如果tracker不存在，创建一个新的
              if (!tracker) {
                tracker = new TransferProgressTracker(file.size);
                transferTrackers.current.set(fileKey, tracker);
              }
              
              // 更新传输进度
              const transferredBytes = (fileInfo.progress / 100) * file.size;
              const progressInfo = tracker.update(transferredBytes);
              transferInfo = progressInfo;
              currentProgress = progressInfo.percentage; // 使用稳定的百分比
            } else {
              // 如果不在传输中，使用原始进度值
              currentProgress = fileInfo?.progress || 0;
            }

            // 清理已完成的tracker
            if (fileStatus === 'completed') {
              const fileKey = `${file.name}-${file.size}`;
              transferTrackers.current.delete(fileKey);
            }
            
            return (
              <div
                key={`${file.name}-${file.size}-${index}`}
                className="group bg-gradient-to-r from-slate-50 to-blue-50 border border-slate-200 rounded-xl hover:shadow-md transition-all duration-200"
              >
                <div className="flex items-center justify-between p-3 sm:p-4">
                  <div className="flex items-center space-x-3 sm:space-x-4 min-w-0 flex-1">
                    <div className="w-10 h-10 sm:w-12 sm:h-12 bg-gradient-to-br from-blue-500 to-indigo-500 rounded-lg flex items-center justify-center flex-shrink-0">
                      {getFileIcon(file.type)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-slate-800 truncate text-sm sm:text-base">{file.name}</p>
                      <div className="flex items-center space-x-2">
                        <p className="text-xs sm:text-sm text-slate-500">{formatFileSize(file.size)}</p>
                        {fileStatus === 'downloading' && (
                          <div className="flex items-center space-x-1">
                            <div className="w-1 h-1 bg-orange-500 rounded-full animate-pulse"></div>
                            <span className="text-xs text-orange-600 font-medium">传输中</span>
                          </div>
                        )}
                        {fileStatus === 'completed' && (
                          <div className="flex items-center space-x-1">
                            <div className="w-1 h-1 bg-emerald-500 rounded-full"></div>
                            <span className="text-xs text-emerald-600 font-medium">已完成</span>
                          </div>
                        )}
                      </div>
                      
                      {/* 传输速度和剩余时间信息 */}
                      {transferInfo && (
                        <div className="flex items-center space-x-3 mt-1">
                          <div className="flex items-center gap-1 text-xs text-blue-600">
                            <Zap className="w-3 h-3 flex-shrink-0" />
                            <span className="w-3 font-mono text-right">{transferInfo.speed.displaySpeed}</span>
                              <span className='w-2'/>
                            <span className="w-3">{transferInfo.speed.unit}</span>
                                   <span className='w-3'/>
                          </div>
                          {transferInfo.remainingTime.seconds < Infinity && (
                            <div className="flex items-center gap-1 text-xs text-slate-600">
                              <Clock className="w-3 h-3 flex-shrink-0" />
                              <span>剩余</span>
                              <span className="w-3 font-mono text-right">{transferInfo.remainingTime.display}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFile(index)}
                    disabled={disabled || fileStatus === 'downloading'}
                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all duration-200 flex-shrink-0 ml-2 disabled:opacity-50"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
                
                {/* 传输进度条 */}
                {(fileStatus === 'downloading' || fileStatus === 'completed') && currentProgress > 0 && (
                  <div className="px-3 sm:px-4 pb-3 sm:pb-4">
                    <div className="space-y-2">
                      <div className="flex justify-between text-xs text-slate-600">
                        <span>
                          {fileStatus === 'downloading' ? '正在发送...' : '发送完成'}
                        </span>
                        <span className="font-medium">{currentProgress.toFixed(1)}%</span>
                      </div>
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full transition-all duration-300 ${
                            fileStatus === 'completed'
                              ? 'bg-gradient-to-r from-emerald-500 to-emerald-600' 
                              : 'bg-gradient-to-r from-orange-500 to-orange-600'
                          }`}
                          style={{ width: `${currentProgress}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* 操作按钮 */}
        <div className="flex flex-col sm:flex-row gap-3">
          {!pickupCode && (
            <>
              <Button
                onClick={onGenerateCode}
                disabled={disabled || selectedFiles.length === 0}
                className="button-primary text-white px-6 sm:px-8 py-3 rounded-xl font-medium flex-1 min-w-0 shadow-lg"
              >
                <Upload className="w-5 h-5 mr-2" />
                生成取件码
              </Button>
              <Button
                onClick={onAddMoreFiles}
                variant="outline"
                disabled={disabled}
                className="px-6 sm:px-8 py-3 rounded-xl font-medium"
              >
                添加文件
              </Button>
              <Button
                onClick={onReset}
                variant="outline"
                disabled={disabled}
                className="text-red-600 hover:bg-red-50 px-6 sm:px-8 py-3 rounded-xl font-medium"
              >
                重新选择
              </Button>
            </>
          )}
          
          {pickupCode && (
            <>
              <Button
                variant="outline"
                onClick={onAddMoreFiles}
                disabled={disabled}
                className="px-6 py-3 rounded-xl border-slate-300 text-slate-600 hover:bg-slate-50 flex-1"
              >
                添加更多文件
              </Button>
              
              {selectedFiles.length > 0 && onClearFiles && (
                <Button
                  variant="outline"
                  onClick={onClearFiles}
                  disabled={disabled}
                  className="px-6 py-3 rounded-xl border-orange-300 text-orange-600 hover:bg-orange-50"
                >
                  清空文件
                </Button>
              )}
            </>
          )}
          
          <Button
            variant="outline"
            onClick={onReset}
            disabled={disabled}
            className="px-6 py-3 rounded-xl border-red-300 text-red-600 hover:bg-red-50"
          >
            关闭房间
          </Button>
        </div>
      </div>

      {/* 取件码展示 */}
      {pickupCode && pickupLink && (
        <RoomInfoDisplay
          code={pickupCode}
          link={pickupLink}
          icon={FileText}
          iconColor="from-emerald-500 to-teal-500"
          codeColor="from-emerald-600 to-teal-600"
          title="取件码生成成功！"
          subtitle="分享以下信息给接收方"
          codeLabel="取件码"
          qrLabel="扫码传输"
          copyButtonText="复制取件码"
          copyButtonColor="bg-emerald-500 hover:bg-emerald-600"
          qrButtonText="使用手机扫码快速访问"
          linkButtonText="复制链接"
          onCopyCode={onCopyCode || (() => {})}
          onCopyLink={onCopyLink || (() => {})}
        />
      )}
    </div>
  );
}
