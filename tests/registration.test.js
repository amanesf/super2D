// D3受け入れ条件: 「既知のズレ(+13px, ×0.94等)を与えた偽画像が1px以内に
// 復元される(自動テスト)」を検証する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

test("既知の平行移動+スケールのズレを与えた偽画像が1px以内に復元される", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/index.html`);
    await page.addScriptTag({ path: path.join(ROOT, "js/normalize.js") });
    await page.addScriptTag({ path: path.join(ROOT, "js/registration.js") });

    const result = await page.evaluate(() => {
      function makeCanvas(w, h, bg, rect) {
        const c = document.createElement("canvas");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = rect.color;
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        return c;
      }

      // マスター: 白背景、内容矩形(300,100)-(700,700)(400x600)
      const master = makeCanvas(1024, 1024, "#ffffff", {
        x: 300, y: 100, w: 400, h: 600, color: "#ffccaa",
      });

      // 生成画像(偽): 既知のズレ +13px、スケール0.94倍
      const dx = 13, dy = 13, appliedScale = 0.94;
      const targetRect = {
        x: Math.round(300 * appliedScale) + dx,
        y: Math.round(100 * appliedScale) + dy,
        w: Math.round(400 * appliedScale),
        h: Math.round(600 * appliedScale),
        color: "#ffccaa",
      };
      const target = makeCanvas(1024, 1024, "#ffffff", targetRect);

      const { canvas: corrected, transform } = window.S2D.registration.registerImage(master, target);

      const internal = window.S2D._normalizeInternal;
      const masterData = master.getContext("2d").getImageData(0, 0, 1024, 1024);
      const correctedData = corrected.getContext("2d").getImageData(0, 0, 1024, 1024);
      const masterBg = internal.detectBackgroundColor(masterData);
      const masterBBox = internal.contentBBox(masterData, masterBg);
      const correctedBg = internal.detectBackgroundColor(correctedData);
      const correctedBBox = internal.contentBBox(correctedData, correctedBg);

      return { transform, masterBBox, correctedBBox };
    });

    assert.ok(Math.abs(result.transform.scale - 1 / 0.94) < 0.01, `scale推定: ${result.transform.scale}`);

    const diffs = [
      Math.abs(result.masterBBox.left - result.correctedBBox.left),
      Math.abs(result.masterBBox.top - result.correctedBBox.top),
      Math.abs(result.masterBBox.right - result.correctedBBox.right),
      Math.abs(result.masterBBox.bottom - result.correctedBBox.bottom),
    ];
    for (const d of diffs) {
      assert.ok(d <= 1, `復元後の内容バウンディングボックスがマスターと1px以内に一致しない(差分${d}px)`);
    }
  } finally {
    await browser.close();
    await close();
  }
});
