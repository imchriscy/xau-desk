#!/usr/bin/env python3
"""
Unix Domain Socket 服务端 — 监听 /tmp/mt5_bridge.sock（或 MT5_IPC_SOCK / --sock）

URI 约定：ipc:///tmp/mt5_bridge.sock → 实际路径 /tmp/mt5_bridge.sock

帧格式：4 字节 little-endian uint32 长度 + UTF-8 payload（紧凑 JSON 等）

非阻塞：asyncio + StreamReader/Writer，支持多客户端。
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import signal
import struct
import sys
from typing import Any

DEFAULT_SOCK = "/tmp/mt5_bridge.sock"
MAX_FRAME = 1 << 20
HEADER = struct.Struct("<I")


def parse_ipc_uri(uri: str) -> str:
    if uri.startswith("ipc://"):
        return uri[len("ipc://") :]
    return uri


def try_compact_json(text: str) -> dict[str, Any] | None:
    try:
        obj = json.loads(text)
        return obj if isinstance(obj, dict) else {"value": obj}
    except json.JSONDecodeError:
        return None


async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    peer = writer.get_extra_info("sockname")
    print(f"[server] client connected {peer}", flush=True)
    try:
        while True:
            hdr = await reader.readexactly(4)
            (length,) = HEADER.unpack(hdr)
            if length > MAX_FRAME:
                print(f"[server] frame too large: {length}", flush=True)
                break
            if length == 0:
                await send_frame(writer, b'{"ok":true,"empty":true}')
                continue
            payload = await reader.readexactly(length)
            text = payload.decode("utf-8", errors="replace")
            obj = try_compact_json(text)
            if obj is not None:
                reply = json.dumps(
                    {"ok": True, "echo": obj, "len": length},
                    separators=(",", ":"),
                    ensure_ascii=False,
                )
            else:
                reply = json.dumps(
                    {"ok": True, "raw": text[:200]},
                    separators=(",", ":"),
                )
            await send_frame(writer, reply.encode("utf-8"))
    except (asyncio.IncompleteReadError, ConnectionResetError, BrokenPipeError):
        pass
    finally:
        writer.close()
        try:
            await writer.wait_closed()
        except Exception:
            pass
        print("[server] client disconnected", flush=True)


async def send_frame(writer: asyncio.StreamWriter, payload: bytes) -> None:
    if len(payload) > MAX_FRAME:
        raise ValueError("payload too large")
    writer.write(HEADER.pack(len(payload)) + payload)
    await writer.drain()


async def run_server(sock_path: str) -> None:
    if os.path.exists(sock_path):
        try:
            os.unlink(sock_path)
        except OSError as e:
            print(f"[server] unlink {sock_path}: {e}", file=sys.stderr)

    server = await asyncio.start_unix_server(handle_client, path=sock_path)
    os.chmod(sock_path, 0o666)
    print(f"[server] listening ipc://{sock_path}", flush=True)

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, lambda: asyncio.create_task(shutdown(server, sock_path)))

    await server.serve_forever()


async def shutdown(server: asyncio.AbstractServer, sock_path: str) -> None:
    server.close()
    await server.wait_closed()
    if os.path.exists(sock_path):
        os.unlink(sock_path)
    print("[server] stopped", flush=True)


def main() -> None:
    p = argparse.ArgumentParser(description="MT5 IPC Unix socket bridge (Python)")
    p.add_argument(
        "--sock",
        default=os.environ.get("MT5_IPC_SOCK", DEFAULT_SOCK),
        help=f"socket path or ipc://… (default {DEFAULT_SOCK})",
    )
    args = p.parse_args()
    path = parse_ipc_uri(args.sock)
    try:
        asyncio.run(run_server(path))
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()