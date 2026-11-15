# MT5 侧联调（需你本机点几下）

服务端与协议联调已通过：`npm run ipc:smoke` → `ALL PASS`。

当前机器 **未安装 mingw-w64**，`Mt5IpcBridge.dll` 尚未生成；EA 源码已编译为 `IpcBridgeSmokeTest.ex5`。

## 已自动完成

- Python 服务端（后台）：`/tmp/mt5_bridge.sock`（日志 `/tmp/mt5_ipc_server.log`）
- `Mt5IpcBridge.mqh`、`IpcBridgeSmokeTest.mq5/.ex5` 已拷入 Wine MT5
- 本机 ctypes + dylib 收发测试通过

## 请你操作（约 2 分钟）

1. **DLL 已用 llvm-mingw 编好**（无需等 brew）。若你改过 C++，再执行：
   ```bash
   ./ipc/scripts/build-mingw-dll.sh
   ./ipc/scripts/install-ipc-to-mt5.sh
   ```
   `brew install mingw-w64` 在你这台 macOS 14 上会**源码编译很久**，已改用 `ipc/tools/llvm-mingw` 预编译链。

2. **不必自动挂 IpcBridgeSmokeTest**  
   MT5 每张图通常只常驻一个 EA；**自动挂载的是 `XauDeskBridge`**（交易 + 状态）。  
   `IpcBridgeSmokeTest` 仅用于一次性验证 DLL；验证通过后请卸掉，只保留 **XauDeskBridge**。  
   XauDesk 启动网关时会自动拉起 IPC 服务端（`/tmp/mt5_bridge.sock`）。

3. **MT5（仅测 IPC 时）**
   - 工具 → 选项 → **专家顾问** → 勾选 **允许 DLL 导入**
   - 算法交易 **绿色**
   - 导航器 → 专家 → **IpcBridgeSmokeTest** → 拖到任意图
   - 参数 `InpSocketPath` 先试：`/tmp/mt5_bridge.sock`
   - 若图表注释仍无 `Ipc OK`，改为：`Z:\tmp\mt5_bridge.sock`

3. **验证**
   - 图表左上角应出现 `Ipc OK: {"ok":true,...}`
   - 或看日志：`tail -f /tmp/mt5_ipc_server.log`

## 停服 / 重启

```bash
pkill -f mt5_bridge_server.py
npm run ipc:server
```