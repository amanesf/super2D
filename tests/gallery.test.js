// D6受け入れ条件: 「同一パーツに偽画像3枚を投入し、採用切替が合成
// プレビューに即反映される」「修正指示欄から新候補が追加され、K回超過で
// 入力欄が閉じる」を検証する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");
const IMAGES = [
  "characters/placeholder-zero/public/eye_l_open.png",
  "characters/placeholder-zero/public/eye_r_open.png",
  "characters/placeholder-zero/public/mouth_aa.png",
  "characters/placeholder-zero/public/mouth_ih.png",
  "characters/placeholder-zero/public/mouth_ou.png",
];

test("同一パーツに偽画像3枚を投入すると採用切替が合成プレビューに即反映される", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/studio.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__studioReady === true);
    await page.click(".tab:nth-child(4)"); // 4. パーツ別in-situ生成

    let expected = 0;
    for (const img of IMAGES.slice(0, 3)) {
      await page.setInputFiles("#gallery-add-input", path.join(ROOT, img));
      expected++;
      await page.waitForFunction(
        (n) => document.querySelectorAll(".candCard").length === n,
        expected,
      );
    }

    const cardIds = await page.$$eval(".candCard", (els) => els.map((e) => e.id.replace("gallery-card-", "")));
    assert.equal(cardIds.length, 3);

    // 2枚目を採用にする
    await page.click(`#gallery-adopt-btn-${cardIds[1]}`);
    const previewSrc = await page.$eval("#gallery-preview-img", (e) => e.getAttribute("src"));
    const card1Src = await page.$eval(`#gallery-card-${cardIds[1]} img`, (e) => e.getAttribute("src"));
    assert.equal(previewSrc, card1Src, "採用切替が合成プレビューに反映される");

    const adoptedCard = await page.$eval(`#gallery-card-${cardIds[1]}`, (e) => e.className);
    assert.match(adoptedCard, /adopted/);
  } finally {
    await browser.close();
    await close();
  }
});

test("修正指示欄から新候補が追加され、修正の連鎖がK回(3回)を超えると入力欄が閉じる", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/studio.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__studioReady === true);
    await page.click(".tab:nth-child(4)");

    await page.setInputFiles("#gallery-add-input", path.join(ROOT, IMAGES[0]));
    await page.waitForFunction(() => document.querySelectorAll(".candCard").length === 1);
    let currentId = await page.$eval(".candCard", (e) => e.id.replace("gallery-card-", ""));

    // depth0→1→2→3まで3回連続で修正版を追加する
    for (let i = 0; i < 3; i++) {
      await page.fill(`#gallery-edit-text-${currentId}`, `修正指示${i + 1}`);
      await page.setInputFiles(`#gallery-edit-upload-${currentId}`, path.join(ROOT, IMAGES[i + 1]));
      await page.waitForFunction(
        (n) => document.querySelectorAll(".candCard").length === n,
        i + 2,
      );
      const cardIds = await page.$$eval(".candCard", (els) => els.map((e) => e.id.replace("gallery-card-", "")));
      currentId = cardIds[cardIds.length - 1];
    }

    // depth3に達した候補は修正指示欄が閉じているはず
    await page.waitForSelector(`#gallery-edit-closed-${currentId}`);
    const hasEditInput = await page.$(`#gallery-edit-text-${currentId}`);
    assert.equal(hasEditInput, null, "3回の連鎖後は修正指示欄が閉じる");

    const closedText = await page.$eval(`#gallery-edit-closed-${currentId}`, (e) => e.textContent);
    assert.match(closedText, /3回まで/);
  } finally {
    await browser.close();
    await close();
  }
});
