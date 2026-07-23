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

// 背景色付きの合成画像を作る。実際のキャラクターイラスト同様、内容物は
// キャンバス中央付近に適度な余白(端ギリギリにはしない。関節の可動域や
// 将来のアクション用マージンを圧迫しないよう、実運用に近い程度の
// 余白を残す)を持たせつつ解像度に対して十分大きく取る。
// 高さ1150は正規化後の目標896pxより大きい=縮小パス(resizeWidthRGBA/
// resizeHeightRGBA)を確実に通す値(縮小パスに実バグがあり、拡大パスしか
// 通らないと見逃すことが判明したため、意図的にこの値を選ぶ)。
async function makeFixture(fixturePath) {
  const canvasW = 1000;
  const canvasH = 1400;
  const contentW = 650;
  const contentH = 1150;
  const left = Math.round((canvasW - contentW) / 2); // 中央寄せ(左右175pxずつの余白)
  const top = Math.round((canvasH - contentH) / 2); // 中央寄せ(上下125pxずつの余白)

  const img = new Jimp({ width: canvasW, height: canvasH, color: 0x228833ff });
  const content = new Jimp({ width: contentW, height: contentH, color: 0xffccaaff });
  img.composite(content, left, top);
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
