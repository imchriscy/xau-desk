# Mac 轨 · 延迟优化路线图（搁置，仅供演进）

> **当前版本（~1.019 文件桥）不再动延迟**，实测与分段见 [MAC_LATENCY_SEGMENTS.md](MAC_LATENCY_SEGMENTS.md)、[artifacts/latency-summary-20251116.md](artifacts/latency-summary-20251116.md)。  
> **最大单点杠杆**：② 段 — 券商 **VPS**，把 MT5↔券商从 **~243ms** 压到 **~0.5–2ms** 量级（与 MT5 官方宣传一致，以终端 ping 为准）。

---

## 目标陈述（产品）

| 阶段 | 目标 | 说明 |
|------|------|------|
| **现在** | ① 本机栈 **可用 ~15–40ms**；② **~200ms+** | 已达标日常 BTC/小仓 |
| **后期 + VPS** | **端到端（点 B → 本机收到「委托已接受」ack）尽量 ≤10ms** | **Mac 端体验目标**；非对券商撮合/手机推送的 SLA |

「10ms 内」指：**在 VPS 已部署、本机栈按 L2/L3 做完之后**，以 **网关 ack / EA 回报** 为界的主路径预算（仍可能因行情、重试略超）。

---

## ① 本机栈：`XauDesk → 网关 → 文件 → EA → 本地 OrderSend`

### 现状（L0 · 文件桥 1.019）

| 子项 | 配置 | 典型 |
|------|------|------|
| EA 定时器 | `InpRefreshMs = 16` | 等扫盘 **0–16ms**（均 ~8） |
| 交易通道 | `xau_trade.json` + 25ms ack 轮询 | 写盘 + **0–25ms** 等 ack |
| EA 内排队 | 读到文件 → `OrderSend` 前 | **~0.87ms**（实测） |
| **① 到 `OrderSend` 入口（粗算）** | | **~15–40ms** 常见，尖峰 **~80ms** |

### 后期极限（只谈可能性，**暂不实施**）

| 级别 | 方案概要 | ① 到 `OrderSend` **乐观** | ① 到 **UI ack** **乐观** | 性质 |
|------|-----------|---------------------------|---------------------------|------|
| **L1** | 16ms→**1ms** 定时器；`RPC_POLL_MS`→**1**；ack 用 `fs.watch` 补强 | **~5–15ms** | **~8–20ms** | 仍文件桥，改动中 |
| **L2** | **IPC/UDS**（`ipc/Mt5IpcBridge.dll`）替代 JSON 下单；报价/状态可仍文件或 bin | **~2–8ms** | **~3–12ms** | **架构升级** |
| **L2+** | 下单专用 **TCP 二进制**（扩展现有 `fast-lane.mjs`），与 Bridge 合一 | **~2–6ms** | **~3–10ms** | 与 L2 二选一或并存 |
| **L3** | **MT5 在 VPS**，Mac **仅 UI**（远程网关 TLS/WebSocket） | Mac 上 ① ≈ **Mac↔VPS RTT + 几ms** | 取决于地理距离，**未必 <10ms** | 拓扑变化 |

**本机栈理论地板（MT5 仍在本机 Mac Wine）**：在 L2 做完、机器不卡顿时，**① 到 `OrderSend` 约 2–8ms** 是合理工程上界；**再低** 受 Wine、MT5 单线程、`OrderSend` 本地准备限制，**不宜承诺亚毫秒整段**。

文档 [MAC_LATENCY_SEGMENTS.md](MAC_LATENCY_SEGMENTS.md) 中「搁置方案」与本表 L1/L2 一致。

---

## ② + VPS：与 Mac「总体 10ms」怎么拼

### 拓扑 A（推荐对齐「Mac 端 10ms」叙述）

**MT5 + EA 在 VPS（离券商）**；**Mac 只跑 XauDesk UI**，网关可：

- 方案 A1：UI → **VPS 上的 `gateway` + 优化栈（Win/Rust 或 VPS 内文件桥）** → 同机 MT5  
- 方案 A2：Mac 仍本地开发网关，但 **下单 RPC 转发 VPS**（多一跳，Mac 难保 10ms）

此时 **「Mac 端 10ms」** 若严格要求 **从 Mac 点击算起**，必须 **Mac 到 VPS 很低延迟**（同区域 VPS 或专线），否则：

```text
Mac 点击 → (Mac↔VPS 5–30ms+) → VPS 内 ① (~2–5ms) → ② (~0.5–2ms) → ack 回 Mac
```

**纯 VPS 内**（不含 Mac 地理距离）：**①+② 合计 ~3–8ms** 可达，**是「总体 10ms」最靠谱的数学基础**。

### 拓扑 B（MT5 仍在 Mac，仅券商走 VPS 概念错误）

MT5 进程在哪，**② 就从哪发包**。  
**不能**「Mac 本机 MT5 + 家宽」同时享受 **0.52ms ②**；要 0.52ms 必须 **终端在 VPS**。

---

## 端到端预算表（ aspirations，非 SLA）

假设：**L2 本机/VPS 内栈 + VPS ② ~1ms + 无极端行情**

| 里程碑 | 乐观 | 备注 |
|--------|------|------|
| 点到 **`OrderSend` 已调用** | **3–8ms**（VPS 内） | 不含撮合 |
| 点到 **网关 ack（委托已被终端接受）** | **5–12ms** | **接近「10ms 目标」** |
| 点到 **持仓出现在列表 / 手机** | **+ 券商撮合 1–20ms+** | 不可单靠 XauDesk 保证 |

**Mac 笔记本 + 海外 VPS**：点击到 ack **10ms 内** 需 **网络工程**（同区域、低抖动），不只是改 EA。

---

## 实施顺序（建议，后期再做）

1. **② VPS** — 终端迁机房，验证 ping **&lt;2ms**（**收益最大**）。  
2. **VPS 内 ①** — 优先 **Windows/Rust 轨** 或 VPS 上精简网关；Mac 文件桥仅作便携轨。  
3. **Mac L1** — 若坚持本机 MT5：1ms 定时器 + 轮询/watch（**省 ~10–20ms**，不解 ②）。  
4. **Mac L2 IPC** — 仅当 **① 仍是瓶颈** 且 MT5 必须在 Mac Wine。  
5. **指标** — `XAU_LATENCY_TRACE=1` + `latency:analyze`；GitHub 上固定 `docs/artifacts/` 快照。

---

## 明确不做（本阶段）

- 不默认 1ms 定时器、不启 IPC DLL 生产挂载。  
- 不为压延迟拆风控/审计路径。  
- 不把「10ms」写进对用户承诺，仅作 **内部演进目标**。

---

## 文档索引（Mac 轨 · GitHub）

| 文档 | 内容 |
|------|------|
| [MAC_LATENCY_SEGMENTS.md](MAC_LATENCY_SEGMENTS.md) | 三段模型、家宽并入 ②、Win/VPS 上界 |
| [MAC_OPTIMIZATION_ROADMAP.md](MAC_OPTIMIZATION_ROADMAP.md) | 本文件 · L0–L3 与 10ms 目标 |
| [artifacts/latency-summary-20251116.md](artifacts/latency-summary-20251116.md) | 实测数据 |
| [MAC_EASY_CONNECT.md](MAC_EASY_CONNECT.md) | 日常使用 |
| [ipc/README.md](../ipc/README.md) | IPC/DLL 实验 |

Windows 轨（Rust/亚毫秒 ①）在另一台机演进，**API 与 UI 契约对齐**，执行实现分叉。