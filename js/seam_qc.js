// 継ぎ目QC(D7)。関節の接続部付近を検査し、B1のような「呼吸/回転で
// 継ぎ目に隙間(背景が透けて見える)が開く」不具合を数値で検知する。
// 目視のズーム表示に加え、この関数で「隙間あり/なし」を機械判定できる
// ようにする(CLAUDE.mdの「数値でトライアンドエラーを制御する」方針)。
(function (global) {
  "use strict";

  const DEFAULT_ALPHA_THRESHOLD = 10; // これ以下のalphaは「背景が透けている」とみなす

  // (cx, cy)を中心とした半径radius px四方を走査し、alphaがthreshold以下の
  // 画素が1つでもあれば継ぎ目に隙間ありと判定する。
  function detectSeamGap(imageData, cx, cy, radius, alphaThreshold) {
    const threshold = alphaThreshold != null ? alphaThreshold : DEFAULT_ALPHA_THRESHOLD;
    const { data, width: w, height: h } = imageData;
    let gapPixelCount = 0;
    let minAlpha = 255;
    const left = Math.max(0, Math.round(cx - radius));
    const right = Math.min(w - 1, Math.round(cx + radius));
    const top = Math.max(0, Math.round(cy - radius));
    const bottom = Math.min(h - 1, Math.round(cy + radius));

    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const a = data[(y * w + x) * 4 + 3];
        if (a < minAlpha) minAlpha = a;
        if (a <= threshold) gapPixelCount++;
      }
    }

    return { hasGap: gapPixelCount > 0, gapPixelCount, minAlpha };
  }

  // detectSeamGapの弱点: 関節の外側は元々何も描かれていない(背景)ため、
  // 単純な透過閾値だけでは「継ぎ目の穴」と「元々のキャラクターシルエット
  // の外側」を区別できない。B1のような不具合は「静止姿勢では隙間が
  // 無かったのに、角度を動かすと新たに透過になる画素が出る」形で現れる
  // ため、静止姿勢(baseline)との差分(不透明→透過に変わった画素)で
  // 判定する方がロバスト。
  function detectSeamRegression(baselineImageData, currentImageData, cx, cy, radius, alphaThreshold) {
    const threshold = alphaThreshold != null ? alphaThreshold : DEFAULT_ALPHA_THRESHOLD;
    const { data: baseData, width: w, height: h } = baselineImageData;
    const curData = currentImageData.data;
    let newGapPixelCount = 0;
    const left = Math.max(0, Math.round(cx - radius));
    const right = Math.min(w - 1, Math.round(cx + radius));
    const top = Math.max(0, Math.round(cy - radius));
    const bottom = Math.min(h - 1, Math.round(cy + radius));

    for (let y = top; y <= bottom; y++) {
      for (let x = left; x <= right; x++) {
        const i = (y * w + x) * 4 + 3;
        const wasOpaque = baseData[i] > threshold;
        const isNowGap = curData[i] <= threshold;
        if (wasOpaque && isNowGap) newGapPixelCount++;
      }
    }

    return { hasNewGap: newGapPixelCount > 0, newGapPixelCount };
  }

  global.S2D = global.S2D || {};
  global.S2D.seamQc = { detectSeamGap, detectSeamRegression, DEFAULT_ALPHA_THRESHOLD };
})(window);
