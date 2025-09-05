"use client";

import React from 'react';
import { Github, HelpCircle } from 'lucide-react';
import Link from 'next/link';

export default function Hero() {
  return (
    <div className="text-center mb-6 animate-fade-in-up">
      <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-indigo-600 bg-clip-text text-transparent mb-2">
        文件快传
      </h1>
      <p className="text-sm sm:text-base text-slate-600 max-w-xl mx-auto leading-relaxed px-4 mb-3">
        安全、快速、简单的传输服务
        <br />
        <span className="text-xs sm:text-sm text-slate-500">基于WebRTC的端到端服务 - 无需注册，即传即用</span>
      </p>
      
      {/* GitHub开源链接和帮助 */}
      <div className="flex items-center justify-center gap-2 mb-4">
        <a 
          href="https://github.com/MatrixSeven/file-transfer-go" 
          target="_blank" 
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs sm:text-sm text-slate-600 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-full transition-colors duration-200 border border-slate-200 hover:border-slate-300"
        >
          <Github className="w-3 h-3 sm:w-4 sm:h-4" />
          <span className="font-medium">开源项目</span>
        </a>
        
        <Link 
          href="/help"
          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs sm:text-sm text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-full transition-colors duration-200 border border-blue-200 hover:border-blue-300"
        >
          <HelpCircle className="w-3 h-3 sm:w-4 sm:h-4" />
          <span className="font-medium">使用帮助</span>
        </Link>
      </div>
      
      <div className="flex items-center justify-center">
        <a 
          href="https://github.com/MatrixSeven/file-transfer-go"
          target="_blank" 
          rel="noopener noreferrer"
          className="text-xs text-slate-500 hover:text-slate-700 hover:underline transition-colors duration-200"
        >
          https://github.com/MatrixSeven/file-transfer-go
        </a>
      </div>
      
      {/* 分割线 */}
      <div className="w-64 sm:w-80 md:w-96 lg:w-[32rem] xl:w-[40rem] h-0.5 bg-gradient-to-r from-blue-400 via-purple-400 to-indigo-400 mx-auto mt-2 mb-2 opacity-60"></div>
    </div>
  );
}
