#!/usr/bin/env python3
"""Rewrite Cargo.lock/Cargo.toml after installing the WebAuthn stub."""
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

# authenticator was the only consumer of the in-tree libudev-sys patch.
# An unused [patch] entry makes cargo want to rewrite Cargo.lock under --frozen.
cargo_toml = Path("Cargo.toml")
toml_text = cargo_toml.read_text()
patch_line = 'libudev-sys = { path = "dom/webauthn/libudev-sys" }\n'
if patch_line not in toml_text:
    raise SystemExit("libudev-sys patch line not found in Cargo.toml")
cargo_toml.write_text(toml_text.replace(patch_line, "", 1))
print("removed unused libudev-sys [patch.crates-io] entry")
