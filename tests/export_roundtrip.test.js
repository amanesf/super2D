// B3: 「character.jsonを書き出す」ボタンが、読込中のmanifestと完全一致
// するJSONを出すことを確認する(往復一致)。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");
const CHARACTER_PATH = path.join(ROOT, "characters", "placeholder-zero", "character.json");

test("character.jsonの書き出しが読込中のmanifestと一致する", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    const consoleErrors = [];
    page.on("pageerror", (err) => consoleErrors.push(String(err)));

    await page.goto(`${url}/viewer.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => {
      const el = document.getElementById("status");
      return !!el && el.textContent.startsWith("読み込み完了");
    });

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.click("#btn-export"),
    ]);
    const downloadPath = await download.path();
    const exported = JSON.parse(fs.readFileSync(downloadPath, "utf8"));
    const original = JSON.parse(fs.readFileSync(CHARACTER_PATH, "utf8"));

    assert.deepEqual(exported, original);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await browser.close();
    await close();
  }
});
