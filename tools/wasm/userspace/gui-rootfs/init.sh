#!/bin/busybox sh

PATH=/bin:/sbin:/usr/bin:/usr/sbin
export PATH
export DISPLAY=:0
export HOME=/root
export TERM=xterm-256color

mount -t devtmpfs devtmpfs /dev
mount -t proc proc /proc
mount -t sysfs sysfs /sys
mount -t tmpfs tmpfs /run
mount -t tmpfs tmpfs /tmp
mount -t tmpfs tmpfs /workspace
chmod 01777 /tmp

# Guest protocol agent for host-driven setup (optional if absent).
if [ -x /bin/linux-guest-agent ]; then
  /bin/linux-guest-agent &
fi

# Bitmap fonts for TinyX / xterm.
if [ -d /share/fonts/X11/misc ]; then
  export FONTCONFIG_PATH=/share/fonts/X11
fi

# Framebuffer TinyX server, then an xterm running htop.
Xfbdev :0 -ac -screen 1024x768x32 -nolisten tcp &
xpid=$!

# Wait briefly for the server socket under /tmp/.X11-unix.
i=0
while [ "$i" -lt 50 ]; do
  if [ -S /tmp/.X11-unix/X0 ] || [ -e /tmp/.X11-unix/X0 ]; then
    break
  fi
  i=$((i + 1))
  sleep 0.1 2>/dev/null || sleep 1
done

if ! kill -0 "$xpid" 2>/dev/null; then
  echo "Xfbdev failed to start" >&2
  exec setsid cttyhack sh
fi

exec xterm -ls -e htop
