@echo off
cd /d "%~dp0"
echo Starting Footy Status...
echo.
echo Keep this window open while using the app.
echo Open http://localhost:5173/ in your browser.
echo.
npm.cmd run dev -- --host 0.0.0.0 --port 5173
pause
