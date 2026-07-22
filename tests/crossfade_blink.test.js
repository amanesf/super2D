// C3: discrete-crossfadeパーツ(まばたき等)が瞬間切替(スナップ)せず、
// 短時間アルファブレンドで遷移することの回帰テスト。B3のUIボタンで
// eye_lをclosedへ切り替え、遷移途中のフレームが「open」「closed」の
// どちらとも異なる(=ブレンドされた中間状態が実在する)ことを確認する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");
const FIXED_DT_MS = 1000 / 120;

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

test("まばたきのstate切替が瞬間切替せず、途中経過が両端と異なる", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await freezeControlledFrames(page);
    await page.goto(`${url}/viewer.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const el = document.getElementById("status");
      return !!el && el.textContent.startsWith("読み込み完了");
    });

    await advance(page, FIXED_DT_MS * 60);
    const openHash = await canvasHash(page);

    // eye_lは「目・口」タブの中にある(既定のアクティブタブは「表情」)
    await page.click('.state-tab[data-tab-key="face"]');
    await page.click('.state-group[data-part="eye_l"] button[data-state="closed"]');
    await advance(page, FIXED_DT_MS * 4); // 遷移(0.12s)の途中
    const midHash = await canvasHash(page);

    await advance(page, FIXED_DT_MS * 30); // 遷移完了
    const closedHash = await canvasHash(page);

    assert.notEqual(openHash, closedHash, "open/closedの見た目が変わっていない");
    assert.notEqual(midHash, openHash, "途中経過がopenと同一(瞬間切替の疑い)");
    assert.notEqual(midHash, closedHash, "途中経過がclosedと同一(瞬間切替の疑い)");
  } finally {
    await browser.close();
    await close();
  }
});
