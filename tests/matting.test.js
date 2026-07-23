// D4受け入れ条件: 「半透明を含む偽ペア画像から期待αが復元される
// (自動テスト)」を検証する。デュアル背景マッティングの復元精度・
// 位置ズレ検出・クロマキーフォールバックの3点を確認する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

async function withPage(url, fn) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/index.html`);
    await page.addScriptTag({ path: path.join(ROOT, "js/normalize.js") });
    await page.addScriptTag({ path: path.join(ROOT, "js/matting.js") });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

test("半透明を含む偽ペア画像(白背景/黒背景)から期待されるα・前景色が復元される", async () => {
  const { url, close } = await startServer(ROOT);
  try {
    const result = await withPage(url, (page) =>
      page.evaluate(() => {
        const w = 50, h = 10;
        const fg = [200, 50, 80];
        const expectedAlphas = [];
        const whiteData = new Uint8ClampedArray(w * h * 4);
        const blackData = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const a = x / (w - 1); // 0(透明)→1(不透明)の横グラデーション
            expectedAlphas.push(a);
            const i = (y * w + x) * 4;
            for (let c = 0; c < 3; c++) {
              whiteData[i + c] = Math.round(a * fg[c] + (1 - a) * 255);
              blackData[i + c] = Math.round(a * fg[c]);
            }
            whiteData[i + 3] = 255;
            blackData[i + 3] = 255;
          }
        }
        const whiteCanvas = document.createElement("canvas");
        whiteCanvas.width = w; whiteCanvas.height = h;
        whiteCanvas.getContext("2d").putImageData(new ImageData(whiteData, w, h), 0, 0);
        const blackCanvas = document.createElement("canvas");
        blackCanvas.width = w; blackCanvas.height = h;
        blackCanvas.getContext("2d").putImageData(new ImageData(blackData, w, h), 0, 0);

        const { imageData } = window.S2D.matting.recoverDualBackgroundAlpha(whiteCanvas, blackCanvas);

        const maxAlphaErr = { v: 0 };
        const maxColorErr = { v: 0 };
        for (let p = 0; p < w * h; p++) {
          const expectedA = expectedAlphas[p % w];
          const gotA = imageData.data[p * 4 + 3] / 255;
          maxAlphaErr.v = Math.max(maxAlphaErr.v, Math.abs(expectedA - gotA));
          if (expectedA > 0.15) {
            for (let c = 0; c < 3; c++) {
              maxColorErr.v = Math.max(maxColorErr.v, Math.abs(imageData.data[p * 4 + c] - fg[c]));
            }
          }
        }
        return { maxAlphaErr: maxAlphaErr.v, maxColorErr: maxColorErr.v };
      })
    );
    assert.ok(result.maxAlphaErr < 0.01, `alpha復元誤差が大きい: ${result.maxAlphaErr}`);
    assert.ok(result.maxColorErr <= 2, `前景色復元誤差が大きい: ${result.maxColorErr}`);
  } finally {
    await close();
  }
});

test("白背景版と黒背景版で内容の位置がズレていると検出される", async () => {
  const { url, close } = await startServer(ROOT);
  try {
    const mismatch = await withPage(url, (page) =>
      page.evaluate(() => {
        function makeOpaqueRectCanvas(bg, rect) {
          const c = document.createElement("canvas");
          c.width = 80; c.height = 80;
          const ctx = c.getContext("2d");
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, 80, 80);
          ctx.fillStyle = "rgb(120,60,200)";
          ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
          return c;
        }
        const whiteCanvas = makeOpaqueRectCanvas("#ffffff", { x: 20, y: 20, w: 30, h: 30 });
        const blackCanvas = makeOpaqueRectCanvas("#000000", { x: 25, y: 27, w: 30, h: 30 });
        const { positionMismatch } = window.S2D.matting.recoverDualBackgroundAlpha(whiteCanvas, blackCanvas);
        return positionMismatch;
      })
    );
    // contentBBoxAgainstは高速化のため2pxストライドで走査しているため、
    // 検出値は±1px程度の誤差を持ちうる(js/normalize.jsのcontentBBoxと同じ仕様)。
    assert.ok(Math.abs(mismatch.dx - 5) <= 1, `dx検出値: ${mismatch.dx}`);
    assert.ok(Math.abs(mismatch.dy - 7) <= 1, `dy検出値: ${mismatch.dy}`);
  } finally {
    await close();
  }
});

test("クロマキーフォールバックはキー色付近を透明、離れた色を不透明にする", async () => {
  const { url, close } = await startServer(ROOT);
  try {
    const result = await withPage(url, (page) =>
      page.evaluate(() => {
        const c = document.createElement("canvas");
        c.width = 4; c.height = 1;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#00ff00";
        ctx.fillRect(0, 0, 4, 1);
        ctx.fillStyle = "#ff00ff"; // キー色から遠い
        ctx.fillRect(2, 0, 2, 1);
        const out = window.S2D.matting.computeChromaKeyAlpha(c);
        return Array.from(out.data);
      })
    );
    const alphaAt = (x) => result[x * 4 + 3];
    assert.equal(alphaAt(0), 0);
    assert.equal(alphaAt(1), 0);
    assert.equal(alphaAt(2), 255);
    assert.equal(alphaAt(3), 255);
  } finally {
    await close();
  }
});

test("クロマキー色の自動選定は、内容が使っている色から最も離れた色相を選ぶ", async () => {
  const { url, close } = await startServer(ROOT);
  try {
    const result = await withPage(url, (page) =>
      page.evaluate(() => {
        // 内容(赤系のみ)を白背景に描いた偽画像。四隅は背景検出の
        // サンプル点(js/normalize.jsのBG_SAMPLE_MARGIN=4)なので、
        // 内容が四隅にかからないよう中央だけに描く。
        const c = document.createElement("canvas");
        c.width = 40; c.height = 40;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 40, 40);
        ctx.fillStyle = "#c00000"; // 赤系の内容
        ctx.fillRect(14, 14, 12, 12);
        return window.S2D.matting.selectChromaKeyColor(c);
      })
    );
    // 赤(#c00000)から最も遠い色相は補色側(シアン〜緑〜青の帯)のはず。
    // 赤成分が低いことだけを機械的に確認する(具体的な色相を固定しすぎない)。
    assert.ok(result.rgb[0] < 100, `選ばれた色の赤成分が高すぎる: ${JSON.stringify(result)}`);
    assert.ok(result.minDistance > 150, `最短距離が小さすぎる: ${result.minDistance}`);
  } finally {
    await close();
  }
});
