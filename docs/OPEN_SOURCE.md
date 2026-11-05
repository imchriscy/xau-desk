# 开源发布清单（隐私与仓库卫生）

## 项目名称

- **产品名**：XauDesk（黄金操盘台）
- **npm 包名**：`xau-desk`（建议 GitHub 仓库同名）

## 不要提交的内容

| 类型 | 路径 / 说明 |
|------|-------------|
| 风控运行时 | `backend/risk_state.json`（含 login、基准净值、参数） |
| 审计日志 | `backend/risk_events.jsonl`（含 login、deal ticket） |
| 成交日记 | `backend/trade_journal.json` |
| 运行日志 | `logs/` |
| 构建产物 | `dist/`、`node_modules/` |
| 本地密钥 | `.env`、任何密码、API token |

## 发布前自检

```bash
# 在仓库根目录（win-trade-terminal）执行
git status   # 不应出现上述被 ignore 的文件
rg "6010|TradeMax|你的姓名|Chris" --glob '!*.jsonl' --glob '!risk_state.json'
```

代码与文档中账户示例请用 **`60101234`**、**`Demo-Server`** 等占位。

## 首次运行

复制示例（可选）：

```bash
cp backend/risk_state.json.example backend/risk_state.json
```

真实数据会在首次连接 MT5 后由网关写入本地 JSON，**不会**进 Git。

## 宣传表述建议（诚实）

- ✅ 「本地 Python 调 MT5 API，**mt5_ms** 常在亚毫秒～数 ms」
- ✅ 「同机 localhost，**ping RTT + 下单链路**在良好环境下可 **&lt;20ms**」
- ❌ 避免「对券商 0.1ms」「全球最低延迟」等无法证实的绝对表述

顶栏 **MT5 ms / RTT ms** 即为可复现的延迟指标。
