// ベストオブNギャラリー+プロンプト微修正(会話継続編集)のデータ層。
// パーツ単位で複数候補を保持し、採用切替・会話継続編集(修正指示から
// 新候補を追加、元候補は残す)を扱う。API呼び出しの実装詳細(履歴機構等)
// はUI層/gemini_api.js側が持ち、このモジュールは候補の状態管理と
// 「修正の連鎖はK回まで」という歯止めだけに責務を絞る(層の分離)。
(function (global) {
  "use strict";

  const MAX_EDIT_CHAIN = 3; // 既定3回。超えたら新規生成に戻す(画風漂流の歯止め)

  // IndexedDBへの永続化を挟むため連番カウンタは使わない
  // (リロード後に採番がリセットされ既存候補とID衝突するのを避ける)。
  function makeId() {
    return `cand-${crypto.randomUUID()}`;
  }

  function createGallery() {
    return { candidates: [], adoptedId: null };
  }

  // 新規候補(会話継続でない、最初の生成/取込)を追加する。
  function addCandidate(gallery, { imageDataUrl, source, promptText }) {
    const candidate = {
      id: makeId(),
      imageDataUrl,
      source: source || "unknown",
      promptText: promptText || null,
      editInstruction: null,
      parentId: null,
      chainDepth: 0,
    };
    gallery.candidates.push(candidate);
    if (!gallery.adoptedId) gallery.adoptedId = candidate.id;
    return candidate;
  }

  function findCandidate(gallery, id) {
    return gallery.candidates.find((c) => c.id === id) || null;
  }

  function canAddEdit(gallery, parentId) {
    const parent = findCandidate(gallery, parentId);
    if (!parent) return false;
    return parent.chainDepth < MAX_EDIT_CHAIN;
  }

  // 会話継続編集による新候補を追加する(元候補は残す)。
  // parentのchainDepthがMAX_EDIT_CHAIN以上なら追加を拒否する。
  function addEditedCandidate(gallery, parentId, { imageDataUrl, source, editInstruction }) {
    const parent = findCandidate(gallery, parentId);
    if (!parent) throw new Error(`親候補が見つかりません: ${parentId}`);
    if (parent.chainDepth >= MAX_EDIT_CHAIN) {
      throw new Error(`修正の連鎖は${MAX_EDIT_CHAIN}回までです(この候補は上限に達しています)`);
    }
    const candidate = {
      id: makeId(),
      imageDataUrl,
      source: source || "unknown",
      promptText: parent.promptText,
      editInstruction,
      parentId,
      chainDepth: parent.chainDepth + 1,
    };
    gallery.candidates.push(candidate);
    gallery.adoptedId = candidate.id; // 新しい修正版を暫定採用にする(手動で戻せる)
    return candidate;
  }

  function adoptCandidate(gallery, id) {
    if (!findCandidate(gallery, id)) throw new Error(`候補が見つかりません: ${id}`);
    gallery.adoptedId = id;
  }

  function getAdopted(gallery) {
    return gallery.adoptedId ? findCandidate(gallery, gallery.adoptedId) : null;
  }

  global.S2D = global.S2D || {};
  global.S2D.gallery = {
    MAX_EDIT_CHAIN,
    createGallery,
    addCandidate,
    addEditedCandidate,
    adoptCandidate,
    getAdopted,
    findCandidate,
    canAddEdit,
  };
})(window);
