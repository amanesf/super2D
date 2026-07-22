// D0b受け入れ条件: 「同一入力に対しNode版と出力が一致する(ピクセル一致、
// 自動テストで比較)」を検証する。scripts/normalize_reference.js(Node/Jimp)
// とjs/normalize.js(ブラウザ、S2D.normalizeImage)に同じ合成画像を通し、
// 出力キャンバスのピクセルが完全一致することを確認する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { chromium } = require("playwright");
const { Jimp } = require("jimp");
const { startServer } = require("./helpers/static_server");
const { normalize } = require("../scripts/normalize_reference");

const ROOT = path.join(__dirname, "..");

// 背景色付き・非対称な内容物を持つ合成画像を作る(等倍でない拡縮・
// 中央配置ズレを両方のパスに通すため)。
async function makeFixture(fixturePath) {
  const img = new Jimp({ width: 1400, height: 900, color: 0x228833ff });
  // 内容物(コンテンツ矩形): 背景と明確に区別できる色で塗る。
  const content = new Jimp({ width: 500, height: 700, color: 0xffccaaff });
  img.composite(content, 300, 100);
  await img.write(fixturePath);
}

test("normalize.js(ブラウザ)がscripts/normalize_reference.js(Node)とピクセル一致する", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "s2d-normalize-"));
  const srcPath = path.join(tmpDir, "src.png");
  const nodeOutPath = path.join(tmpDir, "node_out.png");
  await makeFixture(srcPath);
  await normalize(srcPath, nodeOutPath);
  const nodeOutImg = await Jimp.read(nodeOutPath);
  const nodeBuffer = Buffer.from(nodeOutImg.bitmap.data);

  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/js/normalize.js`.replace("/js/normalize.js", "/index.html"));
    await page.addScriptTag({ path: path.join(ROOT, "js/normalize.js") });

    const srcDataUrl = `data:image/png;base64,${fs.readFileSync(srcPath).toString("base64")}`;

    const browserResult = await page.evaluate(async (dataUrl) => {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = dataUrl;
      });
      const canvas = window.S2D.normalizeImage(img);
      const ctx = canvas.getContext("2d");
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      return { width: canvas.width, height: canvas.height, data: Array.from(data) };
    }, srcDataUrl);
    await page.close();

    assert.equal(browserResult.width, nodeOutImg.bitmap.width);
    assert.equal(browserResult.height, nodeOutImg.bitmap.height);

    const browserBuffer = Buffer.from(browserResult.data);
    let diffCount = 0;
    let maxDiff = 0;
    for (let i = 0; i < nodeBuffer.length; i++) {
      const d = Math.abs(nodeBuffer[i] - browserBuffer[i]);
      if (d > 0) diffCount++;
      if (d > maxDiff) maxDiff = d;
    }
    assert.equal(diffCount, 0, `${diffCount}バイトが不一致(最大差分${maxDiff})`);
  } finally {
    await browser.close();
    await close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
