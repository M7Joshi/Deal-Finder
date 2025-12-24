#!/bin/bash
echo "Restarting backend server..."

# Find and kill existing backend processes
pkill -f "node server.js" || true
pkill -f "backend.*node" || true

# Wait a moment
sleep 2

# Start backend
cd backend
echo "Starting backend on port 3015..."
npm start &

# Wait for it to start
sleep 5
curl -s http://localhost:3015/healthz && echo " - Backend is running!" || echo " - Backend failed to start"
