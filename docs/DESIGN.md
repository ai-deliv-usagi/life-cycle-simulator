# 人生シミュレーター MVP設計書

`docs/SPEC.md`(MVP実装仕様)を実装に落とすための設計。仕様が正であり、この設計書は仕様の「書かれていない部分」を埋めるもの。仕様からはみ出す判断は末尾の「[仕様変更の記録](#12-仕様変更の記録)」にまとめ、承認されたものは `SPEC.md` 側にも反映済み。

数値はすべて初期値。最終的には `scripts/balance.ts` で調整する。

---

## 1. 全体アーキテクチャ

```
┌──────────────── ui/ (DOM・Chart.js・localStorage) ────────────────┐
│ screens/  title → setup → main ⇄ (event / yearSummary / policy) → result │
│ controller.ts  ゲームループ(タイマー・速度・停止判定)                     │
│ storage.ts     セーブ/ロード/過去の人生                                     │
└───────────────┬───────────────────────────────────────────┘
                │ 呼ぶのは engine/index.ts の公開APIだけ
┌───────────────▼──────────── engine/ (純粋関数) ───────────────────┐
│ setup → step(money → stats → events → happiness → death) → result       │
│ rng.ts はすべての乱数の唯一の入口                                        │
└───────────────┬───────────────────────────────────────────┘
                │ import
┌───────────────▼──────────── data/ (JSON) ─────────────────────────┐
│ education / jobs / family / events / balance                             │
└────────────────────────────────────────────────────────┘
```

- 依存の向きは `ui → engine → data` の一方向のみ。`engine` は `ui` を知らない
- `scripts/balance.ts` は UI の代わりに engine を直接回す「もう1つのフロント」。engine の API はこの2者が使える形にする
- 状態は `GameState` 1つ。engine の関数は `(state, ...) => newState` の形で、引数の state を書き換えない

## 2. engine の公開API

`src/engine/index.ts` から以下だけを export する。UI と balance.ts はこれ以外を import しない。

```ts
// rng.ts
createRng(seed: number): Rng

// setup.ts
rollCharacter(seed: number, data?: GameData): CharacterRoll          // 初期ガチャ
createGame(roll: CharacterRoll, values: Values, policy: Policy, name: string, data?: GameData): GameState

// step.ts
stepMonth(state: GameState, rng: Rng, data?: GameData): GameState     // 1ヶ月進める
resolveChoice(state: GameState, choiceIndex: number, rng: Rng, data?: GameData): GameState
changePolicy(state: GameState, policy: Policy): GameState            // logに 'policy' を残す

// result.ts
computeResult(state: GameState, data?: GameData): LifeResult

// 補助(UI表示用。stateから導出するだけの純関数)
getMonthlyView(state: GameState, data?: GameData): MonthlyView        // 手取り月収・金融資産など
```

- `data` は省略時に `src/data/index.ts` の既定データを使う。テストと balance.ts は差し替えたデータを渡せる
- `rng` は呼び出し側が `createRng(state.rngState)` で作って渡す。`stepMonth` は使い終わった乱数の位置を新しい state の `rngState` に書き戻す(→ セーブ・ロードしても同じ人生になる。[§8](#8-乱数とシード))

### 各モジュールの責務

| ファイル | 主な関数(内部) | 責務 |
| --- | --- | --- |
| `types.ts` | — | 全型定義。データJSONの型(`GameData`)も置く |
| `rng.ts` | `next` `normal` `int` `chance` `pick` `weighted` | mulberry32 と Box-Muller。状態は32bit整数1つ |
| `setup.ts` | `rollCharacter` `createGame` | 学歴・職業・実家・体質・運の抽選、初期資産と初期ステータス |
| `money.ts` | `annualGross` `takeHomeRate` `monthlyIncome` `monthlyExpenses` `applyDebtAndInvest` `applyReturns` `coverShortfall` `retire` `pensionMonthly` `severancePay` | お金のすべて。1ヶ月分を順に適用する関数群 |
| `stats.ts` | `updateStats` | 隠しステータスの月次変化とクランプ |
| `death.ts` | `monthlyDeathProb` `rollDeath` `pickCause` | 死亡判定と死因抽選 |
| `happiness.ts` | `computeHappiness` `updateAdaptation` `weights` | 6要素・重み・慣れ |
| `events.ts` | `eligibleEvents` `eventProb` `drawEvent` `applyEffects` `applyChoice` | 条件判定・確率・抽選・効果適用 |
| `result.ts` | `computeResult` `lifeType` | 生涯幸福スコア・最終資産・人生タイプ |
| `step.ts` | `stepMonth` `resolveChoice` `changePolicy` | 上記を[§4](#4-月次処理stepmonthの詳細)の順序で呼ぶだけ。計算は持たない |
| `util.ts` | `clamp` `roundYen` `netWorth` `financialAssets` | 共通ヘルパー |

## 3. 型の追加・詳細化

`SPEC.md`の型に以下を足す(★は元の仕様の型からの追加。[§12](#12-仕様変更の記録))。

```ts
interface Rng {
  next(): number;                         // [0,1)
  normal(mean: number, sd: number): number;
  int(maxExclusive: number): number;
  chance(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  weighted<T>(items: readonly { item: T; weight: number }[]): T;
  readonly state: number;                 // 現在の内部状態(保存用)
}

interface CharacterRoll {                 // ガチャ結果。引き直し = seed を変えて再度 roll
  seed: number;
  education: Education;
  job: Exclude<JobId, 'none'>;
  familyTier: FamilyTier;
  region: RegionId;                       // 出身地 = 開始時の居住地
  hasCar: boolean;
  constitution: number;
  luck: number;
  initialCash: number;
  studentLoan: StudentLoan | null;        // 専門卒・大卒の50%
}

interface StudentLoan {                   // ★ 借金(debt)とは別枠
  interestFree: boolean;                  // 無利子(第一種相当)か有利子(第二種相当)か
  annualRate: number;                     // 無利子なら0
  monthlyPayment: number;                 // 毎月の定額返済(元利均等)
}

interface Assets {
  // ...SPEC.mdの項目すべて
  studentLoan: number;                    // ★ 奨学金の残高
}

interface GameState {
  // ...SPEC.mdの項目すべて
  rngState: number;                       // ★ 乱数の現在位置
  startAge: number;                       // ★ 開始年齢(年金の加入年数・昇給カーブ用)
  eventHistory: Record<string, { count: number; lastMonth: number }>; // ★ once/cooldown 判定用
}

interface Character {
  // ...SPEC.mdの項目すべて
  previousJob?: JobId;                    // ★ 再就職イベントの「前職に戻る」用
  studentLoan: StudentLoan | null;        // ★ 奨学金の条件(残高は assets.studentLoan)
  lastMonthlyPay: number;                 // ★ 直近の額面月給(失業給付の計算用)
  region: RegionId;                       // ★ 住んでいる地域(初期ガチャ、引っ越しで変わる)
  spouse: SpouseType | null;              // ★ 配偶者の働き方(未婚は null)
}

type RegionId = 'metro' | 'city' | 'rural';             // ★ 大都市 / 地方都市 / 田舎
type SpouseType = 'fulltime' | 'parttime' | 'homemaker'; // ★ 共働き / 扶養内パート / 専業(扶養)

interface PendingEvent {
  eventId: string;
  month: number;                          // 発生した月
}

interface LifeResult {
  ageAtDeath: number;                     // 享年(歳)
  cause: DeathCause;
  finalNetWorth: number;
  lifetimeHappiness: number;              // 月次幸福度の平均
  lifeType: 'winner' | 'poor_happy' | 'rich_unhappy' | 'hardship';
  yearly: { age: number; netWorth: number; happiness: number }[]; // グラフ用
  timeline: LogEntry[];                   // 年表(event/choice/death のみ)
}
```

### flags の予約キー

`flags` は自由に使えるが、以下はエンジンが読む予約キーとし、初期値を `createGame` で入れる。

| キー | 型 | 初期値 | 読むところ |
| --- | --- | --- | --- |
| `partner` | boolean | false | イベント条件 |
| `parentAlive` | boolean | true | 実家への送金、親イベント |
| `parentIll` | boolean | false | 親が亡くなる確率 |
| `payMul` | number | 1 | 額面年収に掛ける(昇進・昇給見送り) ★ |
| `priceLevel` | number | 1 | 生活費に掛ける(物価上昇) |
| `recession` | number | 0 | 残り月数。>0 の間リストラ率×3 |
| `parentSupport` | number | 0 | 残り月数。>0 の間、親への仕送り月3万円 |
| `unemploymentBenefit` | number | 0 | 残り月数。>0 の間、失業給付 ★ |
| `hasCar` | boolean | ガチャ | 車を持っているか。維持費・車イベント・事故率 ★ |
| `welfare` | boolean | false | 生活保護を受けているか ★ |
| `bankrupt` | boolean | false | 自己破産したことがあるか(リザルトの年表用) ★ |

- `married` は `character.married` が正。イベント定義の `flags.married` / `setFlags.married` はエンジンが `character.married` に読み替える(仕様のイベント例との互換のため)
- `married` が false → true になったとき、エンジンが `character.spouse` を `balance.spouse.types` の確率で抽選する。離婚で null に戻す
- 数値フラグのうち `balance.json` の `timers` に載っているもの(`recession` `parentSupport` `unemploymentBenefit`)は毎月 −1 して0で止める。値は「残り何ヶ月効くか」で、お金の処理(§4 の 2〜5)のあと・イベントの前に −1 する。こうするとイベントで N をセットした翌月から、ちょうど N ヶ月効く

## 4. 月次処理(stepMonth)の詳細

仕様の10ステップを、曖昧だった部分を埋めて書き下す。

```text
stepMonth(state, rng):
  if state.dead or state.pendingEvent: return state     # 止まっている間は進めない
  s = clone(state)

  1. 時間
     s.month += 1; s.ageMonths += 1
     if 年齢が65歳ちょうど and not retired: retire(s)   # 退職金を cash へ, job は維持して retired=true

  2. 収入   net = retired ? 年金×0.90 : 給与手取り(無職は0)
                + 失業給付(timer) + 配偶者の収入(§5.2.2)
            雇用中かつ厚生年金ありの職業なら pensionMonths += 1, avgMonthlyPay を逐次平均で更新
  3. 支出   決まった支出 = 車の維持費(hasCar) + 健康費 + 実家送金(family.json の monthlyTransfer、親の存命中)
                         + 仕送り(timer) + 奨学金の返済(残高 > 0 の間)
            生活費 = (固定分 + (net − 決まった支出) × incomeShare × 支出係数) × 地域の生活費係数 × priceLevel  # §5.4.1
            exp = 生活費 + 決まった支出
            # 生活保護中は支出係数を「節約」に固定
            s.assets.cash += net − exp
  4. 借金と投資
            debt += round(debt × 年利/12)                  # 利息を先に
            surplus = net − exp
            if surplus > 0: 返済 = min(surplus, debt, cash) → cash と debt を減らす; surplus −= 返済
            if surplus > 0 and 投資方針 != 預金: 積立 = round(surplus × 0.5) を cash → 対象資産
            各資産に月次リターン(cash は正のときだけ預金金利)。speculative は暴落判定も
  5. 資金ショート
            if cash < 0: index → stocks → speculative の順に売って補填
            if まだ不足: net < 節約時の exp なら生活保護で補填(welfare = true)、そうでなければ debt += 不足分。cash = 0
            if debt > 借入上限: 自己破産(§5.6)
            if welfare and net ≥ 節約時の exp: welfare = false
            timers を −1(§3)
  6. ステータス   updateStats(s)   # §5.3
  7. イベント     ev = drawEvent(s, rng)
                  選択肢なし → 効果を即適用、log 'event'
                  選択肢あり → s.pendingEvent = {...}、log 'event'(選択は resolveChoice で 'choice')
  8. 幸福度       h = computeHappiness(s); happinessHistory.push(h); 慣れを更新
  9. 死亡判定     if rollDeath(s, rng): s.dead = {...}; log 'death'; return s
 10. 年間サマリー if (s.ageMonths − startAge×12) % 12 == 0: log 'year_summary'
  s.rngState = rng.state
  return s
```

- イベントで停止した月でも 8〜10 は実行する(=その月は完結させ、選択の効果は翌月以降の計算に効く)。死亡と選択待ちが同時に起きたら死亡を優先し、`pendingEvent` は消す
- `resolveChoice` は効果適用・`valueShift`・log 'choice' を行い `pendingEvent` を消す。outcomes(確率分岐)があればここで rng を使う
- 年齢は `ageMonths / 12` の実数で計算に使う(死亡率など)。「65歳になったら」は `ageMonths === 65*12`
- 安全弁: `balance.json` の `maxAge`(120歳)に達したら老衰で死亡

## 5. 計算の詳細化

### 5.1 給与

仕様の「職業の基準年収(年齢) × 学歴係数」を、学歴表の初任給係数・昇給係数の両方を使う形で定義する。

```text
進捗 p   = clamp((年齢 − 開始年齢) / (50 − 開始年齢), 0, 1)
初年度   = 職業.初年度年収 × 学歴.初任給係数
ピーク   = 職業.ピーク年収 × 学歴.昇給係数
基準年収 = 初年度 + (ピーク − 初年度) × p
額面年収 = 基準年収 × 働き方係数 × (0.9 + 0.2 × スキル/100) × payMul × 地域の給与係数
```

- 学歴によるスタートの違いは「開始年齢」と「係数」で表し、カーブは各自の開始年齢から50歳まで線形
- 転職しても年齢ベースなので年収カーブは継続(転職ペナルティは `payMul` リセットで表現。§7)
- 手取り率は「額面年収」の帯で決める(帯の境界は以下・未満で判定: 300万円未満→0.80)

### 5.2 年金・退職金

- `avgMonthlyPay` = 厚生年金加入月の額面月給の平均。`avg ← avg + (pay − avg) / pensionMonths`
- 基礎年金の加入年数 = `min(40, 65 − 開始年齢)`(無職期間も国民年金として加入扱い)
- 退職金 = 職業.退職金 × `min(1, jobYears / 38)`。`jobYears` は雇用中の月ごとに +1/12
- 転職・リストラ時も、その時点の職業と勤続年数で按分した退職金を受け取り、`jobYears` を0に戻す
- バイトと無職は退職金・厚生年金なし
- 失業給付: リストラで無職になったら、職業に関係なく(バイトも雇用保険に入っている前提)`unemploymentBenefit = 6`。給付額 = 直前の額面月給 × 0.6(非課税として手取りに直接足す)。再就職すると残りは打ち切り
- リストラされるかどうかは運と時代次第: 確率 = 職業のリストラ率 × 不況中×3 × 運補正(悪いイベント扱い)。不況は「不況」イベントで24ヶ月続く

### 5.2.1 奨学金

- 借りるかどうかは学歴表どおり(専門卒・大卒の50%、200万/300万円)。借りた人のうち `balance.studentLoan.interestFreeProb`(35%)が無利子、残りは有利子(年1%)
- 返済は開始月から240回の元利均等。月額 = 元本 × r/(1 − (1+r)^−240)、r = 年利/12(無利子なら元本/240)。300万円なら無利子で月12,500円、有利子で月約13,800円
- 毎月の返済額は支出に含め(§4 の3)、利息分を除いた額だけ残高を減らす。最終回は残高ぴったりにする
- 奨学金は繰上げ返済しない(余剰は `debt` の返済と積立にだけ回す)。信用は下げない
- 最終資産(純資産)には奨学金の残高もマイナスで含める

### 5.2.2 配偶者の収入

結婚時に配偶者の働き方を3通りから抽選する。配偶者は本人と同い年とし、本人が65歳になったら配偶者も退職する。

| 働き方 | 確率 | 配偶者の手取り(月) | 本人の手取りへの影響 | 退職後の配偶者分の年金(月) |
| --- | --- | --- | --- | --- |
| 共働き(fulltime) | 35% | 18万円 | なし | 基礎年金 + 厚生年金6万円 |
| 扶養内パート(parttime) | 35% | 8万円 | 配偶者控除で+5千円 | 基礎年金(第3号) |
| 専業(homemaker) | 30% | 0 | 配偶者控除で+5千円 | 基礎年金(第3号) |

- 仕様の「結婚フラグがあれば基礎年金を2倍」はこの表の「基礎年金」部分にあたる。共働きだけ配偶者の厚生年金を足す
- 配偶者の働き方はMVPでは結婚後に変わらない(育休・時短・扶養の出入りは第2弾。§14)
- 配偶者の手取りも「月の収入」として本人の手取りと合算する(安心・資金繰りの計算は世帯単位)。年間サマリーとメイン画面には「世帯の手取り」として出す

### 5.3 ステータス

仕様の表をそのまま適用したうえで、健康とストレスに「平常値への回帰」を加える([§12](#12-仕様変更の記録) 変更1)。

```text
Δ健康   = Σ(表の増減)                       # 減少分のみ × (1.5 − 体質/100)
        + k_h × (健康の平常値(年齢) − 健康)
健康の平常値(年齢) = 65 + 0.4 × (体質 − 50) − 0.4 × max(0, 年齢 − 40)

Δストレス = Σ(表の増減) + k_s × (30 − ストレス)
k_h = 0.03, k_s = 0.03
```

- 退職後: 働き方の増減は0として扱い、ストレス −1/月(仕様どおり)。スキル変化0
- 無職: 働き方は「定時」扱い + ストレス +1/月(職探しのストレス)
- 人間関係 −0.1/月、信用は借金(`debt`)があれば −0.5、なければ +0.1(仕様どおり)
- 達成感(`achievement`) −0.2/月の減衰はここで行う

### 5.4 幸福度

- 生活水準の `c` は「生活の中身」に使った額 = §5.4.1 の生活費から地域係数と物価を除いた実質額。決まった支出(車・健康費・送金・仕送り・奨学金)は含めない(送金で生活水準が上がって見えるのを防ぐ)
- `adaptedSpending` の初期値は開始時の `c`。慣れも実質額で更新
- 安心の「月の生活費」は名目の総支出 `exp`
- 金融資産 = cash + index + stocks + speculative(借金は引かない)。「借金があれば −30」は `debt > 0` のとき
- 人生タイプのしきい値は `balance.json` の `result`

### 5.4.1 生活費(収入連動)

```text
自由に使える手取り = 世帯の手取り − 決まった支出(車・健康費・実家への送金・親への仕送り・奨学金の返済)
生活費(実質)     = 固定分(単身4万円 / 既婚8万円) + 自由に使える手取り × 0.6 × 支出係数
生活費(名目)     = 生活費(実質) × 地域の生活費係数 × 物価
```

- 収入が多いほど生活水準も上がる(普通なら自由に使える手取りの6割 + 固定分を使う)。車やローンがある人は、そのぶん生活費を抑える
- 支出係数(節約0.8 / 普通1.0 / ゆとり1.2 / 浪費1.4)は収入連動の部分にだけ掛かる。浪費だと、自由に使える手取りが月25万円未満のうちは赤字になる
- 無職で失業給付もなければ、生活費は固定分だけ(それでも足りなければ生活保護)

### 5.5 端数

- 金額は計算の最後に `Math.round` で整数円にする(各ステップの代入時)
- リターンや利息は実数で計算してから丸める。テストは丸め後の値で比較

### 5.6 自己破産と生活保護

借金(`debt`)が無限に膨らまないようにするための下限。

- **生活保護**: 節約しても収入で暮らせない月(収入 < 支出係数「節約」で計算した支出)は、不足分を補填して `cash = 0` で止める(借金にしない)。無職で失業給付が切れたあとや、年金の少ない老後が対象。受給中は支出方針に関係なく「節約」で計算し、幸福度の「安心」は0にする。収入が節約時の支出に届いた月に終わる
- それ以外の不足(浪費、突発の出費)は借金になる
- 借入上限 = max(200万円, 額面年収 × 1/2)。無職・年金生活は200万円
- 上限を超えた月に**自己破産**: `debt = 0`、信用 = 0、ストレス +30、`bankrupt = true`(一度でも破産したか)、log 'event'(id: `bankruptcy`)。何度でも起こりうる
- 収入が通常の支出を上回った月に生活保護は終わる
- どちらも30個のイベントには数えないシステムイベント

### 5.7 住む場所と車

住む場所(地域)を初期ガチャに足す。出身地 = 開始時の居住地で、引っ越しイベントで変えられる。データは `region.json`。

| 地域 | 出現率 | 生活費係数(家賃込み) | 給与係数 | 開始時に車あり | 車の維持費(月) | 車なしのとき |
| --- | --- | --- | --- | --- | --- | --- |
| 大都市 | 35% | 1.15 | 1.10 | 10% | 4万円 | 影響なし |
| 地方都市 | 45% | 1.00 | 1.00 | 60% | 2.5万円 | 影響なし |
| 田舎 | 20% | 0.85 | 0.90 | 100% | 2.5万円 | 自由時間 −15 |

- 車の維持費は保険・税・ガソリン・駐車場をまとめた額。開始時の車は親のお下がり扱いで購入費0
- 車があると「車が壊れる」の対象になり、「交通事故でけが」の確率 ×1.5
- 地域はイベント確率にも効く: 転職の誘い 大都市×1.5・田舎×0.5、再就職 田舎×0.7
- 給与係数は地域が変わると翌月から変わる(転職なしで引っ越せる簡略化。リモートワーク等とみなす)
- マイホーム(購入・住宅ローン)は第2弾。MVPは全員賃貸で、家賃は生活費係数に含む

## 6. データJSON

### 6.1 balance.json(全量。値は src/data/balance.json が正)

```json
{
  "startStats": { "stress": 20, "skill": 10, "credit": 50, "relations": 50 },
  "gacha": { "constitution": { "mean": 50, "sd": 15 }, "luck": { "mean": 50, "sd": 15 } },
  "salary": { "peakAge": 50, "skillBase": 0.9, "skillRange": 0.2 },
  "takeHome": {
    "bands": [
      { "below": 3000000, "rate": 0.8 },
      { "below": 6000000, "rate": 0.77 },
      { "below": 10000000, "rate": 0.73 },
      { "below": null, "rate": 0.68 }
    ],
    "pension": 0.9
  },
  "work": {
    "regular": { "income": 1.0, "freeTime": 80, "health": 0, "stress": -1, "skill": 0.1, "death": 1.0 },
    "normal": { "income": 1.08, "freeTime": 60, "health": -0.05, "stress": 0, "skill": 0.2, "death": 1.0 },
    "overtime": { "income": 1.2, "freeTime": 35, "health": -0.3, "stress": 1.5, "skill": 0.35, "death": 1.15 },
    "grind": { "income": 1.35, "freeTime": 15, "health": -0.6, "stress": 3, "skill": 0.5, "death": 1.5 }
  },
  "spending": {
    "frugal": { "living": 0.8, "stress": 0 },
    "normal": { "living": 1.0, "stress": 0 },
    "comfort": { "living": 1.2, "stress": 0 },
    "lavish": { "living": 1.4, "stress": -0.5 }
  },
  "healthCare": {
    "ignore": { "cost": 0, "health": -0.1, "stress": 0 },
    "normal": { "cost": 5000, "health": 0, "stress": 0 },
    "active": { "cost": 15000, "health": 0.3, "stress": -0.5 }
  },
  "living": { "single": 40000, "married": 80000, "incomeShare": 0.6 },
  "retiredFreeTime": 90,
  "unemployedStress": 1,
  "debtAnnualRate": 0.15,
  "investShare": 0.5,
  "assets": {
    "cash": { "mu": 0.001, "sigma": 0 },
    "index": { "mu": 0.05, "sigma": 0.15 },
    "stocks": { "mu": 0.06, "sigma": 0.3 },
    "speculative": { "mu": 0.06, "sigma": 0.6, "crashProb": 0.003, "crashPct": -0.6 }
  },
  "pension": { "basicFull": 66000, "basicYears": 40, "employeeRate": 0.005481, "spouseBasicMul": 2, "retireAge": 65 },
  "severanceYears": 38,
  "stats": {
    "age40Health": -0.05,
    "age60Health": -0.1,
    "highStress": 70,
    "highStressHealth": -0.3,
    "relationsDecay": -0.1,
    "creditWithDebt": -0.5,
    "creditNoDebt": 0.1,
    "retiredStress": -1,
    "healthReversion": 0.03,
    "healthBase": 65,
    "healthBaseConstitution": 0.4,
    "healthBaseAgeFrom": 40,
    "healthBaseAgeSlope": 0.4,
    "stressReversion": 0.03,
    "stressBase": 30,
    "achievementDecay": 0.2
  },
  "death": {
    "a": 0.0002,
    "b": 0.085,
    "ageOffset": 20,
    "healthPivot": 50,
    "healthScale": 25,
    "highStressMul": 1.2,
    "maxAge": 120,
    "cause": { "overworkGrind": 40, "overworkOvertime": 10, "accidentBase": 10, "oldAgeFrom": 85, "oldAgeOffset": 80, "oldAgeMul": 5 }
  },
  "happiness": {
    "minWeight": 0.2,
    "marriedRelationsBonus": 15,
    "securityMonths": 24,
    "debtSecurityPenalty": 30,
    "livingAbsScale": 200000,
    "livingAbsMax": 60,
    "livingRelMax": 40,
    "livingRelSlope": 2,
    "adaptMonths": 24,
    "skillAchievementShare": 0.5,
    "weights": {
      "living": { "base": 1, "spending": 0.25 },
      "security": { "base": 1, "risk": -0.2, "spending": -0.2 },
      "relations": { "base": 1, "relation": -0.25 },
      "freeTime": { "base": 1, "relation": 0.25, "work": -0.15 },
      "health": { "base": 1 },
      "achievement": { "base": 1, "risk": 0.2, "work": 0.25 }
    }
  },
  "events": { "luckGoodBase": 0.8, "luckGoodScale": 0.4, "luckBadBase": 1.2, "luckBadScale": -0.4, "valueShiftStep": 0.1 },
  "timers": {
    "recession": { "layoffMul": 3 },
    "parentSupport": { "monthlyCost": 30000 },
    "unemploymentBenefit": {}
  },
  "studentLoan": { "interestFreeProb": 0.35, "annualRate": 0.01, "months": 240 },
  "unemployment": { "months": 6, "payRate": 0.6 },
  "spouse": {
    "types": {
      "fulltime": { "prob": 0.35, "monthlyNet": 180000, "taxBenefit": 0, "employeePension": 60000 },
      "parttime": { "prob": 0.35, "monthlyNet": 80000, "taxBenefit": 5000, "employeePension": 0 },
      "homemaker": { "prob": 0.3, "monthlyNet": 0, "taxBenefit": 5000, "employeePension": 0 }
    }
  },
  "bankruptcy": { "minLimit": 2000000, "incomeShare": 0.5, "stress": 30 },
  "result": { "netWorthLine": 30000000, "happinessLine": 52 }
}
```

`education.json` `jobs.json` `family.json` は仕様の表を、`region.json` は §5.7 の表をそのまま配列にする(id・表示名・各列)。表示名(日本語)はデータ側に持ち、UIはidからデータを引く。

### 6.2 GameData の型

```ts
interface GameData {
  education: EducationDef[];   // { id, label, prob, startAge, startPayMul, raiseMul, loan: { prob, amount } | null }
  jobs: JobDef[];              // { id, label, startPay, peakPay, employeePension, severance, layoffRate }
  family: FamilyDef[];         // { tier, label, prob, initialCash, monthlyTransfer, inheritance }
  regions: RegionDef[];        // { id, label, prob, livingMul, payMul, carProb, carMonthlyCost, noCarFreeTime }
  events: EventDef[];
  balance: Balance;            // balance.json の型
}
```

`src/data/index.ts` で JSON を import して `GameData` として export。読み込み時にスキーマ検査(確率の合計=1、イベントidの重複なし、参照するflag/statの名前が正しいか)を行う `validateData()` をテストから呼ぶ。

## 7. イベント設計

### 7.1 定義の形式(仕様の形式を拡張)

仕様の例(`proposal`)はそのまま読める。足すのは★の項目。

```ts
interface EventDef {
  id: string;
  category: 'life' | 'career' | 'money' | 'health' | 'social' | 'system';
  title: string;
  text: string;
  good?: boolean;                    // ★ true=運で確率UP、false=運で確率DOWN、省略=運の影響なし
  conditions: {
    ageMin?: number; ageMax?: number;
    flags?: Record<string, boolean | number>;   // 一致判定
    employed?: boolean;              // ★ job != 'none' かつ未退職
    retired?: boolean;               // ★
    minInvested?: number;            // ★ index+stocks+speculative の下限(円)
    region?: RegionId[];             // ★ 住んでいる地域のどれか
    jobNotIn?: JobId[];              // ★ この職業のときは起きない(昇進はバイトでは起きない、など)
  };
  baseProb: number;
  probFrom?: 'layoffRate';           // ★ baseProb の代わりに職業データの値を使う
  probMods?: ProbMod[];
  once?: boolean;
  cooldownMonths?: number;
  effects?: Effects;                 // 選択肢なしイベントの効果
  choices?: Choice[];
}

type ProbMod =                       // ★ stat以外も条件にできるよう一般化(stat形式は仕様どおり)
  | { stat: keyof Stats; above?: number; below?: number; mul: number }
  | { value: keyof Values; above?: number; below?: number; mul: number }
  | { flag: string; equals?: boolean | number; above?: number; below?: number; mul: number }
  | { age: true; above?: number; below?: number; mul: number }
  | { work: WorkStyle[]; mul: number }
  | { healthCare: HealthCare[]; mul: number }
  | { region: RegionId[]; mul: number };

interface Choice {
  label: string;
  conditions?: EventDef['conditions']; // ★ 満たさない選択肢は表示しない(田舎では「車を手放す」を出さない、など)
  effects?: Effects;
  outcomes?: { prob: number; text: string; effects: Effects }[];  // ★ 確率分岐(合計1)
  valueShift?: Partial<Values>;      // 符号だけ使い、大きさは balance.events.valueShiftStep
}

interface Effects {
  cash?: number;
  cashMonthsOfPay?: number;          // 現在の額面月給 × n(無職・退職後は0)
  stats?: Partial<Stats>;
  setFlags?: Record<string, boolean | number>;
  addFlags?: Record<string, number>; // ★ 数値フラグに加算(payMul +0.1 など)
  mulFlags?: Record<string, number>; // ★ 数値フラグに乗算(priceLevel ×1.05)
  job?: JobId | 'random_other' | 'previous';   // 'random_other' は現職以外から等確率
  achievement?: number;
  assetShock?: { pct: number; targets?: (keyof Assets)[] };  // 既定 targets は index/stocks/speculative
  inheritance?: boolean;             // ★ family.json の相続額を cash へ
  region?: RegionId;                 // ★ 引っ越し先の地域
}
```

- 確率 = (`probFrom` があればその値、なければ `baseProb`) × probMods の積 × 運補正
  - 運補正: good=true → `0.8 + 0.4×運/100`(仕様どおり)、good=false → `1.2 − 0.4×運/100`(★)
- 抽選: 条件を満たす全イベントについて確率を出し、それぞれ独立に判定。当たったものが複数なら確率で重み付けして1件を選ぶ(定義順に依存しないため)
- `job` 効果で職業が変わるときは §5.2 の按分退職金を払い、`previousJob` を記録し、`jobYears=0`・`payMul=1` に戻す
- ログの `text` は「タイトル: 選んだ選択肢 / outcome の text」

### 7.2 MVPのイベント31個(初期値)

仕様の30個に「車を買う」を足して31個(§5.7)。「引っ越し」は地域を変えるイベントに作り直した。

実際の定義は `src/data/events.json`。車の価格などイベント固有の金額は events.json に直接書く(balance.json には置かない)。

確率は月あたり。CD=クールダウン(月)。目安は1人生40〜80回([§11](#11-テストとバランス確認))で、balance.ts で調整する。

**ライフ(8)**

| id | タイトル | 条件 | 確率 | 選択肢 → 主な効果 |
| --- | --- | --- | --- | --- |
| partner | 恋人ができる | 18〜45歳、未婚、partner=false | 0.012 / 人間関係>60 ×1.5 / v.relation<0 ×1.3。good | (なし) partner=true、人間関係+10 |
| proposal | プロポーズのチャンス | 仕様の例どおり | 0.02、CD24 | 仕様の例どおり |
| divorce_crisis | 離婚の危機 | 既婚 | 0.003 / ストレス>70 ×3 / 人間関係<30 ×2。CD36 | 関係修復: cash−30万、ストレス+5、人間関係+10 / 離婚する: 既婚解除、全資産−50%、人間関係−15、v.relation+ |
| parent_ill | 親の病気で仕送り | 40〜75歳、parentAlive、once | 0.004 / 年齢>55 ×2 | 仕送りする: parentSupport=36、人間関係+5、v.relation− / 施設に任せる: cash−100万 / 断る: 人間関係−10、ストレス+10。全選択で parentIll=true |
| parent_death | 親が亡くなる(相続) | 40歳〜、parentAlive、once | 0.003 / parentIll ×3 / 年齢>60 ×2 | (なし) 相続、parentAlive=false、parentSupport=0、ストレス+15 |
| wedding_rush | 友人の結婚式ラッシュ | 25〜35歳 | 0.01、CD24 | 全部出席: cash−15万、人間関係+8 / ご祝儀だけ: cash−5万、人間関係+2 / 欠席: 人間関係−6 |
| moving | 引っ越し | 20〜70歳 | 0.006、CD60 | 都会へ出る(大都市以外のとき): region=metro、cash−40万、ストレス+5、v.risk+ / 地元・地方へ移る(大都市・地方都市のとき): region=rural、cash−30万、ストレス−8 / 近場で住み替え: cash−20万、ストレス−5 / やめる |
| reunion | 同窓会 | 25〜70歳 | 0.006、CD36 | 行く: cash−1万、人間関係+5(未婚なら20%で partner=true) / 行かない: 人間関係−2 |

**キャリア(8)** すべて `employed: true`

| id | タイトル | 条件 | 確率 | 選択肢 → 主な効果 |
| --- | --- | --- | --- | --- |
| promotion | 昇進 | 雇用中、バイト以外 | 0.006 / スキル>60 ×2 / 残業多め・激務 ×1.5。CD36。good | 受ける: payMul+0.1、ストレス+10、達成+15、v.work+ / 断る: ストレス−3、v.work− |
| raise_skipped | 昇給見送り | 雇用中 | 0.005、CD24 | (なし) payMul−0.03、ストレス+5、達成−5 |
| job_offer | 転職の誘い(職業変更) | 雇用中、〜55歳 | 0.004 / スキル>50 ×1.5 / 大都市 ×1.5 / 田舎 ×0.5。CD36 | 転職する: job=random_other、payMul=1.05、ストレス+5、v.risk+ / 断る: v.risk− |
| layoff | リストラ(無職へ) | 雇用中 | probFrom=layoffRate / recession>0 ×3。good=false | (なし) job=none、ストレス+20、達成−10 |
| bonus_cut | 業績悪化でボーナスカット | 雇用中 | 0.006、CD12 | (なし) 月給−1ヶ月分、ストレス+5 |
| certification | 資格取得のチャンス | 雇用中 | 0.006、CD24 | 挑戦する: cash−10万、ストレス+5、スキル+8、達成+5 / 見送る |
| boss_trouble | 上司とのトラブル | 雇用中 | 0.006、CD24 | 我慢する: ストレス+15 / 言い返す: 60% ストレス−5・達成+3、40% payMul−0.05・ストレス+10 / 異動願い: スキル−3、ストレス−10 |
| side_job | 副業の誘い | 雇用中 | 0.004、CD36 | 始める: 60% cash+60万・スキル+5・ストレス+10、40% cash−20万・ストレス+10、v.risk+ / 断る |

**お金(8)**

| id | タイトル | 条件 | 確率 | 選択肢 → 主な効果 |
| --- | --- | --- | --- | --- |
| invest_jackpot | 投資の大当たり | 投資残高≥50万 | 0.003。good | (なし) stocks・speculative +50%、達成+5 |
| scam | 投資詐欺の勧誘 | 25歳〜 | 0.004 / 信用<40 ×2 / v.risk>0 ×1.5。CD36 | 乗る: 85% cash−100万・ストレス+15、15% cash+30万 / 断る: v.risk− |
| lottery | 宝くじ | 20歳〜 | 0.004、CD12 | 買う: cash−3000、0.2% +1億、2% +10万、残り はずれ / 買わない |
| car_broke | 車が壊れる | 20〜80歳、hasCar | 0.004、CD24。good=false | 修理: cash−30万 / 買い替え: cash−150万、ストレス−5 / 手放す(田舎以外): hasCar=false、ストレス+5 |
| car_purchase | 車を買う | 20〜75歳、hasCar=false | 0.004 / 地方都市 ×2 / 田舎 ×4。CD36 | 新車: cash−250万、hasCar=true、達成+5 / 中古車: cash−80万、hasCar=true / 買わない: v.spending− |
| appliance | 家電が壊れる | — | 0.008、CD12。good=false | (なし) cash−10万 |
| windfall_bonus | 臨時ボーナス | 雇用中 | 0.004、CD12。good | (なし) 月給+1ヶ月分、ストレス−3 |
| friend_loan | 友人に借金を頼まれる | 22歳〜 | 0.004、CD36 | 貸す: 50% 返ってきた・人間関係+10、50% cash−50万・人間関係−5 / 断る: 人間関係−8 |

**健康(5)**

| id | タイトル | 条件 | 確率 | 選択肢 → 主な効果 |
| --- | --- | --- | --- | --- |
| cold | 風邪で休む | — | 0.01 / 健康<40 ×2。CD6。good=false | (なし) 健康−2、ストレス+2 |
| checkup | 健康診断で再検査 | 35歳〜 | 0.006 / 健康:意識高め ×1.5。CD24 | 精密検査を受ける: cash−3万、健康+5 / 放置: 健康−5 |
| hospital | 入院 | — | 0.003 / 健康<40 ×2.5 / 年齢>60 ×2。CD12。good=false | (なし) cash−30万、健康−10、ストレス+10 |
| traffic_accident | 交通事故でけが | — | 0.002 / hasCar ×1.5。CD24。good=false | (なし) cash−20万、健康−15、ストレス+10 |
| back_pain | 腰痛 | 30歳〜 | 0.006 / 残業多め・激務 ×1.5。CD24 | 整体に通う: cash−5万、健康+3 / 我慢する: 健康−3、ストレス+5 |

**社会(2)**

| id | タイトル | 条件 | 確率 | 選択肢 → 主な効果 |
| --- | --- | --- | --- | --- |
| recession | 不況 | — | 0.002、CD120 | (なし) 投資資産−30%、recession=24 |
| inflation | 物価上昇 | — | 0.003、CD60 | (なし) priceLevel ×1.05 |

**システム(30個の外。仕様の「再就職」)**

| id | タイトル | 条件 | 確率 | 選択肢 |
| --- | --- | --- | --- | --- |
| reemployment | 再就職 | job=none、未退職 | 0.05 / スキル>30 ×2 / スキル>60 ×1.5 / 田舎 ×0.7(「0.05 + 0.15×スキル/100」を probMods の段階で近似: 0.05 → 0.10 → 0.15) | 前職に戻る: job=previous、payMul=0.95 / 別の職業: job=random_other |

## 8. 乱数とシード

- `rng.ts` は mulberry32。`createRng(seed)` は内部状態を `seed >>> 0` で初期化し、`state` で現在値を返す。Box-Muller の余りはキャッシュしない(状態を32bit整数1つに保つため)
- ガチャ: `rollCharacter(seed)` は seed から独立した rng を作る。「引き直し」は seed+1。タイトルでシードを入力すると同じガチャになる
- 人生: `createGame` で `rngState = hash(seed, 'life')` を入れる(ガチャと乱数列を分けて、ガチャの抽選回数が変わっても人生側がずれないようにする)
- 再現の条件: 同じ seed・同じ価値観・同じ選択・同じ月の方針変更 → 同じ人生。セーブからの再開でも `rngState` で続きの乱数が出る
- `Math.random` は使わない。ESLint の `no-restricted-properties` で `Math.random` を禁止する

## 9. UI設計

フレームワークは使わず、素の TypeScript + DOM で作る(画面5つ・状態1つなので十分。依存を Chart.js だけにする)。

### 9.1 画面遷移

```
title ──新しい人生──▶ setup ──開始──▶ main ──死亡──▶ result ──もう一度──▶ setup
  │                                 │  ▲                       └同じシード──▶ setup(同seed)
  └──続きから(セーブあり)──────────▶│  │
                                    ▼  │ 選択/閉じる
                     event / yearSummary / policy(モーダル)
```

### 9.2 controller.ts(ゲームループ)

```ts
class GameController {
  state: GameState; rng: Rng;
  speed: 1 | 4 | 16; playing: boolean;
  tick(): void  // stepMonth → 表示更新 → 止まる条件を判定
}
```

- `setInterval` ではなく `setTimeout` を1ヶ月ごとに張り直す(1x=1000ms, 4x=250ms, 16x=62.5ms)
- 停止する条件: `pendingEvent` がある → イベントモーダル / 年の切れ目 → 年間サマリー(「自動で閉じる」ON なら1.5秒後に閉じて再開) / `dead` → result
- 選択肢なしイベントは止めずに、メイン画面のログ欄にハイライトで流す
- 「次のイベントまで」ボタン: 選択肢つきイベントか死亡まで、待ち時間なしで `stepMonth` を回す。途中の年間サマリーは表示せずログにだけ残す。描画は飛ばし終わってから1回だけ(配信の尺調整用。要件定義の「何もなければ次のイベントまで飛ばす」)
- 方針変更モーダルを開いている間は一時停止。確定で `changePolicy` し、次の tick から反映
- 1年ごと(年間サマリーを閉じたあと。「次のイベントまで」で飛ばした年も含む)に `storage.save(state)`(ステップ9)
- 選択肢つきイベントはログに「発生」と「選択」の2行が残るので、メイン画面の直近ログとリザルトの年表では選択の行だけを出す(選択の行にタイトルも入っている)

### 9.3 画面の中身

| 画面 | 構成 |
| --- | --- |
| title | タイトル、「新しい人生」「続きから」(セーブがあるときだけ)、シード入力欄、過去の人生(直近10件) |
| setup | ガチャ結果カード(学歴・職業・実家の太さ・出身地・車の有無・体質・奨学金を表示。体質は★、運は出さない)、「引き直し」、名前、価値観4軸スライダー(−2〜+2、0.5刻み、両端に極の名前)、初期方針4項目(ラジオ) |
| main | 上段: 年齢・職業・住んでいる地域・世帯の手取り月収・金融資産・借金 / ステータスバー(健康・ストレス・スキル・信用・人間関係)/ 今月の幸福度 / 資産推移グラフ(年次)/ 直近ログ10件 / 下段固定: 再生・一時停止、速度、次のイベントまで、方針変更 |
| event | タイトル、本文、選択肢ボタン(縦並び)。選択後に結果テキストを1秒表示 |
| yearSummary | 「○歳(○年目)」、健康状態(言葉で: 絶好調/良好/普通/不調/危険)、金融資産と前年比(±と%)、その年のイベント一覧 |
| result | 享年・死因・最終資産・生涯幸福スコア・人生タイプ(大きく)、資産と幸福度の推移グラフ(2軸)、年表、「もう一度」「同じシードで再挑戦」「ログをJSONで保存」 |

- グラフ(`charts.ts`): 資産は年次の純資産(year_summary の snapshot)、幸福度は月次を年平均にして描く。Chart.js はアニメーション off(16xで重くならないように)
- 「ログをJSONで保存」は `LogEntry[]` をそのままダウンロード。AI実況連携の素材確認用(実装は数行なのでMVPに入れる)
- 健康の言葉: 80以上 絶好調 / 60 良好 / 40 普通 / 20 不調 / それ未満 危険(閾値は UI の定数。ゲームバランスに関係しないので data に置かない)

## 10. セーブ

| キー | 内容 |
| --- | --- |
| `lifesim.save.v1` | `{ version: 1, savedAt: ISO文字列, state: GameState }` |
| `lifesim.history.v1` | `LifeRecord[]`(新しい順、最大50件) |

```ts
interface LifeRecord {
  seed: number; name: string; endedAt: string;
  education: Education; job: JobId; familyTier: FamilyTier;
  ageAtDeath: number; cause: DeathCause; finalNetWorth: number;
  lifetimeHappiness: number; lifeType: LifeResult['lifeType'];
}
```

- ロード時に `version` が違う・JSON が壊れている場合はセーブを無視してタイトルに「セーブデータを読み込めませんでした」と出す
- リザルト到達でセーブを消し、`LifeRecord` を history の先頭に追加
- `storage.ts` は UI 層。engine は localStorage を知らない

## 11. テストとバランス確認

### 11.1 単体テスト(tests/)

| ファイル | 内容 |
| --- | --- |
| `rng.test.ts` | 同seedで同じ列、`state` から再開して同じ列、normal の平均・分散がおおむね正しい |
| `setup.test.ts` | 出現率が表どおり(1万回抽選で±2%。学歴・実家・地域・車)、初期ステータス、奨学金 |
| `money.test.ts` | 手取り率の各帯と境界、昇給カーブ(開始・50歳・50歳以降)、年金額、退職金按分、借金の利息と返済、ショート時の売却順、奨学金(無利子・有利子の月額と240回で完済)、失業給付、配偶者の収入、自己破産と生活保護 |
| `stats.test.ts` | 各方針の増減、回帰項、クランプ(0〜100) |
| `death.test.ts` | q(20)≈0.0003、q(80)≈0.05、健康補正(100→0.25倍、0→4倍)、死因の重み |
| `happiness.test.ts` | 重みの最小0.2、頭打ち、慣れ(上げた直後に上がって2年で戻る) |
| `events.test.ts` | 条件外は出ない、once は1回、cooldown、確率分岐、全効果の種類、married の読み替え |
| `step.test.ts` | 同seed・同選択で同じ死亡月・最終資産、セーブ(JSON往復)からの再開で同じ結果、方針変更が翌月から反映、価値観が−2〜+2を超えない |
| `data.test.ts` | `validateData()` が通る |

### 11.2 scripts/balance.ts

```
npx tsx scripts/balance.ts [--n 1000] [--seed 1] [--policy random|grind|...]
```

- 自動プレイヤー: 価値観・初期方針をランダム、10年ごとに方針を引き直す、選択肢はランダム
- 出力: 仕様の5指標を目安と並べて ✓/✗ 表示、加えて「イベント別の発生回数(0回のものを警告)」「死因の内訳」「職業・学歴別の最終資産中央値」
- `--policy grind` は働き方を激務に固定(激務の寿命の確認用)
- 1,000人生が30秒以内に終わること(state のコピーは配列の追記のみで O(月数) に抑える)
- `runBalance()` / `playLife()` を export しているので、係数を変えながら回す調整用スクリプトからも使える

### 11.3 バランス確認の結果(ステップ7)

`npx tsx scripts/balance.ts --n 1000 --seed 1` の結果(1,000人生 × 2、約27秒):

| 指標 | 結果 | 目安 |
| --- | --- | --- |
| 平均寿命(全方針ランダム) | 79.9歳 | 78〜85歳 |
| 激務を続けた場合の平均寿命 | 73.7歳(差 6.2歳) | 全体より5歳以上短い |
| 最終資産の中央値 | 2,865万円 | 1,000万〜3,000万円 |
| 人生タイプの割合 | 勝ち組 31.6% / 貧乏だけど幸せ 15.9% / 金持ち不幸 16.9% / 苦労人 35.6% | どれも10%以上 |
| 1人生あたりのイベント数 | 72.2回 | 40〜80回 |
| 全イベントが1回以上発生 | すべて発生 | 未発生なし |

調整したもの:
- 生活費を収入連動にした(変更11)。生活費が一律13万円だと、低収入の人は初月から赤字で1年以内に破産し、高収入の人は月30万円以上貯まって最終資産の中央値が8,000万円を超えていた
- 生活保護の条件を直した(変更12)
- 支出係数 ゆとり 1.25→1.2・浪費 1.6→1.4、基本死亡率 0.0003→0.0002、幸福度のしきい値 60→52(平均幸福度が約51で、60だと「幸せ」側がほとんど出なかった)、風邪 0.015→0.01・同窓会 0.008→0.006

残っている注意点: ランダムな自動プレイでは約半数の人生で一度は自己破産が起きる。ほとんどが若いうちに浪費を10年続けた場合で、自動プレイは4分の1の確率で浪費を選ぶため。仕様の目安には入っていないので、UIで実際に遊んでみて多すぎると感じたら浪費の係数で調整する

## 12. 仕様変更の記録

CLAUDE.md の「仕様と食い違う実装をする前に確認」に従って確認したもの。

| # | 変更 | 状態 |
| --- | --- | --- |
| 1 | 健康とストレスに平常値への回帰 | 承認済み・SPEC反映済み |
| 2 | 奨学金を借金と分ける(無利子/有利子をランダム) | 承認済み・SPEC反映済み |
| 3 | 型の追加 | 承認済み・SPEC反映済み |
| 4 | イベント定義の拡張 | 承認済み・SPEC反映済み |
| 5 | 細かい決め | 承認済み・SPEC反映済み |
| 6 | 自己破産と生活保護 | 承認済み・SPEC反映済み |
| 7 | 失業給付(全職業が受給、リストラは運と時代次第) | 承認済み・SPEC反映済み |
| 8 | 配偶者の収入(共働き / 扶養内パート / 専業) | 承認済み・SPEC反映済み |
| 9 | 「次のイベントまで」ボタン | 承認済み・SPEC反映済み |
| 10 | 住む場所(3地域)と車の有無 | 追加(住む場所で変わる、という指摘から)・SPEC反映済み |
| 11 | 生活費を収入連動にする | バランス確認から追加(「基本ok」のためSPEC反映済み。反対があれば戻す) |
| 12 | 生活保護は「節約しても暮らせない」ときだけ、自己破産は何度でも | 同上(変更6の不具合の修正) |
| — | 子ども・育休手当、マイホーム・住宅ローン | 第2弾のまま(確認済み)。§14 に申し送り |

### 変更1: 健康とストレスに「平常値への回帰」を入れる

仕様の式のままだと、健康が0か100に張り付き、寿命が目安(78〜85歳)から大きく外れる。死亡判定の式だけを取り出して試算した(イベントなし、体質50、22歳開始):

| 働き方 / 健康方針 | 仕様のまま | 回帰あり(§5.3) |
| --- | --- | --- |
| 定時 / 普通 | 73.6歳(健康→0) | 80.2歳 |
| 普通 / 気にしない | 65.6歳(健康→0) | 79.1歳 |
| 普通 / 普通 | 68.8歳(健康→0) | 80.0歳 |
| 普通 / 意識高め | 95.7歳(健康→100) | 82.9歳 |
| 激務 / 普通 | 58.1歳 | 71.1歳 |
| 16通りの平均 | 約68歳 | 約78歳 |

原因は、健康の増減が毎月足されるだけで戻る力がなく、40歳以降の加齢減少(−0.05〜−0.1/月)だけで数十年かけて0まで落ちること。意識高め(+0.3/月)は逆に100に張り付く。ストレスも同様に、残業多め以上だと70を超えたまま戻らない。回帰を入れると「方針で平常値がずれる」動きになり、激務は−9歳、意識高めは+3歳と、差の大きさも配信向きになる。

### 変更2: 奨学金を借金と分ける

奨学金300万円に年15%の利息がつくと、新卒の余剰(月8〜9万円)は約4年間すべて返済に消え、利息だけで約90〜100万円になる。さらに返済中は毎月信用−0.5で、信用が約25下がる。そこで `Assets.studentLoan` を別枠にし、20年(240回)の定額返済にした(§5.2.1)。

無利子か有利子かはランダム(実際の第一種・第二種に合わせて無利子35%・有利子65%、有利子は年1%)。300万円の月額は無利子12,500円、有利子約13,800円で、差は20年で約30万円。ガチャの見どころとしては小さいが、キャラ作成画面で「奨学金300万円(有利子)」のように出す。

### 変更3: 型の追加

`GameState.rngState` / `startAge` / `eventHistory`、`Character.previousJob` / `studentLoan` / `lastMonthlyPay`、`Assets.studentLoan`(§3)。とくに `rngState` は、ないと「セーブから再開すると乱数がずれて同じ人生にならない」。

### 変更4: イベント定義の拡張

§7.1 の★(`good` `employed` `retired` `minInvested` `probFrom` 一般化した `probMods` `outcomes` `addFlags` `mulFlags` `inheritance`)。31個のイベントを JSON だけで書くのに必要な最小限(変更10で `region` 条件・効果と選択肢ごとの `conditions` も追加)。とくに `payMul`(昇進で年収が上がる)は額面年収の式に係数が1つ増える。

### 変更5: 細かい決め

- 運は悪いイベントの確率も下げる(`1.2 − 0.4×運/100`)。仕様は良いイベントだけ
- 転職・リストラ時にも按分した退職金を払う
- 生活水準の幸福度に使う額から、健康費と実家への送金を除く
- 無職中はストレス+1/月
- リストラは職業の月次リストラ率をそのままイベント確率に使う(リストラ率とイベントの二重判定にしない)

### 変更6: 自己破産と生活保護

仕様のままだと、借金(年15%)が上限なく膨らむ。たとえばバイトで65歳を迎えると、年金は基礎年金だけで手取り約5.9万円、支出は約13.5万円で、月7.6万円ずつ借金が増える。20年後には利息込みで**約1.1億円**の借金になり、最終資産の中央値や人生タイプの判定がこうした極端な値に引っぱられる。

そこで借入上限(年収の1/3、最低50万円)を設け、超えたら自己破産、その後も足りなければ生活保護で暮らす(§5.6)。「自己破産」は配信の見どころにもなる。ローン機能を足すわけではなく、借金が膨らみ続けないための下限の処理。

### 変更7: 失業給付

仕様ではリストラされると収入がいきなり0になり、再就職まで貯金を削るしかない。リストラされたら職業に関係なく(バイトも)6ヶ月、直前の額面月給の60%を受け取る(§5.2)。給付は必ず受けられる前提にし、運が絡むのは「リストラされるかどうか」の側: 職業のリストラ率 × 不況中×3 × 運補正。

### 変更8: 配偶者の収入

仕様では結婚すると生活費が13万→20万円に上がるだけで収入は増えないので、お金の面では結婚が必ず損になる。「家族重視」を選んだプレイヤーが金銭面で一方的に不利になり、「正解の人生はない」というコンセプトとずれる。結婚時に配偶者の働き方を「共働き / 扶養内パート / 専業」から抽選し、それぞれ収入・配偶者控除・年金が変わるようにした(§5.2.2)。育休手当は子どもとセットで第2弾(§14)。

### 変更9: 「次のイベントまで」ボタン

要件定義にある「何もなければ次のイベントまで飛ばす」が、MVP仕様では速度(1x/4x/16x)だけになっていた。UIだけで完結し、配信の尺調整に効くのでMVPに入れる(§9.2)。

### 変更10: 住む場所と車

仕様の基本生活費13万円(家賃込み)は全国一律で、車も「壊れる」イベントだけが前提なしに起きていた。住む場所(大都市 / 地方都市 / 田舎)を初期ガチャに足し、生活費・給与・車の必要性を変える(§5.7)。大都市は稼げるが生活費が高く車はいらない、田舎は生活費が安いが給料も低く車が必須、という違いが出る。「引っ越し」イベントで上京・地方移住ができ、配信の分岐にもなる。データは `region.json` を新設。イベントは「車を買う」を足して31個。

### 変更11: 生活費を収入連動にする

仕様の生活費は「単身13万円・既婚20万円 × 支出係数」で、収入に関係なく一律だった。1,000人生を回すと、低収入の人(高卒バイトの手取り約10.8万円)は初月から赤字で1年以内に破産し、高収入の人(ピーク時の手取り約44万円)は月30万円以上貯まって、最終資産の中央値が8,000万円を超えた。一律の額をどう動かしても両方は直らない。

実際には収入が低い人ほど家賃の安いところに住むなど、生活費は収入に連動する。そこで生活費 = 固定分 + 自由に使える手取り × 0.6 × 支出係数 にした(§5.4.1)。車やローンなど決まった支出を先に引くのは、新卒で車と奨学金がある人が「普通」でも赤字になるのを防ぐため。

### 変更12: 生活保護の条件を直す

変更6では「自己破産したあとの不足はすべて生活保護で補う」としていたが、これだと破産した人は浪費を続けても借金にならず、生活保護(節約扱い)のまま給料を貯め続けられてしまった(破産したバイトの最終資産が数千万円になっていた)。生活保護は「節約しても収入で暮らせない」ときだけにし、それ以外の不足は借金、上限を超えたら何度でも破産、とした(§5.6)。あわせて、結婚式など一度の大きな出費ですぐ破産しないよう、借入上限を max(50万円, 年収の1/3)から max(200万円, 年収の1/2)に引き上げた。

## 13. 実装の進め方

`SPEC.md` の9ステップのとおり、1ステップ=1PR。この設計書を前提に各PRで実装とテストを入れる。

| # | PR | この設計書の参照先 |
| --- | --- | --- |
| 1 | 雛形: Vite + TS + Vitest + ESLint、`types.ts`、`rng.ts` | §2, §3, §8 |
| 2 | データと初期ガチャ: JSON 5種、`data/index.ts`(validateData)、`setup.ts` | §6, §5.7 |
| 3 | お金: `money.ts` | §4 の 1〜5, §5.1, §5.2, §5.5, §5.6, §5.7 |
| 4 | ステータスと死亡: `stats.ts`、`death.ts` | §5.3 |
| 5 | 幸福度: `happiness.ts`、`result.ts` | §5.4 |
| 6 | イベント: `events.ts`、`events.json` 31個 + 再就職 | §7 |
| 7 | 統合とバランス: `step.ts`、`scripts/balance.ts` | §4, §11.2 |
| 8 | UI: 5画面、controller、グラフ | §9 |
| 9 | セーブとデプロイ: `storage.ts`、GitHub Pages | §10 |

## 14. 第2弾への申し送り

MVPでは作らないが、MVPの作りがじゃまにならないよう書き留めておく。

- **子どもと育休手当**: 出産イベントで子どもを足す。育休中は休む側(本人または共働きの配偶者)に、額面月給の67%(最初の6ヶ月)→50%(残り6ヶ月)を非課税で支給し、その間の給与を止める。扶養内パート・専業の配偶者は育休手当なし。子どもの生活費・教育費、世代継承と合わせて設計する
  - MVPでの備え: 配偶者を `character.spouse` に持たせてあるので、育休・時短・扶養の出入りはここを月ごとに変えられるよう拡張する。収入は「本人 + 配偶者 + 給付」の合算になっているので、給付の種類を足すだけで入る
- **マイホームと住宅ローン**: 購入で家賃分の生活費が下がり、ローン返済と固定資産税が増える。地域ごとの住宅価格を `region.json` に足す。MVPの生活費係数(家賃込み)を「家賃」と「それ以外」に分ける必要がある
- **地域の拡張**: 地域ごとの結婚しやすさ・職業の出やすさ・実家との距離(介護負担)など
