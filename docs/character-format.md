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
| `motion` | string | ○ | ビューアがこのパーツをどう動かすかを選ぶ種別タグ。現行の値: `procedural-breathe`(呼吸)/`procedural-sway`(首振り追従)/`procedural-mesh-sway`(遅延揺れ)/`procedural-mesh-bend`(関節メッシュ変形、頂点スキニングで親パーツとの継ぎ目を無くす。C2.5)/`discrete-crossfade`(状態切替、旧→新テクスチャを短時間アルファブレンドする。C3、後述)/`static-cutout`(無変形)/`sprite-select`(全身1枚スプライト切替、後述)。**値の一覧は本書が正**であり、ビューア実装(`js/viewer.js`)側でパーツ名を直書きした分岐をしないことがB2の受け入れ条件 |
| `states` | object | `src`が無い場合は○ | 状態名→`{src}`(または`{isRig: true}`、後述)のマップ。`src`を持つ状態のみがビューア上で選択可能(UIボタン化の対象、B3参照)。`src`の無い状態(例: 現行のプレースホルダーにおける`arm_upper_r.states.raised`)は「将来ここに画像が入る」という予約枠であり、ビューアはボタンを出さない。ただし`isRig: true`の状態(後述)は例外でボタン化される |
| `motionParams` | object | 任意(`motion`が数値駆動の種別なら実質必須) | 揺れの振幅・周波数・追従比率など、`motion`種別ごとの数値パラメータ(後述)。ビューアはこの数値だけを読んで挙動を決め、パーツ名をコードに直書きしない(B2) |
| `defaultState` | string | `states`がある場合は○ | 読込直後・リセット時に選ばれる状態名。`states`のキーに存在すること |
| `drawOrderHint` | number | 任意 | **authoring時のみ使う値**。`scripts/make_placeholder_parts.js`が`drawOrder`配列を機械生成する際のソートキー。ビューアは実行時にこのフィールドを読まない(読むのは常にトップレベルの`drawOrder`) |
| `symmetry` | string | 任意 | 人間・生成パイプライン向けの注記(例: `"asymmetric"` = 左右非対称なので鏡像複製不可)。ビューアは読まない |
| `note` | string | 任意 | 人間向けの自由記述(例: 「肘の関節メッシュ変形、頂点スキニングでarm_upperとの継ぎ目を無くす」)。ビューアは読まない |

### `motionParams`のサブフィールド(`motion`種別ごと)

`motion`の値に応じて、ビューア(`js/viewer.js`の`resolveIdleAngles()`)が
読むサブフィールドが決まる。未指定のフィールドは既定値(角度0・振幅0・
周波数1Hz)として扱われる。

| `motion`の値 | `motionParams`のサブフィールド |
|---|---|
| `procedural-breathe` | `freqHz`(周波数)/ `ampScaleX`・`ampScaleY`(`scaleX`・`scaleY`の脈動振幅、1.0からの相対値) |
| `procedural-sway` | `freqHz` / `ampRad`(回転角の振幅、ラジアン) |
| `procedural-mesh-sway` | `freqHz` / `phase`(位相、ラジアン) / `ampRad` / `followRatio`(親パーツの`angle`にこの比率を掛けて自分の角度に加算する追従係数。`parent`が無ければ無視) |
| `procedural-mesh-bend` | 主駆動の角度は無し(角度自体は`idleSway`や手振りデモ等、他の仕組みで設定される)。`blendMarginPx`(後述、関節メッシュの継ぎ目ぼかし幅) |
| `discrete-crossfade` / `static-cutout` | 上記の主駆動は無し(角度は0のまま)。ただし後述の`idleSway`は共通して使える |

**`idleSway`(任意、どの`motion`にも追加できる補助揺れ)**: `{ freqHz, phase, ampRad }`。
主駆動の角度(上表)に加算される。腕のように「状態切替(`discrete-crossfade`)
はするが、待機中は僅かに揺れてほしい」パーツに使う(現行の
`arm_upper_r`/`arm_upper_l`/`arm_lower_r`/`arm_lower_l`)

**`hairLag`(任意、どの`motion`にも追加できる房内変形、C4)**:
`{ blendMarginPx, lagRate }`。指定すると、そのパーツは`pivot`付近(根元)が
現在の角度にそのまま追従し、`pivot`から`blendMarginPx`以上離れた部分
(毛先)は`lagRate`(1/秒、大きいほど遅れが小さい)の1次遅れフィルタで
遅延した角度に向かう(`js/viewer.js`の`updateHairLag()`)。`procedural-mesh-bend`
と同じ`buildBendMesh()`/`drawBendMesh()`を再利用しているが、
`angleBase`(pivot付近)/`angleFull`(遠方)の意味が逆になる点に注意
(関節メッシュは遠方が「自身の角度」、髪の房は遠方が「遅延角度」)。
左右対称のパーツ(`hair_side_l`/`hair_side_r`)は`freqHz`・`phase`・
`lagRate`をわずかにずらし、左右が同期しないようにする

**`parallax`(任意、どの`motion`にも追加できる頭のパララックス擬似3D、
C5)**: `{ x, y }`(px/rad)。`viewer.html`のyaw/pitchスライダー(±15°)の
値に、このパーツの`x`・`y`係数を掛けた分だけ`offsetX`・`offsetY`(前述の
「実行時状態」)を加算する(`js/viewer.js`の`updateParallax()`)。
スプライト切替やメッシュ変形を伴わない単純なワールド空間オフセットの
ため、`motion`の種類を問わず併用できる。目・口・前髪・サイド髪のように
「頭の向きに応じて少しだけずれて見える」パーツに使う。`offsetX`/
`offsetY`は親の回転の影響を受けない(既存の`computeWorldTransforms()`の
仕様どおり)ため、頭が大きく回転した状態での見た目の一貫性までは
保証しない(±15°程度の小角度を想定)

### `motion: "discrete-crossfade"`(状態切替のクロスフェード、C3)

`states`を持つパーツ(目・口など)の`currentState`が切り替わった瞬間、
旧テクスチャ→新テクスチャへ0.12秒(`js/viewer.js`の`CROSSFADE_DURATION`、
character.jsonでは設定不可の固定値)でアルファブレンドしながら遷移する。
`half`状態の画像を別途用意しなくても、既存の`states.*.src`だけで
「パチッと点滅」ではなく遷移して見えるようにする(まばたきのopen⇄closed・
口パクのviseme間の遷移、いずれもこの仕組みで賄う)。

- 実装は`js/viewer.js`の`updateCrossfades()`(状態変化を検知して
  `fromSrc`/`toSrc`/`startT`を記録)と`draw()`(遷移中は両テクスチャを
  `frac`/`1-frac`の不透明度で重ね描き)
- 遷移が完了する(`(t - startT) >= CROSSFADE_DURATION`)と通常通り
  新テクスチャ1枚のみ描画される

### `motion: "procedural-mesh-bend"`(関節メッシュ変形、C2.5)

`arm_lower_r/l`・`leg_lower_r/l`のように、親パーツ(`arm_upper`/
`leg_upper`)と関節(肘・膝)で繋がるパーツに使う。親と自身が同じ`pivot`
(関節位置)を共有する前提で、そのパーツを**頂点ごとに重み付けした
メッシュ**として描画する(`js/viewer.js`の`buildBendMesh()`/
`drawBendMesh()`、C1で実証した頂点スキニングを実リグに反映したもの)。

- **`blendMarginPx`**(`motionParams`のサブフィールド、数値・px): `pivot`
  からのY距離がこの値以内の頂点は「親のワールド角度(自身の`angle`を
  含まない)」に重み0で揃い、`blendMarginPx`を超えると重み1(従来通り
  自身の`angle`を含めた完全な回転)に達する(間はsmoothstepで補間)。
  未指定または0なら常に重み1、つまり**剛体回転(旧・剛体2分割)と同じ
  見た目**になる(過去バージョンとの互換動作)
- 効果: `pivot`付近(親との境界)が親の向きに滑らかに揃うため、親パーツの
  縁との継ぎ目が目立たない。値が大きいほど広い範囲がなだらかに曲がり、
  小さいほど遠くまで剛体に近い見た目になる
- 実験的な検証は`experiments/c1-renderer-spike/`(同じ頂点スキニングの
  考え方を、独立した2ボーンとして実装したもの)を参照

### `motion: "sprite-select"`(全身1枚スプライト切替、B4)

角度(回転12方向)・アクション(idle/greet/bow等)・ロコモーション
(walk_mid/run_mid/jump×4方向)は、パーツ単位の`states`切替では表現
できない(全身のポーズそのものが変わるため)。これらは専用パーツ
`body_pose`(`motion: "sprite-select"`)の`states`に、カテゴリを問わず
フラットな1階層で持たせる(例: `angle_90`、`greet`、`walk_mid_180`)。

- `body_pose`は`parent: null`・`pivot`はキャンバス中心固定の仮想パーツで、
  通常のリグ階層(親子アンカー接続)には参加しない
- `js/viewer.js`の`draw()`は、`state.body_pose.currentState`が指す
  `states`エントリに`src`があれば**通常のパーツ合成を全部飛ばして
  そのスプライト画像1枚をキャンバス全面に描く**(`drawBodyPoseSprite()`
  が早期リターンする)
- **`states`エントリの`isRig: true`**(`src`を持たない特別な状態、
  `body_pose`の`defaultState`は`"rig"`): 選択すると全身スプライト表示を
  終了し、通常のパーツ合成描画に戻る。`src`が無くても`isRig: true`の
  状態は例外的にB3の状態切替UIでボタン化される(バリデータも
  「未生成」警告の対象から除外する)
- `body_pose`が存在しないcharacter.json(将来、旧形式や別キャラ)では
  この分岐は素通りし、通常のリグ描画のみが行われる

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
