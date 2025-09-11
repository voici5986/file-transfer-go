#!/bin/bash
set -e

echo "🚀 构建并部署前端..."

# 构建前端
cd chuan-next
npm run build:ssg
cd ..

# 压缩
tar -czf /tmp/frontend.tar.gz -C chuan-next/out .

# 创建服务器目录并上传
ssh root@101.33.214.22 "mkdir -p /root/file-transfer/chuan-next"
scp /tmp/frontend.tar.gz root@101.33.214.22:/root/file-transfer/chuan-next/

ssh root@101.33.214.22 << 'EOF'
cd /root/file-transfer/chuan-next
# 备份 api 目录
[ -d current/api ] && cp -r current/api /tmp/api-backup
# 解压新版本
rm -rf current
mkdir current
cd current
tar -xzf ../frontend.tar.gz
# 还原 api 目录
[ -d /tmp/api-backup ] && cp -r /tmp/api-backup ./api && rm -rf /tmp/api-backup
# 清理压缩包
rm -f ../frontend.tar.gz
EOF

# 清理本地文件
rm -f /tmp/frontend.tar.gz
rm -rf chuan-next/out

echo "✅ 部署完成"
