# MQL5 Risk Gateway EA · 规格（Mac / 可移植执行层）

本文档把 **Windows 版 XauDesk Python 网关** 的行为，整理为可在 **MT5 终端内（含 MT5 for Mac）** 实现的 **Expert Advisor** 目标。实现文件预期位于 `mql5/`（当前为占位，欢迎 PR）。

## 设计原则

1. **下单前硬风控**：与 `backend/risk_engine.py` 一致——拒绝的订单不得到达券商（与「事后记账」不同）。
2. **Magic 隔离**：仅管理 `APP_MAGIC`（见 `backend/mt5_trading.py` 中 `MAGIC`），不碰手动单/其它 EA（可配置）。
3. **协议稳定**：HTTP JSON 与现有 `serve_mt5.py` 路径对齐，便于 Mac 上 React UI 复用 `src/api/*`。
4. **可观测**：每笔拒单/放行写审计事件（等价 `risk_events.jsonl` 字段）。

## 建议 EA 结构

```
mql5/
  XauRiskGateway.mq5      # OnInit / OnTimer / OnTick + HTTP 服务环
  Include/
    RiskEngine.mqh        # 从 Python 逻辑移植：日损、连损、SL 强制、头寸上限
    TradingOps.mqh        # OrderSend / close / modify
    JsonMini.mqh          # 轻量解析（或生成固定格式）
```

**OnTimer（例如 50–100ms）**：轮询本地命令队列（见「传输层」）。

## 传输层（任选其一，Phase 1 推荐 A）

| 方案 | 做法 | 适用 |
|------|------|------|
| **A. WebRequest 客户端 EA** | UI `POST` 到小型本地 Node/Python **仅转发**；EA 用 `WebRequest` 拉取 pending 指令 | Mac 上 UI 易调试 |
| **B. 命名管道 / 文件锁** | UI 写 `Common\Files\xau_cmd.json`，EA 读并原子清空 | 无 HTTP 服务器 |
| **C. Socket DLL** | 需第三方或 Win API | 优先 Mac 时不推荐 |

MT5：**工具 → 选项 → 顾问 → 允许 WebRequest**，加入 `http://127.0.0.1:*`。

## HTTP 端点（与 Python 网关对齐）

实现时保持与 `backend/serve_mt5.py` 相同路径与 JSON 形状，UI 改动最小。

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/health` | 存活 |
| GET | `/api/mt5/status` | 终端 / 账户连接 |
| GET | `/api/ping` | 延迟探测 |
| GET | `/api/quote` | Bid/Ask |
| GET | `/api/bars?timeframe=15m` | K 线（可用 `CopyRates`） |
| GET | `/api/account` | 净值、余额、杠杆 |
| GET | `/api/positions` | 持仓列表 |
| GET | `/api/orders` | 挂单 |
| GET | `/api/risk/status` | 风控状态、halt、连损档 |
| POST | `/api/order/market` | 市价（ARM + 风控后） |
| POST | `/api/order/pending` | 挂单 |
| POST | `/api/order/close` | 平仓 ticket |
| POST | `/api/position/modify` | 改 SL/TP |
| POST | `/api/order/modify` | 改挂单 |
| POST | `/api/order/cancel` | 撤单 |
| POST | `/api/risk/config` | 更新配置（需确认/签名） |

Phase 1 可只实现 **market / close / position/modify / risk/status / quote / bars**。

## 风控检查清单（移植自 Python）

在 `OrderSend` 前顺序执行（与 `risk_engine` 对齐，以源码为准）：

- [ ] `trading_halted`（日损、时段、手动 confirm）
- [ ] 连损 tier 暂停（`streak` 计数与冷静分钟）
- [ ] 单笔最大亏损 USD / 净值%
- [ ] 强制 SL（无 SL 拒绝市价，与 UI「强制 SL」一致）
- [ ] 最大同时持仓 + 挂单槽位
- [ ] 保证金预算（演算本金 × 系数 ÷ 杠杆）
- [ ] 手数步进与品种 `volume_min/max/step`

拒绝时返回：

```json
{ "ok": false, "error": "risk_reject", "reason": "daily_loss_cap", "detail": "..." }
```

## 前端适配（Mac）

`src/api/mt5.ts`、`src/api/risk.ts` 中 `BASE` 默认 `http://127.0.0.1:5191`：

```bash
# Mac .env.local 示例
VITE_GATEWAY_URL=http://127.0.0.1:5191
```

当执行层改为「仅 EA + 迷你转发器」时，端口可保持 **5191**，转发器只做 TLS/鉴权，逻辑在 EA。

## 安全

- 仅监听 `127.0.0.1`；远程方案必须 **Tailscale + mTLS 或 token**。  
- EA 输入配置：共享密钥 `XAU_GATEWAY_TOKEN`（HTTP Header `Authorization: Bearer …`）。  
- 勿在仓库提交真实 account login、密码、`risk_state.json`。

## 测试矩阵

| 场景 | Windows Python | MQL5 EA |
|------|----------------|---------|
| ARM 未开拒单 | ✅ | 待实现 |
| 连损第 3 笔暂停 | ✅ | 待实现 |
| 无 SL 市价拒单 | ✅ | 待实现 |
| 选中持仓 X 平仓正确 ticket | ✅ UI 已修 | UI 同逻辑 |

## 参考源码（Windows 权威实现）

| 文件 | 用途 |
|------|------|
| `backend/risk_engine.py` | 规则与状态机 |
| `backend/mt5_trading.py` | 下单、Magic、deal 归因 |
| `backend/serve_mt5.py` | HTTP 路由表 |
| `src/App.tsx` | ARM、选中持仓、快捷键 X |

## 下一步（贡献者）

1. 提交 `mql5/XauRiskGateway.mq5` 最小闭环：`GET /api/risk/status` + `POST /api/order/market`（demo）。  
2. Mac 上 MT5 策略测试器 + 模拟账户验证 Magic 与 SL 强制。  
3. 在 [MAC_VERSION.md](./MAC_VERSION.md) 更新「已实现端点」表格。
