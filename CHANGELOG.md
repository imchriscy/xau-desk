# Changelog

All notable changes to **XauDesk** are documented here. Versioning follows [SemVer](https://semver.org/).

## Unreleased

## [0.3.0] — 2026-11-13 · `v0.3.0`

Windows 生产版功能更新 + **macOS / MQL5 路线文档**（执行层仍仅 Windows Python 网关）。

### Added

- **每日必读 · 硬风控**：顶栏按钮 + 侧栏 ARM 区折叠模块；十条四字箴言 + 五毒 / 七宗罪标签，点卡片展开细则（与成长记录第 47 页同步）。
- **连损条例弹窗**：连续止损达到 tier1（默认 3）或 tier2（默认 5）时弹出可关闭复读窗，突出洪潮莫扑 / 触顶封刀 / 惟台是门 / 无盾莫出。
- **周期切换自动定位最新 K 线**：点击任意周期按钮，新 K 线加载完成后自动跳到最新（「最新」按钮仍可作为快捷键）；修复切换后仍停留旧视野的问题。
- **Tick 买卖价差图**：图表命令栏「Tick价差」打开浮层，红 Ask / 蓝 Bid 双折线，约 350ms 轮询 `/api/quote` 客户端环形缓冲。
- **macOS 文档**：[docs/MAC_VERSION.md](docs/MAC_VERSION.md)、[docs/MQL5_RISK_GATEWAY.md](docs/MQL5_RISK_GATEWAY.md)、`mql5/` 占位目录。
- **TMGM VPS / 限价返佣演习**：`docs/TMGM_VPS_DEPLOY.md`、`limit_rebate_runner.py` 与相关脚本（可选模块）。

### Fixed

- **持仓选中**：轮询刷新持仓列表不再抢用户选中项；仅在成交/改单等 `posSyncTick` 事件后默认选最新单，`X` 平仓与选中 ticket 一致。

[0.3.0]: https://github.com/imchriscy/xau-desk/releases/tag/v0.3.0

## [0.2.0] — 2026-11-05 · `v0.2.0`

First public open-source release focused on **discipline + execution** for XAUUSD on Windows.

### Added

- **Risk engine**: per-trade caps, daily session (BJT), streak tiers (configurable counts & pause minutes), virtual equity, margin budget, forced SL, audit hash chain.
- **Risk UI**: wide card layout (per-trade / daily / exposure / streak), centered modal, presets.
- **Chart**: MT5-native bars, volume, indicators, drawings (trend / rect / fib) with edit handles.
- **Desktop**: Electron shell + local Python gateway (`5191`), desktop shortcut **XauDesk**.
- **Settings**: MT5 auto-connect workflow + usage guide (no in-app password storage).

### Notes

- Requires **MetaTrader 5** logged in locally; not a broker replacement.
- Latency: **mt5_ms** / **RTT** shown in UI; loopback e2e often &lt;20ms on a healthy same-PC setup.
- Do not commit local `backend/risk_state.json`, `risk_events.jsonl`, `trade_journal.json`.

[0.2.0]: https://github.com/imchriscy/xau-desk/releases/tag/v0.2.0
