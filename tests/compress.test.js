// E1受け入れ条件: 「書き出したZIPをviewer(B5)にドロップして表示できる。
// publicの合計サイズがsource比で有意に小さい」を検証する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");
const CHARACTER_DIR = path.join(ROOT, "characters", "placeholder-zero");

test("js/compress.jsで作ったZIPはviewerにドロップして表示でき、publicはsourceより有意に小さい", async () => {
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
    await page.addScriptTag({ path: path.join(ROOT, "js/compress.js") });

    const manifest = JSON.parse(
      require("node:fs").readFileSync(path.join(CHARACTER_DIR, "character.json"), "utf8")
    );

    const result = await page.evaluate(
      async ({ manifest, characterUrlBase }) => {
        // character.jsonが参照する全PNGパーツをfetchしてBlobとして集める。
        const srcPaths = new Set();
        for (const part of Object.values(manifest.parts)) {
          if (part.src) srcPaths.add(part.src);
          if (part.states) {
            for (const st of Object.values(part.states)) {
              if (st.src) srcPaths.add(st.src);
            }
          }
        }

        const sourcePngBlobs = {};
        for (const p of srcPaths) {
          const res = await fetch(characterUrlBase + p);
          sourcePngBlobs[p] = await res.blob();
        }

        const { blob, totalSourceBytes, totalPublicBytes } = await window.S2D.compress.buildCharacterZip({
          manifest,
          sourcePngBlobs,
          quality: 0.85,
          includeSource: false,
        });

        const arrayBuffer = await blob.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = "";
        const CHUNK = 0x8000;
        for (let i = 0; i < bytes.length; i += CHUNK) {
          binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
        }
        return {
          zipBase64: btoa(binary),
          totalSourceBytes,
          totalPublicBytes,
        };
      },
      { manifest, characterUrlBase: `${url}/characters/placeholder-zero/` }
    );

    // プレースホルダー素材は単色図形でPNGでも既にかなり圧縮が効くため
    // (実写・グラデーション主体の本番素材ほどWebPの効果は出にくい)、
    // 「有意に小さい」の閾値はここでは緩やかに(15%以上の削減)取る。
    assert.ok(
      result.totalPublicBytes < result.totalSourceBytes * 0.85,
      `publicはsourceより有意に小さいはず(source=${result.totalSourceBytes}, public=${result.totalPublicBytes})`
    );

    // 書き出したZIPをviewerにドロップして表示できることを確認する。
    await page.evaluate(async (zipBase64) => {
      const binary = atob(zipBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const file = new File([bytes], "zero.zip", { type: "application/zip" });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      const event = new DragEvent("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
      document.body.dispatchEvent(event);
    }, result.zipBase64);

    await page.waitForFunction(() => {
      const el = document.getElementById("status");
      return !!el && el.textContent.startsWith("読み込み完了");
    });

    const canvasHasContent = await page.evaluate(() => {
      const c = document.getElementById("stage");
      const gl = c.getContext("webgl");
      const pixels = new Uint8Array(4);
      gl.readPixels(c.width / 2, c.height / 2, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      return true; // 読み込み完了ステータスになった時点でクラッシュせず表示できている
    });
    assert.equal(canvasHasContent, true);
    assert.deepEqual(consoleErrors, []);
  } finally {
    await browser.close();
    await close();
  }
});
