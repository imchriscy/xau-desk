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

### 最终会合并 `main`，还是另建开源仓库？

| 方案 | 适合什么时候 | 本仓库建议 |
|------|----------------|------------|
| **单仓 + 长期功能分支**（现状） | 同一产品、共享 `src/` UI，仅网关/EA 分平台 | Mac 稳定前继续 `feature/mt5-exec-mac` |
| **单仓 + Mac 并入 `main`** | Mac 文档/README 写清「选 Windows 或 Mac 安装路径」；CI/Release 能分 tag | **中期目标**：`main` = 共享前端 + `gateway/`（Win）+ `gateway-mac/` + `mql5/`，Windows 默认栈不变 |
| **独立仓库** | 品牌拆分、许可证不同、或不想让 Win 用户 clone 到 Wine/EA 体量 | **暂不必要**；除非你要单独运营「XauDesk Mac」发行页 |

推荐路径：**不拆仓**。稳定后做一次 **受控合并**（大 PR 或 `main` 上只增 Mac 目录与文档，不替换 Windows 默认入口）。共享 bugfix 用 **cherry-pick `src/`** 到 `main`；Mac 独占改动留在分支或合并后仍用目录隔离。

另建仓库的唯一强理由：对外叙事要两个 star/issue 池、或 Windows 主线想保持「极简 clone」。维护成本会 almost 翻倍（双 PR、双 issue）。

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

## 日常循环（你 + Cursor）— 步骤 1 / 2 固定记下来

### 步骤 1 · 小步 commit（做什么就记什么）

- **EA**：一个可测行为一单（含必要时同步 `gateway-mac/mt5-payload/*.ex5`）。
- **gateway-mac**：一块 API / 风控逻辑一单。
- **UI**：一个用户可见问题一单。
- **不要**把未验收的实验和已测功能混在同一 commit。

### 步骤 2 · 推送节奏

- **收工**或**里程碑可测** → `git push origin feature/mt5-exec-mac`。
- 仅本地 commit、未 push：适合「明天还要继续改同一功能」；跨机器开发则当天应 push。

### 步骤 0 / 3 / 4（完整循环）

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

## 与 Cursor / Agent 协作（推荐说法）

让助手 **按「可测一小步」提交并推送**，比攒一大堆再 `git push` 更安全、也更好回滚。

| 你这样说 | 助手应做 |
|----------|----------|
| 「只改了 EA，编译过了」 | `git add mql5/ gateway-mac/mt5-payload/`（若同步了 ex5）→ 单独 `fix(bridge): …` commit |
| 「只修了 BTC 盈亏 / 顶栏」 | 只 `git add` 涉及的 `src/` 文件 → `fix(ui): …` |
| 「今天收工，同步 GitHub」 | `git status` 确认无 `release/`、`ipc/tools/` → `git push origin feature/mt5-exec-mac` |
| 「准备合 main 的 UI」 | 列出仅 `src/` 的 commit，cherry-pick 或单独 PR，**不带** `gateway-mac/` |

**助手默认约定（本仓库 Mac 轨）**

1. **分支**：日常只在 `feature/mt5-exec-mac`（或你指定的 `mac/*`）上 commit；不直接改 `main` 除非明确要求。
2. **Commit 粒度**：一个用户可感知行为或一个可编译单元（EA / gateway / 一块 UI）一单；文档可同单或 `docs:` 单列。
3. **禁止入仓**：`release/`、`ipc/tools/`、Wine 缓存、本机桥路径与含账号的状态文件；提交前必须 `git status` 目视。
4. **推送**：完成里程碑或你要求「上传 GitHub」时 push 功能分支；**不** force push `main`；合 `main` 用 PR + 你确认。
5. **验证口令**：动 `mql5/` → 提醒 `compile-mt5-bridge-mac.sh`；动前端 → `npm run build`；发版再谈 tag `mac-v0.3.x-bridge.0xx`。

### 对话里的验收 vs 自动 commit（交互契约）

| 默认 | 例外（你明确下令时） |
|------|----------------------|
| **改完代码 → 给你验收清单 → 等你回复** 再 `commit` / `push` | 「做完直接 push」「今天收工同步 GitHub」「这段 OK 提交」 |
| 助手在回复末尾写：**改了什么、你怎么测、建议 commit 文案** | 「先别提交，还在试」→ 助手只改工作区，不动 Git |
| **不**在未点测 EA / 未 build 时主动 push 大块改动 | 纯文档、且你授权「文档可直接提交」时可当场 commit |

你可把习惯固定成一句开场白，减少来回：

- 任务型：`「在 feature/mt5-exec-mac 上做 X，**验收后再提交**」`
- 同步型：`「按小步 commit，**今天收工 push**」`

助手应在该轮任务结束时概括：**是否符合步骤 1（本单粒度）**、**是否已到步骤 2（该 push 否）**。

---

## Composer Agent + GitHub（更高效）

1. **一条对话 = 一个可测任务**（如「修 BTC 平仓盈亏」），避免一个窗口里混 EA + 打包 + 文档 + Git 大杂烩。
2. **每次开聊带上上下文**：分支名、`bridge_ver`、是否动过 `mql5/`、Windows 是否也要兼容。
3. **GitHub 分工**：`feature/mt5-exec-mac` 日常 push；用 **Issue** 记 Mac 里程碑（标签 `mac`）；稳定块用 **draft PR** 追踪相对 `main` 的差异，不必急着合并。
4. **Release / tag**：Windows 用现有 tag；Mac 用 `mac-v*` 前缀（见上节），在 GitHub Release 说明里写「仅 Mac 文件桥」。
5. **让 Agent 省 token**：指名文件（`gateway-mac/risk-mac.mjs`）、指名现象（「B 键平仓后列表还在」）；验收通过再说「提交并 push」。
6. **Project Rules**：仓库已含 `.cursor/rules/xaudesk-*.mdc`（Mac 轨 / EA / 前端），与本文「交互契约」一致；Settings → Rules 可开关。

---

## 相关文档

- [MAC_EASY_CONNECT.md](MAC_EASY_CONNECT.md) · [MAC_LATENCY_SEGMENTS.md](MAC_LATENCY_SEGMENTS.md) · [MAC_OPTIMIZATION_ROADMAP.md](MAC_OPTIMIZATION_ROADMAP.md)  
- 仓库根 [README.md](../README.md) Mac 轨一节  