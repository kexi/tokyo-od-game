# Contributing

[日本語](CONTRIBUTING.md) | **English** | [中文](CONTRIBUTING.zh.md)

How to set up the development environment for 法令厳守 TOKYO OPEN DRIVE, and the day-to-day workflow. The game's description and data sources are in [README.en.md](README.en.md), and the rules for AI agents are in [AGENTS.md](AGENTS.md) (Japanese).

## Requirements

| What                                                     | For                                                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Nix](https://nixos.org/download/) (with flakes enabled) | Provides all the tools used for development. You don't need to install any other tool separately   |
| [direnv](https://direnv.net/) (optional)                 | Enters the development shell automatically when you enter the repository (`.envrc` is `use flake`) |
| Google Chrome (or another Chromium-based browser)        | Playing and checking. Draws faster with WebGPU (WebGL 2 if WebGPU is not available)                |
| macOS (Apple Silicon) or Linux                           | The Blender shell (`.#blender`) is not available on x86_64 macOS                                   |

## Setup

```sh
git clone https://github.com/kexi/tokyo-od-game.git
cd tokyo-od-game

# Enter the development shell (with direnv, `direnv allow` makes it automatic from then on)
nix develop

# Install the dependencies
just install-deps

# Start the development server
just serve-dev
```

Open <http://localhost:5173/tokyo-od-game/> in the browser to see the title screen.

- **The development shell** (`nix develop`) provides: Node.js 24, pnpm, just, lefthook, uv, yq, ffmpeg, gitleaks, pinact, actionlint, shellcheck, ruff.
- **Git hooks** are installed automatically with `lefthook install` when you enter the development shell.
- **Only packages published at least 1 day ago** are installed (`minimumReleaseAge: 1440` in `pnpm-workspace.yaml`). This guards against supply-chain attacks, so do not relax it when you add a new package. Install scripts are not run either (`allowBuilds`).
- **Maps, buildings and data**: the open data in `public/data/` is in the repository, so the game works without fetching it again. PLATEAU's 3D city models, GSI Tiles and the like are loaded by the browser from their providers while you play.

## Day-to-day work

`just` lists the recipes. Their names are "verb-noun" (`default` is the only exception).

```sh
just serve-dev     # Development server
just check-all     # Check types, lint, formatting, tests, the justfile, Actions and knowledge (same as CI)
just run-tests     # Unit tests (vitest) only
just format-code   # Format (oxfmt)
just build-app     # Production build into dist/
just preview-app   # Serve the production build locally to check it
```

- **Before each commit**, lefthook runs the same checks as CI on the changed files (gitleaks, tsc, oxlint, oxfmt, justfile, pinact, actionlint, ruff, knowledge).
- **Commit messages** follow [Semantic Commit Messages](https://www.conventionalcommits.org/) (`feat(input): …`, `fix(accidents): …`), and the body says why the change was made.
- **Deployment**: pushing to `main` makes GitHub Actions publish to GitHub Pages after CI.
- **Scripts**: `scripts/*.ts` are run with tsx (`pnpm exec tsx scripts/<name>.ts`, or a recipe that calls it). They do not run with `node scripts/<name>.ts`.

### Reading the logs to fix bugs

The game's logs are JSON, one event per line, and accumulate in `.qa/logs/` while you play on the development server (`just serve-dev`). You can follow them from the terminal without opening the browser console.

```sh
just show-logs           # The end of the latest session
just show-errors         # warn and error, and where each uncaught_error happened (the TypeScript line)
just trace-span <spanId> # That job from start to finish
just print-repro-url     # A URL that reloads with the same seed, place, time and weather
just compare-logs        # Compare the error counts of the sessions before and after the fix
```

Logs are written only with `log()` / `warn()` / `error()` from `src/log.ts`, and an event is used only after its Zod schema is registered in `src/logEvents.ts`. For details see [knowledge/logging.md](knowledge/logging.md) (Japanese).

## Assets (3D models and textures)

All assets are made from scripts. No hand-made one-offs.

- **3D models**: made from the Blender CLI (bpy) scripts in `scripts/blender/`. Blender is about 1.6 GB, so it is not in the default shell but in a separate one (`nix develop .#blender`). Each recipe uses this shell (e.g. `just make-car-model`).
- **Textures**: made from the Python scripts (PEP 723, run with uv) in `scripts/textures/` (e.g. `just make-textures`).
- **Ledger**: every file in `assets/` and `public/` (except `public/data`) is registered in `assets/manifest.yml`, one entry each. If there is a file that is not in the ledger, `just check-assets` (also part of `just run-tests`) fails.
- **Checking how they look**: `just open-assets` opens the asset manager. The detailed rules are in [knowledge/asset-manifest.md](knowledge/asset-manifest.md) (Japanese).

## Fetching the data again (only when needed)

```sh
just fetch-data   # Tokyo open data and more (stops if a license is not CC BY 4.0)
just fetch-regs   # JARTIC traffic regulation information (about 400 MB) and OSM traffic signals
```

Both download large files from the network. What they fetch is kept in `.cache/` (not tracked by git) for a week, and they rewrite `public/data/`. `just make-guide-data` and `just make-destinations` use the OSM cache that `fetch-regs` leaves behind.

## Recording (teaser video and social share card)

```sh
just make-teaser      # out/teaser.mp4
just make-og-image    # public/og.png (Tokyo Station on a rainy night shot from inside the car, with the title over it)
```

- **The development server must be running**: both record the game running on the development server frame by frame with headless Chrome. The default location is `/Applications/Google Chrome.app`; if Chrome is somewhere else, set the environment variable `CHROME`.
- **The teaser is edited with ffmpeg**: it is included in the development shell.

## Please observe

- **Real organizations, companies and people**: do not use their logos, emblems or names. Do not use Google Street View or Google Maps images either.
- **Sources**: for anything brought in from outside (data, fonts and so on), write its source and license both in the ledger and in the in-game Credits screen (`src/game/credits.ts`).
- **GitHub Actions**: pin actions to commit SHAs (checked by `pinact run --check`).
- **just recipes**: name them "verb-noun" and write a descriptive comment on the line just before each (checked by `bin/lint-justfile.sh`).
- **Knowledge**: record what you investigate and measure in `knowledge/` as OKF (Markdown with YAML frontmatter). Use only the tags in `knowledge/tags.yml`. The table of contents is [knowledge/index.md](knowledge/index.md) (Japanese).

## License

The code is under the [MIT License](LICENSE). The data, 3D city models, fonts and speech synthesis model each have their providers' terms of use (see "Data sources" in the README and "Credits & licenses" in the game).
