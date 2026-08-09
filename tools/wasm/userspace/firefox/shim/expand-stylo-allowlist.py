#!/usr/bin/env python3
"""Ensure Stylo rusty-enums are allowlisted for bindgen.

On wasm32, allowlisted parent structs (nsStylePosition, etc.) become opaque when
field enum types are not themselves allowlisted, which then omits those enums
from gecko/structs.rs. Desktop builds usually pull the enums in transitively;
make that explicit.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path


def main() -> int:
    path = Path(sys.argv[1] if len(sys.argv) > 1 else "layout/style/ServoBindings.toml")
    text = path.read_text()

    def section_list(name: str) -> list[str]:
        m = re.search(
            rf"(?ms)^{re.escape(name)}\s*=\s*\[(.*?)\]",
            text,
        )
        if not m:
            raise SystemExit(f"missing {name} in {path}")
        return re.findall(r'"([^"]+)"', m.group(1))

    allow = section_list("allowlist-types")
    rusty = section_list("rusty-enums")
    bitfield = section_list("bitfield-enums")
    allow_set = set(allow)

    extras = [
        "mozilla::StyleSheetInfo",
        "mozilla::detail::CopyablePtr",
        "AttrArray_InternalAttr",
        "mozilla::dom::Element",
        "nsINode",
        "nsIContent",
        "nsPresContext",
    ]

    to_add = []
    for item in rusty + bitfield + extras:
        if item not in allow_set:
            to_add.append(item)
            allow_set.add(item)

    if not to_add:
        print("allowlist-types already complete")
        return 0

    # Insert before the closing of allowlist-types = [ ... ]
    m = re.search(r"(?ms)^(allowlist-types\s*=\s*\[)(.*?)(\n\])", text)
    if not m:
        raise SystemExit("could not locate allowlist-types block")

    addition = "".join(f'    "{item}",\n' for item in to_add)
    # Keep existing body; append before closing bracket.
    body = m.group(2)
    if not body.endswith("\n"):
        body += "\n"
    new_text = text[: m.start()] + m.group(1) + body + addition + m.group(3) + text[m.end() :]
    path.write_text(new_text)
    print(f"added {len(to_add)} allowlist-types entries to {path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
