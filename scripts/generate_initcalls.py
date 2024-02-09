import collections
import pathlib
import re
import subprocess
import sys

# TODO(wasm): put this under a kconfig,
# bring the old implementation back by default

order = [
    "setup",
    "initcallearly",
    "initcallconsole",
    "initcall",
    "initcall1",
    "initcall1s",
    "initcall2",
    "initcall2s",
    "initcall3",
    "initcall3s",
    "initcall4",
    "initcall4s",
    "initcall5",
    "initcall5s",
    "initcallrootfs",
    "initcall6",
    "initcall6s",
    "initcall7",
    "initcall7s",
]

phases = collections.OrderedDict()
for phase in order:
    phases[phase] = []

if len(sys.argv) > 1:
    objdump = subprocess.run(
        ["wasm-objdump", "-xj", "data", sys.argv[1]], capture_output=True, text=True
    )
    lines = [line for line in objdump.stdout.split("\n") if "kdata." in line]
    sections = [re.search(r"<\.kdata\.(.*)>", line).group(1) for line in lines]

    for section in sections:
        phase, func = section.split("$", 1)
        phases[phase].append(func)

for phase, functions in phases.items():
    ty = "struct obs_kernel_param" if phase == "setup" else "initcall_entry_t"
    print(f"/* {phase} */")
    for f in functions:
        print(f"extern {ty} {f};")
    print()

for phase, functions in phases.items():
    print(f"#define enumerate_{phase}(X) \\")
    for f in functions:
        print(f"\tX({f}) \\")
    print()

pathlib.Path("include/linux/initcalls.h").touch()