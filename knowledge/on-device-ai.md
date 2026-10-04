---
type: Reference
title: 端末内 AI（Gemma 4・sanoTTS-jp）
description: LiteRT-LM で Gemma 4 E2B をブラウザ内実行、sanoTTS-jp を Emscripten で WASM 化した構成の実測と落とし穴。
tags: [ai, mobile, licensing]
status: stable
stale_after: 2027-01-01T00:00:00Z
generated: { by: claude-opus-5-5/1m, at: 2026-10-04T05:00:00Z }
verified:
  - { by: claude-opus-5-5/1m, at: 2026-10-04T04:55:00Z }
  - { by: process:vitest, at: 2026-10-04T04:30:00Z }
sources:
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

[^gemma-run]: Gemma 4 E2B 実行の実測

[^litertlm]: @litert-lm/core 0.17.1

[^model]: gemma-4-E2B-it-web.litertlm

[^ios]: メンテナ回答

[^tts-build]: TTS ビルド

[^tts-run]: TTS 実測
