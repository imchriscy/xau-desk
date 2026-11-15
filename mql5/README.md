# MQL5 · Risk Gateway（规划中）

本目录用于 **macOS / 可移植 MT5 终端** 上的执行与硬风控，替代 Windows 专属的 Python `MetaTrader5` 网关。

- 规格：[../docs/MQL5_RISK_GATEWAY.md](../docs/MQL5_RISK_GATEWAY.md)  
- Mac 路线：[../docs/MAC_VERSION.md](../docs/MAC_VERSION.md)  
- Windows 生产版仍使用 `backend/serve_mt5.py`（`main` 分支默认）。

**Path A（推荐）**：`Experts/XauDeskExec.mq5` + TCP 快通道 `5192` + `gateway-mac/`。  
遗留：`XauRiskGateway.mq5`（文件桥联调）。  
文档：[../docs/MAC_PATH_A_DESIGN.md](../docs/MAC_PATH_A_DESIGN.md) · [../docs/MAC_QUICKSTART.md](../docs/MAC_QUICKSTART.md)
