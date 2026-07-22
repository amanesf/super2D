// QCゲート: 「全パーツ合成−マスター」のピクセル差分を計算し、閾値以下
// なら合格・超えたら該当パーツのみ再ロール対象とする(PLAN.md「受け入れ
// 判定の機械化」)。目視でなく数値でトライアンドエラーを制御する。
//
// パーツ別の判定は、各パーツの配置矩形(character.jsonのanchors/pivotから
// 求まる、共有1024×1024空間上の位置)に限定してマスターと合成結果を比較する。
// 特定のパーツだけ生成位置がズレた場合、そのパーツの矩形範囲内でのみ
// マスターと乖離するため、他パーツを巻き込まずにそのパーツだけ不合格に
// できる。
(function (global) {
  "use strict";

  const DEFAULT_PIXEL_DIFF_THRESHOLD = 40; // 1画素あたりのRGB差分合計がこれを超えたら「不一致」
  const DEFAULT_DIFF_RATIO_THRESHOLD = 0.05; // 不一致画素の割合がこれを超えたら不合格

  function getImageData(canvasLike) {
    if (canvasLike instanceof ImageData) return canvasLike;
    const ctx = canvasLike.getContext("2d");
    return ctx.getImageData(0, 0, canvasLike.width, canvasLike.height);
  }

  // region内(既定は画像全体)でのマスターと合成結果の不一致画素率を返す。
  function computeDiffRatio(masterCanvasLike, compositeCanvasLike, region, pixelDiffThreshold) {
    const master = getImageData(masterCanvasLike);
    const composite = getImageData(compositeCanvasLike);
    if (master.width !== composite.width || master.height !== composite.height) {
      throw new Error("マスターと合成結果のサイズが一致しません");
    }
    const threshold = pixelDiffThreshold != null ? pixelDiffThreshold : DEFAULT_PIXEL_DIFF_THRESHOLD;
    const r = region || { left: 0, top: 0, right: master.width - 1, bottom: master.height - 1 };
    const w = master.width;

    let mismatchCount = 0;
    let total = 0;
    for (let y = r.top; y <= r.bottom; y++) {
      for (let x = r.left; x <= r.right; x++) {
        const i = (y * w + x) * 4;
        const diff =
          Math.abs(master.data[i] - composite.data[i]) +
          Math.abs(master.data[i + 1] - composite.data[i + 1]) +
          Math.abs(master.data[i + 2] - composite.data[i + 2]) +
          Math.abs(master.data[i + 3] - composite.data[i + 3]);
        if (diff > threshold) mismatchCount++;
        total++;
      }
    }
    return total > 0 ? mismatchCount / total : 0;
  }

  // parts: [{ name, region: {left, top, right, bottom} }]
  // 各パーツの配置矩形範囲だけでマスターと比較し、合否を返す。
  function assessParts(masterCanvasLike, compositeCanvasLike, parts, opts) {
    opts = opts || {};
    const ratioThreshold = opts.diffRatioThreshold != null ? opts.diffRatioThreshold : DEFAULT_DIFF_RATIO_THRESHOLD;
    return parts.map((part) => {
      const diffRatio = computeDiffRatio(masterCanvasLike, compositeCanvasLike, part.region, opts.pixelDiffThreshold);
      return { name: part.name, diffRatio, passed: diffRatio <= ratioThreshold };
    });
  }

  global.S2D = global.S2D || {};
  global.S2D.qcDiff = {
    DEFAULT_PIXEL_DIFF_THRESHOLD,
    DEFAULT_DIFF_RATIO_THRESHOLD,
    computeDiffRatio,
    assessParts,
  };
})(window);
