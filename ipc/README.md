# MT5 ↔ macOS 原生进程 · Unix Domain Socket IPC

## 架构

```
MQL5 EA  ──#import──▶  Mt5IpcBridge.dll (Wine 进程内)
                              │
                              │ AF_UNIX SOCK_STREAM
                              ▼
                    /tmp/mt5_bridge.sock
                              │
                              ▼
              mt5_bridge_server.py (macOS 原生)
```

**重要（Mac + Wine MT5）**

- MQL5 只能 `Liberal` **PE 格式的 `.dll`**（放在 `MQL5/Libraries/`），不能把 macOS `.dylib` / `.so` 直接 `#import`。
- 在 Mac 上请用 **MinGW-w64 交叉编译** 出 `Mt5IpcBridge.dll`，复制到 Wine MT5 的 `MQL5/Libraries/`。
- 用 **macOS 本机 g++ 编出来的 `.so`** 仅适合在本机做 **服务端联调 / 单元测试**，不能给 MQL5 加载。

**Wine 下的 socket 路径**

- 原生路径：`/tmp/mt5_bridge.sock`
- Wine 里常见写法：`Z:\tmp\mt5_bridge.sock` 或 `\\.\unix\tmp\mt5_bridge.sock`（视 Wine 版本而定）
- 建议在 EA 里用 `input string InpSocketPath = "/tmp/mt5_bridge.sock";`，连不上再试 `Z:\\tmp\\mt5_bridge.sock`。

## 帧格式（二进制，非阻塞友好）

| 字段 | 长度 | 说明 |
|------|------|------|
| `len` | 4 B | little-endian `uint32`，payload 字节数，最大 1 MiB |
| `payload` | `len` | UTF-8 文本（紧凑 JSON 或自定义二进制） |

`ReadMessage` 每次至多收 **一帧**；无完整帧时返回 `0`（可稍后重试）。

## 编译 DLL（给 MQL5 / Wine）

```bash
# 需安装：brew install mingw-w64
./ipc/scripts/build-mingw-dll.sh
# 输出：ipc/dist/Mt5IpcBridge.dll
```

复制到：

`~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/Program Files/MetaTrader 5/MQL5/Libraries/Mt5IpcBridge.dll`

并在 MT5：**工具 → 选项 → 专家顾问 → 允许 DLL 导入**。

## 启动 Python 服务端

```bash
python3 ipc/native/mt5_bridge_server.py
# 或自定义路径：
MT5_IPC_SOCK=/tmp/mt5_bridge.sock python3 ipc/native/mt5_bridge_server.py
```

## 本机测试用 POSIX .so（不给 MQL5）

```bash
./ipc/scripts/build-posix-so.sh
```

用于在 macOS 上验证 socket 协议，与 Python 服务端互通。