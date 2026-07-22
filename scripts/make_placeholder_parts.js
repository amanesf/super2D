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

const CHARACTER_DIR = path.join(__dirname, "..", "characters", "placeholder-zero");
const OUT_DIR = path.join(CHARACTER_DIR, "public");
const MANIFEST_PATH = path.join(CHARACTER_DIR, "character.json");

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

// カタログ状態(表情・アクション・角度等)を色相で機械的に区別するための
// HSL→RGB変換(円・四角しか使わない前提での「状態ごとに色を変える」手段)。
function hslToRgbInt(h, s, l, a = 255) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbaToInt(
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
    a
  );
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
  return `public/${name}.png`;
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
      motionParams: { freqHz: 1.1, ampScaleX: 0.006, ampScaleY: 0.012 },
    };
  }

  // --- head_base(表情12状態、PLAN.md標準部品カタログの表情core+拡張) -----
  {
    const w = 170, h = 170;
    // 表情(core、6): neutral/happy/angry/sad/relaxed/surprised(VRM標準準拠)
    // 表情(拡張、6): embarrassed/troubled/smug/sleepy/crying/wink
    const EXPRESSIONS = [
      "neutral", "happy", "angry", "sad", "relaxed", "surprised",
      "embarrassed", "troubled", "smug", "sleepy", "crying", "wink",
    ];
    const states = {};
    for (let i = 0; i < EXPRESSIONS.length; i++) {
      const exprName = EXPRESSIONS[i];
      const im = newCanvas(w, h);
      fillCircle(im, 85, 90, 72, COLORS.skin);
      if (exprName !== "neutral") {
        // neutralは素の肌色円のまま、それ以外は色相の異なる眉バーで区別する
        const accent = hslToRgbInt(((i - 1) * 360) / (EXPRESSIONS.length - 1), 0.6, 0.55);
        fillRect(im, 30, 55, 50, 10, accent, 5);
        fillRect(im, 90, 55, 50, 10, accent, 5);
      }
      const src = await save(im, `head_base_${exprName}`);
      states[exprName] = { src };
    }
    parts.head_base = {
      w, h,
      parent: "torso", parentAnchor: "neck",
      pivot: [85, 155],
      anchors: {
        hair_front_root: [85, 25], hair_side_l_root: [20, 75],
        hair_side_r_root: [150, 75], hair_back_root: [40, 60],
        eye_l: [58, 88], eye_r: [112, 88], mouth: [85, 118],
      },
      motion: "procedural-sway",
      states,
      defaultState: "neutral",
      drawOrderHint: 30,
      motionParams: { freqHz: 0.6, ampRad: 0.035 },
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
      motionParams: { followRatio: 0.4, freqHz: 0.4, phase: -0.9, ampRad: 0.09 },
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
      motionParams: { followRatio: 0.6, freqHz: 0.6, phase: -0.4, ampRad: 0.05 },
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
      motionParams: { followRatio: 0.5, freqHz: 0.55, phase: -0.6, ampRad: 0.06 },
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

  // --- mouth(viseme6、PLAN.md標準部品カタログ: rest/aa/ih/ou/ee/oh) -------
  {
    const w = 46, h = 26;
    const cx = 23, cy = 14;
    // [rx, ry]で口の開き方(横幅・縦の開き具合)をviseme別に変える
    const VISEME_SHAPES = {
      rest: null, // 特別扱い(閉じた横線)
      aa: [14, 9],
      ih: [8, 4],
      ou: [7, 8],
      ee: [16, 4],
      oh: [11, 11],
    };
    const states = {};
    for (const [viseme, shape] of Object.entries(VISEME_SHAPES)) {
      const im = newCanvas(w, h);
      if (shape) fillEllipse(im, cx, cy, shape[0], shape[1], COLORS.mouth);
      else fillRect(im, 8, 12, 30, 4, COLORS.mouth, 2);
      const src = await save(im, `mouth_${viseme}`);
      states[viseme] = { src };
    }
    parts.mouth = {
      w, h,
      parent: "head_base", parentAnchor: "mouth",
      pivot: [23, 13],
      motion: "discrete-crossfade",
      states,
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
      motionParams: { followRatio: 0, freqHz: 0.35, phase: -0.3, ampRad: 0.05 },
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
      motionParams: { idleSway: { freqHz: 1.1, phase: side === "r" ? 1.0 : 1.6, ampRad: 0.02 } },
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
      note: "肘の関節メッシュ変形(C2.5、頂点スキニングでarm_upperとの継ぎ目を無くす)",
      drawOrderHint: side === "r" ? 21 : 43,
      motionParams: {
        idleSway: { freqHz: 1.1, phase: side === "r" ? 1.0 : 1.6, ampRad: 0.015 },
        blendMarginPx: 50,
      },
    };

    // 手の形8(PLAN.md標準部品カタログ: core4 open/fist/point/mic +
    // 拡張4 peace/heart/thumbs_up/wave)。円・四角のみでアクセント形状を
    // 変えて区別する(実際の指の造形はGemini生成後に差し替え前提)。
    const hw = 38, hh = 38;
    const HAND_SHAPES = ["open", "fist", "point", "mic", "peace", "heart", "thumbs_up", "wave"];
    const handStates = {};
    for (let i = 0; i < HAND_SHAPES.length; i++) {
      const shapeName = HAND_SHAPES[i];
      const im = newCanvas(hw, hh);
      fillCircle(im, 19, 19, 16, COLORS.skin);
      if (shapeName !== "open") {
        const accent = hslToRgbInt((i * 360) / HAND_SHAPES.length, 0.6, 0.55);
        switch (shapeName) {
          case "fist": fillCircle(im, 19, 19, 11, accent); break;
          case "point": fillRect(im, 16, 2, 6, 20, accent, 3); break;
          case "mic": fillRect(im, 15, 19, 8, 17, accent, 4); break;
          case "peace": fillRect(im, 11, 2, 5, 20, accent, 2); fillRect(im, 22, 2, 5, 20, accent, 2); break;
          case "heart": fillCircle(im, 13, 15, 8, accent); fillCircle(im, 25, 15, 8, accent); break;
          case "thumbs_up": fillRect(im, 15, 0, 8, 18, accent, 4); break;
          case "wave": fillEllipse(im, 19, 19, 13, 7, accent); break;
          default: break;
        }
      }
      const src = await save(im, `hand_${side}_${shapeName}`);
      handStates[shapeName] = { src };
    }
    parts[`hand_${side}`] = {
      w: hw, h: hh,
      parent: `arm_lower_${side}`, parentAnchor: "wrist",
      pivot: [19, 10],
      motion: "discrete-crossfade",
      states: handStates,
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
      note: "膝の関節メッシュ変形(C2.5、頂点スキニングでleg_upperとの継ぎ目を無くす)",
      drawOrderHint: side === "r" ? 13 : 15,
      motionParams: { blendMarginPx: 60 },
    };
  }

  // --- body_pose(全身1枚スプライト: 角度12・アクション9・ロコモーション12) --
  // PLAN.mdの想定通り、角度・アクション・ロコモーションは個別パーツの
  // 組み合わせではなく「全身1枚の切替」で表現する(motion:sprite-select、
  // js/viewer.jsのdraw()が対応する早期リターン分岐を持つ)。
  {
    const SIZE = 1024;
    function makeBodyPoseImage(hue, markerAngleDeg) {
      const im = newCanvas(SIZE, SIZE);
      const bodyColor = hslToRgbInt(hue, 0.35, 0.85);
      const accent = hslToRgbInt(hue, 0.6, 0.5);
      fillRect(im, SIZE * 0.3, SIZE * 0.35, SIZE * 0.4, SIZE * 0.5, bodyColor, 60);
      fillCircle(im, SIZE * 0.5, SIZE * 0.22, SIZE * 0.13, bodyColor);
      // 向き・ポーズを示すマーカー(頭の周りを回る小円)
      const rad = (markerAngleDeg * Math.PI) / 180;
      const markerR = SIZE * 0.16;
      const mx = SIZE * 0.5 + Math.sin(rad) * markerR;
      const my = SIZE * 0.22 - Math.cos(rad) * markerR;
      fillCircle(im, mx, my, SIZE * 0.035, accent);
      return im;
    }

    const states = {
      // "rig"はsrcを持たない特別な状態。選択すると通常のパーツ合成描画に
      // 戻る(全身スプライト表示を終了する)。isRigはjs/viewer.jsが
      // 判定に使う目印。
      rig: { isRig: true },
    };

    // 角度12(回転角度セット、0/30/.../330度、ミラーなし個別生成の方針)
    const ANGLES = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
    for (const deg of ANGLES) {
      const im = makeBodyPoseImage(deg, deg);
      const src = await save(im, `body_pose_angle_${deg}`);
      states[`angle_${deg}`] = { src };
    }

    // アクション9(core4: idle/greet/bow/nod + 拡張5: sit/think/cheer/clap/shrug)
    const ACTIONS = ["idle", "greet", "bow", "nod", "sit", "think", "cheer", "clap", "shrug"];
    for (let i = 0; i < ACTIONS.length; i++) {
      const hue = (i * 360) / ACTIONS.length;
      const im = makeBodyPoseImage(hue, i * 40);
      const src = await save(im, `body_pose_action_${ACTIONS[i]}`);
      states[ACTIONS[i]] = { src };
    }

    // ロコモーション3×4(walk_mid/run_mid/jump、主要4方向0/90/180/270度)
    const LOCOMOTIONS = [
      { name: "walk_mid", hue: 200 },
      { name: "run_mid", hue: 30 },
      { name: "jump", hue: 280 },
    ];
    const LOCOMOTION_ANGLES = [0, 90, 180, 270];
    for (const loco of LOCOMOTIONS) {
      for (const deg of LOCOMOTION_ANGLES) {
        const im = makeBodyPoseImage(loco.hue, deg);
        const src = await save(im, `body_pose_${loco.name}_${deg}`);
        states[`${loco.name}_${deg}`] = { src };
      }
    }

    parts.body_pose = {
      w: SIZE, h: SIZE,
      parent: null,
      pivot: [SIZE / 2, SIZE / 2],
      motion: "sprite-select",
      states,
      defaultState: "rig",
      drawOrderHint: 0,
      note: "全身スプライト切替用の仮想パーツ。通常のリグ合成には参加せず、rig以外の状態が選ばれた間だけjs/viewer.jsのdraw()がキャンバス全面に表示する。",
    };
  }

  const manifest = {
    format: "super2d-character",
    formatVersion: 1,
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
