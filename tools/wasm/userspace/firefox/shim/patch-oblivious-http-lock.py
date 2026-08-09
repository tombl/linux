#!/usr/bin/env python3
"""Rewrite Cargo.lock oblivious_http deps after installing the OHTTP stub."""
from pathlib import Path

lock = Path("Cargo.lock")
text = lock.read_text()
old = (
    '[[package]]\n'
    'name = "oblivious_http"\n'
    'version = "0.1.0"\n'
    "dependencies = [\n"
    ' "nserror",\n'
    ' "ohttp",\n'
    ' "rand",\n'
    ' "thin-vec",\n'
    ' "xpcom",\n'
    "]\n"
)
new = (
    '[[package]]\n'
    'name = "oblivious_http"\n'
    'version = "0.1.0"\n'
    "dependencies = [\n"
    ' "nserror",\n'
    ' "thin-vec",\n'
    ' "xpcom",\n'
    "]\n"
)
if old not in text:
    raise SystemExit("oblivious_http stanza not found in Cargo.lock")
lock.write_text(text.replace(old, new, 1))
print("updated Cargo.lock oblivious_http dependencies (OHTTP stub)")
