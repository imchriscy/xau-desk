# TMGM 模拟盘 · 限价返佣演习（Windows VPS）

## 为什么必须在你那台 VPS 上跑

`MetaTrader5` Python API **只能 attach 到本机已打开的 MT5 终端**。Cursor 开发机无法「远程登录」你在阿里云 Windows 上已登好的 TMGM 模拟盘；只能把代码同步到 VPS，在 **MT5 已登录、算法交易已允许** 的同一台机器上执行。

## 目录

```
win-trade-terminal/backend/
  config/limit_rebate_tmgm_demo.json   # 0.1 手、库存 ±0.2、pd50、TP/SL 4U
  scripts/probe_mt5_account.py         # 连通性与点差探测
  limit_rebate_runner.py               # 5m 收盘信号 + bid/ask 限价意图
```

## VPS 一次性准备

1. 安装 Python 3.10+，`pip install MetaTrader5 pandas numpy`
2. 克隆/拉取本仓库到 VPS（或只拷贝 `xau_scalp_mt5` 整目录）
3. MT5：**TMGM Demo** 已登录，**工具 → 选项 → 算法交易** 勾选
4. 环境变量（按你终端实际路径改）：
   - `MT5_TERMINAL_PATH=C:\Program Files\MetaTrader 5\terminal64.exe`
   - `MT5_SYMBOL=XAUUSD`（若品种名带后缀如 `XAUUSD+` 以市场报价为准）

## 探测（先跑这个）

```powershell
cd ...\xau_scalp_mt5\win-trade-terminal\backend
py -3 scripts\probe_mt5_account.py
```

期望 JSON：`account_kind` 为 **demo**，`spread_points` 约 **32**，`company` 含 TMGM。

若提示实盘：请 **勿** 加 `--live`，先在 MT5 里切换到模拟账户。

## 演习 runner

```powershell
# 默认 dry-run：每根新 5m 只打印 intent，不下单
py -3 limit_rebate_runner.py --config config\limit_rebate_tmgm_demo.json --once

# 确认 intent 合理后（模拟盘 + 小资金）
py -3 limit_rebate_runner.py --config config\limit_rebate_tmgm_demo.json --live
```

### 常驻（推荐，避免关 RDP 后进程退出）

在 VPS **管理员 PowerShell** 执行一次：

```powershell
cd C:\opt\ming-xau-scalp\xau_scalp_mt5\win-trade-terminal\scripts
powershell -ExecutionPolicy Bypass -File .\install_limit_rebate_runner_task.ps1
```

注册计划任务 **`MingLimitRebateRunner`**：登录 + 开机延迟 3 分钟启动，`--live`，失败每 1 分钟重试；标准输出 → `backend\logs\rebate_drill\runner_stdout.log`。

状态检查：

```powershell
powershell -ExecutionPolicy Bypass -File .\status_limit_rebate_runner.ps1
```

### 冒烟（通路 + 挂单成交率）

暂停 runner 后执行（避免双进程抢 MT5）：

```powershell
Stop-ScheduledTask -TaskName MingLimitRebateRunner
cd ..\backend
$env:MT5_SYMBOL='XAUUSD'
py -3 scripts\smoke_limit_rebate_path.py --live
# 可选无信号时：--force-side buy
Start-ScheduledTask -TaskName MingLimitRebateRunner
```

报告：`backend\logs\rebate_drill\smoke_*.json`（TTL 内是否成交、`price_touched_during_ttl`、相对 `signal_close` 滑点）。

逻辑与回测 `xau_mm_limit_bounded` 对齐：

| 项 | 值 |
|----|-----|
| 手数 | 0.1 |
| 净库存上限 | 0.2 手 |
| 进场 | 多单 @ bid、空单 @ ask（被动限价） |
| TP/SL | 各 4 USD/oz |
| 信号 | v003 · 5m30m1h · thr=10 · smooth=3 |
| 北京日新开 | ≤50 |

**TMGM 演习 economics**：live 返佣记 0；分析时用配置里 `rebate_per_lot_side_usd_projected_yingshi: 22` 外推盈十现金流。

## 交易日志（复盘 / parity）

| 路径 | 说明 |
|------|------|
| `backend/logs/rebate_drill/events.jsonl` | 每行一条：见 `docs/REBATE_DRILL_JOURNAL.md`（含 `order_outcome`、`theory_match`、出场 `deal_exit`） |
| `backend/logs/rebate_drill/summary_latest.json` | `summarize_rebate_drill.py` 聚合指标 |
| `backend/limit_rebate_runner_state.json` | 挂单 TTL、日计数、已见 deal |

JSONL 字段含：**信号时刻 vs 下单时刻** `quote_signal` / `quote_submit`、`theory_signal`（5m close / mid / 被动价）、`quote_drift_usd`、`adverse_slip_usd`。

本机同步部署：`bash win-trade-terminal/scripts/deploy_mt5_vps.sh`（目标 `C:\opt\ming-xau-scalp`）。

导出 CSV：`py -3 scripts/export_rebate_drill_jsonl.py`

报价回头挂不上：`quote_refresh.on_drift=reprice_once` 会在漂移超阈值时 **按新 bid/ask 重挂一次**；仍失败记 `drift_skip`。

## 与盈十实盘的区别

- 点差可能同为 ~32 点，**差异主要在返佣**（盈十 ~$22/标准手/边，TMGM 低或无）
- 演习目标：成交率、挂单 TTL、交易腿 PnL → 再与 `backtest_xau_limit_bounded_stitch` 同月 parity

## 本机开发机注意

开发机若连着 **IEXS 等其他实盘**，`probe` 可能显示 real；**禁止**在本机对该账户 `--live` 0.1 手。
