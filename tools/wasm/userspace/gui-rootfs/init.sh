#!/bin/busybox sh

PATH=/bin:/sbin:/usr/bin:/usr/sbin
export PATH
export DISPLAY=:0
export HOME=/root
export TERM=xterm-256color
export SHELL=/bin/sh
export XDG_RUNTIME_DIR=/tmp
# curl was built without an embedded CA path; point it at the cacert package.
export SSL_CERT_FILE=/etc/ssl/cert.pem
export CURL_CA_BUNDLE=/etc/ssl/cert.pem
export SSL_CERT_DIR=/etc/ssl/certs

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

# Virtio-net: host createNetwork gateway is 192.0.2.1; this guest is .2.
# DNS is already in /etc/resolv.conf (nameserver 192.0.2.1).
ifconfig lo up 2>/dev/null || true
if [ -d /sys/class/net/eth0 ]; then
  ifconfig eth0 192.0.2.2 netmask 255.255.255.0 up
  route add default gw 192.0.2.1 eth0 2>/dev/null || \
    ip route add default via 192.0.2.1 dev eth0 2>/dev/null || true
  echo "network: eth0 192.0.2.2/24 gw 192.0.2.1" >&2
  # Network smoke in the background so X/input stay responsive. Skip with
  # `touch /network-smoke-skip` in the image, or force-wait with /network-smoke.
  if [ ! -e /network-smoke-skip ]; then
    (
      if command -v wget >/dev/null 2>&1; then
        echo "network: wget google.com ..." >&2
        if wget -q -O /tmp/wget-google.out --timeout=25 google.com; then
          echo "network: wget google.com ok ($(wc -c </tmp/wget-google.out) bytes)" >&2
        else
          echo "network: wget google.com FAILED ($?)" >&2
        fi
      fi
      if command -v curl >/dev/null 2>&1; then
        echo "network: curl -I https://www.google.com ..." >&2
        if curl -fsSIL --max-time 25 -o /tmp/curl-google.hdr https://www.google.com/; then
          echo "network: curl https://www.google.com ok" >&2
        else
          echo "network: curl https://www.google.com FAILED ($?)" >&2
        fi
      fi
    ) &
    if [ -e /network-smoke ]; then
      wait
    fi
  fi
else
  echo "network: no eth0 (host did not attach virtio-net)" >&2
fi

# Sample files so the folder UI is not empty.
mkdir -p /root/Documents /root/Downloads
echo "hello from aurora-wm on wasm" > /root/Documents/readme.txt
echo "sample" > /root/Downloads/note.txt
cat > /root/Documents/browse.txt <<'EOF'
Guest network is up (virtio-net → WebSocket TCP proxy).
Try:  wget google.com
      curl -I https://www.google.com/
EOF

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
# aurora-wm / aurora-files are on PATH under /bin (apk).
#
# Launch Firefox as soon as X is up so the Browser app is not missing from
# PATH / the WM session. Single-process: this platform has no fork().
if [ -x /bin/firefox ]; then
  export MOZ_FORCE_DISABLE_E10S=1
  export MOZ_DISABLE_CONTENT_SANDBOX=1
  export MOZ_ENABLE_WAYLAND=0
  echo "starting /bin/firefox https://example.com" >&2
  /bin/firefox --no-remote --new-instance https://example.com &
elif [ -x /bin/js ]; then
  echo "firefox GUI binary missing; SpiderMonkey /bin/js is installed" >&2
else
  echo "firefox not installed on PATH" >&2
fi

if [ -x /bin/aurora-wm ]; then
  echo "starting /bin/aurora-wm --compositor=no" >&2
  # Keep X alive if the WM exits; fall through to xterm.
  /bin/aurora-wm --compositor=no
  echo "aurora-wm exited with status $?; falling back to xterm" >&2
fi

exec /bin/xterm -ls -e htop
