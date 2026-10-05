---
type: Reference
title: 端末内 AI（Gemma 4・sanoTTS-jp・sanoTTS）
description: LiteRT-LMのGemma 4 E2Bと、日本語sanoTTS-jp・英語/中国語sanoTTSをWorker内で動かす構成の実測と落とし穴。
tags: [ai, mobile, licensing]
status: stable
stale_after: 2027-01-01T00:00:00Z
generated: { by: codex, at: 2026-10-05T19:25:00Z }
verified:
  - { by: process:chrome154-production-worker-subpath, at: 2026-10-05T19:58:00Z }
  - { by: process:chrome154-tts-and-vitest, at: 2026-10-05T19:25:00Z }
  - { by: process:local-http-and-log-comparison, at: 2026-10-05T18:25:00Z }
  - { by: claude-opus-5-5/1m, at: 2026-10-04T04:55:00Z }
  - { by: process:vitest, at: 2026-10-04T04:30:00Z }
sources:
  - id: production-workers
    resource: ../.qa/perf/production-workers/report.json（git管理外）
    title: 本番buildのハッシュ付きWorkerと配信サブパスでの3言語PCM検証
  - id: sano-capacity
    resource: ../.qa/perf/2026-10-05T19-24-11-811Z-tts/report.json（git管理外）、../scripts/qa/perf-tts.mjs
    title: 165文字の中文を36.20秒のPCMまで生成した容量超過実測
  - id: sano-upstream
    resource: https://github.com/Ampixa/sanoTTS/blob/3de9f37cbfedb8a1edcc28f4c8139979c6fcf889/README.md
    title: Ampixa/sanoTTSの公式README・固定デモソース
  - id: sano-abi
    resource: https://github.com/Ampixa/sanoTTS/blob/3de9f37cbfedb8a1edcc28f4c8139979c6fcf889/mcu/ports/wasm/snt_voice_wasm.c
    title: 固定commitのWASM shim
  - id: sano-license
    resource: https://github.com/Ampixa/sanoTTS/blob/3de9f37cbfedb8a1edcc28f4c8139979c6fcf889/LICENSE.MIT
    title: 固定commitのLICENSEとLICENSE.MIT
  - id: sano-integration
    resource: ../src/ai/tts.ts, ../src/ai/tts.worker.ts, ../src/ai/sanoTts.ts, ../tests/tts.test.ts, ../assets/sanotts-files.json
    title: 言語別音声のコードとVitest検証
  - id: sano-browser
    resource: ../.qa/perf/2026-10-06-sanotts/report.json（git管理外）、../scripts/qa/perf-tts.mjs
    title: Chrome154で3言語を初期化・生成しPCM/WAVとWebAudio再生を確認
  - id: dev-cache-recovery
    resource: ../.qa/logs/2026-10-06/a199ceac-fab8-49a7-882c-3443783413bc.jsonl, ../.qa/logs/2026-10-06/588477e8-a5a0-4eba-a12d-16e798cc771e.jsonl
    title: ローカルAIモジュールの504とVite再起動後のログ比較（git管理外）
  - id: gemma-run
    resource: ヘッドレス Chrome 150（macOS、M2 Max、--enable-gpu --use-angle=metal）で 2.0GB を取得し、1 往復を生成
    title: Gemma 4 E2B 実行の実測
  - id: litertlm
    resource: https://www.npmjs.com/package/@litert-lm/core
    title: "@litert-lm/core 0.17.1"
  - id: model
    resource: https://huggingface.co/litert-community/gemma-4-E2B-it-litert-lm
    title: gemma-4-E2B-it-web.litertlm（2,008,432,640 B）
  - id: ios
    resource: https://github.com/google-ai-edge/LiteRT-LM/issues
    title: メンテナ回答（E2B は約 4GB の空き RAM が必要、iOS 非対応、2026-09-16）
  - id: tts-build
    resource: scripts/build-tts.sh（sanoTTS-jp v1.2.0、nixpkgs の emscripten 6.0.8）
    title: TTS ビルド
  - id: tts-run
    resource: ヘッドレス Chrome で Voice.enable() と 1 文の合成
    title: TTS 実測
---

# Gemma 4 E2B（LiteRT-LM）

- 経路は `@litert-lm/core` 0.17.1。MediaPipe LLM Inference は保守のみのモードで、LiteRT.js 単体は LLM を扱わない。0.16.0 は中身の無い壊れた版だった。[^litertlm]
- モデルは Hugging Face からコミット固定 URL で取得する（CORS 許可、ゲートなし）。保存先は Cache Storage で、キー名に `tokyo-od-game:` を付けている。`<user>.github.io` は同じアカウントの全プロジェクトサイトが同じ origin になるため。[^model]
- COOP/COEP は不要（wasm は非共有メモリ）。WebGPU は必須。
- 実測（M2 Max のヘッドレス Chrome）: ダウンロードは約 20MB/s で 2.0GB に約 100 秒。最初の 1 往復は 22.4 秒で、シェーダーのコンパイルを含む。[^gemma-run]
- 応答例（丸の内の通行人として「このあたりのおすすめは？」）:「東京国際フォーラムの近くなら、美味しいランチのお店を探してみるのもいいですよ。」
- iOS は対象外。WebGPU 自体はあるが、タブのメモリ上限に収まらない。[^ios]
- スタート画面のチェックボックスで、プレイしながら裏でダウンロードする。完了までは、オープンデータを使った定型応答で会話できる。

# sanoTTS-jp（Emscripten）

- タグ v1.2.0 を clone して `web/build.sh` を実行し、リリース資産を SHA256 で照合する。成果物はコミットしているので、CI に emscripten は要らない。[^tts-build]
- サイズ: wasm 165KB、重み 654KB、フル辞書は gzip 後 5.5MB。
- 合成は Worker で行う（1 文で 10〜200ms メインスレッドを止めるため）。初期化は 0.46 秒。案内のセリフ 1 文から 4.69 秒ぶんの音声を合成できた。[^tts-run]

# 落とし穴

1. **Vite の開発サーバは `.gz` に `Content-Encoding: gzip` を付ける**。ブラウザが展開済みのデータをさらに展開しようとして「Failed to fetch」になった。gzip のマジックバイト（1f 8b）を見て、残っているときだけ展開するようにした。
2. **NFKC 正規化で「℃」が「°C」に変わる**ので、単位を読み替える規則が効かなかった（テストで発見）。`°C|℃` の両方に対応した。
3. sanoTTS-jp は算用数字と英字を黙って捨て、512 バイトを超える入力は拒否する。漢数字への変換と文単位の分割を入れている。
4. 長い検証（ダウンロード 100 秒）を走らせている間にソースを編集すると、Vite の HMR がページを再読み込みして検証が途切れる（[ヘッドレス Chrome での検証](headless-browser-testing.md)）。

# 開発サーバーでAIライブラリを取得できない（2026-10-06 JST）

`llm_enable_failed` に `Failed to fetch dynamically imported module` と `@litert-lm_core.js?v=…` が記録された。該当URLへ直接アクセスするとHTTP `504 Outdated Optimize Dep`。モデルの推論ではなく、Viteの最適化済み依存を取得する段階の失敗だった。[^dev-cache-recovery]

- 稼働プロセスのコマンドとcwdが対象リポジトリのViteであることを確認し、そのプロセスだけを終了。`vite --host localhost --port 5173 --strictPort --force` で起動し直した。
- 再読み込み後の `src/ai/llm.ts` が参照する新しい依存URLでHTTP 200を確認。古いURLのハッシュを固定して確認すると、再起動後も504になるため、現在配信されているURLを使う。
- `scripts/logs.ts compare` で `llm_enable_failed` が1→0（gone）、`uncaught_error` は0→0。会話生成まではこの調査で確認していない。
- 起動済みかの確認には先にHTTP疎通とポートの所有プロセスを調べる。今回、別のVite起動を試みた時点でも依存再最適化が走っていた。これが不整合を起こしたかは未確定だが、同じ作業ツリーで二重起動による確認は避ける。

[^dev-cache-recovery]: ローカルAIモジュールの504とVite再起動後のログ比較

[^gemma-run]: Gemma 4 E2B 実行の実測

[^litertlm]: @litert-lm/core 0.17.1

[^model]: gemma-4-E2B-it-web.litertlm

[^ios]: メンテナ回答

[^tts-build]: TTS ビルド

[^tts-run]: TTS 実測

# 言語別の音声エンジン（2026-10-06 JST）

日本語だけsanoTTS-jpを使い、英語はsanoTTSのamy、中国語はsanoTTSのchinese-xiaoyaを使う。英語と中文を日本語の原文で話す以前の制約は撤回した。会話の定型文/AI返答、119/110、警察の拡声器/無線、ナビ案内、TVニュースは表示と同じ言語で話す。音声オプションが無効なら、既存のナビ/TV/警察のOS音声経路を使う。[^sano-integration]

- AI返答は生成開始時のlocaleを発声まで保持する。同じNPCのLLM会話はlocaleが変わったら古いsystem promptと履歴を破棄して作り直す。会話/電話で返答待ち中にen→jaへ変更しても英語返答をenモデルへ渡すこと、同言語の履歴再利用と異言語の再作成をmock回帰4件で検証した（`tests/ttsLocale.test.ts`）。[^sano-integration]
- Ampixa/sanoTTSの固定commitは`3de9f37cbfedb8a1edcc28f4c8139979c6fcf889`（2026-10-01）。公式デモの中国語は旧chineseをchinese-xiaoyaに置き換えており、後者を採用した。英語はamy。[^sano-upstream]
- モデル・WASM・中国語辞書は`public/sanotts/`へ同梱する。取得URLと取得物/配布物のSHA-256を`assets/sanotts-files.json`に固定し、`just fetch-sanotts`で照合・再取得する。必要な言語だけWorker内で初期化し、同じ言語は再利用する。[^sano-integration]
- 初回の配信量は、日本語約6.3MB、英語約9.6MB（amy約5.82MB+英語G2P/runtime）、中国語約3.6MB（chinese-xiaoya約3.11MB+ピンイン辞書/runtime）。言語を切り替えると共用runtime分は再取得しない。[^sano-integration]
- Chineseモデルのfloat16格納をfloat32へ戻す際は、公式meta.jsonの復元後SHA-256へ一致することを実行時と単体テストで検証する。Viteが辞書`.gz`をHTTPで展開済みにした場合はgzip magicで判定し、二重展開を防ぐ。[^sano-integration]
- WASMの合成ABIは20秒の出力容量を超えると`-11`、duration入力の限界で`-5`を返す。切り詰めはしない。この2コードでは同じモデルへの入力を分割して再試行し、全PCMを順番に連結する。日本語の数字・単位の読み替えはjaだけに適用し、en/zhは数字と小数点を保持する。合成失敗は`tts_synth_failed`にlocale/id/errorを残す。[^sano-abi]

## 初期化・合成の実測

M2 Max、macOS、ヘッドレスChrome154、ローカルVite5173、専用の新規Chromeプロファイル（HTTPキャッシュなし）、ゲーム描画を開始しない静的ページで測った。全資産はローカルから取得した値であり、インターネットのダウンロード速度は含まない。3言語を同じWorkerで順に初期化した。[^sano-browser]

| 言語 | 初期化 |  合成1回目 / 2回目 / 3回目 | 音声長 |
| ---- | -----: | -------------------------: | -----: |
| ja   | 52.1ms |       68.1 / 60.8 / 61.8ms | 2.21秒 |
| en   | 26.4ms | 2182.3 / 1040.1 / 1030.0ms | 2.33秒 |
| zh   | 77.5ms |    731.5 / 739.2 / 763.2ms | 2.29秒 |

日本語は「300m先を右に曲がってください。」、英語は「Turn right in 300 meters.」、中国語は「前方300米右转。」を使った。全て22050Hz、有限・非無音のPCMを生成し、WAVへ保存した。英語ではAudioContextを実際に再生しVoice.speaking=trueを確認した。エラー/consoleログは0。**音質・発音の聴感評価はしていない**。この測定中のrAF最大間隔166.6msが1件あったが、PCM解析とWAV用転送も含むためTTS起因の停止とは断定していない。[^sano-browser]

公式の英語amyは24文でWER0.058、中国語chinese-xiaoyaは別の24文でCER0.201という予測器/認識器の評価を公表している。これは今回のゲームのセリフを人が聴いて評価した結果ではない。[^sano-upstream]

容量超過の追加実測では、165文字の中文「前方右转然后继续直行。」の15回繰り返しを1依頼で渡し、36.20秒のPCMを12.45秒で生成できた。単発ABIの出力容量20秒を超える結果なので、分割再試行と全PCM結合が実際に動いた。再測定のエラー/consoleログも0。[^sano-capacity]

本番buildの配信サブパス`/tokyo-od-game/`でも、ハッシュ付きTTS Workerを起動して同じ案内を合成した。新規Chrome154プロファイルでja/en/zhの初期化は53.6 / 103.3 / 73.7ms、合成は68.5 / 2197.1 / 736.5ms。3言語とも22050Hzの有限・非無音PCMで、ブラウザログは0件。静的ページでのWorker検証であり、ゲーム描画中のFPSや聴感品質の評価ではない。[^production-workers]

## 配布Web資産のライセンス

公式READMEは推論runtimeをMITと説明するが、`LICENSE.MIT`は対象Cファイルを限定列挙しており、今回同梱するWeb資産は列挙外。Web資産はGPL-3.0-or-laterとして台帳・クレジット・READMEに記載する。日本語sanoTTS-jpの独自モデルライセンスと帰属表示は維持する。対応する固定ソースarchive・ビルド手順・ES module化とgzip判定の変更内容を`public/sanotts/SOURCE.md`からたどれる。[^sano-license]

[^sano-upstream]: Ampixa/sanoTTSの公式README・固定デモソース

[^sano-abi]: 固定commitのWASM shim

[^sano-license]: 固定commitのLICENSEとLICENSE.MIT

[^sano-integration]: 言語別音声のコードとVitest検証

[^sano-browser]: Chrome154で3言語を初期化・生成しPCM/WAVとWebAudio再生を確認

[^sano-capacity]: 同じローカル配信・新規Chrome154プロファイルでの容量超過実測

[^production-workers]: 本番buildのハッシュ付きWorkerと配信サブパスでの3言語PCM検証
