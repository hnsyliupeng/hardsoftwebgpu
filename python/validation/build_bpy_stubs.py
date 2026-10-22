"""Build no-op stub shared libraries (output dir: $BPY_STUBS_DIR, default /home/user/bpy_stubs) so headless bpy can load without X11/GL/xkb/ICE/SM installed.
Missing sonames = NEEDED entries of bpy's .so files that do not exist on the system.
Missing symbols = undefined in bpy's .so files but defined nowhere (system libs, python, bpy itself).
Each missing soname gets a stub library defining those symbols as empty functions. Nothing is called in a
headless run; the stubs only let the module load."""
import glob, os, subprocess, sys

SITE = sys.argv[1]
OUT = os.environ.get("BPY_STUBS_DIR", "/home/user/bpy_stubs")
os.makedirs(OUT, exist_ok=True)
bpy_libs = [p for p in glob.glob(os.path.join(SITE, "bpy", "**", "*.so*"), recursive=True) if os.path.isfile(p)]
sys_dirs = ["/usr/lib/x86_64-linux-gnu", "/lib/x86_64-linux-gnu", "/usr/lib64", "/lib64", "/usr/lib"]
sys_libs = []
for d in sys_dirs:
    sys_libs += glob.glob(os.path.join(d, "*.so*"))
sys_libs += glob.glob("/usr/lib/python3*/config*/*.so*") + ["/usr/bin/python3.11"]
def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout

sonames_present = {os.path.basename(p) for p in sys_libs + bpy_libs}
needed = set()
for p in bpy_libs:
    for line in run(["readelf", "-d", p]).splitlines():
        if "(NEEDED)" in line:
            needed.add(line.split("[")[1].split("]")[0])
missing_sonames = sorted(n for n in needed if n not in sonames_present)

undef, defined = set(), set()
for p in bpy_libs:
    for line in run(["nm", "-D", "--undefined-only", p]).splitlines():
        parts = line.split()
        if parts:
            undef.add(parts[-1].split("@")[0])
for p in sys_libs + bpy_libs:
    for line in run(["nm", "-D", "--defined-only", p]).splitlines():
        parts = line.split()
        if len(parts) >= 3:
            defined.add(parts[-1].split("@")[0])
missing = sorted(s for s in undef - defined if s and not s.startswith("__gmon") and s != "_ITM_registerTMCloneTable")
print("missing sonames:", missing_sonames)
print("missing symbols:", len(missing))
src = os.path.join(OUT, "stub.c")
with open(src, "w") as f:
    f.write("/* generated no-op stubs for headless bpy load */\n")
    for s in missing:
        f.write(f"void {s}(void) {{}}\n")
for so in missing_sonames:
    dst = os.path.join(OUT, so)
    subprocess.run(["gcc", "-shared", "-fPIC", f"-Wl,-soname,{so}", "-o", dst, src], check=True)
    print("built", dst)
