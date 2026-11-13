# 返佣演习 JSONL 数据字典（parity / 实战分析）

路径：`backend/logs/rebate_drill/events.jsonl`（一行一条 JSON）。

## 事件类型

| kind | 用途 |
|------|------|
| `runner_start` | 进程/账户/品种快照 |
| `signal` | 5m 收盘信号、`p_long`/`p_short`、`quote_signal`、`theory_signal` |
| `intent` | 限价意图：双时刻报价 `quote_signal`/`quote_submit`、`quote_drift_*`、`theory_*` |
| `order_submit` | MT5 回执 `result`（含 `order` ticket）、`limit_px` |
| `order_outcome` | **挂单结局**：`filled` / `cancelled_ttl` / `gone_no_deal`；含 `age_sec`、滑点、`theory_match` |
| `order_gone` | 兼容短标记（带 `outcome`） |
| `ttl_expired` | TTL 撤单 + `price_touched_at_cancel`（触价是否发生过） |
| `reprice` / `drift_skip` | 报价漂移重挂或跳过 |
| `deal_entry` | MT5 入场成交（magic 过滤） |
| `fill_slip` | 相对挂单价滑点 + `theory_match`（相对 signal_close / passive / mid） |
| `deal_exit` | 平仓 deal（TP/SL 等）、`profit_usd` |
| `skip` | 日 cap / 净库存 cap |
| `smoke_begin` / `smoke_end` | 冒烟脚本 |

## 理论匹配字段（`theory_bundle` / `theory_match`）

- `passive_target_px`：被动限价（多=bid，空=ask）
- `theory_vs_passive_usd`：`signal_close - passive`（信号时刻）
- `fill_minus_passive_usd`：成交价 − 挂单价（理想应为 0）
- `fill_minus_signal_close_usd`：成交价 − 5m 收盘价
- `adverse_slip_usd`：对己不利滑点（正=更差）

## 汇总脚本

```powershell
py -3 scripts\summarize_rebate_drill.py --live-only
py -3 scripts\export_rebate_drill_jsonl.py
```

输出：`logs/rebate_drill/summary_latest.json`（挂单成功率、TTL 撤单率、触价未成交次数、滑点分布）。

## 跑一段时间的建议

1. 保持 `MingLimitRebateRunner` 常驻；**勿删** `events.jsonl`（可按月轮转复制）。
2. 每日/每周跑一次 `summarize_rebate_drill.py --live-only`。
3. 与回测对照：`fill_rate` vs `fill_prob=0.99`，`touch_but_ttl_cancel` vs 回测触价队列失败。
