#!/usr/bin/env node
/**
 * 「この骨格・関節位置に合わせて描け」と指定するための棒人間テンプレート
 * を生成する。座標は自分たちで決め打ちするので、検出は不要になる
 * (マスター生成後にこの座標がそのままpivots_normalizedの実値になる)。
 *
 * 使い方: node scripts/make_pose_skeleton.js <out.png>
 */
const { Jimp, rgbaToInt } = require("jimp");

const CANVAS_W = 1024;
const CANVAS_H = 1024;

// 標準ポーズ(正面直立・肩幅程度に脚を開く・腕は体から離して自然に
// 下げる)の関節位置。normalize_reference.jsの基準(キャラクター高さ
// 896px、y方向オフセット64px、つまり正規化y=0.0625〜0.9375)に合わせた
// 見積もり。マスター生成後に実際の絵とズレていたら座標を調整する前提の
// 初版。
const JOINTS_NORMALIZED = {
  head_top: [0.50, 0.065],
  neck: [0.50, 0.16],
  shoulder_r: [0.62, 0.19],
  shoulder_l: [0.38, 0.19],
  elbow_r: [0.66, 0.32],
  elbow_l: [0.34, 0.32],
  wrist_r: [0.64, 0.45],
  wrist_l: [0.36, 0.45],
  hip_r: [0.56, 0.50],
  hip_l: [0.44, 0.50],
  knee_r: [0.54, 0.70],
  knee_l: [0.46, 0.70],
  ankle_r: [0.53, 0.90],
  ankle_l: [0.47, 0.90],
};

// 骨(線)の接続定義。どの関節とどの関節を結ぶか。
const BONES = [
  ["head_top", "neck"],
  ["neck", "shoulder_r"], ["neck", "shoulder_l"],
  ["shoulder_r", "elbow_r"], ["elbow_r", "wrist_r"],
  ["shoulder_l", "elbow_l"], ["elbow_l", "wrist_l"],
  ["neck", "hip_r"], ["neck", "hip_l"], ["hip_r", "hip_l"],
  ["hip_r", "knee_r"], ["knee_r", "ankle_r"],
  ["hip_l", "knee_l"], ["knee_l", "ankle_l"],
];

const LINE_COLOR = rgbaToInt(40, 120, 255, 255);
const JOINT_COLOR = rgbaToInt(255, 0, 60, 255);
const JOINT_RADIUS = 9;
const LINE_WIDTH = 4;

function toPixel(name) {
  const [nx, ny] = JOINTS_NORMALIZED[name];
  return [Math.round(nx * CANVAS_W), Math.round(ny * CANVAS_H)];
}

function drawFilledCircle(image, cx, cy, radius, colorInt) {
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if (x * x + y * y <= radius * radius) {
        const px = cx + x;
        const py = cy + y;
        if (px >= 0 && px < CANVAS_W && py >= 0 && py < CANVAS_H) {
          image.setPixelColor(colorInt, px, py);
        }
      }
    }
  }
}

function drawThickLine(image, x0, y0, x1, y1, width, colorInt) {
  const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1) * 2;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const cx = Math.round(x0 + (x1 - x0) * t);
    const cy = Math.round(y0 + (y1 - y0) * t);
    drawFilledCircle(image, cx, cy, Math.round(width / 2), colorInt);
  }
}

async function makeSkeleton(outPath) {
  const image = new Jimp({ width: CANVAS_W, height: CANVAS_H, color: 0xffffffff });

  for (const [a, b] of BONES) {
    const [x0, y0] = toPixel(a);
    const [x1, y1] = toPixel(b);
    drawThickLine(image, x0, y0, x1, y1, LINE_WIDTH, LINE_COLOR);
  }
  const placed = {};
  for (const name of Object.keys(JOINTS_NORMALIZED)) {
    const [x, y] = toPixel(name);
    drawFilledCircle(image, x, y, JOINT_RADIUS, JOINT_COLOR);
    placed[name] = [x, y];
  }

  await image.write(outPath);
  console.log(`saved ${outPath}`);
  console.log("joint pixel coords:", JSON.stringify(placed, null, 2));
}

if (require.main === module) {
  const [, , outPath] = process.argv;
  if (!outPath) {
    console.error("usage: node make_pose_skeleton.js <out.png>");
    process.exit(1);
  }
  makeSkeleton(outPath).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { makeSkeleton, JOINTS_NORMALIZED, BONES };
