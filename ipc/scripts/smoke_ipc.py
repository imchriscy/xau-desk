#!/usr/bin/env python3
"""本机联调：Python 服务端 + libMt5IpcBridge.dylib 客户端（ctypes）。"""
from __future__ import annotations

import ctypes
import json
import os
import socket
import struct
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DYLIB = ROOT / "dist" / "libMt5IpcBridge.dylib"
SERVER = ROOT / "native" / "mt5_bridge_server.py"
SOCK = os.environ.get("MT5_IPC_SOCK", "/tmp/mt5_bridge.sock")
HDR = struct.Struct("<I")


def py_client_roundtrip(sock_path: str) -> None:
    msg = json.dumps({"op": "ping", "src": "smoke_py"}, separators=(",", ":")).encode()
    frame = HDR.pack(len(msg)) + msg
    cli = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    cli.settimeout(3.0)
    cli.connect(sock_path)
    cli.sendall(frame)
    hdr = cli.recv(4)
    assert len(hdr) == 4
    (ln,) = HDR.unpack(hdr)
    body = b""
    while len(body) < ln:
        body += cli.recv(ln - len(body))
    cli.close()
    print("[smoke_py] ok", body.decode())


def dll_roundtrip(sock_path: str, server_proc: subprocess.Popen[bytes]) -> None:
    if not DYLIB.exists():
        print("[smoke_dll] skip: dylib missing", file=sys.stderr)
        return
    lib = ctypes.CDLL(str(DYLIB))
    lib.Mt5IpcConnect.argtypes = [ctypes.c_char_p]
    lib.Mt5IpcConnect.restype = ctypes.c_int
    lib.Mt5IpcSend.argtypes = [ctypes.c_char_p]
    lib.Mt5IpcSend.restype = ctypes.c_int
    lib.Mt5IpcRecv.argtypes = [ctypes.c_char_p, ctypes.c_int]
    lib.Mt5IpcRecv.restype = ctypes.c_int
    lib.Mt5IpcDisconnect.restype = ctypes.c_int

    time.sleep(0.3)
    ok = lib.Mt5IpcConnect(sock_path.encode("utf-8"))
    if ok != 1:
        raise RuntimeError(f"Mt5IpcConnect failed: {ok}")

    payload = json.dumps(
        {"op": "ping", "src": "smoke_dll", "ts": int(time.time())},
        separators=(",", ":"),
    )
    sent = lib.Mt5IpcSend(payload.encode("utf-8"))
    if sent < 0:
        raise RuntimeError(f"Mt5IpcSend failed: {sent}")

    buf = ctypes.create_string_buffer(8192)
    deadline = time.time() + 3.0
    reply_len = 0
    while time.time() < deadline:
        reply_len = lib.Mt5IpcRecv(buf, 8192)
        if reply_len > 0:
            break
        if reply_len < 0:
            raise RuntimeError("Mt5IpcRecv error")
        time.sleep(0.02)

    lib.Mt5IpcDisconnect()
    if reply_len <= 0:
        raise RuntimeError("no reply from server")
    print("[smoke_dll] ok", buf.value.decode("utf-8", errors="replace"))


def main() -> None:
    if os.path.exists(SOCK):
        try:
            os.unlink(SOCK)
        except OSError:
            pass

    env = {**os.environ, "MT5_IPC_SOCK": SOCK}
    proc = subprocess.Popen(
        [sys.executable, str(SERVER), "--sock", SOCK],
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
    )
    try:
        time.sleep(0.5)
        if proc.poll() is not None:
            out = proc.stdout.read() if proc.stdout else b""
            raise RuntimeError(f"server exited: {out!r}")

        py_client_roundtrip(SOCK)
        dll_roundtrip(SOCK, proc)
        print("[smoke] ALL PASS")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
        if os.path.exists(SOCK):
            try:
                os.unlink(SOCK)
            except OSError:
                pass


if __name__ == "__main__":
    main()