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
| `blacklist` | number | 0 | 残り月数。>0 の間は自己破産後のブラックリスト(借りられない・節約固定・再破産不可) ★ |
| `rank` | number | 0 | 役職 0=一般 1=主任 2=係長 3=課長 4=部長。昇進で+1、転職で0 ★ |
| `overLimit` | number | 0 | 借金が借入上限を超えている月数。6ヶ月続くと自己破産、下回ったら0 ★ |
| `illnessTreated` | number | 0 | 残り月数。>0 の間は大病の治療中(月0.1%の死亡リスク) ★ |
| `illnessUntreated` | number | 0 | 残り月数。>0 の間は大病を治療しないまま(月1.2%の死亡リスク、健康 −0.3/月) ★ |
| `checkupNeglect` | number | 0 | 残り月数。>0 の間は再検査を放置した状態(大病が3倍起きやすい) ★ |
| `widowed` | boolean | false | 配偶者と死別したか ★ |
| `survivorPension` | number | 0 | 遺族厚生年金(月額・額面)。自分の厚生年金と多いほうを受け取る ★ |
| `elderlyDriver` | boolean | false | 免許返納を断って運転を続けている(交通事故・高齢ドライバーの事故が2倍) ★ |

- `married` は `character.married` が正。イベント定義の `flags.married` / `setFlags.married` はエンジンが `character.married` に読み替える(仕様のイベント例との互換のため)
- `married` が false → true になったとき、エンジンが `character.spouse` を `balance.spouse.types` の確率で抽選する。離婚で null に戻す
- 数値フラグのうち `balance.json` の `timers` に載っているもの(`recession` `parentSupport` `unemploymentBenefit` `blacklist` `rehire` `illnessTreated` `illnessUntreated` `checkupNeglect`)は毎月 −1 して0で止める。値は「残り何ヶ月効くか」で、お金の処理(§4 の 2〜5)のあと・イベントの前に −1 する。こうするとイベントで N をセットした翌月から、ちょうど N ヶ月効く

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
最低限の生活費   = 単身8万円 / 既婚12万円 × 地域の生活費係数(家賃の差)
自由に使える手取り = 毎月の世帯の手取り(ボーナスを除く) − 決まった支出(車・健康費・送金・仕送り・奨学金・ローン)
生活費           = (最低限 + (自由に使える手取り − 最低限) × 0.85 × 支出係数
                    + ボーナス × min(1, 0.7 × 支出係数))× 物価
```

- 収入が多いほど生活水準も上がる。車やローンがある人は、そのぶん生活費を抑える
- 最低限の生活費を先に取るので、普通(×1.0)・節約(×0.8)・ゆとり(×1.1)なら、最低限を払えるかぎり月々の収入を超えない。浪費(×1.2)は少しずつ赤字になる
- 地域の生活費係数は最低限の分(家賃の差)にだけ掛ける。収入に応じた分は、地域の給料の差にすでに含まれている
- ボーナス月はボーナスの一部を使い(旅行・家電・ごほうび)、残りは貯まる。ボーナス以上は使わない
- 幸福度の生活水準に使う額は、ここから家賃の差(最低限 × (地域係数 − 1))と物価を除いた実質額
- 無職で失業給付もなければ、生活費は最低限の分だけ(それでも足りなければ生活保護)

### 5.5 端数

- 金額は計算の最後に `Math.round` で整数円にする(各ステップの代入時)
- リターンや利息は実数で計算してから丸める。テストは丸め後の値で比較

### 5.6 自己破産と生活保護

借金(`debt`)が無限に膨らまないようにするための下限。

- **生活保護**: 金融資産を使い切っても、節約しても収入で暮らせない月(収入 < 生活保護の条件で計算した支出)は、不足分を補填して `cash = 0` で止める(借金にしない)。受け始めると車を手放し(`hasCar = false`、ログ `welfare`)、受給中は車の維持費と健康のための出費がかからない(医療扶助)。無職で失業給付が切れたあとや、年金の少ない老後が対象。受給中は支出方針に関係なく「節約」で計算し、幸福度の「安心」は0にする。収入が節約時の支出に届いた月に終わる
- それ以外の不足(浪費、突発の出費)は借金になる
- 借入上限 = max(200万円, 額面年収 × 1/2)。無職・年金生活は200万円
- 大きな出費(30万円以上)で預金と投資を合わせても足りないときは、足りない分を1万円単位で**ローン**(5年・年3%)にする(ログ `auto_loan`)。審査に落ちたら月末に投資を売り、それでも足りなければ借金になる。ローンにした分は臨時の出費に数えず、毎月の返済として支出に入る
- 上限を超えた月に警告(ログ `debt_warning`)を出し、超えた状態が**6ヶ月続いたら自己破産**: `debt = 0`、信用 = 0、ストレス +30、`bankrupt = true`(一度でも破産したか)、log 'event'(id: `bankruptcy`)。破産後84ヶ月(7年)は `blacklist` タイマーが残り、その間は借りられず支出は「節約」に固定、再び破産もできない(不足は延滞として借金に残る)
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
  "startStats": {
    "stress": 20,
    "skill": 10,
    "credit": 50,
    "relations": 50
  },
  "gacha": {
    "constitution": {
      "mean": 50,
      "sd": 15
    },
    "luck": {
      "mean": 50,
      "sd": 15
    }
  },
  "salary": {
    "peakAge": 50,
    "skillBase": 0.9,
    "skillRange": 0.2,
    "declineFrom": 55,
    "declinePerYear": 0.02
  },
  "takeHome": {
    "bands": [
      {
        "below": 3000000,
        "rate": 0.8
      },
      {
        "below": 6000000,
        "rate": 0.77
      },
      {
        "below": 10000000,
        "rate": 0.73
      },
      {
        "below": null,
        "rate": 0.68
      }
    ],
    "pension": 0.9
  },
  "work": {
    "regular": {
      "income": 1.0,
      "freeTime": 80,
      "health": 0,
      "stress": -1,
      "skill": 0.1,
      "death": 1.0
    },
    "normal": {
      "income": 1.08,
      "freeTime": 60,
      "health": -0.05,
      "stress": 0,
      "skill": 0.2,
      "death": 1.0
    },
    "overtime": {
      "income": 1.2,
      "freeTime": 35,
      "health": -0.3,
      "stress": 1.5,
      "skill": 0.35,
      "death": 1.15
    },
    "grind": {
      "income": 1.35,
      "freeTime": 15,
      "health": -0.6,
      "stress": 3,
      "skill": 0.5,
      "death": 1.5
    }
  },
  "spending": {
    "frugal": {
      "living": 0.8,
      "stress": 0
    },
    "normal": {
      "living": 1.0,
      "stress": 0
    },
    "comfort": {
      "living": 1.1,
      "stress": 0
    },
    "lavish": {
      "living": 1.2,
      "stress": -0.5
    }
  },
  "healthCare": {
    "ignore": {
      "cost": 0,
      "health": -0.1,
      "stress": 0
    },
    "normal": {
      "cost": 5000,
      "health": 0,
      "stress": 0
    },
    "active": {
      "cost": 15000,
      "health": 0.3,
      "stress": -0.5
    }
  },
  "living": {
    "single": 80000,
    "married": 120000,
    "incomeShare": 0.85,
    "bonusSpendShare": 0.7
  },
  "retiredFreeTime": 90,
  "unemployedStress": 1,
  "debtAnnualRate": 0.15,
  "debtMinPayment": {
    "share": 0.03,
    "min": 10000
  },
  "investShare": 0.5,
  "assets": {
    "cash": {
      "mu": 0.001,
      "sigma": 0
    },
    "index": {
      "mu": 0.05,
      "sigma": 0.15
    },
    "stocks": {
      "mu": 0.06,
      "sigma": 0.3
    },
    "speculative": {
      "mu": 0.06,
      "sigma": 0.6,
      "crashProb": 0.003,
      "crashPct": -0.6
    }
  },
  "pension": {
    "basicFull": 66000,
    "basicYears": 40,
    "employeeRate": 0.005481,
    "spouseBasicMul": 2,
    "survivorRate": 0.75,
    "retireAge": 65
  },
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
    "a": 0.00014,
    "b": 0.085,
    "ageOffset": 20,
    "healthPivot": 50,
    "healthScale": 15,
    "highStressMul": 1.2,
    "genderMul": {
      "male": 1.4,
      "female": 0.7
    },
    "karoshi": {
      "grindMonthly": 0.00015,
      "overtimeMonthly": 0.00003,
      "minStress": 70
    },
    "maxAge": 120,
    "cause": {
      "overworkGrind": 40,
      "overworkOvertime": 10,
      "accidentBase": 10,
      "oldAgeFrom": 85,
      "oldAgeOffset": 80,
      "oldAgeMul": 5
    }
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
      "living": {
        "base": 1,
        "spending": 0.25
      },
      "security": {
        "base": 1,
        "risk": -0.2,
        "spending": -0.2
      },
      "relations": {
        "base": 1,
        "relation": -0.25
      },
      "freeTime": {
        "base": 1,
        "relation": 0.25,
        "work": -0.15
      },
      "health": {
        "base": 1
      },
      "achievement": {
        "base": 1,
        "risk": 0.2,
        "work": 0.25
      }
    }
  },
  "events": {
    "luckGoodBase": 0.8,
    "luckGoodScale": 0.4,
    "luckBadBase": 1.2,
    "luckBadScale": -0.4,
    "valueShiftStep": 0.1
  },
  "timers": {
    "recession": {
      "layoffMul": 3
    },
    "parentSupport": {
      "monthlyCost": 30000
    },
    "unemploymentBenefit": {},
    "blacklist": {},
    "rehire": {},
    "pregnant": {},
    "parentalLeave": {},
    "spouseLeave": {},
    "fertilityCare": {},
    "maternityLeave": {},
    "illnessTreated": {
      "deathMonthly": 0.001,
      "health": 0
    },
    "illnessUntreated": {
      "deathMonthly": 0.012,
      "health": -0.3
    },
    "checkupNeglect": {
      "deathMonthly": 0,
      "health": 0
    }
  },
  "studentLoan": {
    "interestFreeProb": 0.35,
    "annualRate": 0.01,
    "months": 240
  },
  "unemployment": {
    "months": 6,
    "payRate": 0.6
  },
  "spouse": {
    "probByGender": {
      "male": {
        "fulltime": 0.3,
        "parttime": 0.4,
        "homemaker": 0.3
      },
      "female": {
        "fulltime": 0.94,
        "parttime": 0.04,
        "homemaker": 0.02
      }
    },
    "types": {
      "fulltime": {
        "prob": 0.35,
        "monthlyNet": 180000,
        "taxBenefit": 0,
        "employeePension": 60000
      },
      "parttime": {
        "prob": 0.35,
        "monthlyNet": 80000,
        "taxBenefit": 5000,
        "employeePension": 0
      },
      "homemaker": {
        "prob": 0.3,
        "monthlyNet": 0,
        "taxBenefit": 5000,
        "employeePension": 0
      }
    }
  },
  "bankruptcy": {
    "minLimit": 2000000,
    "incomeShare": 0.5,
    "stress": 30,
    "blacklistMonths": 84,
    "graceMonths": 6
  },
  "result": {
    "netWorthLine": 25000000,
    "happinessLine": 52
  },
  "loan": {
    "annualRate": 0.03,
    "minCredit": 30,
    "autoMinAmount": 300000,
    "autoMonths": 60
  },
  "rehire": {
    "months": 60,
    "payRate": 0.5
  },
  "bonus": {
    "months": [
      6,
      12
    ],
    "startCalendarMonth": 4
  },
  "gender": {
    "femaleProb": 0.5
  },
  "children": {
    "max": 3,
    "universityProb": 0.6,
    "livingOffset": 0.5,
    "stages": [
      {
        "until": 6,
        "label": "未就学",
        "living": 40000,
        "education": {
          "public": 15000,
          "private": 15000
        }
      },
      {
        "until": 12,
        "label": "小学生",
        "living": 50000,
        "education": {
          "public": 28000,
          "private": 28000
        }
      },
      {
        "until": 15,
        "label": "中学生",
        "living": 60000,
        "education": {
          "public": 45000,
          "private": 120000
        }
      },
      {
        "until": 18,
        "label": "高校生",
        "living": 60000,
        "education": {
          "public": 42000,
          "private": 88000
        }
      },
      {
        "until": 22,
        "label": "大学生",
        "living": 30000,
        "education": {
          "public": 50000,
          "private": 100000
        }
      }
    ],
    "allowance": {
      "under3": 15000,
      "school": 10000,
      "third": 30000,
      "until": 18
    },
    "parentalLeave": {
      "months": 12,
      "firstMonths": 6,
      "firstRate": 0.67,
      "laterRate": 0.5,
      "spouseFirstRate": 0.84,
      "spouseLaterRate": 0.63,
      "maternityMonths": 2,
      "maternityRate": 0.67,
      "birthHealth": -5
    },
    "happiness": {
      "relationsPerChild": 6,
      "relationsMax": 12,
      "youngUntil": 12,
      "freeTimePerYoung": -8,
      "babyUntil": 6,
      "stressPerBaby": 0.2
    }
  },
  "nisa": {
    "tsumitateAnnual": 1200000,
    "growthAnnual": 2400000,
    "lifetimeTotal": 18000000,
    "lifetimeGrowth": 12000000,
    "taxRate": 0.20315
  },
  "business": {
    "label": "社長",
    "capital": {
      "small": 3000000,
      "large": 10000000
    },
    "salaryBase": {
      "small": 300000,
      "large": 500000
    },
    "salaryMin": 100000,
    "salaryMax": 3000000,
    "startLevel": 0.6,
    "failLevel": 0.35,
    "breakEvenLevel": 0.8,
    "maxLevel": 8,
    "closeCost": {
      "small": 1000000,
      "large": 3000000
    },
    "valuationMonths": 48,
    "successionShare": 0.5,
    "review": {
      "mu": -0.05,
      "sigma": 0.45,
      "skillMul": 0.004,
      "luckMul": 0.003,
      "work": {
        "regular": -0.1,
        "normal": 0,
        "overtime": 0.05,
        "grind": 0.1
      },
      "recession": -0.25
    }
  }
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
    minFinancial?: number;           // ★ 金融資産(預金+投資)の下限(円)。変更20
    jobIn?: JobId[];                 // ★ この職業のときだけ。変更20
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

### 7.2 MVPのイベント50個(初期値)

仕様の30個に「車を買う」を足して31個(§5.7)。「引っ越し」は地域を変えるイベントに作り直した。

その後の追加は §12 変更13・14・19・20(いまは選択イベント64個 + システム2個)。

実際の定義は `src/data/events.json`。車の価格などイベント固有の金額は events.json に直接書く(balance.json には置かない)。

確率は月あたり。CD=クールダウン(月)。目安は1人生40〜90回([§11](#11-テストとバランス確認))で、balance.ts で調整する。

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
| promotion | 昇進 | 雇用中、バイト以外 | 0.006 / スキル>60 ×2 / 残業多め・激務 ×1.5 / 役職(rank)が上がるごとに ×0.7・×0.7・×0.5、部長(4)で0 / 45歳超 ×0.5・55歳超 ×0.2。CD36。good | 受ける: payMul+0.1、rank+1、ストレス+10、達成+15、v.work+ / 断る: ストレス−3、v.work−。転職で rank は0に戻る |
| raise_skipped | 昇給見送り | 雇用中 | 0.005、CD24 | (なし) payMul−0.03、ストレス+5、達成−5 |
| job_offer | 転職の誘い(職業変更) | 雇用中、〜55歳 | 0.004 / スキル>50 ×1.5 / 大都市 ×1.5 / 田舎 ×0.5。CD36 | 転職する: job=random_other、payMul=1.05、ストレス+5、v.risk+ / 断る: v.risk− |
| layoff | リストラ(無職へ) | 雇用中 | probFrom=layoffRate / recession>0 ×3。good=false | (なし) job=none、ストレス+20、達成−10 |
| bonus_cut | 業績悪化でボーナスカット | 雇用中 | 0.006、CD12 | (なし) 月給−1ヶ月分、ストレス+5 |
| certification | 資格取得のチャンス | 雇用中、〜55歳 | 0.004、CD24 | 挑戦する: cash−10万・ストレス+5 → 55% 合格(スキル+8・達成+5)、45% 不合格(ストレス+5・達成−3) / 見送る |
| boss_trouble | 上司とのトラブル | 雇用中 | 0.006、CD24 | 我慢する: ストレス+15 / 言い返す: 40% ストレス−5・達成+3、40% payMul−0.05・ストレス+10、20% 左遷(payMul−0.1・ストレス+15・人間関係−5・達成−5) / 異動願い: スキル−3、ストレス−10 |
| side_job | 副業の誘い | 雇用中 | 0.004、CD36 | 始める: 35% cash+60万・スキル+5・ストレス+10、65% cash−20万・ストレス+10、v.risk+ / 断る |

**お金(8)**

| id | タイトル | 条件 | 確率 | 選択肢 → 主な効果 |
| --- | --- | --- | --- | --- |
| invest_jackpot | 投資の大当たり | 投資残高≥50万 | 0.003。good | (なし) stocks・speculative +50%、達成+5 |
| scam | 投資詐欺の勧誘 | 25歳〜 | 0.004 / 信用<40 ×2 / v.risk>0 ×1.5。CD36 | 乗る: 85% cash−100万・ストレス+15、15% cash+30万 / 断る: v.risk− |
| lottery | 宝くじ | 20歳〜 | 0.004、CD12 | 買う: cash−3000、0.2% +1億、2% +10万、残り はずれ / 買わない |
| car_broke | 車が壊れる | 20〜80歳、hasCar | 0.004、CD24。good=false | 修理: cash−30万 / 買い替え: cash−150万、ストレス−5 / 手放す(田舎以外): hasCar=false、ストレス+5 |
| car_purchase | 車を買う | 20〜75歳、hasCar=false | 0.004 / 地方都市 ×2 / 田舎 ×4。CD36 | 新車: cash−250万、hasCar=true、達成+5 / 中古車: cash−80万、hasCar=true / 買わない: v.spending− |
| appliance | 家電が壊れる | — | 0.004、CD24。good=false | 新しいものに買い替える: cash−15万・ストレス−2 / 型落ちを安く: cash−5万 / 修理して使う: cash−2万・ストレス+3 |
| windfall_bonus | 臨時ボーナス | 雇用中 | 0.004、CD12。good | (なし) 月給+1ヶ月分、ストレス−3 |
| friend_loan | 友人に借金を頼まれる | 22歳〜 | 0.004、CD36 | 貸す: 50% 返ってきた・人間関係+10、50% cash−50万・人間関係−5 / 断る: 人間関係−8 |

**健康(6)**

| id | タイトル | 条件 | 確率 | 選択肢 → 主な効果 |
| --- | --- | --- | --- | --- |
| cold | 風邪で休む | — | 0.01 / 健康<40 ×2。CD6。good=false | (なし) 健康−2、ストレス+2 |
| checkup | 健康診断で再検査 | 35〜74歳 | 0.006 / 健康:意識高め ×1.5。CD24 | 精密検査を受ける: cash−3万、健康+5 / 放置: 健康−5 |
| hospital | 入院 | — | 0.002 / 健康<40 ×2.5 / 年齢>60 ×2。CD12。good=false | (なし) cash−30万、健康−10、ストレス+10 |
| traffic_accident | 交通事故でけが | — | 0.0004 / hasCar ×1.5。CD24。good=false | (なし) cash−20万、健康−15、ストレス+10 |
| serious_illness | 大病 | — | 0.0005 / 健康<30 ×6 / 健康<15 ×2 / 50歳超 ×2。CD36。good=false | (なし) cash−100万、健康−10、ストレス+20、達成−5 |
| back_pain | 腰痛 | 30歳〜 | 0.006 / 残業多め・激務 ×1.5。CD24 | 整体に通う: cash−5万、健康+3 / 我慢する: 健康−3、ストレス+5 |

**社会(2)**

| id | タイトル | 条件 | 確率 | 選択肢 → 主な効果 |
| --- | --- | --- | --- | --- |
| recession | 不況 | — | 0.002、CD120 | (なし) 投資資産−30%、recession=24 |
| inflation | 物価上昇 | — | 0.003、CD60 | (なし) priceLevel ×1.05 |

**追加のライフイベント(18。変更14)**

| id | タイトル | 条件 | 確率 | 選択肢 → 主な効果 |
| --- | --- | --- | --- | --- |
| travel | 旅行のチャンス | 20〜80歳 | 0.004、CD24 | 海外旅行に行く: cash−40万・ストレス−15・人間関係+3・達成+3 / 国内旅行に行く: cash−10万・ストレス−8 / 家でゆっくりする: ストレス−2 |
| hobby | 新しい趣味 | 18〜80歳 | 0.003、CD60 | 始めてみる: cash−5万・ストレス−6・人間関係+4・達成+3 / やめておく |
| pet | ペットを飼う | 22〜70歳、pet=false | 0.002、CD60 | 家族に迎える: cash−20万・ストレス−10・人間関係+5・pet=true / 今は飼えない |
| pet_loss | ペットとの別れ | pet=true | 0.006 | (なし) ストレス+15・人間関係−3・pet=false |
| oshi | 推しができる | 18〜65歳 | 0.003、CD36 | 全力で推す: cash−30万・ストレス−12・達成+3 / ほどほどに楽しむ: cash−5万・ストレス−5 / 距離を置く |
| sns_buzz | SNSでバズる | 18〜60歳 | 0.0015、CD60。good=true | (なし) 人間関係+5・ストレス+3・達成+5 |
| volunteer | ボランティアの誘い | 25〜80歳 | 0.003、CD48 | 参加する: 人間関係+8・ストレス−3・達成+3 / 断る: 人間関係−2 |
| exercise | 運動を始めるきっかけ | 30〜75歳 | 0.004、CD48 | ジムに通う: cash−10万・健康+8・ストレス−5 / ウォーキングを始める: 健康+3・ストレス−2 / 面倒なのでやめる |
| anniversary | 結婚記念日 | married=true | 0.006、CD24 | 豪華に祝う: cash−20万・人間関係+8・ストレス−5 / ささやかに祝う: cash−3万・人間関係+3 / うっかり忘れていた: 人間関係−8・ストレス+3 |
| gambling | ギャンブルに誘われる | 20〜75歳 | 0.003、CD36 | 行く → 15% cash+50万・ストレス−5、85% cash−30万・ストレス+5 / 断る |
| guarantor | 保証人を頼まれる | 30〜70歳 | 0.0015、CD120。good=false | 引き受ける → 70% 人間関係+5、30% cash−200万・ストレス+20 / 断る: 人間関係−10 |
| jukunen_divorce | 熟年離婚の危機 | 60〜歳、married=true | 0.001 / relations<40 ×3、once。good=false | じっくり話し合う: 人間関係+10・ストレス+10 / 別々の道を歩む: ストレス+5・married=false・資産-50% |
| silver_job | シルバー人材センター | 〜80歳、退職後 | 0.004、CD36 | 働いてみる: cash+30万・人間関係+5・ストレス−3・健康+2 / のんびり過ごす |
| ore_ore | オレオレ詐欺 | 70〜歳 | 0.003、CD60。good=false | 言われた口座に振り込む: cash−200万・ストレス+15 / 一度電話を切って確かめる: ストレス+3 |
| care_needed | 介護が必要になる | 75〜歳 | 0.003 / health<40 ×3、once | 介護施設に入る: cash−500万・ストレス−10・人間関係−3 / 在宅介護サービスを使う: cash−150万・ストレス+5 / 家族に頼る: 人間関係−10・ストレス+10 |
| shukatsu | 終活 | 70〜歳 | 0.004、once | エンディングノートを書く: ストレス−5・達成+5 / 業者に生前整理を頼む: cash−30万・ストレス−10 / まだ早い |
| old_friend_death | 旧友の訃報 | 60〜歳 | 0.004、CD36 | (なし) ストレス+10・人間関係−3 |
| grand_reunion | 昔の仲間との再会 | 60〜85歳 | 0.003、CD48 | 参加する: cash−3万・人間関係+8・ストレス−5 / 体調を理由に断る: 人間関係−2 |

**システム(50個の外。仕様の「再就職」)**

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
- ゲーム開始時と、年の切れ目ごと(年間サマリーを閉じたあと。「次のイベントまで」で飛ばした年も含む)に保存する。選択待ちのまま保存された場合は、再開すると選択肢が出る
- リザルト到達でセーブを消し、`LifeRecord` を history の先頭に追加
- localStorage が使えない(プライベートモードなど)・容量オーバーのときは、保存に失敗してもゲームは続ける
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

`npx tsx scripts/balance.ts --n 1000 --seed 1` の結果(1,000人生 × 2、約33秒。変更13〜15の調整後):

| 指標 | 結果 | 目安 |
| --- | --- | --- |
| 平均寿命(全方針ランダム) | 81.2歳 | 78〜85歳 |
| 激務を続けた場合の平均寿命 | 73.4歳(差 7.8歳) | 全体より5歳以上短い |
| 最終資産の中央値 | 1,935万円 | 1,000万〜3,000万円 |
| 人生タイプの割合 | 勝ち組 29.9% / 貧乏だけど幸せ 23.6% / 金持ち不幸 13.5% / 苦労人 33.0% | どれも10%以上 |
| 1人生あたりのイベント数 | 76.4回 | 40〜90回 |
| 全イベントが1回以上発生 | すべて発生 | 未発生なし |

調整したもの:
- 生活費を収入連動にした(変更11)。生活費が一律13万円だと、低収入の人は初月から赤字で1年以内に破産し、高収入の人は月30万円以上貯まって最終資産の中央値が8,000万円を超えていた
- 生活保護の条件を直した(変更12)
- 支出係数 ゆとり 1.25→1.2・浪費 1.6→1.4、基本死亡率 0.0003→0.0002、幸福度のしきい値 60→52(平均幸福度が約51で、60だと「幸せ」側がほとんど出なかった)、風邪 0.015→0.01・同窓会 0.008→0.006

(変更20のあとの数字は §12 変更20 を参照)

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
| 12 | 生活保護は「節約しても暮らせない」ときだけ、自己破産は何度でも | 同上(変更6の不具合の修正)。破産の回数は変更13で7年に1回までに |
| 13 | 遊んだ感想からの調整(イベントの頻度と中身、大病、健康補正、7年ルール) | 承認済み(A→B→Cの順で進める、の A)・SPEC反映済み |
| 14 | ライフイベントを18個追加(計50個) | 要望(「ライフイベントを増やしたい」)・SPEC反映済み |
| 15 | 目安の見直し(資産しきい値2,500万円、イベント数40〜90回) | 要望・SPEC反映済み |
| 16 | 表示の改善(年月・資産の内訳と運用成績・借金と奨学金・定年後の収入・役職・価値観5段階) | 承認済み(B)・SPEC反映済み |
| 17 | 投資の配分、ローンと繰上げ返済、65歳の再雇用 | 承認済み(C)・SPEC反映済み |
| 18 | 年間の収支とバランスシート、方針の説明 | 要望・SPEC反映済み |
| 19 | リアリティの調整(ボーナス、生活費の式、収支に運用損益、左遷の転勤、恋人との別れ、親の死亡時期、宝くじ、生活保護では車を手放し医療費なし) | 要望・SPEC反映済み |
| 20 | 大きな出費の自動ローンと破産の猶予、大病の選択と死亡リスク、免許返納、方針で起きやすさが変わるイベント、収入の内訳、金融資産の内訳グラフ、若くても過労死、詐欺はお金があるときだけ | 承認済み(1〜7を全部進める)・SPEC反映済み |
| 21 | 第2弾: 投資を好きなタイミングで売って預金にする(税金なし) | 要望(第2弾として進める)・SPEC反映済み |
| 22 | 離婚の年齢の上限、配偶者との死別と遺族年金 | 要望(88歳の離婚はおかしい、死別では)・承認済み・SPEC反映済み |
| 23 | 給料の見直し(バイト・ピーク年収・役職定年)、リボの毎月の返済、基本死亡率 | 承認済み(A〜F)・SPEC反映済み |
| — | マイホーム・住宅ローン | 第2弾のまま(確認済み)。§14 に申し送り。子ども(§15)・起業(§18)は第2弾で作った |

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

実際には収入が低い人ほど家賃の安いところに住むなど、生活費は収入に連動する。そこで生活費 = 固定分 + 自由に使える手取り × 0.6 × 支出係数 にした(§5.4.1。割合は変更13で0.64に調整)。車やローンなど決まった支出を先に引くのは、新卒で車と奨学金がある人が「普通」でも赤字になるのを防ぐため。

### 変更12: 生活保護の条件を直す

変更6では「自己破産したあとの不足はすべて生活保護で補う」としていたが、これだと破産した人は浪費を続けても借金にならず、生活保護(節約扱い)のまま給料を貯め続けられてしまった(破産したバイトの最終資産が数千万円になっていた)。生活保護は「節約しても収入で暮らせない」ときだけにし、それ以外の不足は借金、上限を超えたら何度でも破産、とした(§5.6)。あわせて、結婚式など一度の大きな出費ですぐ破産しないよう、借入上限を max(50万円, 年収の1/3)から max(200万円, 年収の1/2)に引き上げた。

### 変更13: 遊んだ感想からの調整

実際に遊んだ感想(交通事故・家電・昇進が多い、資格や副業や上司トラブルの損得が偏っている、老後の検診が不自然、健康が最悪でも倒れない、自己破産を何度もできる)を受けて調整した。1,000人生で数えた1人生あたりの回数と主な変更:

| イベント | 調整前 | 主な変更 |
| --- | --- | --- |
| 交通事故 | 1.8回 | 確率を1/5に(現実は一生で0.2〜0.3回程度) |
| 家電が壊れる | 5.2回 | 確率を半分・クールダウン2年に。選択肢つきにして金額に幅(2万〜15万円) |
| 昇進 | 3.5回 | 役職(一般→主任→係長→課長→部長)を足し、上の役職ほど・年を取るほど話が来にくい |
| 資格 | 2.6回 | 合格55%・不合格45%に。〜55歳 |
| 副業 | 成功60% | 成功35% |
| 上司トラブル「言い返す」 | 良い結果60% | 良い結果40%・評価ダウン40%・左遷20% |
| 健康診断で再検査 | 年齢の上限なし | 74歳まで |

健康補正は 2^((50−健康)/25) から 2^((50−健康)/15) にし(健康0で4倍 → 約10倍)、健康が悪いと起きやすい「大病」イベントを足した。そのぶん基本死亡率 a を 0.0002 → 0.00017 に、生活費の収入連動の割合を 0.6 → 0.64 にして、バランスの目安に合わせ直した。

自己破産は、現実の免責(7年以内の再免責は不可)に合わせて、破産後7年はブラックリストにした。借りられず支出は「節約」に固定され、その間は再び破産できない(不足は延滞として借金に残る)。

### 変更14: ライフイベントを増やす

「人生のイベントのバリエーションを増やしたい」「後半に大きな出来事がない」という感想を受けて、18個足した(§7.2 の追加表)。働き盛り向け(旅行・趣味・ペット・推し活・SNS・ボランティア・運動・結婚記念日・ギャンブル・保証人)と、老後向け(熟年離婚・シルバー人材センター・オレオレ詐欺・介護・終活・旧友の訃報・昔の仲間との再会)。子どもは第2弾のまま。

1人生あたりのイベント数が目安(80回)を超えないよう、風邪(0.01→0.006)・投資詐欺(0.004→0.0025)・腰痛(0.006→0.004)を下げた。1,000人生で 76.4回、ほかの目安もすべて満たす(平均寿命 81.2歳、激務 −7.8歳、最終資産の中央値 1,935万円、人生タイプ 27.5% / 26.0% / 11.4% / 35.1%)。金持ち不幸型が11.4%と下限に近い(お金を使うイベントが増えて資産の中央値が下がったため)。

### 変更15: 目安の見直し

イベントの追加で資産の中央値が下がり(約2,400万 → 約1,900万円)、金持ち不幸型が下限の10%に近づいた(11.4%)。人生タイプの資産しきい値を、中央値に近い 3,000万 → 2,500万円に下げた。あわせて、Cでもイベントを足す予定なので、1人生あたりのイベント数の目安を 40〜80回 → 40〜90回に広げた。

### 変更16: 表示の改善

- **年月**: ゲームは新卒の4月に始まる。経過月から暦の月を出し、ヘッダーは「26歳 8月(9年目)」、ログと年表は「26歳8月」と表示する(年間サマリーは毎年4月)
- **金融資産の内訳と運用成績**: メイン画面の金融資産をタップすると、預金・積立・個別株・信用/仮想通貨それぞれの残高・元本・損益(円と%)と、借金・奨学金の残りを出す。元本は `GameState.invested`(省略可。古いセーブにはないので「—」と表示)で、積立で増え、資金ショートの売却では売った割合だけ減る。値動きでは変わらない。財産分与(離婚)は `assetShock.split` で元本も同じ割合で減らす(運用の損にしない)
- **借金と奨学金**: タイルを分け、借金のタイルに「奨学金 残り◯万円」「ブラックリスト 残り◯年」を添える
- **収入の表示**: 定年後は「年金・世帯の手取り」、失業給付中は「失業給付・世帯の手取り」と出す
- **役職**: 職業の横に(主任)〜(部長)を出す
- **価値観**: スライダーを5段階(−2〜+2)にし、数字でなく「とても安定志向 / やや安定志向 / 中間 / やや挑戦志向 / とても挑戦志向」のように言葉で出す。内部の値と、選択による±0.1の変化はそのまま

### 変更17: 投資の配分、ローンと繰上げ返済、再雇用

**投資の配分**: `Policy.invest` を1つの資産名から配分 `InvestAllocation`(預金・積立・個別株・信用/仮想通貨の%、10%刻みで合計100)に変えた。余剰の50%(投資に回す分)をこの割合で振り分け、預金の分は現金に残す。`Policy.prepay`(繰上げ返済)を足した。`createGame` / `changePolicy` は `PolicyInput`(投資に1つの資産名を渡すと100%扱い)も受け取り、`normalizePolicy()`(`src/engine/policy.ts`)で直す。古いセーブも読み込み時に同じ関数で直す。UIは積立・個別株・信用/仮想通貨を±10%で決め、残りが預金。プリセット(預金だけ / 積立中心 / バランス / 攻め)もある。

**ローン**: `Assets.loan`(残高)と `Character.loanPayment`(毎月の返済額の合計)を足した(どちらも古いセーブにはないので省略可)。イベント効果 `loan: { amount, months }` で組む。年3%(`balance.loan.annualRate`)の元利均等で、返済は決まった支出に入る。審査は信用30以上(`balance.loan.minCredit`)かつブラックリスト外。落ちたら現金で払い、ログ `loan_rejected` を残す。ローンの選択肢は結婚(ブライダルローン)・新車・車の買い替えに足した。自己破産でローンも消える。円の丸めで最終回に数円だけ残らないよう、残りが返済額の1%未満ならまとめて返す。

**繰上げ返済**: `prepay` の方針なら、投資に回す分で先にローン → 奨学金を返し、残りを積み立てる。返済額が減るのではなく、返し終わるのが早くなる。

**再雇用**: 65歳で退職(退職金)した直後に、システムイベント `rehire_offer`(65歳時点で職に就いていた人だけ、1回だけ)を出す。「再雇用で働く」なら `flags.rehire = 60`(タイマー)。その間は年金に加えて、退職前の額面月給 × 50%(`balance.rehire.payRate`)が手取り率どおりに入り、働き方は定時扱い(ストレス・健康・自由時間・死亡率)。画面の職業は「再雇用(営業)」。

1,000人生の結果: 平均寿命 80.6歳、激務 −7.9歳、最終資産の中央値 2,621万円、人生タイプ 36.8% / 18.8% / 14.8% / 29.6%、イベント 75.9回。すべて目安内。一度でも自己破産した人生は 63.5% → 59.2%。

### 変更18: 年間の収支とバランスシート、方針の説明

**年間の収支**: `src/engine/ledger.ts` の `YearLedger` に1年分を足していく(`GameState.ledger`、古いセーブにはないので省略可)。

- 毎月の収入の内訳(給料・年金・失業給付・配偶者・仕送り)と、支出の内訳(生活費・車・健康・送金・仕送り・奨学金・ローン)を足す
- あわせて、カードローンの利息、イベントでの臨時収入と出費、退職金、投資に回した額、繰上げ返済した額も記録する
- 年の切れ目で `lastLedger` に移し、新しい年を0から始める

年間サマリーには「年間の収入・支出・収支」を出し、「この1年の収支とバランスシート」を開くと内訳とバランスシート(資産・負債・純資産)が見られる。開いたら自動で閉じない。

**資産の画面**: 「資産と負債」にした。資産ごとの元本と損益、負債(カードローン・ローン・奨学金)、純資産、今年ここまでの収支を出す。

**方針の説明**: キャラ作成と方針変更で、選んでいる選択肢を選ぶと「つまりどうなるか」を各項目の下に一言で出す(例: 激務「いちばん稼げるが、体を壊しやすく、寿命が縮む」)。細かい数字は出さない。投資先にも一言ずつ添える(`src/ui/policyHelp.ts`)。

### 変更19: リアリティの調整

遊んだ感想(左遷されても大都市のまま、収支マイナスでもお金が減らない、ボーナスがない、20年以上付き合って50歳で結婚)を受けて、現実味のないところを直した。

| 項目 | 原因 | 対応 |
| --- | --- | --- |
| 左遷されても住む場所が変わらない | 文章だけで地域を変えていなかった | 効果 `relocate: 'down'` を足し、左遷は一段下の地域(大都市→地方都市→田舎)に転勤する |
| 収支マイナスでもお金が減らない(老後) | 投資の値上がりが赤字を上回っていた(老後に赤字の年の約半分)。運用益が収支に出ていなかった | 年間の収支に「運用損益」と「生活保護」を足した。説明文も添えた |
| ボーナスがない | 年収を12等分していた | 年収 = 月給 × (12 + ボーナスの月数)。会社員4ヶ月分(製造3、バイト0)を6月・12月に半分ずつ。ボーナスカットは今期のボーナス(2ヶ月分)がなくなる |
| 20年以上付き合って50歳で結婚 | 恋人と別れる仕組みがなかった | 「恋人と別れる」イベント(50歳を過ぎると3倍)、プロポーズで「まだ早い」なら30%で去る、プロポーズは40歳を過ぎると半分に |
| (親が100歳を超えても生きている) | 親が亡くなる確率が年齢で十分に上がらなかった | 55歳・60歳・65歳を過ぎるごとに上がるようにした |
| (宝くじが当たりすぎる) | 1等0.2%で、期待値が買った額の約70倍だった | 実際の還元率(約46%)に近い当たり方にした(1等は100万分の1) |

1,000人生で確かめた結果:

- 結婚: 年齢の中央値は32歳。恋人期間の中央値は3.1年、90パーセンタイルは9.8年
- 親が亡くなるのは本人が54歳前後(親が80代半ば)。75歳で親が存命なのは401人中1人

**生活費の式**: ボーナスを入れると、月々の収入だけでは生活費が足りず、ボーナスまで借金でしのぐ人が出た。そこで次のように直した(§5.4.1)。

- 最低限の生活費を先に取り、残りの一定割合を使う形にした(普通なら月々の収入を超えない)
- ボーナスの一部はボーナス月に使う
- 地域の生活費係数は家賃の差の分だけに掛ける。地域の給料の差と二重にかかっていたため

**生活保護**: 老後に生活保護を受けるのは500人生中38人(ほとんどが基礎年金だけのバイト)で、受け始める直前の金融資産は多くても6万円だった(資産を使い切ってから受ける、は現実どおり)。現実に合わせて、受け始めると車を手放し、受給中は医療費(健康のための出費)をかけないようにした。

バランス(1,000人生 × 2): 平均寿命 81.1歳、激務 −8.1歳、最終資産の中央値 2,566万円、人生タイプ 33.0% / 18.9% / 17.7% / 30.4%、イベント 75.9回。一度でも自己破産した人生は 59% → 34%。

### 変更20: 自動ローンと破産の猶予、大病、免許返納、方針で変わるイベント

遊んだ感想(病気を放置してもなかなか亡くならない、免許返納があってもいい、中古車もローンを組める、田舎のバイトが上司と口論して左遷はない、方針の差がイベントに出ない、収入の内訳と投資の内訳が見たい)を受けて直した。

| 項目 | 原因 | 対応 |
| --- | --- | --- |
| 自己破産が多い | 貯金のないうちに新車250万円・結婚式200万円を現金で払うと、すぐに借金が上限(200万円)を超えて破産していた | 30万円以上の出費で預金と投資が足りないときは、足りない分を自動でローン(5年)にする。破産は上限を超えた状態が6ヶ月続いたとき(超えた月に警告) |
| 病気を放置しても亡くならない | 大病は出費とステータスだけで、死亡リスクがなかった | 大病は「治療に専念する(100万円・12ヶ月は月0.1%)」「治療しない(36ヶ月は月1.2%、健康も下がる)」を選ぶ。死因は病気。再検査の放置・生活習慣病を気にしないと5年(3年)は大病が3倍。大病は年齢で起きやすく(50歳超×3、65歳超×さらに2) |
| 免許返納 | なかった | 70歳以上で車があると「免許返納」(返納/運転を続ける)。続けると交通事故と「運転中の事故」(踏み間違い。50万円・免許返納)が2倍 |
| 中古車のローン | 選択肢がなかった | 「中古車をローンで買う」(80万円・3年) |
| バイトの左遷 | 上司とのトラブルがバイトにも起きていた | 上司とのトラブルはバイト以外。バイトには「店長とのトラブル」(シフトを減らされる・辞めて別のバイト) |
| 結婚式ラッシュの件数 | 文章に件数がなかった | 「今年だけで3通、1件5万円ほど」 |
| 方針の差がイベントに出ない | 方針を見るイベントが少なかった | 13個追加(下の表)。条件に `jobIn`、確率補正に `spending` を足した。恋人ができる確率は激務0.5倍・残業多め0.75倍・定時1.2倍 |
| 収入の内訳 | 合計だけだった | メイン画面の手取りのタイルを押すと、今月と今年(年が明けた直後は去年)の内訳 |
| 投資の内訳の推移 | なかった | 年間サマリーのログ(`year_summary`)に年末の内訳 `assets` を持たせ、年間サマリーと資産の画面に積み上げ棒グラフ |
| 若いと過労死しない | 過労は死因の重みだけで、若いうちは死亡率そのものが低かった | ストレス70以上で激務なら毎月0.015%、残業多めなら0.003%を年齢に関係なく足す(死因は過労)。激務を続けた1,000人生で過労死185人、うち40歳未満42人 |
| お金がなくてもオレオレ詐欺に払える | 金融資産を見ていなかった | 条件 `minFinancial`(預金+投資の下限)を足した。オレオレ詐欺は200万円、投資詐欺は100万円ないと起きず、友人に「貸す」は50万円あるときだけ |
| (年の切れ目のイベントの収支) | 年末の月に起きた選択イベントのお金が翌年の収支に入り、年間サマリーの金融資産と収支が合わなかった | 締めたばかりの年の収支に入れる |

追加したイベント(方針で起きやすさが変わるもの):

| id | 起きやすい方針 | 内容 |
| --- | --- | --- |
| `overwork_collapse` | 激務×8・残業多め×3 | 過労で倒れる(休職/すぐ復帰) |
| `burnout` | 激務×8・残業多め×3 | 燃え尽き(休職/辞める/続ける) |
| `family_neglect` | 既婚で激務×6・残業多め×3 | 家庭がギクシャク |
| `evening_class` | 定時×8 | 夜の時間(社会人スクール) |
| `impulse_buy` | 浪費×6・ゆとり×2.5 | 衝動買い(30万円) |
| `revolving` | 浪費×8・ゆとり×3、節約は起きない | リボ払いの誘い(借金+40万円) |
| `frugal_stingy` | 節約のときだけ | 付き合いが悪いと言われる |
| `marathon` | 健康意識高め×10、気にしないは起きない | マラソン大会 |
| `early_detection` | 健康意識高め×8、気にしないは起きない | 人間ドックで早期発見 |
| `lifestyle_disease` | 気にしない×5・意識高め×0.2 | 生活習慣病の疑い |
| `shop_trouble` | バイトのとき | 店長とのトラブル |
| `license_return` `elderly_crash` | 70歳以上で車あり | 免許返納・運転中の事故 |

方針の影響(各300人生、選択肢はいつも1番目):

| 方針 | 平均寿命 | 最終資産の中央値 | 幸福度 | 自己破産 |
| --- | --- | --- | --- | --- |
| 堅実(定時・節約・積立・意識高め) | 90.1歳 | 7,410万円 | 66.2 | 15% |
| 普通 | 84.4歳 | 3,422万円 | 62.3 | 14% |
| モーレツ(激務・ゆとり・個別株・気にしない) | 70.7歳 | 1,266万円 | 49.2 | 27% |
| 破滅(激務・浪費・信用100%・気にしない) | 72.1歳 | 286万円 | 47.5 | 87% |
| のんびり(定時・ゆとり・預金・普通) | 84.8歳 | 557万円 | 60.1 | 51% |

自己破産は 普通 41%→14%、堅実 29%→15% に減った。

バランス(1,000人生 × 2): 平均寿命 81.2歳 → 78.3歳(大病を治療しない人生と過労死の分。自動プレイは半分の確率で「治療しない」を選ぶ)、激務 −9.1歳、最終資産の中央値 2,371万円、人生タイプ 29.9% / 15.3% / 18.3% / 36.5%、イベント 79.7回。一度でも自己破産した人生は 36% → 23%。死因は病気72%・老衰16%・事故7%・過労5%。

大病の死亡リスクは、治療しないで3年のあいだに約35%が亡くなる強さにした(月2%だと平均寿命が75歳まで下がり目安を外れた)

### 変更21: 投資を売って預金にする(第2弾)

「仮想通貨や投資商品を好きなタイミングで売却して預金にしたい」という要望。第2弾の最初の項目として入れた。

- engine: `sellAsset(state, key, amount)`(`step.ts`、公開API)。`key` は `index` `stocks` `speculative`、`amount` は円。持っている額を超えたら全部売る。新しい state を返し、0円以下・持っていない・死亡後は同じ state を返す
- 売った額はそのまま `cash` に入る。税金はかけない(NISA扱い。確認済み。月末の資金ショートでの自動売却も無税のまま)。→ §17 でNISAと特定口座を分け、特定口座の利益には税金をかけるようにした。`invested` の元本は売った割合だけ減らすので、純資産も運用損益も変わらない
- 収支(`YearLedger`)には入れない(資産の入れ替えで、収入でも支出でもない)。ログは `type: 'policy'`, `id: 'sell'` で「売却: 信用・仮想通貨を60万円売って預金にした(損益 +10万円)」
- 方針(配分)は変えないので、翌月からも配分どおりに積み立てが続く
- UI: 資産の画面(金融資産のタイル)の各投資の行に「売る」。全部・半分・金額(万円)を選ぶ。売ると画面がその場で更新される。`GameController.sell()` が state を差し替えて描き直す
- 売れるのは止まっている間(資産の画面を開いている間は自動で一時停止)

### 変更22: 離婚の年齢と、配偶者との死別

「88歳で離婚はない、どちらかというと死別では」という感想から。

- 離婚の危機(`divorce_crisis`)は50歳まで、熟年離婚の危機(`jukunen_divorce`)は60〜69歳。70歳以上では離婚しない(確認済み。離婚の平均年齢は夫45歳前後・妻42歳前後)
- 配偶者との死別(`spouse_death`、ライフ): 50歳以上の既婚者。配偶者は本人と同い年とみなし、確率は `probFrom: 'spouseMortality'`(基本死亡率 q(年齢)/12。健康や働き方の補正はかけない)。独身に戻り、`widowed = true`、人間関係 −20・ストレス +25・健康 −5・達成感 −5
- 遺族年金: 死別のとき、共働きだった配偶者の厚生年金 × `pension.survivorRate`(0.75)を `flags.survivorPension` に残す。年金の本人の厚生年金は「自分の分」と「遺族年金」の多いほう(実際の併給調整の近似)。配偶者分の基礎年金はなくなる。現役のうちの遺族年金・配偶者からの相続は入れていない
- 1,000人生: 結婚した686人生のうち、死別137件(中央値78歳)。離婚288件(中央値41歳、最高69歳)。平均寿命 78.1歳、最終資産の中央値 2,652万円、人生タイプ 33.2% / 13.5% / 19.0% / 34.3%、イベント 79.5回

### 変更23: 給料の見直しと、リボの毎月の返済

「バイトの月給が高い、給料も全体的に高そう、年功序列?」「リボ払いをしたら借金だけが増える」という感想から(A〜F は承認済み)。

| 項目 | 原因 | 対応 |
| --- | --- | --- |
| バイトの給料が高い | 年収200万→240万円と年功で上がり、月の額面が中央値18万円(多いと25万円)だった | 180万→200万円(時給1,000〜1,100円で月150時間ほど)。25歳の月の額面は中央値16万円 |
| エンジニア・営業の50代が高い | 50歳の中央値が926万・806万円だった | ピーク年収 エンジニア 750万→650万円、営業 650万→580万円(50歳の中央値 803万・700万円) |
| 60〜64歳も50代と同じ給料 | 50歳以降は横ばいのままだった | `salary.declineFrom` 55歳から `declinePerYear` 2%ずつ下がる(役職定年。60歳で約1割減) |
| リボで借金だけが増える | カードローンは「その月の余り」からしか返さず、預金があっても手を付けなかった。赤字なら利息で増え続けた | `debtMinPayment`: 毎月 max(1万円, 残高×3%) を預金から自動で返す。繰上げ返済の方針なら預金で一括で返す。リボの選択肢に金額を出した |
| (平均寿命が目安の下限ぎりぎり) | 大病・過労死・死別などで病気の死因が増え、自動プレイの平均寿命が78歳前後になっていた | 基本死亡率 a = 0.00017 → 0.00014。自動プレイの「普通」方針で 85.7歳(22歳の平均余命の現実に近い) |

年収の中央値(額面、1,500人生):

| 職業 | 25歳 | 35歳 | 45歳 | 50歳 | 60歳 |
| --- | --- | --- | --- | --- | --- |
| エンジニア | 418万 | 579万 | 740万 | 803万 | 701万 |
| 営業 | 389万 | 529万 | 645万 | 700万 | 628万 |
| 製造 | 348万 | 455万 | 562万 | 603万 | 532万 |
| 事務 | 313万 | 390万 | 484万 | 519万 | 469万 |
| バイト | 193万 | 210万 | 225万 | 230万 | 206万 |

バランス(1,000人生 × 2、シード1〜3): 平均寿命 78.6 / 81.2 / 80.3歳。シード1は、最終資産の中央値・人生タイプ・イベント数とも目安内。自己破産 23% → 19%

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

- **投資の売却**: 作った(§12 変更21)。まとめ買いとNISA・特定口座の区別も作った(§17)

- **起業(社長)**: 作った(§18)
- **子どもと育休手当**: 作った(§15)。世代継承(子どもで次の人生を始める)は今後
  - MVPでの備え: 配偶者を `character.spouse` に持たせてあるので、育休・時短・扶養の出入りはここを月ごとに変えられるよう拡張する。収入は「本人 + 配偶者 + 給付」の合算になっているので、給付の種類を足すだけで入る
- **マイホームと住宅ローン**: 購入で家賃分の生活費が下がり、ローン返済と固定資産税が増える。地域ごとの住宅価格を `region.json` に足す。MVPの生活費係数(家賃込み)を「家賃」と「それ以外」に分ける必要がある
- **地域の拡張**: 地域ごとの結婚しやすさ・職業の出やすさ・実家との距離(介護負担)など

## 15. 第2弾: 子どもと育休

ユーザーの「第2弾を進めよう」で、最初の項目として作った。金額は `balance.json` の `children`(1人あたりの月額)。

### 15.1 状態

- `character.children?: Child[]`。`Child = { birthMonth, university }`。年齢は `(state.month − birthMonth) / 12`。大学に進むか(`universityProb` 60%)は生まれたときに決まる
- 大学に進めば22歳、進まなければ18歳(高校卒業)で独立し、費用がかからなくなる。独立した月にログ `child_independent`
- 方針に `education`(子どもの教育): `public` 公立中心 / `private` 私立中心(中学から私立、大学も私立)。子どもがいないときは何も変わらない。古いセーブは `public`
- タイマー: `pregnant`(出産までの残り月数。1になった月に出産)、`parentalLeave`(本人の育休)、`spouseLeave`(配偶者の育休)、`fertilityCare`(不妊治療)。フラグ `trying`(子どもを望んでいる)

### 15.2 お金

| 段階 | 年齢 | 生活費 | 公立中心 | 私立中心 |
| --- | --- | --- | --- | --- |
| 未就学 | 0〜5歳 | 4万円 | 1.5万円 | 1.5万円 |
| 小学生 | 6〜11歳 | 5万円 | 2.8万円 | 2.8万円 |
| 中学生 | 12〜14歳 | 6万円 | 4.5万円 | 12万円 |
| 高校生 | 15〜17歳 | 6万円 | 4.2万円 | 8.8万円 |
| 大学生 | 18〜21歳 | 3万円 | 5万円 | 10万円 |

(文部科学省「子供の学習費調査」と大学の学費を月額にならした概算。公立中心で大学まで1人約2,100万円、私立中心で約2,800万円)

- 子どもの費用は決まった支出(`expenses.children`)。ただし生活費の式(§5.4.1)で「自由に使える手取り」から引くのは `livingOffset`(50%)だけ。残りの半分は親の生活水準を下げずに貯金が減る。全額を引くと、親が生活費を削るだけで貯金がほとんど減らなかった(子ども1人で最終資産が約300万円しか減らない)
- 児童手当(`income.childAllowance`、2024年の制度): 3歳未満 1.5万円、3歳〜高校生 1万円、3人目からは3万円。所得制限なし
- 育休(`income.parentalLeave`): 本人の育休中は給与とボーナスが止まり、額面月給の67%(最初の6ヶ月)→50%(残り6ヶ月)を非課税で受け取る。働き方は「定時」扱い(自由時間が増え、仕事のストレスは減る)。配偶者(共働きのときだけ)の育休中は、配偶者の手取りが 84% → 63% になる(額面の67%・50%を手取りに直した近似)
- 出産: 10万円(出産育児一時金で大半はまかなえる、準備の費用)

### 15.3 イベント

| id | 条件 | 内容 |
| --- | --- | --- |
| `child_wish` | 既婚・23〜42歳・3人未満・妊娠中でない | 子どもを考える(ほしい → `trying` / 今はまだ) |
| `pregnancy` | `trying`・45歳まで | 妊娠(月12%、35歳超×0.5、40歳超×さらに0.4、不妊治療中×2.5)。10ヶ月後に出産 |
| `fertility_treatment` | `trying`・32〜45歳 | 不妊治療(50万円・1年は妊娠しやすい / 自然に任せる / あきらめる) |
| `birth`(システム) | `pregnant` が1 | 出産。自分が育休(会社員のとき)/ 配偶者が育休(共働きのとき)/ 取らない |
| `child_sick` | 子どもが0〜8歳 | 子どもの発熱 |
| `rebellion` | 13〜17歳 | 反抗期 |
| `child_exam` | 14〜17歳 | 受験の夏期講習(20万円) |
| `child_wedding` | 26〜35歳 | 子どもの結婚(援助100万円 / お祝い10万円) |
| `grandchild` | 27〜45歳 | 孫が生まれる |

- 条件に `spouseType`(配偶者のタイプ)、`childrenBelow`(人数がこれ未満)、`childAge`(子どもの誰かがこの年齢)、効果に `addChild` を足した
- 確率1のイベント(出産・再雇用の話)は、同じ月にほかのイベントが当たっても先に起こす(前は重み付けで選ばれず、出産が来ないことがありえた)

### 15.4 幸福度とストレス

- 人間関係 +6/人(上限 +12)
- 12歳未満の子1人ごとに自由時間 −8
- 6歳未満の子1人ごとにストレス +0.2/月
- 出産で達成感 +10

### 15.5 バランス(1,000人生、選択肢はランダム)

- 既婚696組のうち、子ども0人 264 / 1人 205 / 2人 143 / 3人 84。1組あたり1.07人。第1子は親が34歳ごろ(自動プレイは「今はまだ」を半分選ぶので、現実の夫婦の約1.9人より少ない)
- 最終資産の中央値: 子ども0人 2,471万円 / 1人 1,185万円 / 2人 775万円 / 3人 551万円。生涯幸福度は 51.7 / 52.2 / 52.3 / 52.6
- 全体: 平均寿命 80.6歳、最終資産の中央値 1,735万円、人生タイプ 24.6% / 22.3% / 13.9% / 39.2%、イベント 86.0回、自己破産 23.6%。目安の6項目はすべて範囲内

## 16. 第2弾: 性別

「初期ガチャで性別もガチャにしてもいいかも」という要望。男女で変えるのは、ユーザーが選んだ3つだけ。**給料の男女差は入れない**(確認済み。どちらの性別を引いても不利にならないように)。

- ガチャ: `CharacterRoll.gender`(`femaleProb` 50%)。過去のシードの結果を変えないよう、ガチャの最後に引く。`character.gender` は古いセーブにはなく、そのときは男女の平均で扱う
- **寿命**: 死亡率に `death.genderMul`(男性 1.4、女性 0.7)を掛ける。1,500人生で平均寿命 男性 78.1歳・女性 83.9歳(差 5.8歳。現実は約6歳)。大病・過労死など年齢によらない死因があるので、係数の比は寿命の差より大きめにしてある
- **配偶者との死別**: 配偶者は本人と同い年の異性とみなし、配偶者の性別の係数で起きる。死別は女性 161件・男性 90件(既婚はどちらも約520人)
- **配偶者の働き方**: `spouse.probByGender`。男性の配偶者は 共働き30%・扶養内パート40%・専業30%、女性の配偶者は 共働き94%・パート4%・専業2%。手取りの額(`spouse.types`)は男女で同じ
- **出産**: 女性本人が出産すると健康 −5(`birthHealth`)。会社員で育休を取らない場合も、産後2ヶ月は産休(`maternityLeave` タイマー、額面月給の67%、ログ `maternity_leave`、職業の表示は「産休中」)。育休を取るなら産休は育休に含める。男性は配偶者が出産する扱いで、健康も産休も変わらない
- 条件 `gender`(本人の性別)を足した(いまは使っていない。性別で分けたいイベント用)
- UI: キャラ作成のガチャ結果と、メイン画面の名前の横に性別

バランス(1,000人生): 平均寿命 80.7歳、激務 −9.8歳、最終資産の中央値 1,951万円、人生タイプ 26.2% / 21.6% / 15.4% / 36.8%、イベント 86.2回。目安の6項目はすべて範囲内

## 17. 第2弾: NISAと特定口座

「NISAと特定口座」を第2弾として進める、というユーザーの決定から(売ったときの税金は変更21では「かけない」と決めていたが、ここで口座を分けた)。数字は `balance.json` の `nisa`(2024年からの新NISA)。

### 17.1 状態(`src/engine/nisa.ts`)

- `assets.index` / `assets.stocks` は2つの口座の**合計**のまま。NISAの分は `state.nisa.frac`(時価に占める割合)で持つ。値上がり・暴落・離婚の財産分与は口座によらず同じ割合で効くので、割合は変わらない。割合が変わるのは買うときと売るときだけで、どちらも `nisa.ts` の関数を通す。合計を残したので、純資産・グラフ・イベントの資産ショックなどは今までどおり動く
- `nisa.principal`: NISAの元本(簿価)。生涯の枠はこれで数え、売った元本の分だけ空く
- `nisa.year`: 今年使ったつみたて枠・成長投資枠。暦の1月(`calendarMonthOf === 1`)に0に戻る
- 特定口座の元本 = `invested[key]` − `nisa.principal[key]`。利益 = 売った額 − 売った割合ぶんの元本(平均取得単価)
- 古いセーブは `nisa` がなく、全部特定口座として扱う。`invested` もない古いセーブは元本がわからないので税金をかけない

### 17.2 買う・売る

| 操作 | 関数 | 口座 |
| --- | --- | --- |
| 毎月の積立(方針の配分) | `buyInvestment` | NISAの枠から先に。積立はつみたて枠(120万)→ 成長投資枠(240万)、個別株は成長投資枠だけ。生涯1,800万円(個別株は1,200万円)。信用・仮想通貨は特定口座だけ |
| 預金でまとめて買う | `buyAsset(state, key, amount)` | 同上。ログ `buy`「購入: 預金で積立を300万円買った(うちNISA 260万円)」 |
| 手で売る | `sellAsset(state, key, amount, from)` | `from`: `auto` 特定口座から先に / `taxable` 特定口座だけ / `nisa` NISAだけ。ログ `sell`「売却: 積立を130万円売って預金にした(損益 +30万円・税金 6万円)」 |
| 資金ショート | `sellForCash` | 特定口座から先に。税金のぶん多めに売り(利益の割合から逆算)、足りなければNISAから |

- 税金: 特定口座の利益 × `taxRate`(20.315%)。損のときは0(損益通算・繰越控除は入れていない)。信用取引・仮想通貨も同じ税率(実際の仮想通貨は雑所得で累進課税だが、簡単のため)
- 税金は年間の収支(`YearLedger.investTax`)に「投資の利益にかかる税金」として出す
- 簡単にしたところ: 積立が成長投資枠を使った分は、個別株の生涯1,200万円の枠に数えない

### 17.3 UI

- 資産の画面: 積立・個別株の残高の下に「うちNISA」、表の下に投資ごとの「売る」「買う」、NISAの残りの枠(今年の積立・個別株、生涯)
- 売る欄: NISAと特定口座の両方にあるときは、どちらから売るかを選べる。税金の注意を出す
- 買う欄: 今年のNISAの残り枠と、超えた分は特定口座になることを出す

### 17.4 バランス

1,000人生 × 2(シード1・2): 平均寿命 80.8 / 79.4歳、最終資産の中央値 1,928 / 1,820万円(NISAを入れる前は 1,951万円)、人生タイプ 25.9% / 21.5% / 15.4% / 37.2%、イベント 86.2回。目安の6項目はすべて範囲内。ふつうの人はほとんどNISAの枠に収まるので、税金の影響は小さい

## 18. 第2弾: 起業(社長)

最初に「社長にはどうやったらなれる?」と聞かれたときは第2弾に回し、ここで作った。数字は `balance.json` の `business`。

### 18.1 状態と収入(`src/engine/business.ts`)

- 職業 `owner`(社長)。`jobs.json` には置かず `ownerJob()` で作る(ガチャで社長は引かない)。厚生年金あり、ボーナス・退職金・リストラなし
- `state.business = { since, scale, level }`。役員報酬(月・額面)= `salaryBase[scale]` × `level`(10万〜300万円)。小さく30万円・大きく50万円。年収は役員報酬 × 12(働き方の係数は掛けない。働き方は決算の伸びに効く)
- 自営業なので失業給付はない。社長を辞める(燃え尽きで辞める・廃業・売却)と会社はなくなり、無職に戻る。再就職の「前職」は起業前の会社員の仕事

### 18.2 決算と廃業

- 起業した月から12ヶ月ごとに決算: `level *= exp(g)`、g ~ N(μ, 0.45)。μ = −0.05 + 0.004 ×(スキル − 50)+ 0.003 ×(運 − 50)+ 働き方(定時 −0.1 / 普通 0 / 残業多め +0.05 / 激務 +0.1)+ 不況中 −0.25。ログ `business_review`
- level が 0.35 を下回ったら廃業。整理の費用(小さく100万円・大きく300万円。借入の返済など)を払い、無職に戻る。ログ `business_closed`
- 会社の価値 = `salaryBase` ×(level − 0.8)× 48ヶ月。純資産には入れない(売ったときだけ現金になる)
- 65歳の定年で事業承継: 会社の価値の50%を受け取る(収支では「退職金・事業承継」)。ログ `business_succession`

### 18.3 イベント

| id | 条件 | 内容 |
| --- | --- | --- |
| `startup_chance` | 会社員・25〜55歳(挑戦志向×2、スキル60超×1.5) | 小さく起業(300万円)/ 大きく起業(1,000万円)/ 続ける。元手が足りなければ自動でローン |
| `big_client` | 社長 | 大口の取引先(業績×1.25) |
| `employee_quit` | 社長 | 社員が辞める(自分で埋める: 業績×0.95・ストレス / 高い給料で雇う: 100万円) |
| `cash_crunch` | 社長(不況中×3) | 資金繰り(貯金を入れる300万円 / 銀行から借りる / 待ってもらう: 40%で業績×0.6) |
| `acquisition_offer` | 社長・業績2.5以上 | 買収の打診(売る: 会社の価値を受け取り無職に / 続ける) |

- 条件に `hasBusiness` `minBusinessLevel`、効果に `startBusiness` `businessLevel` `sellBusiness` を足した
- 会社員向けのイベント(昇進・昇給見送り・転職の誘い・リストラ・ボーナスカット・上司とのトラブル・臨時ボーナス・再雇用)は `jobNotIn: owner`

### 18.4 バランス(2,000人生、選択肢はランダム)

- 起業したのは225人(11%)。廃業 86人(3年以内 53・5年以内 68・10年以内 78。5年でおよそ7割が残る)、売却 41人、事業承継 55人、それ以外(在任中に死亡・自分で辞めた)43人
- 最終資産: 社長経験者は中央値 3,361万円・上位10% 1億8,664万円・下位10% 0円。それ以外は中央値 1,898万円・上位10% 8,980万円(当たり外れが大きい)
- 全体(1,000人生 × 2): 平均寿命 80.2 / 79.9歳、最終資産の中央値 1,714 / 2,059万円、人生タイプ 25.0% / 20.2% / 14.7% / 40.1%、イベント 85.4回。目安の6項目はすべて範囲内
