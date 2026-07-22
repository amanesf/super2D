// D2受け入れ条件の前提となるjs/gemini_api.js単体の検証。
// 実APIは一切呼ばない(CLAUDE.mdルール2)。fetchImplを差し替えた
// 偽レスポンスで、レスポンス解析・エラーメッセージ・呼び出し上限を確認する。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { chromium } = require("playwright");
const { startServer } = require("./helpers/static_server");

const ROOT = path.join(__dirname, "..");

async function withPage(url, fn) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
  try {
    const page = await browser.newPage();
    await page.goto(`${url}/index.html`);
    await page.addScriptTag({ path: path.join(ROOT, "js/gemini_api.js") });
    return await fn(page);
  } finally {
    await browser.close();
  }
}

test("APIキー未設定ではcallGeminiがfetchを呼ばずにエラーを投げる", async () => {
  const { url, close } = await startServer(ROOT);
  try {
    const result = await withPage(url, (page) =>
      page.evaluate(async () => {
        localStorage.clear();
        try {
          await window.S2D.geminiApi.callGemini({ prompt: "test" });
          return { threw: false };
        } catch (e) {
          return { threw: true, message: e.message };
        }
      })
    );
    assert.equal(result.threw, true);
    assert.match(result.message, /APIキーが設定されていません/);
  } finally {
    await close();
  }
});

test("成功レスポンスからtext/画像を抽出できる", async () => {
  const { url, close } = await startServer(ROOT);
  try {
    const result = await withPage(url, (page) =>
      page.evaluate(async () => {
        localStorage.setItem("s2d_gemini_api_key", "fake-key");
        const fakeFetch = async () => ({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      { text: "hello" },
                      { inlineData: { mimeType: "image/png", data: "AAAA" } },
                    ],
                  },
                },
              ],
            }),
        });
        return window.S2D.geminiApi.callGemini({ prompt: "test", fetchImpl: fakeFetch });
      })
    );
    assert.equal(result.text, "hello");
    assert.deepEqual(result.images, [{ mimeType: "image/png", base64: "AAAA" }]);
  } finally {
    await close();
  }
});

test("429(limit: 0)は課金設定未完了メッセージになり、生のレスポンス本文を含む", async () => {
  const { url, close } = await startServer(ROOT);
  try {
    const result = await withPage(url, (page) =>
      page.evaluate(async () => {
        localStorage.setItem("s2d_gemini_api_key", "fake-key");
        const body = JSON.stringify({ error: { code: 429, message: "quota", "limit": 0 } });
        const fakeFetch = async () => ({ ok: false, status: 429, text: async () => body });
        try {
          await window.S2D.geminiApi.callGemini({ prompt: "test", fetchImpl: fakeFetch });
          return { threw: false };
        } catch (e) {
          return { threw: true, message: e.message, body };
        }
      })
    );
    assert.equal(result.threw, true);
    assert.match(result.message, /課金設定が未完了/);
    assert.ok(result.message.includes(result.body), "生のレスポンス本文がエラーに含まれる");
  } finally {
    await close();
  }
});

test("セッション呼び出し上限に達すると以後fetchせずエラーになる", async () => {
  const { url, close } = await startServer(ROOT);
  try {
    const result = await withPage(url, (page) =>
      page.evaluate(async () => {
        localStorage.setItem("s2d_gemini_api_key", "fake-key");
        sessionStorage.setItem("s2d_gemini_call_log", "200");
        let fetchCalled = false;
        const fakeFetch = async () => {
          fetchCalled = true;
          return { ok: true, status: 200, text: async () => JSON.stringify({ candidates: [] }) };
        };
        try {
          await window.S2D.geminiApi.callGemini({ prompt: "test", fetchImpl: fakeFetch });
          return { threw: false, fetchCalled };
        } catch (e) {
          return { threw: true, fetchCalled, message: e.message };
        }
      })
    );
    assert.equal(result.threw, true);
    assert.equal(result.fetchCalled, false);
    assert.match(result.message, /呼び出し上限/);
  } finally {
    await close();
  }
});
