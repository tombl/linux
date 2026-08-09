#!/usr/bin/env python3
"""Rewrite Cargo.lock after installing the WebAuthn stub.

Dropping authenticator-rs orphans several lock entries. cargo metadata
--frozen then tries to rewrite the lock (and fails). Prune with an
offline metadata resolve so the subsequent mach build stays --frozen.
"""
import os
import shutil
import subprocess
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

cargo = os.environ.get("CARGO") or shutil.which("cargo")
if not cargo:
    raise SystemExit("cargo not found for lockfile prune")

cargo_dir = Path(".cargo")
cargo_dir.mkdir(exist_ok=True)
config = cargo_dir / "config.toml"
config_in = cargo_dir / "config.toml.in"
wrote_config = False
if not config.is_file():
    if not config_in.is_file():
        raise SystemExit(".cargo/config.toml.in missing")
    # config.toml.in is valid as-is for topsrcdir use (see file comments).
    config.write_text(config_in.read_text())
    wrote_config = True

try:
    subprocess.run(
        [
            cargo,
            "metadata",
            "--all-features",
            "--format-version",
            "1",
            "--manifest-path",
            "Cargo.toml",
            "--offline",
        ],
        check=True,
        stdout=subprocess.DEVNULL,
    )
finally:
    if wrote_config and config.is_file():
        config.unlink()

print("pruned Cargo.lock via cargo metadata --offline")
