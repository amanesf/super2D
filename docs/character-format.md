# キャラクターバンドル形式(`character.json`)

設計の正は[`PLAN.md`](../PLAN.md)文末「全体レビューによる設計改訂
(2026-07-22)」節。本書はその節で定めた「共有1024×1024空間+関節座標表+
描画順」ベースのフォーマットを、実装済みのフィールド単位で記述する。
フォーマットを変更したら本書を同時更新すること(CLAUDE.md)。

対象ファイル例: [`characters/placeholder-zero/character.json`](../characters/placeholder-zero/character.json)

## 座標系

- **共有キャンバス座標系**: `canvasStandard`で定義される矩形(現行
  1024×1024)。全パーツはin-situ生成(PLAN.md①)により、マスター画像と
  同じ位置・同じスケールでこの空間に乗っている前提
- **パーツのローカル座標系**: 各パーツの`pivot`・`anchors`は、その
  パーツ画像自身の左上を原点(0,0)とするピクセル座標。パーツ画像の
  サイズは`w`×`h`
- **ワールド座標**: ビューアが親子階層を辿って実行時に計算する値
  (後述「実行時状態は含まない」参照)。character.jsonには保存しない

## トップレベルフィールド

| フィールド | 型 | 必須 | 意味 |
|---|---|---|---|
| `format` | string | ○ | 固定値`"super2d-character"`。他形式のJSONとの誤読込を防ぐ識別子 |
| `formatVersion` | number | ○ | フォーマットの破壊的変更ごとに増やす整数。現行`1` |
| `_comment` | string | 任意 | 人間向けの自由記述メモ。ローダー・バリデータは無視する |
| `canvasStandard` | `[w, h]` | ○ | 全パーツが共有する基準キャンバスの幅・高さ(px)。in-situ生成の前提サイズ |
| `rootAnchor` | `[x, y]` | ○ | `parent`が`null`のパーツ(ルート、通常は`torso`)を配置する、ビューア画面上の基準点(px)。ワールド座標計算の起点 |
| `parts` | object | ○ | パーツ名→パーツ定義(後述)のマップ |
| `drawOrder` | string[] | ○ | 描画順(背面から前面へ)。`parts`の全キーをちょうど1回ずつ含む。未知のパーツ名を含んではならない |

## `parts.<name>` フィールド

| フィールド | 型 | 必須 | 意味 |
|---|---|---|---|
| `src` | string | `states`が無い場合は○ | `character.json`からの相対パスの画像ファイル(パーツ全体で1枚固定の場合) |
| `w`, `h` | number | ○ | パーツ画像の幅・高さ(px)。`pivot`・`anchors`・`states.*`の全画像がこのサイズで揃っている前提 |
| `parent` | string \| null | ○ | 親パーツ名。`null`ならルート(`rootAnchor`に直接配置) |
| `parentAnchor` | string | `parent`が`null`でなければ○ | 親の`anchors`のキー名。子の`pivot`をこの点に一致させて配置する |
| `pivot` | `[x, y]` | ○ | パーツのローカル座標系における回転・配置の基準点(px) |
| `anchors` | object | 任意 | このパーツに子パーツを接続するための命名点のマップ(`{名前: [x, y]}`、ローカル座標)。子を持たないパーツには無い |
| `motion` | string | ○ | ビューアがこのパーツをどう動かすかを選ぶ種別タグ。現行の値: `procedural-breathe`(呼吸)/`procedural-sway`(首振り追従)/`procedural-mesh-sway`(遅延揺れ)/`procedural-mesh-bend`(関節曲げ、現状は剛体近似)/`discrete-crossfade`(状態切替)/`static-cutout`(無変形)。**値の一覧は本書が正**であり、ビューア実装(`js/viewer.js`)側でパーツ名を直書きした分岐をしないことがB2の受け入れ条件 |
| `states` | object | `src`が無い場合は○ | 状態名→`{src}`のマップ。`src`を持つ状態のみがビューア上で選択可能(UIボタン化の対象、B3参照)。`src`の無い状態(例: 現行のプレースホルダーにおける`arm_upper_r.states.raised`)は「将来ここに画像が入る」という予約枠であり、ビューアはボタンを出さない |
| `defaultState` | string | `states`がある場合は○ | 読込直後・リセット時に選ばれる状態名。`states`のキーに存在すること |
| `drawOrderHint` | number | 任意 | **authoring時のみ使う値**。`scripts/make_placeholder_parts.js`が`drawOrder`配列を機械生成する際のソートキー。ビューアは実行時にこのフィールドを読まない(読むのは常にトップレベルの`drawOrder`) |
| `symmetry` | string | 任意 | 人間・生成パイプライン向けの注記(例: `"asymmetric"` = 左右非対称なので鏡像複製不可)。ビューアは読まない |
| `note` | string | 任意 | 人間向けの自由記述(例: 「肘のメッシュ曲げ点デモ、プロトタイプは剛体2分割」)。ビューアは読まない |

## 実行時状態は含まない(境界)

`character.json`は**静的なリグ形状と見た目のバリエーション**だけを持つ。
以下はビューアが実行時に`js/viewer.js`内のメモリ上(`state`オブジェクト)
でのみ保持し、character.jsonには一切書かれない:

- 現在の回転角度・オフセット・スケール(`state[name].angle` /
  `offsetX` / `offsetY` / `scaleX` / `scaleY`)。呼吸・揺れ・首振りは
  毎フレームこれらを計算し直す
- 現在選択中のstate(`state[name].currentState`。例: まばたきで
  `eye_l`が今`open`か`closed`か)。`defaultState`は初期値の指定に
  過ぎず、実行中の選択状態はcharacter.jsonと同期しない
- アニメーションの時刻・まばたきのタイマー等、ビューア内部のみで
  完結する変数

したがって「character.jsonを書き出す」(B3)は、ロード時点の静的定義を
そのまま保存するものであり、実行中のポーズ・表情のスナップショットには
ならない。

## 予約(将来追加予定、現時点の実ファイルには存在しない)

- **`parts.<name>.motionParams`(B2で追加予定)**: 揺れの振幅・周波数・
  減衰・追従遅れなど、現在`js/viewer.js`にハードコードされている数値を
  パーツごとにcharacter.json側へ移す。追加後は`motion`種別ごとに
  読むべきサブフィールドを本書に追記する
- **`generation_log`参照(D5で追加予定)**: studio.htmlでの生成時に
  記録される`generation_log.json`(時刻・モデル名・プロンプト版・入力
  ハッシュ・QC数値・採否)への参照。バンドル(ZIP)に同梱される想定で、
  character.json自体にログ本体は埋め込まない見込み(詳細はD5着手時に
  本書へ確定させる)

## バリデータとの関係

`js/validate.js`(`S2D.validateCharacter`、A3)は本書の必須フィールド・
参照整合(`parent`が存在するパーツ名か/`parentAnchor`が親の`anchors`に
在るか/`drawOrder`が全パーツを過不足なく網羅するか/`states`の各エントリに
`src`が有るか)を検査する。本書とバリデータの検査項目は一致させる。
