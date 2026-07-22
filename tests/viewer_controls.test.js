// ユーザー要望: ビューアにピンチズーム・ドラッグ(角度回転)・十字ボタンでの
// パン・リセット、状態切替ボタンのカテゴリ別タブ化を追加した。
// これらのインタラクションが実際に効くことを検証する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

function dispatchTwoPointerPinch({ cx, cy, startHalfGap, endHalfGap }) {
  const el = document.getElementById("stage");
  function fire(type, id, x, y) {
    el.dispatchEvent(
      new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: "touch" })
    );
  }
  fire("pointerdown", 1, cx - startHalfGap, cy);
  fire("pointerdown", 2, cx + startHalfGap, cy);
  fire("pointermove", 1, cx - endHalfGap, cy);
  fire("pointermove", 2, cx + endHalfGap, cy);
  fire("pointerup", 1, cx - endHalfGap, cy);
  fire("pointerup", 2, cx + endHalfGap, cy);
}

function dispatchSingleDrag({ cx, cy, dx }) {
  const el = document.getElementById("stage");
  function fire(type, id, x, y) {
    el.dispatchEvent(
      new PointerEvent(type, { pointerId: id, clientX: x, clientY: y, bubbles: true, cancelable: true, pointerType: "touch" })
    );
  }
  fire("pointerdown", 9, cx, cy);
  fire("pointermove", 9, cx + dx, cy);
  fire("pointerup", 9, cx + dx, cy);
}

async function gotoLoadedViewer(page, url) {
  await page.goto(`${url}/viewer.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const el = document.getElementById("status");
    return !!el && el.textContent.startsWith("読み込み完了");
  });
}

test("十字ボタンでパンでき、リセットで戻る", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await gotoLoadedViewer(page, url);

    assert.equal(await page.$eval("#stage", (e) => e.style.transform || ""), "");
    await page.click("#view-pan-right");
    await page.click("#view-pan-down");
    const transform = await page.$eval("#stage", (e) => e.style.transform);
    assert.match(transform, /translate\(24px, 24px\)/);

    await page.click("#view-pan-reset");
    const reset = await page.$eval("#stage", (e) => e.style.transform);
    assert.match(reset, /translate\(0px, 0px\) scale\(1\)/);
  } finally {
    await browser.close();
    await close();
  }
});

test("2本指ピンチでズームできる", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage({ hasTouch: true });
    await gotoLoadedViewer(page, url);

    const box = await page.$eval("#stage", (el) => {
      const r = el.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });
    await page.evaluate(dispatchTwoPointerPinch, { cx: box.cx, cy: box.cy, startHalfGap: 10, endHalfGap: 60 });
    const transform = await page.$eval("#stage", (e) => e.style.transform);
    assert.match(transform, /scale\(3\)/, `ズーム上限(3倍)にクランプされているはず: ${transform}`);
  } finally {
    await browser.close();
    await close();
  }
});

test("ポーズタブでアクションを選び、ドラッグすると角度(body_pose)が変わる", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage({ hasTouch: true });
    await gotoLoadedViewer(page, url);

    await page.click('.state-tab[data-tab-key="pose"]');
    const familyLabels = await page.$$eval('.state-tab-panel[data-tab-key="pose"] [data-family]', (els) =>
      els.map((e) => e.dataset.family)
    );
    assert.deepEqual(
      familyLabels,
      ["rig", "angle", "idle", "greet", "bow", "nod", "sit", "think", "cheer", "clap", "shrug", "walk", "run", "jump"]
    );

    await page.click('.state-tab-panel[data-tab-key="pose"] button[data-family="angle"]');
    assert.equal(await page.evaluate(() => window.S2D.viewerDebug.getPartCurrentState("body_pose")), "angle_0");

    const box = await page.$eval("#stage", (el) => {
      const r = el.getBoundingClientRect();
      return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
    });
    await page.evaluate(dispatchSingleDrag, { cx: box.cx, cy: box.cy, dx: 150 });
    const afterDrag = await page.evaluate(() => window.S2D.viewerDebug.getPartCurrentState("body_pose"));
    assert.equal(afterDrag, "angle_60");

    // 角度データが無いアクション(idle)に切り替えると、ドラッグしても角度は変わらない
    await page.click('.state-tab-panel[data-tab-key="pose"] button[data-family="idle"]');
    assert.equal(await page.evaluate(() => window.S2D.viewerDebug.getPartCurrentState("body_pose")), "idle");
    await page.evaluate(dispatchSingleDrag, { cx: box.cx, cy: box.cy, dx: 300 });
    assert.equal(await page.evaluate(() => window.S2D.viewerDebug.getPartCurrentState("body_pose")), "idle");
  } finally {
    await browser.close();
    await close();
  }
});

test("状態切替ボタンはカテゴリ別タブに分かれている", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await gotoLoadedViewer(page, url);

    const tabLabels = await page.$$eval(".state-tab", (els) => els.map((e) => e.textContent));
    assert.deepEqual(tabLabels, ["表情", "目・口", "手", "ポーズ"]);

    // 既定は「表情」タブがアクティブ
    const activeTab = await page.$eval(".state-tab.active", (e) => e.textContent);
    assert.equal(activeTab, "表情");
    const activePanelParts = await page.$$eval(
      '.state-tab-panel.active [data-part]',
      (els) => els.map((e) => e.dataset.part)
    );
    assert.deepEqual(activePanelParts, ["head_base"]);
  } finally {
    await browser.close();
    await close();
  }
});
