@echo off
chcp 65001 > nul
cd /d D:\claude_projects\feishu-bitable-bot
echo Sending notifications...
node notify.js all
echo.
echo Done. Press any key to close.
pause > nul
