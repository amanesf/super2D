// 生成ログ(provenance)。全API呼び出し・手動取込を記録し、
// 「このパーツはどのプロンプトのどの試行か」を後から追えるようにする
// (PLAN.md「生成ログ(provenance)」節)。IndexedDBに保持し、
// キャラクターバンドル書き出し時にgeneration_log.jsonとして同梱する
// (Stage E/E1で配線)。
(function (global) {
  "use strict";

  const LOG_KEY = "generation_log";

  // entry: { timestamp, model, promptFile, promptVersion, inputHash,
  //          partName, qcDiffRatio, adopted, source }
  async function append(entry) {
    const log = await getAll();
    log.push(Object.assign({ timestamp: new Date().toISOString() }, entry));
    await global.S2D.idb.set(LOG_KEY, log);
    return log;
  }

  async function getAll() {
    const log = await global.S2D.idb.get(LOG_KEY);
    return log || [];
  }

  async function clear() {
    await global.S2D.idb.set(LOG_KEY, []);
  }

  async function toJSONText() {
    return JSON.stringify(await getAll(), null, 2);
  }

  global.S2D = global.S2D || {};
  global.S2D.generationLog = { append, getAll, clear, toJSONText };
})(window);
