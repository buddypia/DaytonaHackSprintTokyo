# ローカルで Daytona の Computer Use と同じ構成（Xvfb + xfce4 + x11vnc + noVNC）を再現するデスクトップ。
# npm run desktop:build でビルドし、SANDBOX_PROVIDER=docker で使う。
FROM mcr.microsoft.com/playwright:v1.65.0-noble

RUN apt-get update \
 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
      xvfb xfce4 xfce4-terminal dbus-x11 x11vnc novnc websockify fonts-noto-cjk \
 && apt-get purge -y xfce4-screensaver light-locker 2>/dev/null; rm -rf /var/lib/apt/lists/*

# サンドボックスのスクリプト（/opt/omakase/app に読み取り専用でマウント）が playwright を解決できるようにする
WORKDIR /opt/omakase
RUN npm init -y >/dev/null && npm i playwright@1.65.0 >/dev/null

COPY start.sh /usr/local/bin/omakase-desktop
RUN chmod 755 /usr/local/bin/omakase-desktop

USER pwuser
ENV DISPLAY=:1 LANG=ja_JP.UTF-8
EXPOSE 6080
CMD ["omakase-desktop"]
