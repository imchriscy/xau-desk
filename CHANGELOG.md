# Changelog

All notable changes to **XauDesk** are documented here. Versioning follows [SemVer](https://semver.org/).

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
