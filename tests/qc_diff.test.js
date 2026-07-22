// D5受け入れ条件: 「偽パーツ一式で『1パーツだけ位置を壊す→そのパーツ
// だけ不合格になる』ことをテストで確認」を検証する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

test("1パーツだけ位置を壊すと、そのパーツだけQC不合格になる", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/index.html`);
    await page.addScriptTag({ path: path.join(ROOT, "js/qc_diff.js") });

    const result = await page.evaluate(() => {
      const PARTS = [
        { name: "head", rect: { x: 100, y: 20, w: 100, h: 100, color: "#ffcc88" } },
        { name: "torso", rect: { x: 90, y: 120, w: 120, h: 150, color: "#8899ff" } },
        { name: "arm_l", rect: { x: 20, y: 130, w: 30, h: 100, color: "#ff8899" } },
        { name: "arm_r", rect: { x: 250, y: 130, w: 30, h: 100, color: "#88ff99" } },
      ];

      function drawParts(parts) {
        const c = document.createElement("canvas");
        c.width = 300; c.height = 300;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, 300, 300);
        for (const p of parts) {
          ctx.fillStyle = p.rect.color;
          ctx.fillRect(p.rect.x, p.rect.y, p.rect.w, p.rect.h);
        }
        return c;
      }

      const master = drawParts(PARTS);

      // 合成結果: arm_lだけ位置を+25pxずらして生成されたと仮定
      const brokenParts = PARTS.map((p) =>
        p.name === "arm_l"
          ? { name: p.name, rect: { ...p.rect, x: p.rect.x + 25, y: p.rect.y + 25 } }
          : p
      );
      const composite = drawParts(brokenParts);

      const qcParts = PARTS.map((p) => ({
        name: p.name,
        region: { left: p.rect.x, top: p.rect.y, right: p.rect.x + p.rect.w - 1, bottom: p.rect.y + p.rect.h - 1 },
      }));

      return window.S2D.qcDiff.assessParts(master, composite, qcParts);
    });

    const byName = Object.fromEntries(result.map((r) => [r.name, r]));
    assert.equal(byName.arm_l.passed, false, `arm_lは不合格になるべき(diffRatio=${byName.arm_l.diffRatio})`);
    assert.equal(byName.head.passed, true, `headは合格のはず(diffRatio=${byName.head.diffRatio})`);
    assert.equal(byName.torso.passed, true, `torsoは合格のはず(diffRatio=${byName.torso.diffRatio})`);
    assert.equal(byName.arm_r.passed, true, `arm_rは合格のはず(diffRatio=${byName.arm_r.diffRatio})`);
  } finally {
    await browser.close();
    await close();
  }
});
