// studio.htmlのタブ構成をデータ定義として持つ(PLAN.md「パイプラインは
// データ定義で駆動する」)。タブUIはこの配列を描画するだけで、カテゴリや
// ステップの追加はここにオブジェクトを足すだけにする。
// D1時点ではスケルトン(タブ描画+進捗のIndexedDB保存/再開)のみを扱う。
// 各ステップの実処理(API呼び出し・QC等)はD2以降で追加する。
(function (global) {
  "use strict";

  const STEPS = [
    { id: "input", title: "1. 画像投入・APIキー設定", promptFile: null, generation: false },
    { id: "master", title: "2. マスター生成", promptFile: null, generation: false },
    { id: "detect", title: "3. パーツ検出", promptFile: "prompts/part_detection_v1.txt", generation: true },
    { id: "parts", title: "4. パーツ別in-situ生成", promptFile: "prompts/part_insitu_v1.txt", generation: true },
    { id: "qc", title: "5. モーション/継ぎ目QC", promptFile: null, generation: false },
  ];

  const SESSION_KEY = "studio_session";

  function defaultSession() {
    return { currentStepId: STEPS[0].id, completedStepIds: [], stepData: {} };
  }

  async function loadSession() {
    const saved = await global.S2D.idb.get(SESSION_KEY);
    if (!saved) return defaultSession();
    // 未知のstepId(古いセッションが指す削除済みステップ等)は先頭に戻す。
    if (!STEPS.some((s) => s.id === saved.currentStepId)) {
      saved.currentStepId = STEPS[0].id;
    }
    return saved;
  }

  function saveSession(session) {
    return global.S2D.idb.set(SESSION_KEY, session);
  }

  function markStepComplete(session, stepId, data) {
    if (!session.completedStepIds.includes(stepId)) {
      session.completedStepIds.push(stepId);
    }
    if (data !== undefined) {
      session.stepData[stepId] = data;
    }
    const idx = STEPS.findIndex((s) => s.id === stepId);
    const next = STEPS[idx + 1];
    if (next) session.currentStepId = next.id;
    return session;
  }

  global.S2D = global.S2D || {};
  global.S2D.studioPipeline = {
    STEPS,
    defaultSession,
    loadSession,
    saveSession,
    markStepComplete,
  };
})(window);
