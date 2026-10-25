# life-sim

お金と幸福度に特化したWeb版人生シミュレーターゲーム。社会人スタートから死亡までを1ターン=1ヶ月で進める。

仕様は `docs/SPEC.md` が正。仕様と食い違う実装をしたくなったら、実装する前に確認すること。

## コマンド

- `npm run dev` 開発サーバー
- `npm test` テスト(Vitest)
- `npm run build` 静的ビルド
- `npx tsx scripts/balance.ts` 1,000人生を自動プレイしてバランス統計を出す

## 構成

- `src/engine/` ゲームロジック。DOM非依存の純粋関数のみ
- `src/data/` 調整用データ(JSON)。係数は `balance.json` に集める
- `src/ui/` 画面とグラフ(Chart.js)
- `scripts/` バランス確認などのスクリプト

## ルール

- 乱数は必ず `src/engine/rng.ts` 経由。`Math.random` は使わない(シードで人生を再現するため)
- `src/engine/` から DOM・localStorage・UI を参照しない
- 数値(係数・確率・金額)はコードに直書きせず `src/data/` のJSONに置く
- 金額は円の整数。ステータスは0〜100、価値観は-2〜+2にクランプ
- 状態は `GameState` ひとつにまとめ、`stepMonth(state, rng)` は新しい state を返す
- ログ(`LogEntry`)は後でAI実況に流すので、JSONとしてそのまま使える形を保つ
- UIの文言は日本語
- 作業の完了前に `npm test` と型チェックを通す
- MVPの範囲外(子ども、世代継承、起業、ローン、保険など)は実装しない
