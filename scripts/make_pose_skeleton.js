#!/usr/bin/env node
/**
 * パーツ分解生成時に添付する「関節ガイド」画像を作る。
 *
 * 役割の切り分け(2026-07-21確定):
 * - マスター生成: 棒人間は使わない/使っても「高さ・中心を示すだけ」の
 *   緩い役割(自由なポーズを妨げない)。
 * - パーツ分解生成(#2・#3): このスクリプトの出番。マスターに対して
 *   joint_detection_master_v1.txt で実測した関節座標(点)+関節を結ぶ
 *   骨(線、角度を伝える)+邪魔にならない位置のラベル文字、を描いた
 *   ガイド画像を作り、パーツ生成時に元画像・テンプレ画像と並べて添付
 *   する。当てずっぽうの座標ではなく実測値を使うのが前提。
 *
 * 使い方:
 *   node scripts/make_pose_skeleton.js <out.png> [joints.json]
 *   joints.json省略時はフォールバック仮値を使う(未検証、暫定確認用)。
 *
 * 【状態 2026-07-22】in-situ生成への転換(PLAN.md「全体レビューによる
 * 設計改訂」)により、パーツ生成時の関節ガイドという役割は見直し対象。
 * 使うかどうかはStage Dのプロンプト設計時に判断する(勝手に廃止しない)。
 * ラベル文字の描画はjimp v1のフォントAPI対応が未完のため未実装
 * (点と骨線のみ出力する。黙って失敗はしない)。
 */
const fs = require("fs");
const { Jimp, rgbaToInt } = require("jimp");

const CANVAS_W = 1024;
const CANVAS_H = 1024;

// フォールバック用の仮値(正規化座標)。実測JSONが無い場合のみ使う。
const FALLBACK_JOINTS_NORMALIZED = {
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

// 骨(線)の接続定義。どの関節とどの関節を結ぶか(角度を伝えるため)。
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

async function makeGuide(outPath, jointsJsonPath) {
  const image = new Jimp({ width: CANVAS_W, height: CANVAS_H, color: 0xffffffff });

  let pixelCoords = {};
  let source;
  if (jointsJsonPath) {
    const raw = JSON.parse(fs.readFileSync(jointsJsonPath, "utf8"));
    // joint_detection_master_v1.txt の出力はそのままピクセル座標なので直接使う
    pixelCoords = raw;
    source = `実測値(${jointsJsonPath})`;
  } else {
    for (const [name, [nx, ny]] of Object.entries(FALLBACK_JOINTS_NORMALIZED)) {
      pixelCoords[name] = [Math.round(nx * CANVAS_W), Math.round(ny * CANVAS_H)];
    }
    source = "フォールバック仮値(未検証、暫定確認用のみ)";
  }

  for (const [a, b] of BONES) {
    if (!pixelCoords[a] || !pixelCoords[b]) continue;
    const [x0, y0] = pixelCoords[a];
    const [x1, y1] = pixelCoords[b];
    drawThickLine(image, x0, y0, x1, y1, LINE_WIDTH, LINE_COLOR);
  }

  // ラベル文字は未実装(jimp v1のフォントAPI対応が未完)。黙って失敗
  // させず、未実装であることを明示して点と骨線のみ出力する。
  for (const [x, y] of Object.values(pixelCoords)) {
    drawFilledCircle(image, x, y, JOINT_RADIUS, JOINT_COLOR);
  }

  await image.write(outPath);
  console.log(`saved ${outPath} (座標の出どころ: ${source}, ラベル: 未実装のためなし)`);
}

if (require.main === module) {
  const [, , outPath, jointsJsonPath] = process.argv;
  if (!outPath) {
    console.error("usage: node make_pose_skeleton.js <out.png> [joints.json]");
    process.exit(1);
  }
  makeGuide(outPath, jointsJsonPath).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { makeGuide, FALLBACK_JOINTS_NORMALIZED, BONES };
