# Mac 轨：持仓 UI 全链路（审计用）

## 现象对照

| 用户看到 | 实际含义 |
|----------|----------|
| 黄字「买 #N 已成交」 | `POST /api/order/market` 已 HTTP 200 且 `ok:true`（与底部 N 无必然关系） |
| 底部「持仓 N」 | `App.tsx` 中 `positions.length` = `mergedMt5Positions`（非 MT5 终端实时数） |
| N 先 0、数秒后才 1 | **ack 未写入 UI**，只靠 `GET /api/positions`（state/snapshot 滞后）补上 |

## 链路（按 B 市价）

```
B / 按钮
  → submitOrder()
  → POST /api/order/market  (gateway-mac/server.mjs)
  → rpcTrade → xau_trade.json → EA BridgeExecTrade market
  → OrderSend → xau_trade_ack.json { ok, result: { ticket, price, side, lots } }
  → 网关 flatten → HTTP JSON { ok, ticket, price, side, lots, symbol, latency }
  → sendMarketOrder() → normalizeMarketTicket()
  → [应有] ackHoldRef + displayPositions + flushSync → mergedMt5Positions → N≥1
  → [以往缺陷] 仅 if (res.ticket) 写入；ticket 缺/嵌套未解析 → N=0，仍 setFlash 已成交
  → 并行：useMt5PositionsSync 每 120ms GET /positions?snapshot=0（读 xau_state，常滞后）
  → 成交后 snapshot=1 合并（数秒级才稳定到与 MT5 一致）
```

## UI 真源（当前约定）

| 来源 | 作用 |
|------|------|
| `displayPositions` | **唯一 state**：ack / snapshot / bootstrap 写入；**展示直接读它** |
| poll `useEffect` | 仅 patch 已有 ticket 或（非 mute 时）追加；**从不整表清空** |
| `dismissedTicketsRef` | 已平 ticket，poll 不得写回 |
| 已删除（闪因） | `mt5UiPositions` + `suppressedTickets` 二次过滤 → 列表 state 还在但 UI 算成 `[]` |

## 根因摘要（一帧全没）

`displayPositions` 里仍有仓，但派生层用 `suppressedTickets`/`hidden` 过滤后 `mt5UiPositions=[]`；此时 `executeOnMt5` 仍为 true → `mt5Live` true 且 `positions=[]` → 侧栏/K 线/N 同步闪没，数秒后 snapshot 再写入 state。

## 历史根因（为何修了多轮仍闪/迟）

1. **已成交但 N=0**：前端 `if (res.ticket)` 过严；网关 spread `ack.result` 与字段名不一致时 ticket 为 `undefined`，闪字照常。
2. **0/1 乱跳**：账户轮询误判 session → `setDisplayPositions([])`（已改为仅 login 变化清空）。
3. **显示 2 笔慢**：仅靠滞后 state；跨设备（手机+桌面）仓要等 snapshot/多轮 poll。

## 验收检查

1. DevTools → Network：`order/market` 响应体必须含 **`ticket` > 0**（同秒与黄字一起出现）。
2. 同帧底部 **N≥1**（不应等数秒才变）。
3. 若响应无 `ticket`：应出现「正在拉持仓…」并马上打 `positions?snapshot=1`；仍无则查 EA / `xau_trade_ack.json`。

## 相关文件

- `src/App.tsx` — submitOrder、mergedMt5Positions、ackHoldRef
- `src/api/mt5.ts` — normalizeMarketTicket、sendMarketOrder
- `gateway-mac/server.mjs` — `/api/order/market` 响应扁平化
- `gateway-mac/mt5-payload/BridgeRpc.mqh` — market ack result JSON
- `src/hooks/useMt5PositionsSync.ts` — 轮询 `/positions`