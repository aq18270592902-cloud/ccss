@echo off
chcp 65001 >nul
cd /d %~dp0
where node >nul 2>nul && (node fetch_official.js) || ("D:\nodejs\node.exe" fetch_official.js)
pause
