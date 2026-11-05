# GitHub 仓库文案（XauDesk）

复制到 GitHub 创建仓库 / Settings → General → About 即可。

---

## 基本信息

| 字段 | 建议内容 |
|------|----------|
| **Repository name** | `xau-desk` |
| **Description（英文，≤350 字符）** | XauDesk — Windows MT5 XAUUSD trading desk: Electron chart UI, local Python gateway, hard risk engine (daily/streak/per-trade), ARM + drag SL/TP. Sub-ms MT5 API on localhost; e2e often &lt;20ms loopback. |
| **Description（中文短版，可放 README 或 Release）** | Windows 黄金 XAUUSD 操盘台：MT5 本地网关、Electron 图表、硬风控、图形下单；同机低延迟。 |
| **Website** | （可选）留空或你的文档页 |
| **Topics** | `metatrader5` `xauusd` `gold` `trading-terminal` `electron` `react` `typescript` `python` `risk-management` `forex` `windows` |

---

## About 区（Social / 首页卡片）

**Tagline（一行）**

> XauDesk — MT5 XAUUSD on Windows: chart, risk machine, localhost speed.

**中文一行**

> 黄金操盘台：MT5 + 风控 + 图表下单，Windows 本地环回低延迟。

---

## 仓库 README 首段（与根目录 README 一致）

见项目根 [README.md](../README.md)。

---

## Release v0.2.0 标题与说明（示例）

**Title:** `XauDesk v0.2.0 — Risk panel & open-source branding`

**Body:**

```markdown
## XauDesk

Windows desktop terminal for **XAUUSD** via **MetaTrader 5** (must be installed & logged in locally).

### Highlights
- Electron + Lightweight Charts
- Local gateway `:5191` — **mt5_ms** / **RTT** on the top bar
- Risk: per-trade, daily, streak tiers, margin budget, forced SL, audit log
- Drawing tools, volume, indicators

### Requirements
- Windows, MT5, Python + `MetaTrader5`, Node.js LTS
- Enable **Algo Trading** in MT5

### Privacy
Do not commit `backend/risk_state.json`, `risk_events.jsonl`, `trade_journal.json` — see docs/OPEN_SOURCE.md
```

---

## 独立仓库 vs MING  monorepo

当前 XauDesk 源码路径：

`Ming/strategies/MicroEdge_Factory/research/xau_scalp_mt5/win-trade-terminal/`

若要在 GitHub 上 **单独** 开源 `xau-desk`（推荐， star 更清晰）：

1. 本机登录 GitHub CLI：`gh auth login`
2. 仅导出该目录为新仓库（在 **win-trade-terminal** 目录执行）：

```bash
# 示例：新建独立仓库并首次推送（请先确认 .gitignore 已排除隐私 JSON）
gh repo create xau-desk --public --source=. --remote=origin --description "XauDesk — Windows MT5 XAUUSD trading desk"
git init
git add .
git commit -m "Initial open-source release: XauDesk"
git branch -M main
git push -u origin main
```

若目录已在 **MING** 大仓库的 git 跟踪下，需先在独立文件夹复制一份再 `git init`，或使用 `git subtree split`（见 GitHub 文档）。

继续放在 **MING** 仓库内也可以：在 MING 的 About 里加一句 “Includes **XauDesk** (`…/win-trade-terminal`)”.

---

## 本机连接状态（自行检查）

```bash
gh auth status
git remote -v
```

未登录时：`gh auth login`（Browser / Token 均可）。
