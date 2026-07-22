#!/usr/bin/env node
/**
 * 関節位置に印(丸)を描いたガイド画像を作る。生成前にGeminiへ
 * 「ここに関節を置け」と指定するためのテンプレ画像(事後検出ではなく
 * 事前指定)。
 *
 * 座標の出どころは2通り:
 * 1. prompts/joint_detection_master_v1.txtの検出結果(ピクセル座標の
 *    JSON)を渡す(推奨。実測値なので正確)
 * 2. 何も渡さなければ PLAN.md の pivots_normalized 相当の仮値を使う
 *    (未検証の推測値。目視で大きくズレることを確認済み、暫定利用のみ)
 *
 * 使い方:
 *   node scripts/make_joint_guide.js <base.png> <out.png> [joints.json]
 */
const fs = require("fs");
const { Jimp, rgbaToInt } = require("jimp");

// フォールバック用の仮値(正規化座標)。実測JSONが無い場合のみ使う。
const FALLBACK_PIVOTS_NORMALIZED = {
  neck: [0.50, 0.30],
  shoulder_r: [0.62, 0.40],
  shoulder_l: [0.38, 0.40],
  elbow_r: [0.68, 0.52],
  elbow_l: [0.32, 0.52],
  wrist_r: [0.66, 0.63],
  wrist_l: [0.34, 0.63],
  hip: [0.50, 0.58],
  knee_r: [0.55, 0.78],
  knee_l: [0.45, 0.78],
  ankle_r: [0.56, 0.94],
  ankle_l: [0.44, 0.94],
};

const MARKER_RADIUS = 8;
const MARKER_COLOR = rgbaToInt(255, 0, 60, 255);

function drawFilledCircle(image, cx, cy, radius, colorInt) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) {
        const px = cx + x;
        const py = cy + y;
        if (px >= 0 && px < w && py >= 0 && py < h) {
          image.setPixelColor(colorInt, px, py);
        }
      }
    }
  }
}

async function makeGuide(basePath, outPath, jointsJsonPath) {
  const image = await Jimp.read(basePath);
  const w = image.bitmap.width;
  const h = image.bitmap.height;

  let pixelCoords = {};
  let source;
  if (jointsJsonPath) {
    const raw = JSON.parse(fs.readFileSync(jointsJsonPath, "utf8"));
    pixelCoords = raw;
    source = `実測値(${jointsJsonPath})`;
  } else {
    for (const [name, [nx, ny]] of Object.entries(FALLBACK_PIVOTS_NORMALIZED)) {
      pixelCoords[name] = [Math.round(nx * w), Math.round(ny * h)];
    }
    source = "フォールバック仮値(未検証、要置き換え)";
  }

  for (const [name, [x, y]] of Object.entries(pixelCoords)) {
    drawFilledCircle(image, x, y, MARKER_RADIUS, MARKER_COLOR);
  }

  await image.write(outPath);
  console.log(`saved ${outPath} (座標の出どころ: ${source})`);
  console.log("markers (pixel coords):", JSON.stringify(pixelCoords, null, 2));
}

if (require.main === module) {
  const [, , basePath, outPath, jointsJsonPath] = process.argv;
  if (!basePath || !outPath) {
    console.error("usage: node make_joint_guide.js <base.png> <out.png> [joints.json]");
    process.exit(1);
  }
  makeGuide(basePath, outPath, jointsJsonPath).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { makeGuide, FALLBACK_PIVOTS_NORMALIZED };
