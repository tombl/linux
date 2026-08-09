#!/usr/bin/env python3
"""Rewrite Cargo.lock neqo_glue deps after installing the HTTP/3 stub."""
from pathlib import Path

lock = Path("Cargo.lock")
text = lock.read_text()
old = (
    '[[package]]\n'
    'name = "neqo_glue"\n'
    'version = "0.1.0"\n'
    "dependencies = [\n"
    ' "libc",\n'
    ' "log",\n'
    ' "neqo-common",\n'
    ' "neqo-crypto",\n'
    ' "neqo-http3",\n'
    ' "neqo-qpack",\n'
    ' "neqo-transport",\n'
    ' "nserror",\n'
    ' "nsstring",\n'
    ' "qlog",\n'
    ' "static_prefs",\n'
    ' "thin-vec",\n'
    ' "uuid",\n'
    ' "winapi",\n'
    ' "xpcom",\n'
    "]\n"
)
new = (
    '[[package]]\n'
    'name = "neqo_glue"\n'
    'version = "0.1.0"\n'
    "dependencies = [\n"
    ' "nserror",\n'
    ' "nsstring",\n'
    ' "thin-vec",\n'
    ' "xpcom",\n'
    "]\n"
)
if old not in text:
    raise SystemExit("neqo_glue stanza not found in Cargo.lock")
lock.write_text(text.replace(old, new, 1))
print("updated Cargo.lock neqo_glue dependencies (HTTP/3 stub)")
