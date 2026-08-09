#!/usr/bin/env python3
"""Rewrite Cargo.lock authrs_bridge deps after installing the WebAuthn stub."""
from pathlib import Path

lock = Path("Cargo.lock")
text = lock.read_text()
old = (
    '[[package]]\n'
    'name = "authrs_bridge"\n'
    'version = "0.1.0"\n'
    "dependencies = [\n"
    ' "authenticator",\n'
    ' "base64 0.21.3",\n'
    ' "cstr",\n'
    ' "log",\n'
    ' "moz_task",\n'
    ' "nserror",\n'
    ' "nsstring",\n'
    ' "rand",\n'
    ' "serde",\n'
    ' "serde_cbor",\n'
    ' "serde_json",\n'
    ' "static_prefs",\n'
    ' "thin-vec",\n'
    ' "xpcom",\n'
    "]\n"
)
new = (
    '[[package]]\n'
    'name = "authrs_bridge"\n'
    'version = "0.1.0"\n'
    "dependencies = [\n"
    ' "libudev-sys",\n'
    ' "nserror",\n'
    ' "nsstring",\n'
    ' "thin-vec",\n'
    ' "xpcom",\n'
    "]\n"
)
if old not in text:
    raise SystemExit("authrs_bridge stanza not found in Cargo.lock")
lock.write_text(text.replace(old, new, 1))
print("updated Cargo.lock authrs_bridge dependencies (WebAuthn stub)")
