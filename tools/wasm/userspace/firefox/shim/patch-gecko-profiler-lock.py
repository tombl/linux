#!/usr/bin/env python3
"""Rewrite Cargo.lock gecko-profiler deps after installing the stub crate."""
from pathlib import Path

lock = Path("Cargo.lock")
text = lock.read_text()
old = (
    '[[package]]\n'
    'name = "gecko-profiler"\n'
    'version = "0.1.0"\n'
    "dependencies = [\n"
    ' "bincode",\n'
    ' "bindgen 0.69.4",\n'
    ' "lazy_static",\n'
    ' "mozbuild",\n'
    ' "profiler-macros",\n'
    ' "serde",\n'
    "]\n"
)
new = (
    '[[package]]\n'
    'name = "gecko-profiler"\n'
    'version = "0.1.0"\n'
    "dependencies = [\n"
    ' "bincode",\n'
    ' "lazy_static",\n'
    ' "mozbuild",\n'
    ' "profiler-macros",\n'
    ' "serde",\n'
    "]\n"
)
if old not in text:
    raise SystemExit("gecko-profiler stanza not found in Cargo.lock")
lock.write_text(text.replace(old, new, 1))
print("updated Cargo.lock gecko-profiler dependencies (profiler stub)")
