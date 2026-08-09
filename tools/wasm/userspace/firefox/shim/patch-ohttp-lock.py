#!/usr/bin/env python3
"""Rewrite Cargo.lock ohttp deps after installing the NSS-free stub."""
from pathlib import Path

lock = Path("Cargo.lock")
text = lock.read_text()
old = (
    '[[package]]\n'
    'name = "ohttp"\n'
    'version = "0.3.1"\n'
    'source = "registry+https://github.com/rust-lang/crates.io-index"\n'
    'checksum = "850ce328ec7e4dc1a9446c56aef700d21d914268c8529b96017a2bf10f74b70f"\n'
    "dependencies = [\n"
    ' "bindgen 0.63.999",\n'
    ' "byteorder",\n'
    ' "hex",\n'
    ' "lazy_static",\n'
    ' "log",\n'
    ' "mozbuild",\n'
    ' "serde",\n'
    ' "serde_derive",\n'
    ' "thiserror",\n'
    ' "toml",\n'
    "]\n"
)
new = (
    '[[package]]\n'
    'name = "ohttp"\n'
    'version = "0.3.1"\n'
    'source = "registry+https://github.com/rust-lang/crates.io-index"\n'
    'checksum = "850ce328ec7e4dc1a9446c56aef700d21d914268c8529b96017a2bf10f74b70f"\n'
    "dependencies = [\n"
    ' "thiserror",\n'
    "]\n"
)
if old not in text:
    raise SystemExit("ohttp stanza not found in Cargo.lock")
lock.write_text(text.replace(old, new, 1))
print("updated Cargo.lock ohttp dependencies (OHTTP NSS stub)")
