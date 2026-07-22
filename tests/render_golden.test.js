// B6: プレースホルダーキャラ描画のゴールデンハッシュ。
// requestAnimationFrame()を「固定dt=0.05sのフレームをN回同期的に呼んだ後は
// 何もしない」形に差し替え、t≈0.6sで静止した状態を再現性ある形で描画させる。
// t=0では呼吸のsin(t*freq)が常に0になり、B1で修正したスケール込みアンカー
// 変換の有無による違いが消えてしまう(バグを検出できない)ため、あえて
// t>0の値で凍結する。0.6sはまばたきの最短発火時刻(1.5s、nextBlinkAtの
// 下限)より確実に手前なので、Math.random()の値に関わらずまばたき未発火
// の状態で決定的に止まる。
// computeWorldTransforms()/resolveIdleAngles()/draw()のいずれかを壊すと
// このハッシュが変わり、テストがFAILする。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

// 値を更新する場合: このテストのassertを一時的に外してconsole.log(hash)で
// 実測し、差し替える(意図した見た目の変更であることをスクリーンショット
// 等で確認したうえで行うこと)。
const GOLDEN_HASH = "7ac3d615bb09d79529d166ddf1ffc75dbf2e300a84837cddc5de53e30a345c9c";

async function freezeAtRest(page) {
  await page.addInitScript(() => {
    const FRAME_DT_MS = 50; // frame()内のMath.min(dt, 0.05)の上限と一致させる
    const TOTAL_FRAMES = 12; // 累計t = 12 * 0.05s = 0.6s(まばたき最短発火1.5sより手前)
    let callCount = 0;
    window.performance.now = () => 0; // main()内の初期 last の取得に使われる
    window.requestAnimationFrame = (cb) => {
      if (callCount < TOTAL_FRAMES) {
        callCount++;
        cb(callCount * FRAME_DT_MS);
      }
      return 0;
    };
  });
}

test("プレースホルダーキャラ描画のゴールデンハッシュ(静止状態)", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await freezeAtRest(page);

    await page.goto(`${url}/viewer.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const el = document.getElementById("status");
      return !!el && el.textContent.startsWith("読み込み完了");
    });
    await page.waitForTimeout(50);

    const hash = await page.evaluate(async () => {
      const c = document.getElementById("stage");
      const gl = c.getContext("webgl"); // 既にjs/viewer.jsが取得済みのコンテキストを再取得
      const pixels = new Uint8Array(c.width * c.height * 4);
      gl.readPixels(0, 0, c.width, c.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const digest = await crypto.subtle.digest("SHA-256", pixels.buffer);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    });

    assert.equal(hash, GOLDEN_HASH);
  } finally {
    await browser.close();
    await close();
  }
});
