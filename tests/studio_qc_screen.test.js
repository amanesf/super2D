// D7受け入れ条件: 「B1のバグのような接続ズレを意図的に作ると、この画面で
// 視認できる」を検証する。ここでは(1)継ぎ目QC画面がviewer.htmlを
// iframe越しに操作しズーム表示+隙間判定を更新できること、(2)実際に
// 関節部分(arm_lower_r、B1と同種の親子接続)を可動域スクラブしても
// 現行の(修正済みの)リグでは隙間が出ないことを確認する。隙間検知
// 関数自体が実際に隙間を検知できることはtests/seam_qc.test.jsで
// 別途(合成データで)検証済み。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

test("継ぎ目QC画面でパーツを選び角度をスクラブすると、ズーム表示と隙間判定が更新される", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/studio.html`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => window.__studioReady === true);
    await page.click(".tab:nth-child(5)"); // 5. モーション/継ぎ目QC
    await page.waitForFunction(() => window.__qcReady === true, null, { timeout: 15000 });

    const partOptions = await page.$$eval("#qc-part-select option", (els) => els.map((e) => e.value));
    assert.ok(partOptions.includes("arm_lower_r"), "関節(肘)パーツが選択肢にある");

    // js/viewer.jsのupdateWave()が実際に使う肘の可動範囲(waveLowerAngle
    // ≈ -0.6±0.35rad、およそ-14°〜-54°)内での確認を行う。QC画面の
    // スライダー自体はそれ以上も動かせる(意図を外れた角度での破綻の
    // 発見にも使うため)。
    await page.selectOption("#qc-part-select", "arm_lower_r");
    await page.fill("#qc-angle-slider", "-30");
    await page.dispatchEvent("#qc-angle-slider", "input");
    await page.waitForTimeout(200);

    // ズームキャンバスが空(全画素alpha=0)でないこと=実際に描画結果を反映している
    const zoomHasContent = await page.evaluate(() => {
      const c = document.getElementById("qc-zoom-canvas");
      const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 0) return true;
      return false;
    });
    assert.equal(zoomHasContent, true, "ズームキャンバスに描画結果が反映されている");

    const statusText = await page.$eval("#qc-gap-status", (e) => e.textContent);
    assert.match(statusText, /継ぎ目OK/, `修正済みの肘関節では隙間が出ないはず: ${statusText}`);

    // 実際に使われる可動範囲を往復スクラブしても継続して隙間なしであることを確認
    for (const deg of [-54, -40, -20, -10, 0]) {
      await page.fill("#qc-angle-slider", String(deg));
      await page.dispatchEvent("#qc-angle-slider", "input");
      await page.waitForTimeout(150);
      const s = await page.$eval("#qc-gap-status", (e) => e.textContent);
      assert.match(s, /継ぎ目OK/, `角度${deg}度で隙間が検出された: ${s}`);
    }
  } finally {
    await browser.close();
    await close();
  }
});
