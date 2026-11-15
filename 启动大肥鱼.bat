@echo off
rem 大肥鱼 · 启动
rem 双击即可。关掉她：托盘图标 → 退出。
setlocal
set "ELECTRON_RUN_AS_NODE="
cd /d "D:\document\DSH Live2D\_app"
start "" "runtime\electron.exe" .
exit
