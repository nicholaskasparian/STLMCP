#!/bin/bash
set -e

# Start a virtual framebuffer so OpenSCAD can use OpenGL for PNG export.
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
XVFB_PID=$!

# Ensure Xvfb has started before Node.js begins handling requests.
sleep 2

# Propagate SIGTERM/SIGINT to Xvfb.
cleanup() {
  kill "$XVFB_PID" 2>/dev/null || true
}
trap cleanup EXIT

echo "Xvfb running (PID $XVFB_PID, DISPLAY=$DISPLAY)"
exec node dist/index.js
