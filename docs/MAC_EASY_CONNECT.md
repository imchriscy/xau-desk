# Mac · 最简单连接方式（2 步日常 + 1 次首次）

Mac 版没有 Windows 的 Python `MetaTrader5` 库，因此需要 **一个极小的 EA（XauDeskBridge）** 把账户/K 线写到共享文件夹。对用户来说：**首次配置一次，以后每天两步**。

## 日常（你希望的使用方式）

1. 打开 **MT5**，登录要交易的账号，点工具栏 **算法交易**（绿色）。
2. 打开 **XauDesk**，自动识别账户与净值。

在 MT5 **换账号 / 换券商** 后：

- 多数情况 **不到 1 秒** 自动更新（EA 检测到 `login@server` 变化）；
- 若没有，点图表区 **「立即刷新 MT5 连接」** 或 **设置 → 刷新 MT5 连接**。

## 首次（只需做一次）

在仓库目录执行：

```bash
npm run mac:setup
```

会自动：复制 EA、编译 Bridge、写好桥目录。

若希望 **完全不用手拖 EA**，再执行：

```bash
bash scripts/mt5-autoload-ea.sh
```

脚本会重启 MT5，用官方 `/config` 自动挂 **XauDeskBridge**；XAU / BTC / NAS100 等符号由 EA 在全市场扫描匹配，**不必**先在「市场报价」里逐项添加。

### 手动挂 EA（约 15 秒）

1. MT5 → **导航器** → **专家顾问** → **XauDeskBridge**
2. 拖到任意品种图表即可（EA 会自动解析券商上的黄金/比特币/纳指符号）
3. 勾选 **允许算法交易**

## 原理（给 DMG 打包参考）

```text
MT5（算法交易开）→ XauDeskBridge EA → Common/Files/xau_state.json
                                    ↓
XauDesk App → gateway-mac :5191 → 读状态 + K 线 RPC
```

桥目录固定在：`~/Library/Application Support/XauDesk/bridge-path.txt`（自动探测 Wine 用户目录）。

## 常见问题

| 现象 | 处理 |
|------|------|
| XauDesk 无账户 | MT5 是否算法交易已开；图表右上角 EA 是否笑脸 |
| 显示旧券商账号 | 点「立即刷新」；确认当前登录账号对应的黄金图上有 EA |
| 品种名不同 | 正常，顶栏与 K 线会显示券商实际符号（如 `XAUUSDm`、`BTCUSD#`） |
| 切换 BTC/NAS 后 K 线不变 | Cmd+Q 重开 XauDesk；确认 EA 已更新且算法交易为绿 |
