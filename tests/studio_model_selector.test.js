// ユーザー要望: Geminiモデルを選べるようにしたい。既定はNano Banana 2
// (gemini-3.1-flash-image、lite無し版。2026-07-23実API検証でlite版は
// 位置/スケールのズレ・指定外要素の写り込みが高頻度と判明したため)。
// studio.htmlの「1.画像投入・APIキー設定」タブにモデル入力欄を追加し、
// 選択がlocalStorageに保存されリロード後も復元されることを検証する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

test("Geminiモデルを選択欄で変更でき、リロード後も保持される", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/studio.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__studioReady === true);

    // 既定値はNano Banana 2(js/gemini_api.jsのDEFAULT_MODEL)
    const defaultValue = await page.$eval("#gemini-model-input", (e) => e.value);
    assert.equal(defaultValue, "gemini-3.1-flash-image");

    // 候補一覧にNano Banana 2 Liteも含まれる(自由入力の手掛かりとして)
    const options = await page.$$eval("#gemini-model-options option", (els) => els.map((e) => e.value));
    assert.ok(options.includes("gemini-3.1-flash-lite-image"));

    // 別モデルへの切替もできることを確認
    await page.fill("#gemini-model-input", "gemini-2.5-flash-image");
    await page.dispatchEvent("#gemini-model-input", "change");

    const stored = await page.evaluate(() => window.S2D.geminiApi.getModel());
    assert.equal(stored, "gemini-2.5-flash-image");

    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__studioReady === true);
    const afterReload = await page.$eval("#gemini-model-input", (e) => e.value);
    assert.equal(afterReload, "gemini-2.5-flash-image");
  } finally {
    await browser.close();
    await close();
  }
});
