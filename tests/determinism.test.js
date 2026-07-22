// C2: 固定タイムステップ化の受け入れ条件「同条件で2回実行した描画ハッシュ
// が一致する」を検証する。
//
// 単に同じdt列を2回与えるだけでは、可変dt実装(修正前)でもモック環境
// では再現するため区別できない(モックしたperformance.now/rAFが同じ列を
// 返す限り、可変dtだろうと決定的になってしまう)。固定タイムステップが
// 本当に効いているかを確かめるには、「実際のブラウザでは1フレームごとの
// 経過時間が実行のたびに微妙に揺れる」状況を模して、**同じ合計経過時間を
// 異なるフレーム分割(チャンク)で再現し、それでも結果が一致すること**を
// 確認する必要がある。可変dtのままだと、accumulator.doesn't existで
// t+=dtの積算パス(チャンクの切り方)によって浮動小数の丸まり方が変わり
// うるが、固定サブステップ(1/120s)は常に同じ演算列で積算するため、
// チャンクの切り方に関係なく同じtに収束する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

async function freezeControlledFrames(page) {
  await page.addInitScript(() => {
    let simNow = 0;
    let cb = null;
    window.performance.now = () => simNow;
    window.requestAnimationFrame = (fn) => {
      cb = fn;
      return 0;
    };
    window.__advanceFrame = (dtMs) => {
      simNow += dtMs;
      if (cb) {
        const fn = cb;
        cb = null;
        fn(simNow);
      }
    };
  });
}

async function advance(page, dtMs) {
  await page.evaluate((ms) => window.__advanceFrame(ms), dtMs);
}

async function canvasHash(page) {
  return page.evaluate(async () => {
    const c = document.getElementById("stage");
    const gl = c.getContext("webgl");
    const pixels = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const digest = await crypto.subtle.digest("SHA-256", pixels.buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  });
}

// 手振りON→合計500ms経過、というシナリオを指定のフレーム分割(chunksMs、
// 合計は必ず500ms)で再現し、最終的なcanvasハッシュを返す。
async function runWithChunks(browser, url, chunksMs) {
  const page = await browser.newPage();
  await freezeControlledFrames(page);
  await page.goto(`${url}/viewer.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const el = document.getElementById("status");
    return !!el && el.textContent.startsWith("読み込み完了");
  });
  await page.click("#btn-wave");
  for (const ms of chunksMs) await advance(page, ms);
  const hash = await canvasHash(page);
  await page.close();
  return hash;
}

test("同じ合計経過時間なら、フレーム分割の粒度が違っても描画ハッシュが一致する", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const evenChunks = Array(10).fill(50); // 10 x 50ms = 500ms(均等)
    const jitteryChunks = [200, 33, 17, 150, 41, 9, 50]; // 合計500ms、粒度バラバラ
    assert.equal(
      evenChunks.reduce((a, b) => a + b, 0),
      jitteryChunks.reduce((a, b) => a + b, 0)
    );

    const hashEven = await runWithChunks(browser, url, evenChunks);
    const hashJittery = await runWithChunks(browser, url, jitteryChunks);

    assert.equal(hashJittery, hashEven);
  } finally {
    await browser.close();
    await close();
  }
});
