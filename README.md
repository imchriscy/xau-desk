# XauDesk

[![Release](https://img.shields.io/github/v/release/imchriscy/xau-desk?label=release)](https://github.com/imchriscy/xau-desk/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## English

**XauDesk** is a Windows trading desk for **XAUUSD** on **MetaTrader 5**: chart-native UI, a **local Python gateway**, and a **hard risk engine** that sits *outside* your strategy—where discipline actually belongs.

You already understand systematic trading; the failure mode is **risk discipline**, not another indicator. XauDesk enforces caps, session rules, streak halts, and exposure budgets **before** orders reach the broker. Execution stays on **localhost** (`127.0.0.1`) so latency is measurable and minimal: **MT5 API time (mt5_ms)** and **HTTP round-trip (RTT)** are live on the toolbar—same-machine loopback typically keeps the full path **within ~20ms** under normal conditions.

**Built for:** discretionary and systematic gold traders on Windows who want **professional-grade control** without giving up MT5.

### Technical stack

| Layer | Implementation |
|--------|----------------|
| **Desktop** | Electron · single-window workflow · no browser chrome |
| **Chart** | Lightweight Charts · MT5-native bar sync · multi-TF · volume · drawings · indicators |
| **Gateway** | Python stdlib HTTP server · official `MetaTrader5` package · `pythonw` background process |
| **Risk** | Per-trade & daily loss caps (USD / %) · configurable streak tiers · virtual equity · margin budget · max slots · mandatory SL · append-only audit with hash chain |
| **Execution** | ARM gate · market & pending orders · drag SL/TP on chart · APP magic isolation |

### Latency model

- **`mt5_ms`** — time for the gateway to call MT5 (often sub-ms to a few ms on one PC).
- **`RTT`** — browser ↔ local gateway (loopback).
- Not a claim about broker WAN; a claim about **your** execution stack being tight and **observable**.

### Quick start

1. Install and log in to **MT5**; enable **XAUUSD** (or set `MT5_SYMBOL`).
2. Turn on **Algo Trading** in MT5.
3. `pip install MetaTrader5` (Python bitness must match MT5).
4. `npm install` in this repo.
5. Run **`install-desktop.vbs`** once → launch **XauDesk** from the desktop shortcut (starts gateway `:5191` + UI `:5190` + Electron).

Risk design: **[docs/RISK_DESIGN_AND_PHILOSOPHY.md](docs/RISK_DESIGN_AND_PHILOSOPHY.md)** · Changes: **[CHANGELOG.md](CHANGELOG.md)**

### macOS (portable execution via MQL5)

The **supported production build is Windows** (Python gateway + local MT5). For Mac, the same UI talks to **Wine MT5 + `XauDeskBridge` EA** via a **file bridge** (`gateway-mac`, no Python MT5 API).

**Measured latency (Mac track, 2025-11-16, demo account, TMGM-class ~243ms terminal ping):**

| Segment | Typical | What it means |
|---------|---------|----------------|
| **EA queue** (trade file read → `OrderSend` call) | **~0.87ms** | Local MQL5 only; **not** click-to-fill |
| **`OrderSend` span** (before/after in EA) | **~245ms** | Dominated by **broker RTT** inside MT5 |
| **Gateway write → ack** | **~274ms** | Mostly the row above + ack file poll |

Full detail: **[docs/artifacts/latency-summary-20251116.md](docs/artifacts/latency-summary-20251116.md)** · raw log: `docs/artifacts/latency-session-20251116.jsonl`. Re-run with `XAU_LATENCY_TRACE=1` and `npm run latency:analyze`.

Docs: **[docs/MAC_EASY_CONNECT.md](docs/MAC_EASY_CONNECT.md)** · **[docs/MAC_VERSION.md](docs/MAC_VERSION.md)** · **`mql5/`**

### License

[MIT](LICENSE) — tooling only, not investment advice. You are responsible for live trading outcomes.

---

## 中文

**XauDesk（黄金操盘台）** 是面向 **Windows + MetaTrader 5 + XAUUSD** 的专业级交易终端：图表、**本地网关**、**外部硬风控** 一体。

目标用户很清晰：**懂系统交易、有执行力，但风控纪律最难靠自觉**——连损加仓、盘中改规则、无 SL 手痒，都是实盘杀手。XauDesk 把规则做成系统：**单笔 / 日窗 / 连损分档 / 头寸与保证金** 在下单链路前拦截，而不是事后写总结。执行走 **本机环回**，延迟可量化：顶栏 **MT5 ms** 与 **RTT** 实时可见；同机环境下，**端到端常可压在 ~20ms 量级**（取决于机器与券商，指的是你的本地栈，不是吹 WAN）。

**适合：** 黄金日内 / 短线 / 系统化交易者，要 **MT5 实盘通道 + 机构化纪律**，而不是再多一个指标面板。

### 技术架构

| 模块 | 说明 |
|------|------|
| **桌面** | Electron 单窗口 · 无浏览器地址栏 · 一键桌面启动 |
| **图表** | Lightweight Charts · 与 MT5 周期一致 · 成交量 · 画线 · 指标 |
| **网关** | Python 标准库 HTTP · 官方 MT5 API · 后台无控制台 |
| **风控** | 单笔 & 日损（USD / 净值%）· 可配置连损档位与暂停 · 演算本金 · 保证金预算 · 最大头寸 · 强制止损 · 审计日志哈希链 |
| **下单** | ARM 确认 · 市价 / 挂单 · 图上拖动 SL/TP · Magic 隔离 |

### 延迟说明

- **MT5 ms**：网关调用 MT5 的耗时（同机常见亚毫秒～数 ms）。
- **RTT**：界面到本地网关的 HTTP 往返。
- 强调 **可观测、可优化** 的本地执行链，而非对券商线路做营销式承诺。

### 快速开始

1. 安装并登录 **MT5**；启用 **XAUUSD**（或通过 `MT5_SYMBOL` 指定券商符号）。
2. MT5 打开 **算法交易**。
3. `pip install MetaTrader5`（Python 与 MT5 **位数一致**）。
4. 本目录 `npm install`。
5. 首次双击 **`install-desktop.vbs`**，之后从桌面 **XauDesk** 启动（网关 5191 + 前端 5190 + Electron）。

风控设计：[docs/RISK_DESIGN_AND_PHILOSOPHY.md](docs/RISK_DESIGN_AND_PHILOSOPHY.md) · 版本记录：[CHANGELOG.md](CHANGELOG.md)

### macOS（Mac 轨 · 已可日常操盘）

**默认发行版仍是 Windows（Python + 官方 MT5 API）。** Mac 无 Python `MetaTrader5`，本仓库 **Mac 轨** 为：Electron 同款 UI + **`gateway-mac`** + Wine 内 **XauDeskBridge** EA（`Common/Files` 文件桥）。日常：**MT5 算法交易绿 + 打开 XauDesk**。

#### Mac 延迟实测（2025-11-16，勿与 Windows 栈混读）

压测 **34 笔** 市价/平仓（BTC 等），日志见 [docs/artifacts/latency-summary-20251116.md](docs/artifacts/latency-summary-20251116.md)。

| 分段 | 中位数量级 | 含义 |
|------|------------|------|
| **EA 排队** | **~0.87ms** | EA 已读到 `xau_trade.json` → 调用 `OrderSend` **之前** 的本机处理（**不是**整单延迟） |
| **`OrderSend` 段** | **~245ms** | EA 内 `OrderSend` 前后间隔；与 MT5 右下角 **~243ms 链路** 一致，**主体是券商网络往返** |
| **写盘 → ack** | **~274ms** | 网关发出交易文件到收到 EA ack；**实战体感「等成交」≈ 200–280ms 主要由网络决定** |

**为何与「本机 25–50ms」理论并存、不矛盾？**

- **~0.87ms** 只量 **EA 内最后一小段排队**（文件已进 EA 之后）。
- **点到 MT5 收到指令** 还应加上：UI → HTTP → 写桥文件 → **最多 ~16ms 等 EA 定时器** → **最多 ~25ms 等 ack 轮询**；该 session 多数未带 UI 时间戳，未单独汇总，粗算仍常在 **数十 ms** 量级。
- **整笔到券商确认/持仓出现** 还要加上 **`OrderSend` 内 ~245ms**，故 **总闭环 ~200ms+ 由网络主导**，不是「平均订单亚毫秒」。

> **亚毫秒/约 1ms** 仅适用于上表 **EA 排队** 一行；**不是** 从点 B 到成交的全链路。

复现：`XAU_LATENCY_TRACE=1 npm run gateway:mac` → `npm run latency:watch` / `npm run latency:analyze`（默认已关 trace，不占盘）。

上手：[docs/MAC_EASY_CONNECT.md](docs/MAC_EASY_CONNECT.md) · 分段：[docs/MAC_LATENCY_SEGMENTS.md](docs/MAC_LATENCY_SEGMENTS.md) · **后期路线图（含 10ms 目标）**：[docs/MAC_OPTIMIZATION_ROADMAP.md](docs/MAC_OPTIMIZATION_ROADMAP.md) · **Git 协作**：[docs/MAC_GIT_WORKFLOW.md](docs/MAC_GIT_WORKFLOW.md) · [docs/MAC_VERSION.md](docs/MAC_VERSION.md) · EA：`mql5/`

### 桌面图标打不开？

1. 看 **`logs/vite.err.log`**：若出现「未找到 npm」，说明快捷方式启动时 **未加载系统 PATH**（已在新版 `scripts/_root.ps1` 中修复：从注册表刷新 PATH）。
2. 需已安装 **Node.js LTS**（安装时勾选 *Add to PATH*），并在本目录执行过 **`npm install`**。
3. 网关：确认 **Python + `pip install MetaTrader5`**，MT5 已登录；查看 **`logs/gateway.err.log`**。
4. 仍失败时先用 **`run-dev.cmd`**（会弹出窗口便于看报错），确认 `http://127.0.0.1:5190` 能开，再双击桌面 **XauDesk**。
5. 若 Electron 已在运行，再次点图标只会 **聚焦旧窗口**（单实例）；任务管理器结束 `electron.exe` 后重试。

### 许可

[MIT](LICENSE) · 仅为交易工具，不构成投资建议；实盘后果自负。

---

## API (reference)

| Endpoint | Description |
|----------|-------------|
| `GET /api/mt5/status` | Terminal / account |
| `GET /api/ping` | `mt5_ms`, `server_ms` |
| `GET /api/quote` | Bid / Ask |
| `GET /api/bars?timeframe=15m` | OHLCV bars |
| `GET/POST /api/risk/*` | Risk status & configuration |

Optional env: `MT5_TERMINAL_PATH`, `MT5_SYMBOL`.
