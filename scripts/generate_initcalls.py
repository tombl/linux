import collections
import pathlib
import re
import subprocess
import sys

# TODO(wasm): put this under a kconfig,
# bring the old implementation back by default

order = [
    "setup",
    "param",
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

# these are params defined in files that consume params
tricky_items = {
    "__param_initcall_debug",
    "__param_console_suspend",
    "__param_console_no_auto_verbose",
}

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
    ty = (
        "struct obs_kernel_param"
        if phase == "setup"
        else "const struct kernel_param"
        if phase == "param"
        else "initcall_entry_t"
    )
    print(f"/* {phase} */")
    for f in functions:
        if f in tricky_items:
            print(f"#ifndef will_define_{f}")
        print(f"extern {ty} {f};")
        if f in tricky_items:
            print(f"#endif")
    print()

for phase, functions in phases.items():
    print(f"#define enumerate_{phase}(X) \\")
    for f in functions:
        print(f"\tX({f}) \\")
    print()

pathlib.Path("include/linux/initcalls.h").touch()
