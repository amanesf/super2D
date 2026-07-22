// C2: 手振り開始時に腕がスナップしないことの回帰テスト。
// 内部状態を覗く専用フックは追加せず、外部から観測できる見た目
// (canvasのピクセル)だけで検証する。
//
// 手振りのアクション自体はsin(t*6)で常に動き続けるため、単純に
// 「アクション開始直後のフレーム」と「アクション完了後のフレーム」の
// ハッシュを比較しても、両方とも時間経過で変化し続けるので一致しない
// (ハッシュの一致/不一致だけでは"スナップしたか"を判定できない)。
// そこで「idle姿勢との差分ピクセル数」を使い、アクション開始1ms後の
// 差分が、十分時間が経った後の差分よりずっと小さいことを確認する。
// スナップ実装なら1ms後でも完全な手振り角度に飛ぶため差分が既に大きく
// なり、この比較が成立しなくなる(テストがFAILする)。
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

async function captureSnapshot(page, key) {
  await page.evaluate((k) => {
    const c = document.getElementById("stage");
    const gl = c.getContext("webgl");
    const pixels = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    window.__pixelSnapshots = window.__pixelSnapshots || {};
    window.__pixelSnapshots[k] = pixels;
  }, key);
}

// keyに保存済みのスナップショットと現在のcanvasの差分ピクセル数を返す
async function diffPixelCountFrom(page, key) {
  return page.evaluate((k) => {
    const c = document.getElementById("stage");
    const gl = c.getContext("webgl");
    const pixels = new Uint8Array(c.width * c.height * 4);
    gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    const baseline = window.__pixelSnapshots[k];
    let diff = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (
        pixels[i] !== baseline[i] ||
        pixels[i + 1] !== baseline[i + 1] ||
        pixels[i + 2] !== baseline[i + 2] ||
        pixels[i + 3] !== baseline[i + 3]
      ) {
        diff++;
      }
    }
    return diff;
  }, key);
}

test("手振り開始時に腕がスナップしない(1ms後の変化量が最終状態よりずっと小さい)", async () => {
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

    await advance(page, 16); // idleを1フレーム安定させる
    await captureSnapshot(page, "idle");

    await page.click("#btn-wave");
    await advance(page, 1); // アクション開始1ms後(スナップなら既に完全移動しているはず)
    const tinyStepDiff = await diffPixelCountFrom(page, "idle");

    await advance(page, 2000); // 十分にブレンド完了+手振りが進行した状態
    const fullDiff = await diffPixelCountFrom(page, "idle");

    assert.ok(fullDiff > 0, "手振りで見た目が全く変化していない(そもそも動いていない)");
    assert.ok(
      tinyStepDiff < fullDiff * 0.1,
      `1ms後の変化(${tinyStepDiff}px)が最終状態の変化(${fullDiff}px)の10%以上ある(スナップの疑い)`
    );
  } finally {
    await browser.close();
    await close();
  }
});
