/**
 * UI / 网关 → EA 快通道：TCP 二进制帧 @ 127.0.0.1:5192
 * 无 JSON 文件轮询；EA 在 OnTimer(1ms) 收包后立即 OrderSend
 */
import net from "node:net";

const MAGIC_REQ = Buffer.from("XDF1");
const MAGIC_RES = Buffer.from("XDF1");

const OP_MARKET = 1;
const OP_CLOSE = 2;
const OP_PENDING = 3;
const OP_MODIFY = 4;

const HOST = process.env.XAU_FAST_HOST || "127.0.0.1";
const PORT = Number(process.env.XAU_FAST_PORT || 5192);
const TIMEOUT_MS = Number(process.env.XAU_FAST_TIMEOUT_MS || 400);

function sideByte(side) {
  return side === "sell" ? 1 : 0;
}

function buildFrame(op, fields) {
  const buf = Buffer.alloc(48);
  MAGIC_REQ.copy(buf, 0);
  buf.writeUInt8(op, 4);
  buf.writeUInt8(fields.side ?? 0, 5);
  let flags = 0;
  if (fields.allow_demo_mt5) flags |= 1;
  buf.writeUInt8(flags, 6);
  buf.writeFloatLE(Number(fields.lots ?? 0.01), 7);
  buf.writeDoubleLE(Number(fields.sl ?? 0), 11);
  buf.writeDoubleLE(Number(fields.tp ?? 0), 19);
  buf.writeDoubleLE(Number(fields.price ?? 0), 27);
  const ticket = BigInt(fields.ticket ?? 0);
  buf.writeBigUInt64LE(ticket, 35);
  return buf;
}

function parseResponse(buf) {
  if (buf.length < 16) throw new Error("fast_lane_short_ack");
  const magic = buf.subarray(0, 4).toString("ascii");
  if (magic !== "XDF1") throw new Error("fast_lane_bad_magic");
  const ok = buf.readUInt8(4) === 1;
  const retcode = buf.readUInt32LE(5);
  const ticket = buf.readBigUInt64LE(9);
  return { ok, retcode, ticket: Number(ticket) };
}

export function fastLaneAvailable() {
  return process.env.XAU_EXECUTOR !== "python";
}

export function sendFastLane(op, fields) {
  const frame = buildFrame(op, fields);
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: HOST, port: PORT });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("fast_lane_timeout"));
    }, TIMEOUT_MS);

    sock.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });

    sock.once("connect", () => sock.write(frame));

    sock.on("data", (chunk) => {
      clearTimeout(timer);
      sock.destroy();
      try {
        resolve(parseResponse(chunk));
      } catch (e) {
        reject(e);
      }
    });
  });
}

export async function marketFastLane(body) {
  const side = sideByte(body.side);
  return sendFastLane(OP_MARKET, {
    side,
    lots: body.lots,
    sl: body.sl ?? 0,
    tp: body.tp ?? 0,
    allow_demo_mt5: body.allow_demo_mt5,
  });
}

export async function closeFastLane(ticket) {
  return sendFastLane(OP_CLOSE, { ticket, side: 0, lots: 0 });
}

export async function pendingFastLane(body) {
  const side = sideByte(body.side);
  return sendFastLane(OP_PENDING, {
    side,
    lots: body.lots,
    sl: body.sl ?? 0,
    tp: body.tp ?? 0,
    price: body.price,
    allow_demo_mt5: body.allow_demo_mt5,
  });
}

export async function modifyFastLane(body) {
  return sendFastLane(OP_MODIFY, {
    ticket: body.ticket,
    sl: body.sl ?? 0,
    tp: body.tp ?? 0,
    side: 0,
    lots: 0,
  });
}
