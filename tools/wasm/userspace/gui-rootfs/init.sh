#!/bin/busybox sh

PATH=/bin:/sbin:/usr/bin:/usr/sbin
export PATH
export DISPLAY=:0
export HOME=/root
export TERM=xterm-256color
export SHELL=/bin/sh
export XDG_RUNTIME_DIR=/tmp

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

# Sample files so the folder UI is not empty.
mkdir -p /root/Documents /root/Downloads
echo "hello from aurora-wm on wasm" > /root/Documents/readme.txt
echo "sample" > /root/Downloads/note.txt

# Bitmap fonts for TinyX / xterm.
if [ -d /share/fonts/X11/misc ]; then
  export FONTCONFIG_PATH=/share/fonts/X11
fi

# Activate VT1 so TinyX can read K_MEDIUMRAW scancodes from virtio-input.
if [ -c /dev/tty1 ]; then
  chvt 1 2>/dev/null || true
fi

# Framebuffer TinyX server, then aurora-wm (folder / terminal / settings).
# Explicit -fp: fonts live under /share/fonts/X11/{misc,cursor}.
Xfbdev :0 -ac -screen 1024x768x32 -nolisten tcp \
  -fp /share/fonts/X11/misc,/share/fonts/X11/cursor &
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

# TinyX has no Composite redirect; force the light compositor off.
# aurora-wm / aurora-files are installed on PATH under /bin by apk.
if [ -x /bin/aurora-wm ]; then
  echo "starting /bin/aurora-wm" >&2
  exec /bin/aurora-wm --compositor=no
fi

echo "aurora-wm missing from PATH; falling back to xterm" >&2
exec /bin/xterm -ls -e htop
