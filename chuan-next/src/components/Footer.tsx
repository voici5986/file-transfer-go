"use client";

import React from 'react';
import { Github, HelpCircle, MessageCircle, Bug } from 'lucide-react';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="mt-auto py-4 shrink-0">
      <div className="container mx-auto px-4">
        {/* 分割线 */}
        <div className="w-full h-px bg-gradient-to-r from-transparent via-slate-200 to-transparent mb-4"></div>
        
        {/* 链接区域 */}
        <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4 text-sm">
          <Link 
            href="/help"
            className="text-slate-500 hover:text-blue-500 transition-colors duration-200 flex items-center gap-1"
          >
            <HelpCircle className="w-3.5 h-3.5" />
            帮助
          </Link>
          
          <a 
            href="https://github.com/MatrixSeven/file-transfer-go" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-slate-700 transition-colors duration-200 flex items-center gap-1"
          >
            <Github className="w-3.5 h-3.5" />
            开源地址
          </a>
          
          <a 
            href="https://x.com/_MatrixSeven" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-blue-400 transition-colors duration-200 flex items-center gap-1"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            X
          </a>
          
          <a 
            href="https://github.com/MatrixSeven/file-transfer-go/issues" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-slate-500 hover:text-orange-500 transition-colors duration-200 flex items-center gap-1"
          >
            <Bug className="w-3.5 h-3.5" />
            Issue
          </a>
        </div>
        
        {/* 版权信息 */}
        <div className="text-center mt-3">
          <p className="text-xs text-slate-400">
            基于 WebRTC 的端到端文件传输服务
          </p>
        </div>
      </div>
    </footer>
  );
}
