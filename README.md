# XauDesk

[![Release](https://img.shields.io/github/v/release/imchriscy/xau-desk?label=release)](https://github.com/imchriscy/xau-desk/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**Windows 黄金（XAUUSD）操盘台** — Electron 图表 + 本地 MT5 Python 网关，面向 scalping / 日内：**硬风控**、图形下单、近机位延迟。

> 当前版本 **v0.2.0** · 变更见 [CHANGELOG.md](CHANGELOG.md)

---

## 一句话

在 **本机已登录 MetaTrader 5** 的前提下，用一块专为 **XAUUSD** 做的 Windows 终端：**风控机**管纪律，**下单路径**走 localhost，MT5 API 调用延迟通常在 **亚毫秒～数 ms**；界面顶栏可观测 **MT5 ms / HTTP RTT**，同机环回下 **端到端常可压在 ~20ms 内**（视机器与券商而定，非对赌商 WAN 延迟承诺）。

---

## 亮点（宣传 / Release Notes 可用）

| 维度 | 说明 |
|------|------|
| **平台** | Windows · MT5 官方 Python API · 默认 **XAUUSD**（符号可配置） |
| **延迟** | 本地网关 `127.0.0.1:5191`；`GET /api/ping` 返回 **mt5_ms**（Python→MT5）与 **server_ms**（HTTP 环回） |
| **图表** | Lightweight Charts · 多周期 · 成交量 · 画线 · 指标 |
| **下单** | ARM 确认 · 市价 / 挂单 · 图上拖 SL/TP · 网关直送 MT5 |
| **风控** | 单笔 / 日累计 / 连损分档暂停 · 演算本金 · 头寸与保证金预算 · 强制 SL · 审计哈希链 |
| **形态** | Electron 单窗口 · 网关 **pythonw** 无黑窗 · 一键桌面图标 |

---

## 快速开始

1. 安装 **MetaTrader 5** 并登录；报价里启用 **XAUUSD**（或券商等价符号）。
2. Python（与 MT5 **同位数**）：`pip install MetaTrader5`
3. Node.js LTS；在本目录：`npm install`
4. MT5 中开启 **算法交易（AutoTrading）**。
5. 首次：双击 **`install-desktop.vbs`** → 桌面 **XauDesk** 图标。
6. 日常：先 MT5 登录，再双击图标（自动重启网关 + 前端 + Electron）。

- 网关：`http://127.0.0.1:5191`
- 前端：`http://127.0.0.1:5190`（Vite 代理 `/api` → 5191）

日志：`logs/gateway.log`、`logs/vite.err.log` · 停服务：`stop-app.vbs`

### 环境变量（可选）

| 变量 | 说明 |
|------|------|
| `MT5_TERMINAL_PATH` | MT5 可执行路径 |
| `MT5_SYMBOL` | 默认自动探测；券商不同可设 `XAUUSDm` 等 |

---

## 风控

设计说明：**[docs/RISK_DESIGN_AND_PHILOSOPHY.md](docs/RISK_DESIGN_AND_PHILOSOPHY.md)**

改后端后执行 **`restart-backend.cmd`** 或重启桌面图标。网关版本见 `GET /api/risk/status` 或 `serve_mt5.py` 内 `GATEWAY_VERSION`。

---

## 开源与隐私

**切勿提交**真实账户数据。以下文件已在 `.gitignore` 中忽略，仅保留本地：

- `backend/risk_state.json`
- `backend/risk_events.jsonl`
- `backend/trade_journal.json`

首次克隆可用示例空状态：`backend/risk_state.json.example`。详见 **[docs/OPEN_SOURCE.md](docs/OPEN_SOURCE.md)**。

---

## API（节选）

| 路径 | 说明 |
|------|------|
| `GET /api/mt5/status` | 终端 / 账户 |
| `GET /api/ping` | `mt5_ms` + `server_ms` |
| `GET /api/quote` | Bid/Ask |
| `GET /api/bars?timeframe=15m` | K 线 |
| `GET/POST /api/risk/*` | 风控状态与配置 |

---

## 目录

```
win-trade-terminal/
  backend/serve_mt5.py      # HTTP 网关
  backend/risk_engine.py    # 风控引擎
  electron/main.cjs         # 桌面壳
  src/                      # React + 图表
```

---

## 打包（规划）

- MT5 **无法内置**，须用户自行安装并登录。
- 可将网关 PyInstaller 化 + Electron 安装包，用户只看到一个 **XauDesk** 窗口。

---

## License

[MIT](LICENSE) · 本项目为工具软件，**不构成投资建议**；实盘风险自负。
