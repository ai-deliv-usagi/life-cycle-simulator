# 人生シミュレーター

生まれ・職業・価値観の違う人の一生を、お金と幸福度の両面でシミュレートするWebゲーム。1ターン=1ヶ月で、社会人スタートから死ぬまでを進める。正解の人生はない。

- 要件: `docs/REQUIREMENTS.md`
- MVP仕様: `docs/SPEC.md`(正)
- 実装設計: `docs/DESIGN.md`

## 遊び方

1. 「新しい人生」で生まれ(学歴・職業・実家・出身地など)をガチャで決める。シードを入れれば同じ生まれで遊べる
2. 価値観と最初の方針を決めて開始
3. 再生すると1ヶ月ずつ進む。イベントで選択肢が出たら選ぶ。方針はいつでも変えられる
4. 死んだらリザルト。人生タイプ・資産と幸福度の推移・年表が出る

1年ごとにブラウザ(localStorage)へ自動セーブされ、タイトルの「続きから」で再開できる。

## 開発

```
npm install
npm run dev                       # 開発サーバー
npm test                          # テスト
npm run typecheck && npm run lint
npm run build                     # dist/ に静的ビルド
npx tsx scripts/balance.ts        # 1,000人生を自動プレイしてバランスを確認
```

## 公開

`main` に push すると GitHub Actions(`.github/workflows/deploy.yml`)がビルドして GitHub Pages に公開する。初回だけ、リポジトリの Settings → Pages → Build and deployment の Source を「GitHub Actions」にしておく必要がある。
