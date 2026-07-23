// Gemini APIの呼び出し層。UI層からfetchの実装詳細(エンドポイント・
// レスポンス構造)が見えないようにする(PLAN.md「層の分離」)。
// APIキーはコードに埋め込まず、localStorageにのみ保持する
// (CLAUDE.mdルール2。このファイル自体は実キーを一切持たない)。
(function (global) {
  "use strict";

  const KEY_STORAGE = "s2d_gemini_api_key";
  const MODEL_STORAGE = "s2d_gemini_model";
  const DEFAULT_MODEL = "gemini-3.1-flash-image"; // Nano Banana 2(lite無し版)。2026-07-23実API検証でlite版は位置/スケールのズレ・指定外要素の写り込みが高頻度(fixtures/gemini-verification-2026-07-23参照)で、価格差(1K画像1枚あたり約2倍)より品質を優先
  const CALL_LOG_STORAGE = "s2d_gemini_call_log";
  const MAX_CALLS_PER_SESSION = 200; // 誤操作による無限リトライ等での爆発課金を防ぐ上限

  function getApiKey() {
    return localStorage.getItem(KEY_STORAGE) || "";
  }

  function setApiKey(key) {
    if (key) {
      localStorage.setItem(KEY_STORAGE, key);
    } else {
      localStorage.removeItem(KEY_STORAGE);
    }
  }

  function getModel() {
    return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL;
  }

  function setModel(model) {
    if (model) {
      localStorage.setItem(MODEL_STORAGE, model);
    } else {
      localStorage.removeItem(MODEL_STORAGE);
    }
  }

  // セッション内呼び出し回数(sessionStorage。タブを閉じれば0に戻る)。
  function getSessionCallCount() {
    return Number(sessionStorage.getItem(CALL_LOG_STORAGE) || "0");
  }

  function bumpSessionCallCount() {
    const n = getSessionCallCount() + 1;
    sessionStorage.setItem(CALL_LOG_STORAGE, String(n));
    return n;
  }

  function resetSessionCallCount() {
    sessionStorage.removeItem(CALL_LOG_STORAGE);
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  // { prompt: string, images?: [{mimeType, base64}], model?, apiKey?, fetchImpl? }
  // → { text: string|null, images: [{mimeType, base64}] }
  // fetchImplはテスト用の差し替え口(実装詳細を知らないUI層は使わない)。
  async function callGemini(opts) {
    const model = opts.model || getModel();
    const apiKey = opts.apiKey || getApiKey();
    const fetchImpl = opts.fetchImpl || global.fetch;
    if (!apiKey) {
      throw new Error("Gemini APIキーが設定されていません(手動フォールバック経路を使ってください)");
    }
    if (getSessionCallCount() >= MAX_CALLS_PER_SESSION) {
      throw new Error(
        `このセッションでのAPI呼び出し上限(${MAX_CALLS_PER_SESSION}回)に達しました。誤って無限リトライしていないか確認してください`
      );
    }

    const parts = [{ text: opts.prompt }];
    for (const img of opts.images || []) {
      parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } });
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }] }),
    });

    bumpSessionCallCount();

    const bodyText = await res.text();
    if (!res.ok) {
      throw new Error(describeError(res.status, bodyText));
    }

    let json;
    try {
      json = JSON.parse(bodyText);
    } catch (e) {
      throw new Error(`GeminiのレスポンスがJSONとして解析できませんでした: ${bodyText}`);
    }

    return extractContent(json);
  }

  // ghostitdでの実運用知見: 429は「レート制限」と「課金設定未完了
  // (limit: 0)」の2種類があり、原因が違うのに同じステータスで返ってくる。
  // 生のレスポンス本文を必ず含めて表示し、黙って握りつぶさない
  // (CLAUDE.mdルール5)。
  function describeError(status, bodyText) {
    if (status === 429) {
      if (bodyText.includes('"limit": 0') || bodyText.includes('"limit":0')) {
        return `Gemini API課金設定が未完了の可能性があります(limit: 0)。Google AI Studioの課金設定を確認してください。\n生のレスポンス: ${bodyText}`;
      }
      return `Gemini APIのレート制限に達しました(429)。しばらく待って再試行してください。\n生のレスポンス: ${bodyText}`;
    }
    return `Gemini API呼び出しが失敗しました(status: ${status})。\n生のレスポンス: ${bodyText}`;
  }

  function extractContent(json) {
    const candidate = json.candidates && json.candidates[0];
    const respParts = (candidate && candidate.content && candidate.content.parts) || [];
    let text = null;
    const images = [];
    for (const part of respParts) {
      if (part.text) {
        text = (text || "") + part.text;
      } else if (part.inlineData) {
        images.push({ mimeType: part.inlineData.mimeType, base64: part.inlineData.data });
      }
    }
    return { text, images };
  }

  global.S2D = global.S2D || {};
  global.S2D.geminiApi = {
    DEFAULT_MODEL,
    getApiKey,
    setApiKey,
    getModel,
    setModel,
    getSessionCallCount,
    resetSessionCallCount,
    blobToBase64,
    callGemini,
  };
})(window);
