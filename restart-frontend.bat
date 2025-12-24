@echo off
echo Stopping React frontend on port 3000...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000 ^| findstr LISTENING') do taskkill /F /PID %%a
timeout /t 2
echo Starting React frontend...
cd site
start cmd /k npm start
echo Frontend restart initiated!
