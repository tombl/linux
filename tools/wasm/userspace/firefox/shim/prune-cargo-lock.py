#!/usr/bin/env python3
"""Prune Cargo.lock via cargo metadata --offline after stub Cargo.toml edits."""
import os
import shutil
import subprocess
from pathlib import Path

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
