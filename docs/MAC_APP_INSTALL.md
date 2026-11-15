# Mac 本地安装 · XauDesk.app

## 已安装位置

```text
~/Applications/XauDesk.app
```

启动台 / Finder → **应用程序** → **XauDesk**（深色金条图标）。

## 应用内自带

- 前端 UI（`127.0.0.1:5190`）
- Mac 网关（`127.0.0.1:5191`）
- 单实例窗口

## 连接 MT5（实盘数据）

1. MT5 编译并挂载 `mql5/Experts/XauDeskExec.mq5`
2. 开启算法交易
3. **Wine 版 MT5（常见）** Common 路径为：
   `~/Library/Application Support/net.metaquotes.wine.metatrader5/drive_c/users/user/AppData/Roaming/MetaQuotes/Terminal/Common/Files/xau_state.bin`
4. 一键复制 EA 源码：`bash scripts/install-mt5-ea-mac.sh`，再在 MetaEditor 编译并挂图

未挂 EA 时界面为 **未连接 / 模拟 K 线**，属正常。

## 重新打包安装（开发）

```bash
cd /path/to/XauDesk
npm install
npm run mac:pack      # release/mac-arm64/XauDesk.app
npm run mac:install   # 复制到 ~/Applications 并打开
```

图标源：`assets/icon-1024.png` → `build/icon.icns`
