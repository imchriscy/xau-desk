# Mac 延迟实测摘要 · 2025-11-16

数据源：`latency-session-20251116.jsonl`（332 行事件，34 笔市价/平仓 trace 可统计）

## 读数别混：三段延迟

1. **EA 排队 ~0.87ms** — 仅「EA 已读到交易文件 → 尚未调用 `OrderSend`」；**不是**点按钮到成交。
2. **本机桥 + UI（未在本 session 全量打标）** — 理论预算仍约 **数十 ms**（16ms 定时器、25ms ack 轮询、HTTP/写盘）；与 ~0.87ms **相加**，不是替代。
3. **`OrderSend` ~245ms + 总 ack ~274ms** — **券商 RTT** 占主导；与 MT5 终端显示的 ~243ms 链路一致。

## 结论（分段统计）

| 指标 | 市价 n=22 | 平仓 n=12 |
|------|-----------|-----------|
| EA 排队（读到 trade 文件 → OrderSend 前） | 中位 **874μs** (~0.9ms) | 中位 **866μs** |
| `OrderSend` 段（EA 内 before→after） | 中位 **~246ms** | 中位 **~245ms** |
| 网关写盘 → ack（含上项） | 中位 **274ms** | 中位 **278ms** |
| 网关 ack 轮询次数 | 中位 **11**（≈11×25ms 与尾延迟叠加） | 中位 **11.5** |

- **本机栈**（文件桥 + 16ms 定时器）：EA 内排队约 **1ms 内**，符合设计目标。
- **`OrderSend` ~245ms** 与 MT5 右下角 **~243ms 链路**一致：主要是 **券商网络往返**，不是 XauDesk 文件桥。
- 少数 **写盘→ack 27–28ms** 样本为 polls≈2，可能未等到完整成交回报或异常快路径；主流仍 ~270ms。
- 本次多数 trace **未带 UI `ui_t0_ms`**（可能未用最新 Cmd+Q 后的 App），故未统计「点击→写盘」；后续开 `XAU_LATENCY_TRACE=1` 可补测。

## 复现

```bash
XAU_LATENCY_TRACE=1 npm run gateway:mac   # 可选
npm run latency:watch
npm run latency:analyze
```

## 延伸阅读

三段延迟、家宽是否单独成段、VPS 与「5ms 极限」：[../MAC_LATENCY_SEGMENTS.md](../MAC_LATENCY_SEGMENTS.md)