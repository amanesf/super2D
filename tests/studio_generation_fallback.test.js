// D2受け入れ条件: 「APIキー無しで、プロンプトコピー+手動アップロード
// 経路がend-to-endで動く」を検証する(実API呼び出しはこのタスクでは行わない)。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");
const DUMMY_IMAGE = path.join(ROOT, "characters/placeholder-zero/public/eye_l_open.png");

test("APIキー無しでもプロンプトコピー+手動アップロードで生成ステップが完了する", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const context = await browser.newContext();
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: url });
    const page = await context.newPage();
    await page.goto(`${url}/studio.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__studioReady === true);

    // APIキーは一切設定していないことを確認
    const apiKey = await page.evaluate(() => window.S2D.geminiApi.getApiKey());
    assert.equal(apiKey, "");

    // 3.パーツ検出タブへ移動
    await page.click(".tab:nth-child(3)");
    await page.waitForSelector("#step-detect .promptBox");
    await page.waitForFunction(() => {
      const el = document.querySelector("#step-detect .promptBox");
      return el && el.textContent.length > 10 && !el.textContent.includes("読み込み中");
    });
    const promptText = await page.$eval("#step-detect .promptBox", (e) => e.textContent);
    assert.ok(promptText.includes("パーツ"), "part_detection_v1.txtの内容が読み込まれている");

    // 経路B: プロンプトをコピー
    await page.click("#gen-copy-btn-detect");
    await page.waitForFunction(
      () => document.getElementById("gen-copy-btn-detect").textContent === "コピーしました"
    );
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clipboardText, promptText);

    // 経路C: 生成済み画像を手動アップロード(APIキー不要)
    await page.setInputFiles("#gen-upload-input-detect", DUMMY_IMAGE);
    await page.waitForSelector("#gen-output-thumb-detect", { state: "attached" });

    const activeAfter = await page.$eval(".tab.active", (e) => e.textContent);
    assert.equal(activeAfter, "4. パーツ別in-situ生成", "手動アップロード完了で次のステップに進む");
    const doneTitles = await page.$$eval(".tab.done", (els) => els.map((e) => e.textContent));
    assert.ok(doneTitles.includes("3. パーツ検出"));

    const apiKeyStillEmpty = await page.evaluate(() => window.S2D.geminiApi.getApiKey());
    assert.equal(apiKeyStillEmpty, "", "手動フォールバック経路はAPIキー設定を必要としない");

    await context.close();
  } finally {
    await browser.close();
    await close();
  }
});
