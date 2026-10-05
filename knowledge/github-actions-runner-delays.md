---
type: Reference
title: GitHub Actionsの開始前キャンセルを調べる
description: ホスト型ランナーの割り当て失敗はstepsとcheck-runのannotationsで確認する。2026-10-06 JSTの障害中に約15分の待機後キャンセルを観測した。
tags: [testing]
status: draft
stale_after: 2026-11-06T00:00:00Z
generated: { by: codex, at: 2026-10-05T21:09:07Z }
verified:
  - { by: process:gh-actions-api, at: 2026-10-05T21:09:07Z }
sources:
  - id: incident
    resource: https://www.githubstatus.com/incidents/3q1yb5m7ltvb
    title: GitHubのランナー割り当てと開始失敗の障害情報
  - id: job
    resource: https://github.com/kexi/tokyo-od-game/actions/runs/37367316093/job/111971901896
    title: PR4の未開始でキャンセルされたgitleaks（試行4）
---

2026-10-06 JST、CIジョブが約15分のqueued状態の後にcancelledになった。jobのstepsは空、runner_nameも空で、annotationsには `The job was not acquired by Runner of type hosted even after multiple attempts` があった。実行環境を割り当てられず、検査ステップへ到達していない。GitHubもランナー割り当ての遅延・ジョブ開始失敗を公表していた。[^job] [^incident]

原因の確認には、失敗ログに加えてjobとcheck-runのannotationsを読む。今回は `gh run view --log-failed` に出力がなく、annotationsから原因を確認できた。

```sh
gh run view 37367316093 --json status,conclusion,jobs
gh api repos/kexi/tokyo-od-game/actions/jobs/111971901896
gh api repos/kexi/tokyo-od-game/check-runs/111971901896/annotations
gh run rerun 37367316093 --job 111971901896
```

同じrunの失敗ジョブだけを再実行すると、成功済みの結果は次の試行へ引き継がれた。PR3のcheckは試行3で成功したが、PR4のgitleaksは試行4まで開始前キャンセルだった。この調査記録の実コミットで新しいCI実行を起動する。実行を新しくすることで割り当てが改善するかは未検証で、全ジョブの成功確認を継続する。[^job]

[^job]: ghで取得したjob・check-runの状態とannotations、PR3/4の各試行の観測

[^incident]: GitHubの2026-10-05 UTCのActions障害
