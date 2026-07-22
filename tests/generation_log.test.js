// D5: 生成ログ(js/generation_log.js)がIndexedDBに記録され、
// バンドル同梱用にJSONへ書き出せることを確認する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

test("generation_logはappendで蓄積され、JSONとして書き出せる", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/index.html`);
    await page.addScriptTag({ path: path.join(ROOT, "js/idb.js") });
    await page.addScriptTag({ path: path.join(ROOT, "js/generation_log.js") });

    const result = await page.evaluate(async () => {
      await window.S2D.generationLog.clear();
      await window.S2D.generationLog.append({
        model: "gemini-2.5-flash-image",
        promptFile: "prompts/part_insitu_v1.txt",
        promptVersion: "v1",
        inputHash: "abc123",
        partName: "head",
        qcDiffRatio: 0.01,
        adopted: true,
        source: "api",
      });
      await window.S2D.generationLog.append({
        partName: "arm_l",
        qcDiffRatio: 0.4,
        adopted: false,
        source: "manual-upload",
      });
      const all = await window.S2D.generationLog.getAll();
      const jsonText = await window.S2D.generationLog.toJSONText();
      return { all, jsonText };
    });

    assert.equal(result.all.length, 2);
    assert.equal(result.all[0].partName, "head");
    assert.equal(result.all[0].adopted, true);
    assert.ok(result.all[0].timestamp, "timestampが自動付与される");
    assert.equal(result.all[1].adopted, false);

    const parsed = JSON.parse(result.jsonText);
    assert.equal(parsed.length, 2);
  } finally {
    await browser.close();
    await close();
  }
});
