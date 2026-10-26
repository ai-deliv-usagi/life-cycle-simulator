# life-sim

お金と幸福度に特化したWeb版人生シミュレーターゲーム。社会人スタートから死亡までを1ターン=1ヶ月で進める。

仕様は `docs/SPEC.md` が正。モジュール構成・API・イベント定義などの実装設計は `docs/DESIGN.md`。仕様と食い違う実装をしたくなったら、実装する前に確認すること。

## コマンド

- `npm run dev` 開発サーバー
- `npm test` テスト(Vitest)
- `npm run typecheck` 型チェック
- `npm run lint` ESLint(`Math.random` と engine からの DOM 参照を禁止している)
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
- MVPの範囲外(世代継承、起業、保険など)は実装しない。第2弾の項目はユーザーが「進める」と決めたものだけ作る(済み: 投資の売却、子どもと育休、性別)
