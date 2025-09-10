import { Metadata } from 'next'

export const metadata: Metadata = {
  title: '使用帮助 - 文件传输工具',
  description: '详细的部署指南和使用说明，帮助您快速上手文件传输工具',
  keywords: ['文件传输', '帮助文档', '部署指南', 'WebRTC', '使用说明'],
}

export default function HelpLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return children
}
