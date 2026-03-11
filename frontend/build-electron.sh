#!/bin/bash
set -e

FRONTEND_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$(dirname "$FRONTEND_DIR")/backend"
DOWNLOADS_DIR="$BACKEND_DIR/static/downloads"

echo "=== Building Electron client ==="
echo "Frontend: $FRONTEND_DIR"
echo "Output:   $DOWNLOADS_DIR"

cd "$FRONTEND_DIR"

if [ ! -f "public/icon.ico" ]; then
    echo "WARNING: public/icon.ico not found. Build may use default icon."
fi

npm install --no-audit --no-fund 2>/dev/null || true

echo "Building Windows x64 installer..."
npx electron-builder --win --x64

EXE=$(find dist-electron -name "*.exe" -type f | head -1)
if [ -z "$EXE" ]; then
    echo "ERROR: No .exe found in dist-electron/"
    exit 1
fi

mkdir -p "$DOWNLOADS_DIR"
cp "$EXE" "$DOWNLOADS_DIR/"
echo "Copied $(basename "$EXE") to $DOWNLOADS_DIR/"

echo "=== Build complete ==="
ls -lh "$DOWNLOADS_DIR/"*.exe
