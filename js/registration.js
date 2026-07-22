// レジストレーション(座標系の機械補正)。PLAN.md「レジストレーション」節:
// Geminiは絶対解像度でなくアスペクト比を優先するため、リサイズだけでは
// 内容の位置ズレを補正できない。ここではマスターと生成画像それぞれの
// 内容バウンディングボックス(js/normalize.jsと同じ背景差分検出)を比較し、
// 生成画像側の平行移動・等倍スケールのズレを推定してアフィン補正する。
//
// PLAN.mdはトンボ検出/位相相関の2案を挙げているが、in-situプロンプトは
// 既に「マスターと同一の座標系・背景色」を指示しており(prompts/
// part_insitu_v1.txt)、内容バウンディングボックス自体がその座標系の
// 実測値になる。トンボ(新規マーカー)や位相相関(FFT実装)を追加せずとも
// 同じ補正ができるため、既存のD0b実装(js/normalize.js)を再利用する形を
// 採る(CLAUDE.mdルール1: 設計判断を変える大きな話ではなく実装手段の選択)。
(function (global) {
  "use strict";

  function getImageData(canvasLike) {
    if (canvasLike instanceof ImageData) return canvasLike;
    const ctx = canvasLike.getContext("2d");
    return ctx.getImageData(0, 0, canvasLike.width, canvasLike.height);
  }

  // マスター画像に対する生成画像のズレ(dx, dy, scale)を推定する。
  // scaleは生成画像側の内容を何倍すればマスターと同じサイズになるか。
  // dx, dyはスケール後、生成画像の内容左上をマスターの内容左上に
  // 合わせるために必要な平行移動量(px、生成画像の座標系基準)。
  function estimateTransform(masterCanvasLike, targetCanvasLike) {
    const internal = global.S2D._normalizeInternal;
    const masterData = getImageData(masterCanvasLike);
    const targetData = getImageData(targetCanvasLike);

    const masterBg = internal.detectBackgroundColor(masterData);
    const masterBBox = internal.contentBBox(masterData, masterBg);
    const targetBg = internal.detectBackgroundColor(targetData);
    const targetBBox = internal.contentBBox(targetData, targetBg);

    const masterW = masterBBox.right - masterBBox.left + 1;
    const masterH = masterBBox.bottom - masterBBox.top + 1;
    const targetW = targetBBox.right - targetBBox.left + 1;
    const targetH = targetBBox.bottom - targetBBox.top + 1;

    const scaleW = masterW / targetW;
    const scaleH = masterH / targetH;
    const scale = (scaleW + scaleH) / 2;

    // 生成画像の内容左上をscale倍した位置が、マスターの内容左上に
    // 一致するために必要な平行移動量。
    const dx = masterBBox.left - targetBBox.left * scale;
    const dy = masterBBox.top - targetBBox.top * scale;

    return { dx, dy, scale, masterBBox, targetBBox };
  }

  // targetCanvasLikeにestimateTransformの補正を適用し、masterと同じ
  // 座標系に載った新しいcanvasを返す(サイズはmasterと同じ)。
  function applyCorrection(masterCanvasLike, targetCanvasLike, transform) {
    const t = transform || estimateTransform(masterCanvasLike, targetCanvasLike);
    const masterW = masterCanvasLike.width || masterCanvasLike.canvas.width;
    const masterH = masterCanvasLike.height || masterCanvasLike.canvas.height;

    const outCanvas = document.createElement("canvas");
    outCanvas.width = masterW;
    outCanvas.height = masterH;
    const ctx = outCanvas.getContext("2d");
    ctx.setTransform(t.scale, 0, 0, t.scale, t.dx, t.dy);
    ctx.drawImage(targetCanvasLike, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return { canvas: outCanvas, transform: t };
  }

  function registerImage(masterCanvasLike, targetCanvasLike) {
    const transform = estimateTransform(masterCanvasLike, targetCanvasLike);
    return applyCorrection(masterCanvasLike, targetCanvasLike, transform);
  }

  global.S2D = global.S2D || {};
  global.S2D.registration = { estimateTransform, applyCorrection, registerImage };
})(window);
