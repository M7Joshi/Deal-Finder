@echo off
echo ========================================
echo Testing Backend API Server
echo ========================================
echo.
echo Starting API server on http://localhost:3015
echo Press Ctrl+C to stop
echo.

set AUTOMATION_WORKER=0
set RUN_IMMEDIATELY=false
set PORT=3015

node server.js
