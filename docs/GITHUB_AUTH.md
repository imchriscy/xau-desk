# 在本机登录 GitHub（gh CLI）

已安装：`gh` 2.82+。Cursor 里代跑 `gh auth login --web` 时，若访问 `github.com/login/device/code` **超时**，请用下面 **方案 B（Token）** 或配置代理后再试 **方案 A**。

---

## 方案 A：浏览器登录（网络能直连 GitHub 时）

在 **Cursor 终端** 或 **Git Bash** 里**自己执行**（会打开浏览器或显示一次性验证码）：

```bash
gh auth login --hostname github.com --git-protocol ssh --web --skip-ssh-key
```

- 选 **SSH** 可与现有 `git@github.com:...` 远程一致。
- 若已有 SSH key 上传过 GitHub，加 `--skip-ssh-key` 可跳过上传步骤。
- 完成后再执行：`gh auth status`

若走代理（示例）：

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
export HTTP_PROXY=http://127.0.0.1:7890
gh auth login --hostname github.com --git-protocol ssh --web --skip-ssh-key
```

（端口改成你的 Clash / V2Ray 本地端口。）

---

## 方案 B：Personal Access Token（推荐 · 国内常用）

1. 浏览器打开（需能访问 GitHub）：  
   https://github.com/settings/tokens/new  
2. **Note** 填 `gh-cli-xau-desk`  
3. **Expiration** 自选  
4. 勾选 scope（classic token）：**repo**、**read:org**、**gist**（与 gh 要求一致）  
5. Generate token，**复制 token（只显示一次）**

6. 在终端执行（**不要**把 token 发给任何人或贴进聊天）：

```bash
gh auth login --with-token
```

粘贴 token 后按 **Enter**，再按 **Ctrl+Z 然后 Enter**（Windows CMD）或粘贴后 **Ctrl+D**（Git Bash / Linux）结束输入。

或一行（Git Bash，将 `PASTE_TOKEN` 替换为真实 token，且勿提交到 git）：

```bash
printf '%s' 'PASTE_TOKEN' | gh auth login --with-token
```

7. 验证：

```bash
gh auth status
gh api user --jq .login
```

---

## 登录成功后

创建 XauDesk 独立仓库（可选）：

```bash
cd "Ming/strategies/MicroEdge_Factory/research/xau_scalp_mt5/win-trade-terminal"
# 若该目录尚无独立 git，见 docs/GITHUB_REPO.md
gh repo create xau-desk --public --description "XauDesk — Windows MT5 XAUUSD trading desk"
```

文案见 [GITHUB_REPO.md](./GITHUB_REPO.md)。
