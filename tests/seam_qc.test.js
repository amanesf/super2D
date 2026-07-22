// D7: js/seam_qc.jsのdetectSeamGapが、継ぎ目に隙間(背景の透過)がある
// 場合とない場合を正しく区別できることを検証する。
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
    await page.addScriptTag({ path: path.join(ROOT, "js/seam_qc.js") });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

test("継ぎ目に隙間(透過画素)があるとhasGap=trueになる", async () => {
  const { url, close } = await startServer(ROOT);
  try {
    const result = await withPage(url, (page) =>
      page.evaluate(() => {
        const w = 40, h = 40;
        const data = new Uint8ClampedArray(w * h * 4);
        for (let p = 0; p < w * h; p++) data[p * 4 + 3] = 255; // 全面不透明(継ぎ目なし)
        const opaque = new ImageData(data.slice(), w, h);

        // 中心付近に1px、B1のような透過の隙間を作る
        const withGap = new ImageData(data.slice(), w, h);
        const gapIndex = (20 * w + 20) * 4;
        withGap.data[gapIndex + 3] = 0;

        return {
          opaqueResult: window.S2D.seamQc.detectSeamGap(opaque, 20, 20, 5),
          gapResult: window.S2D.seamQc.detectSeamGap(withGap, 20, 20, 5),
        };
      })
    );
    assert.equal(result.opaqueResult.hasGap, false);
    assert.equal(result.gapResult.hasGap, true);
    assert.equal(result.gapResult.gapPixelCount, 1);
    assert.equal(result.gapResult.minAlpha, 0);
  } finally {
    await close();
  }
});

test("detectSeamRegressionは静止姿勢では不透明だった画素が透過に変わった場合だけ検知する", async () => {
  const { url, close } = await startServer(ROOT);
  try {
    const result = await withPage(url, (page) =>
      page.evaluate(() => {
        const w = 40, h = 40;
        // baseline: 中心付近は不透明、外側(キャラクターの外)は元々透過
        const baseData = new Uint8ClampedArray(w * h * 4);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            const inside = Math.abs(x - 20) < 10 && Math.abs(y - 20) < 10;
            baseData[(y * w + x) * 4 + 3] = inside ? 255 : 0;
          }
        }
        const baseline = new ImageData(baseData, w, h);

        // ケースA: 角度を変えても不透明範囲は変わらない(正常)
        const sameData = baseData.slice();
        const same = new ImageData(sameData, w, h);

        // ケースB: 元々不透明だった中心付近の1画素が透過になった(継ぎ目が開いた)
        const gapData = baseData.slice();
        gapData[(20 * w + 20) * 4 + 3] = 0;
        const withNewGap = new ImageData(gapData, w, h);

        return {
          normal: window.S2D.seamQc.detectSeamRegression(baseline, same, 20, 20, 15),
          regressed: window.S2D.seamQc.detectSeamRegression(baseline, withNewGap, 20, 20, 15),
        };
      })
    );
    assert.equal(result.normal.hasNewGap, false, "元々透過だった外側は誤検知しない");
    assert.equal(result.regressed.hasNewGap, true);
    assert.equal(result.regressed.newGapPixelCount, 1);
  } finally {
    await close();
  }
});
