# super2D

VTuber風パーツパペットエンジンの実装リポジトリ。

研究・検討の前身は [`amanesf/new2D3D`](https://github.com/amanesf/new2D3D)。
現行方針・設計は [`PLAN.md`](./PLAN.md) を参照。

## このリポジトリの位置づけ

`new2D3D` は試行錯誤(スパイク検証・却下案・改訂履歴)を含む研究リポジトリ。
`super2D` は `new2D3D` で確定した最新方針(パーツ生成をGemini 3.1 Flash
Image Preview / Nano Banana 2 ベースに切り替える案、`SUPER_LIVE2D_V3_PLAN.md`
§6.5)を実施の起点とする実装リポジトリとして開始した。

現時点では計画・設計のみを配置している(実装コードは未着手)。パーツ生成には
Gemini APIキーと実費(見積もり約$4)が必要なため、キー提供後に着手する。
