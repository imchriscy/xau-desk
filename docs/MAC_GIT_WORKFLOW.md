# Mac 轨 · Git 协作节奏（与 Windows `main` 并行）

> **原则**：Mac 日常开发在 **`feature/mt5-exec-mac`**（或后继 `mac/*` 分支）进行；**`main` 以 Windows 实盘栈为准**。共享 UI 改动需考虑两侧兼容，Mac 专有加 `gateway-mac/`、`mql5/`、Mac 脚本与文档前缀。

---

## 分支模型（推荐）

| 分支 | 用途 |
|------|------|
| **`main`** | Windows 发布线（Python 网关 + 官方 MT5 API），仅合并已测 Windows 改动 |
| **`feature/mt5-exec-mac`** | Mac 文件桥 + EA + `gateway-mac` + Mac 文档（当前 Mac 轨主开发分支） |
| **`mac/<topic>`**（可选） | 从 `feature/mt5-exec-mac` 拉出的小功能，如 `mac/multi-symbol`、`mac/risk-streak` |

```text
main ─────────────────────────► Windows 发布
         ╲
          ╲── feature/mt5-exec-mac ──► Mac 提交 / PR 合回本分支
                    ╲
                     └── mac/xxx（短分支，几天内合并回 feature/mt5-exec-mac）
```

**不要**在 Mac 上长期直接改 `main` 却不分离提交，以免和 Windows 机上的 Rust/Python 演进搅在一起。

---

## Commit 节奏（避免「改一堆再上传」）

### 一条 commit 应满足

1. **可复述的一句 why**（中文或英文均可，与仓库现有风格一致）。
2. **可独立回滚**（不半个功能 + 半个文档凑一单）。
3. **能通过本机最小验证**（见下表）。

### 建议粒度

| 类型 | 频率 | 示例信息 |
|------|------|----------|
| **EA / MQL5** | 每完成一个可测行为 | `fix(bridge): BTC 品种切换不写回 XAU` |
| **gateway-mac** | API 或风控逻辑一块 | `feat(gateway-mac): 连损入账全品种` |
| **共享 UI (`src/`)** | 一个用户可见问题 | `fix(ui): 顶栏两行布局；BTC 用 MT5 profit` |
| **文档** | 可与功能同 commit，或单独 `docs:` | `docs: Mac 延迟分段与优化路线图` |
| **脚本 / 打包** | 部署路径变化时 | `chore(mac): compile-mt5-bridge 同步 payload` |

### 不宜单次 commit 的内容

- 未编译通过的 EA + 未 `npm run build` 的前端混在一起且无说明  
- **>500MB** 工具链（`ipc/tools/` 勿提交，见 `.gitignore`）  
- 本机路径、桥目录、`bridge-path.txt`、含账号的 `xau_state.json`  

---

## 日常循环（你 + Cursor）

1. **开工前**  
   `git fetch origin` → 在 `feature/mt5-exec-mac` 上 `git pull --rebase`（仅当你单人 Mac 开发时可省略，多机必做）。

2. **一小步改完**（例如只修持仓盈亏或只改 EA 1.020）  
   - `npm run build`  
   - 可选：`bash scripts/compile-mt5-bridge-mac.sh`（动过 `mql5/` 时）  
   - Cmd+Q 重开 App 点测一条路径（连 MT5、切品种、B/X）

3. **提交**（小步快走）  
   ```bash
   git add <明确文件列表>   # 避免 git add -A 误带 release/、工具链
   git status               # 再看一眼
   git commit -m "fix(mac): ..."
   ```

4. **推送**（每天收工或完成一个可测里程碑）  
   ```bash
   git push -u origin feature/mt5-exec-mac
   ```

5. **准备给 Windows 合并的 UI 改动**  
   - 只含 `src/` 且无 Mac 硬编码时，可 cherry-pick 到 `main` 的 PR  
   - Mac 专用逻辑保留在 `gateway-mac/`、`electron/mac-bootstrap.cjs` 等  

---

## 与 GitHub 同步（Mac 轨）

| 动作 | 命令 |
|------|------|
| 首次推送 Mac 分支 | `git push -u origin feature/mt5-exec-mac` |
| 开 PR（可选，对 `main` 仅文档/README Mac 节） | `gh pr create --base main --head feature/mt5-exec-mac` |
| 仅同步 Mac 线、不合并 main | 只 push `feature/mt5-exec-mac`，PR 可设 **draft** |

**推荐**：Mac 功能未稳定前，PR 标题带 **`[Mac]`**，说明 **不影响 Windows 默认安装路径**。

---

## 发版打 tag（Mac 本地 DMG / App）

- Tag 打在 **`feature/mt5-exec-mac`** 或合并后的提交上：`mac-v0.3.1-bridge.020`  
- 在 tag message 中写：**EA `bridge_ver`、最低 Node 版本、是否需重编译 EA**  
- **不要**与 Windows `v0.3.0` 共用同一 tag 名，避免 Release 页混淆  

---

## `.gitignore` 提醒（Mac 开发）

已忽略或应忽略：`node_modules/`、`dist/`、`release/`、`ipc/tools/`、Wine 缓存、本地 `bridge-path.txt`、含账户信息的 `xau_state.json` / `xau_deals.jsonl`（若在仓库根目录误拷）。

**可提交**：`docs/artifacts/latency-summary-*.md`、脱敏后的 `latency-session-*.jsonl` 样本（无账号 token）。

---

## 相关文档

- [MAC_EASY_CONNECT.md](MAC_EASY_CONNECT.md) · [MAC_LATENCY_SEGMENTS.md](MAC_LATENCY_SEGMENTS.md) · [MAC_OPTIMIZATION_ROADMAP.md](MAC_OPTIMIZATION_ROADMAP.md)  
- 仓库根 [README.md](../README.md) Mac 轨一节  