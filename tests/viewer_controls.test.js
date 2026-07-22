// ユーザー要望: ビューアにピンチズーム・ドラッグ(角度回転)・十字ボタンでの
// パン・リセット、状態切替ボタンのカテゴリ別タブ化を追加した。
// これらのインタラクションが実際に効くことを検証する。
//
// 注意: 合成PointerEvent(new PointerEvent().dispatchEvent())は
// setPointerCapture()が実ポインタを伴わないと例外を投げる実装依存の
// 挙動があり、それを踏まえてタッチ操作はTouchEventではなくCDPの
// Input.dispatchTouchEvent(本物のタッチ入力に近い経路)で検証する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

async function gotoLoadedViewer(page, url) {
  await page.goto(`${url}/viewer.html`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => {
    const el = document.getElementById("status");
    return !!el && el.textContent.startsWith("読み込み完了");
  });
}

// キャンバスを画面内に戻してから中心座標を返す(タブ操作等でページが
// スクロールしていると、CDPのタッチ座標がキャンバス外を指してしまい
// イベントが届かないため)。
async function getCanvasCenter(page) {
  await page.$eval("#stage", (el) => el.scrollIntoView({ block: "center" }));
  return page.$eval("#stage", (el) => {
    const r = el.getBoundingClientRect();
    return { cx: r.x + r.width / 2, cy: r.y + r.height / 2 };
  });
}

async function touchDrag(client, { cx, cy, dx }) {
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: cx + dx, y: cy }] });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function touchPinch(client, { cx, cy, startHalfGap, endHalfGap }) {
  await client.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: cx - startHalfGap, y: cy, id: 1 },
      { x: cx + startHalfGap, y: cy, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: cx - endHalfGap, y: cy, id: 1 },
      { x: cx + endHalfGap, y: cy, id: 2 },
    ],
  });
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
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

test("既定状態(rig)で1本指ドラッグするとパンになる(角度データが無いアクションはパンにフォールバックする回帰テスト)", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await gotoLoadedViewer(page, url);
    const client = await context.newCDPSession(page);

    const { cx, cy } = await getCanvasCenter(page);
    await touchDrag(client, { cx, cy, dx: 100 });
    const transform = await page.$eval("#stage", (e) => e.style.transform);
    assert.match(transform, /translate\(100px, 0px\)/, `既定(rig)のドラッグはパンになるはず: ${transform}`);
  } finally {
    await browser.close();
    await close();
  }
});

test("2本指ピンチでズームできる", async () => {
  const { url, close } = await startServer(ROOT);
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await gotoLoadedViewer(page, url);
    const client = await context.newCDPSession(page);

    const { cx, cy } = await getCanvasCenter(page);
    await touchPinch(client, { cx, cy, startHalfGap: 10, endHalfGap: 70 });
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
    const context = await browser.newContext({ hasTouch: true, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await gotoLoadedViewer(page, url);
    const client = await context.newCDPSession(page);

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

    let { cx, cy } = await getCanvasCenter(page);
    await touchDrag(client, { cx, cy, dx: 150 });
    const afterDrag = await page.evaluate(() => window.S2D.viewerDebug.getPartCurrentState("body_pose"));
    assert.equal(afterDrag, "angle_60");

    // 角度データが無いアクション(idle)に切り替えると、ドラッグしても角度は変わらない(パンになる)
    await page.click('.state-tab-panel[data-tab-key="pose"] button[data-family="idle"]');
    assert.equal(await page.evaluate(() => window.S2D.viewerDebug.getPartCurrentState("body_pose")), "idle");
    ({ cx, cy } = await getCanvasCenter(page));
    await touchDrag(client, { cx, cy, dx: 200 });
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
