#!/usr/bin/env node
/**
 * Node 版 UDS 服务端（与 Python 同帧协议）。
 * MT5_IPC_SOCK=/tmp/mt5_bridge.sock node ipc/native/mt5_bridge_server.mjs
 */
import fs from "node:fs";
import net from "node:net";
import os from "node:os";

const MAX = 1 << 20;
const SOCK = (process.env.MT5_IPC_SOCK || "/tmp/mt5_bridge.sock").replace(/^ipc:\/\//, "");

if (fs.existsSync(SOCK)) fs.unlinkSync(SOCK);

const server = net.createServer((socket) => {
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      if (buf.length < 4) break;
      const len = buf.readUInt32LE(0);
      if (len > MAX) {
        socket.destroy();
        return;
      }
      if (buf.length < 4 + len) break;
      const payload = buf.subarray(4, 4 + len);
      buf = buf.subarray(4 + len);
      let echo;
      try {
        const j = JSON.parse(payload.toString("utf8"));
        echo = JSON.stringify({ ok: true, echo: j, len });
      } catch {
        echo = JSON.stringify({ ok: true, raw: payload.toString("utf8").slice(0, 200) });
      }
      const out = Buffer.from(echo, "utf8");
      const hdr = Buffer.alloc(4);
      hdr.writeUInt32LE(out.length);
      socket.write(Buffer.concat([hdr, out]));
    }
  });
});

server.listen(SOCK, () => {
  try {
    fs.chmodSync(SOCK, 0o666);
  } catch {
    /* */
  }
  console.log(`[node-ipc] listening ipc://${SOCK}`);
});