#!/usr/bin/env node
/**
 * 仮パーツ画像(円・四角の組み合わせ)一式と、階層構造(親子関係・
 * ローカルピボット)を持つマニフェストを生成する。
 *
 * 目的: Geminiでの実画像生成を待たずに、リグ・アニメーション(ビューア)
 * 側の実装とワークフローを先に動かして検証するため。パーツ画像は
 * 差し替え前提のプレースホルダー。
 *
 * 各パーツは独立した透過PNG(実際にGeminiが返す切り抜き画像を模した
 * もの)で、パーツ自身のローカル座標系でピボット・アンカー点を持つ。
 * 親パーツのアンカー点(ローカル座標)に、子パーツのピボットを合わせて
 * 配置する、という一般的な2Dスケルタルアニメーションの階層構造。
 *
 * 使い方: node scripts/make_placeholder_parts.js
 */
const path = require("path");
const fs = require("fs");
const { Jimp, rgbaToInt } = require("jimp");

const OUT_DIR = path.join(__dirname, "..", "assets", "placeholder");
const MANIFEST_PATH = path.join(__dirname, "..", "assets", "manifest.json");

const COLORS = {
  skin: rgbaToInt(255, 224, 200, 255),
  hair: rgbaToInt(210, 210, 220, 255),
  hairAccent: rgbaToInt(150, 220, 180, 255),
  outfit: rgbaToInt(235, 240, 245, 255),
  outfitAccent: rgbaToInt(120, 200, 190, 255),
  cape: rgbaToInt(225, 232, 238, 200),
  eyeOpen: rgbaToInt(90, 180, 150, 255),
  eyeClosed: rgbaToInt(60, 60, 70, 255),
  mouth: rgbaToInt(180, 90, 100, 255),
  outline: rgbaToInt(60, 60, 70, 255),
};

function newCanvas(w, h) {
  return new Jimp({ width: w, height: h, color: 0x00000000 });
}

function fillRect(image, x, y, w, h, colorInt, radius = 0) {
  for (let py = y; py < y + h; py++) {
    for (let px = x; px < x + w; px++) {
      if (px < 0 || py < 0 || px >= image.bitmap.width || py >= image.bitmap.height) continue;
      if (radius > 0) {
        const cornerX = px < x + radius ? x + radius : px > x + w - radius ? x + w - radius : px;
        const cornerY = py < y + radius ? y + radius : py > y + h - radius ? y + h - radius : py;
        const dx = px - cornerX;
        const dy = py - cornerY;
        if (dx * dx + dy * dy > radius * radius) continue;
      }
      image.setPixelColor(colorInt, px, py);
    }
  }
}

function fillCircle(image, cx, cy, r, colorInt) {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      if (x * x + y * y <= r * r) {
        const px = cx + x, py = cy + y;
        if (px >= 0 && py >= 0 && px < image.bitmap.width && py < image.bitmap.height) {
          image.setPixelColor(colorInt, px, py);
        }
      }
    }
  }
}

function fillEllipse(image, cx, cy, rx, ry, colorInt) {
  for (let y = -ry; y <= ry; y++) {
    for (let x = -rx; x <= rx; x++) {
      if ((x * x) / (rx * rx) + (y * y) / (ry * ry) <= 1) {
        const px = cx + x, py = cy + y;
        if (px >= 0 && py >= 0 && px < image.bitmap.width && py < image.bitmap.height) {
          image.setPixelColor(colorInt, px, py);
        }
      }
    }
  }
}

async function save(image, name) {
  const p = path.join(OUT_DIR, `${name}.png`);
  await image.write(p);
  return `assets/placeholder/${name}.png`;
}

async function build() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const parts = {};

  // --- torso -------------------------------------------------------
  {
    const w = 180, h = 240;
    const im = newCanvas(w, h);
    fillRect(im, 15, 5, w - 30, h - 15, COLORS.outfit, 30);
    fillRect(im, 25, 90, w - 50, 30, COLORS.outfitAccent, 8);
    const src = await save(im, "torso");
    parts.torso = {
      src, w, h,
      parent: null,
      pivot: [90, 232],
      anchors: {
        neck: [90, 12], shoulder_r: [158, 35], shoulder_l: [22, 35],
        hip_r: [118, 225], hip_l: [62, 225], cape_root: [90, 220],
      },
      motion: "procedural-breathe",
      drawOrderHint: 10,
    };
  }

  // --- head_base -----------------------------------------------------
  {
    const w = 170, h = 170;
    const im = newCanvas(w, h);
    fillCircle(im, 85, 90, 72, COLORS.skin);
    const src = await save(im, "head_base");
    parts.head_base = {
      src, w, h,
      parent: "torso", parentAnchor: "neck",
      pivot: [85, 155],
      anchors: {
        hair_front_root: [85, 25], hair_side_l_root: [20, 75],
        hair_side_r_root: [150, 75], hair_back_root: [40, 60],
        eye_l: [58, 88], eye_r: [112, 88], mouth: [85, 118],
      },
      motion: "procedural-sway",
      drawOrderHint: 30,
    };
  }

  // --- hair_back (ponytail) ------------------------------------------
  {
    const w = 90, h = 280;
    const im = newCanvas(w, h);
    fillEllipse(im, 45, 30, 40, 30, COLORS.hair);
    fillRect(im, 15, 40, 40, 200, COLORS.hair, 20);
    fillRect(im, 15, 200, 30, 70, COLORS.hairAccent, 15);
    const src = await save(im, "hair_back");
    parts.hair_back = {
      src, w, h,
      parent: "head_base", parentAnchor: "hair_back_root",
      pivot: [45, 20],
      motion: "procedural-mesh-sway",
      symmetry: "asymmetric",
      drawOrderHint: 5,
    };
  }

  // --- hair_front ------------------------------------------------------
  {
    const w = 110, h = 55;
    const im = newCanvas(w, h);
    fillRect(im, 5, 5, w - 10, h - 15, COLORS.hair, 18);
    const src = await save(im, "hair_front");
    parts.hair_front = {
      src, w, h,
      parent: "head_base", parentAnchor: "hair_front_root",
      pivot: [55, 45],
      motion: "procedural-mesh-sway",
      drawOrderHint: 40,
    };
  }

  // --- hair_side_l / hair_side_r ---------------------------------------
  for (const side of ["l", "r"]) {
    const w = 34, h = 140;
    const im = newCanvas(w, h);
    fillRect(im, 6, 0, w - 12, h - 20, COLORS.hair, 14);
    const src = await save(im, `hair_side_${side}`);
    parts[`hair_side_${side}`] = {
      src, w, h,
      parent: "head_base", parentAnchor: `hair_side_${side}_root`,
      pivot: [17, 12],
      motion: "procedural-mesh-sway",
      drawOrderHint: 35,
    };
  }

  // --- eyes (open/closed for blink) -------------------------------------
  for (const side of ["l", "r"]) {
    const w = 34, h = 34;
    const open = newCanvas(w, h);
    fillCircle(open, 17, 17, 13, COLORS.eyeOpen);
    fillCircle(open, 17, 17, 5, COLORS.outline);
    const closed = newCanvas(w, h);
    fillRect(closed, 5, 15, 24, 4, COLORS.eyeClosed, 2);
    const srcOpen = await save(open, `eye_${side}_open`);
    const srcClosed = await save(closed, `eye_${side}_closed`);
    parts[`eye_${side}`] = {
      w, h,
      parent: "head_base", parentAnchor: `eye_${side}`,
      pivot: [17, 17],
      motion: "discrete-crossfade",
      states: { open: { src: srcOpen }, closed: { src: srcClosed } },
      defaultState: "open",
      drawOrderHint: 50,
    };
  }

  // --- mouth (closed/open for viseme demo) ------------------------------
  {
    const w = 46, h = 26;
    const closed = newCanvas(w, h);
    fillRect(closed, 8, 12, 30, 4, COLORS.mouth, 2);
    const open = newCanvas(w, h);
    fillEllipse(open, 23, 14, 14, 9, COLORS.mouth);
    const srcClosed = await save(closed, "mouth_closed");
    const srcOpen = await save(open, "mouth_open");
    parts.mouth = {
      w, h,
      parent: "head_base", parentAnchor: "mouth",
      pivot: [23, 13],
      motion: "discrete-crossfade",
      states: { rest: { src: srcClosed }, aa: { src: srcOpen } },
      defaultState: "rest",
      drawOrderHint: 51,
    };
  }

  // --- cape ------------------------------------------------------------
  {
    const w = 160, h = 220;
    const im = newCanvas(w, h);
    fillRect(im, 10, 0, w - 20, h - 10, COLORS.cape, 10);
    const src = await save(im, "cape");
    parts.cape = {
      src, w, h,
      parent: "torso", parentAnchor: "cape_root",
      pivot: [80, 10],
      motion: "procedural-mesh-sway",
      drawOrderHint: 8,
    };
  }

  // --- arms (upper + lower, jointed at elbow) ---------------------------
  for (const side of ["r", "l"]) {
    const uw = 54, uh = 140;
    const upper = newCanvas(uw, uh);
    fillRect(upper, 12, 0, uw - 24, uh - 10, COLORS.outfit, 18);
    const srcUpper = await save(upper, `arm_upper_${side}`);
    parts[`arm_upper_${side}`] = {
      src: srcUpper, w: uw, h: uh,
      parent: "torso", parentAnchor: `shoulder_${side}`,
      pivot: [27, 10],
      anchors: { elbow: [27, 130] },
      motion: "discrete-crossfade",
      states: { rest: {}, raised: {}, forward: {}, back: {} },
      defaultState: "rest",
      drawOrderHint: side === "r" ? 20 : 42,
    };

    const lw = 48, lh = 130;
    const lower = newCanvas(lw, lh);
    fillRect(lower, 10, 0, lw - 20, lh - 20, COLORS.outfitAccent, 16);
    const srcLower = await save(lower, `arm_lower_${side}`);
    parts[`arm_lower_${side}`] = {
      src: srcLower, w: lw, h: lh,
      parent: `arm_upper_${side}`, parentAnchor: "elbow",
      pivot: [24, 10],
      anchors: { wrist: [24, 120] },
      motion: "procedural-mesh-bend",
      note: "肘のメッシュ曲げ点デモ(プロトタイプは剛体2分割で簡易表現)",
      drawOrderHint: side === "r" ? 21 : 43,
    };

    const hw = 38, hh = 38;
    const hand = newCanvas(hw, hh);
    fillCircle(hand, 19, 19, 16, COLORS.skin);
    const srcHand = await save(hand, `hand_${side}`);
    parts[`hand_${side}`] = {
      src: srcHand, w: hw, h: hh,
      parent: `arm_lower_${side}`, parentAnchor: "wrist",
      pivot: [19, 10],
      motion: "discrete-crossfade",
      states: { open: {}, fist: {}, point: {}, mic: {} },
      defaultState: "open",
      drawOrderHint: side === "r" ? 22 : 44,
    };
  }

  // --- legs (upper + lower, jointed at knee) -----------------------------
  for (const side of ["r", "l"]) {
    const uw = 58, uh = 150;
    const upper = newCanvas(uw, uh);
    fillRect(upper, 10, 0, uw - 20, uh - 10, COLORS.outfitAccent, 16);
    const srcUpper = await save(upper, `leg_upper_${side}`);
    parts[`leg_upper_${side}`] = {
      src: srcUpper, w: uw, h: uh,
      parent: "torso", parentAnchor: `hip_${side}`,
      pivot: [29, 8],
      anchors: { knee: [29, 140] },
      motion: "static-cutout",
      drawOrderHint: side === "r" ? 12 : 14,
    };

    const lw = 52, lh = 160;
    const lower = newCanvas(lw, lh);
    fillRect(lower, 8, 0, lw - 16, lh - 15, COLORS.outfit, 14);
    fillRect(lower, 6, lh - 24, lw - 12, 22, COLORS.outline, 6);
    const srcLower = await save(lower, `leg_lower_${side}`);
    parts[`leg_lower_${side}`] = {
      src: srcLower, w: lw, h: lh,
      parent: `leg_upper_${side}`, parentAnchor: "knee",
      pivot: [26, 8],
      motion: "procedural-mesh-bend",
      note: "膝のメッシュ曲げ点デモ(プロトタイプは剛体2分割で簡易表現)",
      drawOrderHint: side === "r" ? 13 : 15,
    };
  }

  const manifest = {
    _comment: "円・四角のプレースホルダーで組んだ試作マニフェスト。実画像に差し替え前提。座標はこのプレースホルダー生成スクリプトが自分で決めた値(検出不要、既知)。",
    canvasStandard: [1024, 1024],
    rootAnchor: [300, 420],
    parts,
    drawOrder: Object.entries(parts)
      .sort((a, b) => (a[1].drawOrderHint || 0) - (b[1].drawOrderHint || 0))
      .map(([name]) => name),
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2));
  console.log(`wrote ${Object.keys(parts).length} parts, manifest at ${MANIFEST_PATH}`);
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
