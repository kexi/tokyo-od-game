# 参与开发

[日本語](CONTRIBUTING.md) | [English](CONTRIBUTING.en.md) | **中文**

法令厳守 TOKYO OPEN DRIVE 开发环境的搭建方法，以及日常的工作流程。游戏说明和数据来源见 [README.zh.md](README.zh.md)，面向 AI 智能体的规则见 [AGENTS.md](AGENTS.md)（日文）。

## 所需环境

| 项目                                              | 用途                                                         |
| ------------------------------------------------- | ------------------------------------------------------------ |
| [Nix](https://nixos.org/download/)（启用 flakes） | 一次性备齐开发所用的工具。无需单独安装其他工具               |
| [direnv](https://direnv.net/)（可选）             | 进入仓库时自动进入开发 shell（`.envrc` 为 `use flake`）      |
| Google Chrome（或其他 Chromium 系浏览器）         | 游玩与确认。可用 WebGPU 时绘制更快（不可用时使用 WebGL 2）   |
| macOS（Apple Silicon）或 Linux                    | Blender 的 shell（`.#blender`）不能在 x86_64 的 macOS 上使用 |

## 环境搭建

```sh
git clone https://github.com/kexi/tokyo-od-game.git
cd tokyo-od-game

# 进入开发 shell（使用 direnv 时，执行 `direnv allow` 后即自动进入）
nix develop

# 安装依赖包
just install-deps

# 启动开发服务器
just serve-dev
```

在浏览器中打开 <http://localhost:5173/tokyo-od-game/> 即会显示标题画面。

- **开发 shell**（`nix develop`）中备有：Node.js 24、pnpm、just、lefthook、uv、yq、ffmpeg、gitleaks、pinact、actionlint、shellcheck、ruff。
- **git hook** 会在进入开发 shell 时由 `lefthook install` 自动安装。
- **只安装发布已满 1 天的软件包**（`pnpm-workspace.yaml` 中的 `minimumReleaseAge: 1440`）。这是为了防范供应链攻击，添加新软件包时也请不要放宽。安装时的脚本也不会运行（`allowBuilds`）。
- **地图、建筑与数据**：`public/data/` 中的开放数据已包含在仓库中，无需重新获取即可运行。PLATEAU 的 3D 城市模型、地理院瓦片等，会在游玩期间由浏览器从各提供方加载。

## 日常工作

用 `just` 可以列出全部配方。名称采用“动词-名词”的形式（只有 `default` 例外）。

```sh
just serve-dev     # 开发服务器
just check-all     # 检查类型、lint、格式、测试、justfile、Actions 和知识库（与 CI 相同）
just run-tests     # 仅运行单元测试（vitest）
just format-code   # 格式化（oxfmt）
just build-app     # 生产构建到 dist/
just preview-app   # 在本地提供生产构建以便确认
```

- **提交之前**，lefthook 会对变更的文件执行与 CI 相同的检查（gitleaks、tsc、oxlint、oxfmt、justfile、pinact、actionlint、ruff、知识库）。
- **提交信息**按 [Semantic Commit Messages](https://www.conventionalcommits.org/)（`feat(input): …`、`fix(accidents): …`）书写，正文写明“为什么修改”。
- **部署**：push 到 `main` 后，GitHub Actions 会在 CI 之后发布到 GitHub Pages。
- **脚本**：`scripts/*.ts` 用 tsx 运行（`pnpm exec tsx scripts/<name>.ts`，或调用它的配方）。用 `node scripts/<name>.ts` 无法运行。

### 阅读日志来修复问题

游戏的日志是每行一个事件的 JSON，在开发服务器（`just serve-dev`）上游玩时会积累到 `.qa/logs/`。无需打开浏览器控制台，也能在终端中追踪。

```sh
just show-logs           # 最新会话的末尾
just show-errors         # warn、error 以及 uncaught_error 的发生位置（TypeScript 行）
just trace-span <spanId> # 该任务从开始到结束的全过程
just print-repro-url     # 以相同 seed、地点、时刻、天气重新加载的 URL
just compare-logs        # 比较修复前后会话的错误数量
```

日志只用 `src/log.ts` 的 `log()` / `warn()` / `error()` 书写，事件要先在 `src/logEvents.ts` 中注册 Zod schema 后才能使用。详情见 [knowledge/logging.md](knowledge/logging.md)（日文）。

## 资产（3D 模型与纹理）

所有资产都由脚本生成，不放置手工制作的孤品。

- **3D 模型**：由 `scripts/blender/` 中的 Blender CLI（bpy）脚本生成。Blender 约有 1.6 GB，因此不放在默认 shell 中，而是放在单独的 shell（`nix develop .#blender`）里。各配方会使用这个 shell（例：`just make-car-model`）。
- **纹理**：由 `scripts/textures/` 中的 Python 脚本（PEP 723，用 uv 运行）生成（例：`just make-textures`）。
- **台账**：`assets/` 和 `public/`（`public/data` 除外）中的文件，全部要在 `assets/manifest.yml` 中逐条登记。如果有台账里没有的文件，`just check-assets`（也包含在 `just run-tests` 中）会失败。
- **确认外观**：用 `just open-assets` 可以打开资产管理画面。规则详情见 [knowledge/asset-manifest.md](knowledge/asset-manifest.md)（日文）。

## 重新获取数据（仅在需要时）

```sh
just fetch-data   # 东京都开放数据等（许可不是 CC BY 4.0 时停止）
just fetch-regs   # JARTIC 交通管制信息（约 400 MB）和 OSM 的信号灯
```

两者都会从网络获取大文件。获取的内容在 `.cache/`（不受 git 管理）中保留 1 周，并重写 `public/data/`。`just make-guide-data` 和 `just make-destinations` 使用 `fetch-regs` 留下的 OSM 缓存。

## 拍摄（预告视频与社交分享卡片）

```sh
just make-teaser      # out/teaser.mp4
just make-og-image    # public/og.png（从车内拍摄雨夜的东京站，并叠加标题文字）
```

- **需要开发服务器**：两者都用无头 Chrome 逐帧拍摄在开发服务器上运行的游戏。默认位置为 `/Applications/Google Chrome.app`，在其他位置时用环境变量 `CHROME` 指定。
- **预告视频用 ffmpeg 剪辑**：它已包含在开发 shell 中。

## 请遵守

- **真实存在的团体、企业与人物**：不使用其标志、徽章和名称。也不使用 Google 街景和 Google 地图的图像。
- **来源**：从外部引入的内容（数据、字体等），要把来源和许可同时写在台账和游戏内的来源画面（`src/game/credits.ts`）中。
- **GitHub Actions**：action 用提交的 SHA 固定（由 `pinact run --check` 检查）。
- **just 配方**：名称采用“动词-名词”，并在前一行写上说明注释（由 `bin/lint-justfile.sh` 检查）。
- **知识库**：调查和测量得到的结论，以 OKF（Markdown 与 YAML frontmatter）记录在 `knowledge/` 中。tag 只使用 `knowledge/tags.yml` 中已有的。目录见 [knowledge/index.md](knowledge/index.md)（日文）。

## 许可

代码采用 [MIT License](LICENSE)。数据、3D 城市模型、字体和语音合成模型各有其提供方的使用条件（见 README 的“数据来源”以及游戏内的“数据来源与许可”）。
