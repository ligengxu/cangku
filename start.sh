#!/bin/bash
# 果管系统 v2.0 - 快速启动脚本
# 用法: bash start.sh [dev|prod]

MODE=${1:-dev}
BASE_DIR=$(cd "$(dirname "$0")" && pwd)

echo "🍎 果管系统 v2.0 启动中..."
echo "模式: $MODE"
echo ""

if [ "$MODE" = "dev" ]; then
    echo "▶ 启动 FastAPI 后端 (port 8000)..."
    cd "$BASE_DIR/backend"
    source venv/bin/activate
    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
    BACKEND_PID=$!

    echo "▶ 启动 Next.js 前端 (port 3000)..."
    cd "$BASE_DIR/frontend"
    npx next dev --port 3000 &
    FRONTEND_PID=$!

    echo ""
    echo "✅ 服务已启动:"
    echo "   前端: http://localhost:3000"
    echo "   后端: http://localhost:8000"
    echo "   API 文档: http://localhost:8000/api/docs"
    echo ""
    echo "按 Ctrl+C 停止所有服务"

    trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit 0" INT TERM
    wait

elif [ "$MODE" = "prod" ]; then
    echo "▶ 使用 Docker Compose 启动..."
    cd "$BASE_DIR"
    docker-compose up -d --build
    echo ""
    echo "✅ 生产环境已启动:"
    echo "   访问: http://localhost:8080"
else
    echo "用法: bash start.sh [dev|prod]"
fi
