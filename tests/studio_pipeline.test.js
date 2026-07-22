// D1受け入れ条件: 「タブがステップ定義から描画される」「ダミー画像を
// 投入→リロード→『前回の続きから』で復元される」を検証する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");
const DUMMY_IMAGE = path.join(ROOT, "characters/placeholder-zero/public/eye_l_open.png");

test("studio.htmlはステップ定義からタブを描画し、投入内容がリロード後も復元される", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${url}/studio.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__studioReady === true);

    const tabTitles = await page.$$eval(".tab", (els) => els.map((e) => e.textContent));
    assert.deepEqual(tabTitles, [
      "1. 画像投入・APIキー設定",
      "2. マスター生成",
      "3. パーツ検出",
      "4. パーツ別in-situ生成",
      "5. モーション/継ぎ目QC",
    ]);

    // 初回はresumeバナーが出ていないこと
    assert.equal(await page.isVisible("#resumeBanner.show"), false);

    // ダミー画像を投入
    await page.setInputFiles("#master-image-input", DUMMY_IMAGE);
    await page.waitForSelector("#master-image-thumb", { state: "attached" });

    const activeAfterUpload = await page.$eval(".tab.active", (e) => e.textContent);
    assert.equal(activeAfterUpload, "2. マスター生成", "投入完了で次のステップに進む");

    const doneCount = await page.$$eval(".tab.done", (els) => els.length);
    assert.equal(doneCount, 1);

    // リロードして「前回の続きから」復元されることを確認
    await page.reload({ waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__studioReady === true);

    assert.equal(await page.isVisible("#resumeBanner.show"), true);
    const activeAfterReload = await page.$eval(".tab.active", (e) => e.textContent);
    assert.equal(activeAfterReload, "2. マスター生成");
    const thumbSrc = await page.$eval("#master-image-thumb", (e) => e.getAttribute("src"));
    assert.match(thumbSrc, /^data:image\/png;base64,/);

    await context.close();
  } finally {
    await browser.close();
    await close();
  }
});
