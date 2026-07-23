#!/usr/bin/env node
/**
 * キャラクター参照画像を標準キャンバスに正規化する。
 *
 * D0b以降、実装の正はjs/normalize.js(ブラウザ、S2D.normalizeImage)。
 * このスクリプトは開発補助専用(CLAUDE.md「コア処理はブラウザ実装が正」)。
 * 挙動を変える際はjs/normalize.jsとtests/normalize.test.jsの一致を先に崩さないこと。
 *
 * Geminiに渡す入力画像(元画像・派生画像とも)は、構図(キャラクターの
 * サイズ・位置)を毎回揃えることでモデルへの依存を減らす。手作業のリサイズ
 * ではなく、このスクリプトを常に通すことでキャラクターサイズ基準を固定する。
 *
 * ルール(PLAN.md「入力画像の前処理」節に対応):
 * - 出力キャンバス: 1024x1024(正方形)、白背景。Geminiの課金は解像度
 *   ティア(0.5K/1K/2K/4K、1K=長辺1024px)単位のため、9:16等の縦長
 *   キャンバスで長辺だけ1024pxに合わせると画素数枠を余らせてしまう。
 *   正方形1024x1024にすることで同じ1K課金枠を無駄なく使う
 * - 背景色(四隅サンプリングで自動検出、既定は白)と異なる領域を
 *   キャラクター本体とみなしバウンディングボックスを検出する
 * - バウンディングボックスの高さがキャンバス高さの87.5%(896px)に
 *   なるよう等比拡大縮小し、水平中央揃え・下端は24px固定余白で配置する
 *   (足元は地面に接する想定で余白を持たせず、余った縦余白は全て上に
 *   回す非対称配置。上端側は髪の揺れ・持ち物等の可動余地に使う)
 *
 * 使い方: node scripts/normalize_reference.js <src.png> <dst.png>
 */
const { Jimp, intToRGBA } = require("jimp");

const CANVAS_W = 1024;
const CANVAS_H = 1024;
const TARGET_CONTENT_H = 896; // キャンバス高さの87.5%
const BOTTOM_MARGIN_PX = 24; // 足元は地面に接するため上下均等ではなく下余白を小さく固定する
const BG_SAMPLE_MARGIN = 4;
const BG_DIFF_THRESHOLD = 18; // 背景色からの差分がこれを超えたら「内容」とみなす

function detectBackgroundColor(image) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  const corners = [
    [BG_SAMPLE_MARGIN, BG_SAMPLE_MARGIN],
    [w - 1 - BG_SAMPLE_MARGIN, BG_SAMPLE_MARGIN],
    [BG_SAMPLE_MARGIN, h - 1 - BG_SAMPLE_MARGIN],
    [w - 1 - BG_SAMPLE_MARGIN, h - 1 - BG_SAMPLE_MARGIN],
  ];
  let r = 0, g = 0, b = 0;
  for (const [x, y] of corners) {
    const { r: cr, g: cg, b: cb } = intToRGBA(image.getPixelColor(x, y));
    r += cr;
    g += cg;
    b += cb;
  }
  return { r: Math.round(r / 4), g: Math.round(g / 4), b: Math.round(b / 4) };
}

function contentBBox(image, bg) {
  const w = image.bitmap.width;
  const h = image.bitmap.height;
  let left = w, right = 0, top = h, bottom = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x += 2) { // 高速化のため2px間引き
      const { r, g, b } = intToRGBA(image.getPixelColor(x, y));
      const diff = Math.abs(r - bg.r) + Math.abs(g - bg.g) + Math.abs(b - bg.b);
      if (diff > BG_DIFF_THRESHOLD) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }
  if (left > right || top > bottom) {
    throw new Error("背景と区別できるコンテンツが見つからなかった");
  }
  return { left, top, right, bottom };
}

async function normalize(srcPath, dstPath) {
  const src = await Jimp.read(srcPath);
  const bg = detectBackgroundColor(src);
  const { left, top, right, bottom } = contentBBox(src, bg);
  const contentW = right - left + 1;
  const contentH = bottom - top + 1;

  const content = src.clone().crop({ x: left, y: top, w: contentW, h: contentH });

  const scale = TARGET_CONTENT_H / contentH;
  const newW = Math.max(1, Math.round(contentW * scale));
  const newH = TARGET_CONTENT_H;
  content.resize({ w: newW, h: newH });

  const canvas = new Jimp({ width: CANVAS_W, height: CANVAS_H, color: 0xffffffff });
  const xOff = Math.floor((CANVAS_W - newW) / 2);
  const yOff = CANVAS_H - newH - BOTTOM_MARGIN_PX;
  canvas.composite(content, xOff, yOff);

  await canvas.write(dstPath);
  console.log(
    `saved ${dstPath}: canvas=${CANVAS_W}x${CANVAS_H} content=${newW}x${newH} ` +
      `offset=(${xOff},${yOff}) bg=(${bg.r},${bg.g},${bg.b})`
  );
}

if (require.main === module) {
  const [, , srcPath, dstPath] = process.argv;
  if (!srcPath || !dstPath) {
    console.error("usage: node normalize_reference.js <src.png> <dst.png>");
    process.exit(1);
  }
  normalize(srcPath, dstPath).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { normalize };
