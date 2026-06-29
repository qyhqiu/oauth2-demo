#!/bin/bash

echo ""
echo "🚀 启动 OAuth2 Demo 项目..."
echo ""

# 检查依赖是否安装
check_and_install() {
  local dir=$1
  local name=$2
  if [ ! -d "$dir/node_modules" ]; then
    echo "📦 正在安装 $name 依赖..."
    cd "$dir" && npm install && cd -
    echo "✅ $name 依赖安装完成"
  fi
}

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

check_and_install "$ROOT_DIR/oauth2-server" "OAuth2 服务端"
check_and_install "$ROOT_DIR/oauth2-login" "OAuth2 登录页"
check_and_install "$ROOT_DIR/app-a" "应用 A"
check_and_install "$ROOT_DIR/app-b" "应用 B"
check_and_install "$ROOT_DIR/oauth2-console" "OAuth2 控制台"

echo ""
echo "🎯 启动所有服务..."
echo ""

# 启动 OAuth2 服务端
cd "$ROOT_DIR/oauth2-server" && npm start &
OAUTH2_PID=$!
echo "✅ OAuth2 服务端启动中... (PID: $OAUTH2_PID, 端口: 3000)"

sleep 1

# 启动 OAuth2 登录页（Vite）
cd "$ROOT_DIR/oauth2-login" && npm start &
LOGIN_PID=$!
echo "✅ OAuth2 登录页启动中... (PID: $LOGIN_PID, 端口: 3001)"

# 启动应用 A（Vite）
cd "$ROOT_DIR/app-a" && npm start &
APP_A_PID=$!
echo "✅ 应用 A 启动中... (PID: $APP_A_PID, 端口: 3002)"

# 启动应用 B（Vite）
cd "$ROOT_DIR/app-b" && npm start &
APP_B_PID=$!
echo "✅ 应用 B 启动中... (PID: $APP_B_PID, 端口: 3003)"

# 启动 OAuth2 控制台
cd "$ROOT_DIR/oauth2-console" && npm run dev &
CONSOLE_PID=$!
echo "✅ OAuth2 控制台启动中... (PID: $CONSOLE_PID, 端口: 3010)"

echo ""
echo "================================================"
echo "  OAuth2 Demo 启动完成！"
echo "================================================"
echo "  🔐 OAuth2 服务端:    http://localhost:3000"
echo "  🔑 OAuth2 登录页:    http://localhost:3001"
echo "  📱 应用 A:        http://localhost:3002"
echo "  📱 应用 B:        http://localhost:3003"
echo "  🖥️  OAuth2 控制台:   http://localhost:3010"
echo "================================================"
echo "  测试账号: admin/123456  user1/123456  user2/123456"
echo "================================================"
echo ""
echo "按 Ctrl+C 停止所有服务"

# 捕获 Ctrl+C，停止所有子进程
trap "kill $OAUTH2_PID $LOGIN_PID $APP_A_PID $APP_B_PID $CONSOLE_PID 2>/dev/null; echo '所有服务已停止'; exit 0" INT

# 等待所有后台进程
wait
