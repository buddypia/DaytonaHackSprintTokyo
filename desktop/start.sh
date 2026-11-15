#!/bin/sh
# 画面（Xvfb）→ デスクトップ（xfce4）→ VNC → ブラウザ用の noVNC（6080）の順に起動する
set -e
Xvfb "$DISPLAY" -screen 0 1280x800x24 -nolisten tcp &
while [ ! -e "/tmp/.X11-unix/X${DISPLAY#:}" ]; do sleep 0.1; done
dbus-launch --exit-with-session startxfce4 >/dev/null 2>&1 &
x11vnc -display "$DISPLAY" -forever -shared -nopw -quiet -localhost -rfbport 5900 >/dev/null 2>&1 &
exec websockify --web /usr/share/novnc 6080 localhost:5900
