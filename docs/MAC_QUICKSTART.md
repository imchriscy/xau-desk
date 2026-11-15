# Mac 实用重构 · 最快闭环（MQL5 + Node，无 Python）

目标：**复用现有 React UI**，在 **MT5 for Mac** 内用 **MQL5 EA** 做执行，Node 只做 HTTP 适配（与 Windows `serve_mt5.py` 同路径）。

## 架构（推荐，Phase 1 已实现骨架）

```text
浏览器/Electron :5190  ──proxy──►  gateway-mac :5191
                                        │
                          Terminal/Common/Files/
                            xau_state.json  ◄── EA 定时写
                            xau_cmd.json    ──► EA 读命令
                            xau_ack.json    ◄── EA 写结果
                                        │
                              XauRiskGateway.mq5（图表上运行）
                                        │
                              MT5 for Mac 本机成交
```

**为什么不用 Python**：官方 `MetaTrader5` 包仅 Windows。  
**为什么不用 EA 内嵌 HTTP**：MQL5 做服务端麻烦；**文件桥** 最省事、Mac 可用。  
**风控怎么快**：Phase 1 在 EA 内做 **强制 SL + Magic 隔离 + Demo 开关**；完整 `risk_engine.py` 规则分阶段搬进 `Include/RiskEngine.mqh`（见 [MQL5_RISK_GATEWAY.md](./MQL5_RISK_GATEWAY.md)）。

## 30 分钟上手

### 1. 依赖

- MetaTrader 5 for Mac（已登录、开启 **算法交易**）
- Node.js LTS
- 本仓库：`npm install`

### 2. 编译并挂载 EA

1. 复制 `mql5/XauRiskGateway.mq5` 到 MT5 数据目录的 `MQL5/Experts/`（或通过 MetaEditor 打开该文件）。
2. 编译（F7）。
3. 在 **XAUUSD**（或你的券商黄金符号）图表挂上 **XauRiskGateway**：
   - `InpMagic` = `8805190`（与 Windows 一致）
   - `InpRequireSL` = true
   - 演示账户：`InpAllowDemo` = true

4. 确认 Common 目录出现 `xau_state.json`：

```bash
ls "$HOME/Library/Application Support/MetaQuotes/Terminal/Common/Files/"
```

若路径不存在，可手动指定：

```bash
export XAU_BRIDGE_DIR="$HOME/Library/Application Support/MetaQuotes/Terminal/Common/Files"
```

### 3. 启动 UI + 网关

```bash
chmod +x scripts/run-mac-dev.sh
./scripts/run-mac-dev.sh
```

或分两个终端：

```bash
node gateway-mac/server.mjs
npm run dev
```

打开 **http://127.0.0.1:5190**。顶栏应显示 MT5 已连接；`GET http://127.0.0.1:5191/api/mt5/status` → `connected: true`。

### 4. Phase 1 已对齐的 API

| API | 说明 |
|-----|------|
| `GET /api/quote`, `/bars`, `/account`, `/positions`, `/orders` | EA 状态 + bars RPC |
| `GET /api/risk/status` | Node 默认字段 + EA `risk` 块 |
| `POST /api/order/market`, `/order/close`, `/position/modify` | EA 执行 |
| 挂单 / 完整风控 / 审计哈希链 | 待 Phase 2 |

## 演进顺序（实用主义）

1. **现在**：文件桥 + 市价/平仓/改 SLTP + K 线 → 能外出 Mac 实盘试单。  
2. **下一步**：把 `risk_engine.py` 里 `check_order_allowed`、日损、连损 tier 逐条移植到 MQL5。  
3. **可选**：远程 Windows VPS（[MAC_VERSION.md](./MAC_VERSION.md) 拓扑 A/C）在 EA 未就绪前零改动用现网 Python 网关。  
4. **不推荐先做**：在 EA 里起完整 HTTP、或 Mac 上强行 port Python MT5。

## 与 Windows 主线的关系

- `main` 仍维护 **Python 网关**（权威风控）。
- Mac 工作建议分支 `feature/mql5-mac-gateway`；合并前用 CHANGELOG 勾选端点对齐表。
