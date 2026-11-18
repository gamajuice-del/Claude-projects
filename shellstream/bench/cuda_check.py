"""Compile kernel.cu exactly as the notebook does on the T4 (NVRTC, -use_fast_math, -std=c++14) and run
ptxas for sm_75 to obtain register / spill / stack figures -- no GPU needed."""
import ctypes
import glob
import json
import os
import re
import subprocess
import sys

from common import ROOT, RESULTS


def find(pattern):
    import site
    for d in site.getsitepackages() + [site.getusersitepackages()]:
        c = glob.glob(os.path.join(d, pattern))
        if c:
            return c[0]
    return None


def nvrtc_compile(src, opts):
    lib = ctypes.CDLL(find("nvidia/cuda_nvrtc/lib/libnvrtc.so*"))
    prog = ctypes.c_void_p()
    assert lib.nvrtcCreateProgram(ctypes.byref(prog), src.encode(), b"kernel.cu", 0, None, None) == 0
    copts = (ctypes.c_char_p * len(opts))(*[o.encode() for o in opts])
    rc = lib.nvrtcCompileProgram(prog, len(opts), copts)
    n = ctypes.c_size_t()
    lib.nvrtcGetProgramLogSize(prog, ctypes.byref(n))
    log = ctypes.create_string_buffer(n.value)
    lib.nvrtcGetProgramLog(prog, log)
    if rc != 0:
        raise RuntimeError(log.value.decode())
    lib.nvrtcGetPTXSize(prog, ctypes.byref(n))
    ptx = ctypes.create_string_buffer(n.value)
    lib.nvrtcGetPTX(prog, ptx)
    return ptx.value.decode(), log.value.decode()


def main():
    src = open(os.path.join(ROOT, "kernel.cu")).read()
    ptx, log = nvrtc_compile(src, ["--gpu-architecture=compute_75", "-use_fast_math", "-std=c++14"])
    ptx_path = os.path.join(RESULTS, "kernel_sm75.ptx")
    open(ptx_path, "w").write(ptx)
    ptxas = find("nvidia/cuda_nvcc/bin/ptxas")
    out = subprocess.run([ptxas, "-arch=sm_75", "-O3", "-v", ptx_path, "-o", "/dev/null"], capture_output=True, text=True)
    info = out.stderr
    res = {}
    for fn in ("ss_render", "ss_conn", "ss_brick"):
        m = re.search(rf"Compiling entry function '{fn}'.*?Used (\d+) registers", info, re.S)
        st = re.search(rf"Function properties for {fn}\s+(\d+) bytes stack frame, (\d+) bytes spill stores, (\d+) bytes spill loads", info)
        res[fn] = dict(registers=int(m.group(1)) if m else None,
                       stack=int(st.group(1)) if st else None, spill_st=int(st.group(2)) if st else None,
                       spill_ld=int(st.group(3)) if st else None)
    res["nvrtc_log"] = log.strip()
    res["ptx_lines"] = ptx.count("\n")
    print(info)
    print(json.dumps(res, indent=1))
    json.dump(res, open(os.path.join(RESULTS, "cuda_check.json"), "w"), indent=1)


if __name__ == "__main__":
    sys.exit(main())
