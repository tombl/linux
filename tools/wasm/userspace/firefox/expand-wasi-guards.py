#!/usr/bin/env python3
"""Expand selected __wasi__ ifdefs to also cover __wasm__ (tombl wasm linux).

Only touch files that need no-mmap / memalign paths. Do not redefine __wasi__
globally — that would take wasi-only TLS/mutex stubs and break real threads.
"""
from __future__ import annotations

import pathlib
import re
import sys

FILES = [
    # Memory managers that already have posix_memalign WASI paths.
    "js/src/gc/Memory.cpp",
    "js/src/vm/TypedArrayObject.cpp",
    "js/src/util/NativeStack.cpp",
    # SharedArray discard uses MozTaggedAnonymousMmap; WASI uses memset.
    "js/src/vm/SharedArrayObject.cpp",
]


def expand(text: str) -> str:
    # Order matters: handle compound forms first.
    replacements = [
        (r"!defined\(__wasi__\)", r"!defined(__wasi__) && !defined(__wasm__)"),
        (r"defined\(__wasi__\)", r"(defined(__wasi__) || defined(__wasm__))"),
        (r"#ifdef __wasi__", r"#if defined(__wasi__) || defined(__wasm__)"),
        (r"#ifndef __wasi__", r"#if !defined(__wasi__) && !defined(__wasm__)"),
        (r"#  ifdef __wasi__", r"#  if defined(__wasi__) || defined(__wasm__)"),
        (r"#  ifndef __wasi__", r"#  if !defined(__wasi__) && !defined(__wasm__)"),
        (r"#    ifdef __wasi__", r"#    if defined(__wasi__) || defined(__wasm__)"),
        (r"#    ifndef __wasi__", r"#    if !defined(__wasi__) && !defined(__wasm__)"),
    ]
    for pat, repl in replacements:
        text = re.sub(pat, repl, text)
    # Clean accidental double-application from earlier patches.
    text = text.replace(
        "!defined(__wasi__) && !defined(__wasm__) && !defined(__wasm__)",
        "!defined(__wasi__) && !defined(__wasm__)",
    )
    text = text.replace(
        "(defined(__wasi__) || defined(__wasm__)) || defined(__wasm__)",
        "(defined(__wasi__) || defined(__wasm__))",
    )
    return text


def main() -> int:
    root = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else ".")
    for rel in FILES:
        path = root / rel
        if not path.exists():
            print(f"skip missing {rel}", file=sys.stderr)
            continue
        original = path.read_text()
        updated = expand(original)
        if updated != original:
            path.write_text(updated)
            print(f"expanded {rel}")
        else:
            print(f"unchanged {rel}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
