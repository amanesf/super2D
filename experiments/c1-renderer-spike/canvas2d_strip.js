// Canvas2D短冊分割(fan bend)によるテクスチャ曲げ。
// 短冊ごとに剛体回転を割り当てる古典的な2Dスケルタル手法。
// 短冊数を増やすほど見た目は滑らかに近づくが、隣接短冊は「共通のpivotの
// 周りに少しずつ違う角度で」回転するため、境界は原理的に完全一致しない
// (継ぎ目・微小な段差が残る)。
(function (global) {
  "use strict";

  function smoothBlend(y, jointY, blendHalfWidth) {
    const t = (y - (jointY - blendHalfWidth)) / (blendHalfWidth * 2);
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * (3 - 2 * clamped); // smoothstep
  }

  function drawBentStrips(ctx, img, opts) {
    const { pivotX, pivotY, angleRad, stripCount, blendHalfWidth, destX, destY } = opts;
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const stripH = h / stripCount;

    ctx.save();
    ctx.translate(destX, destY);
    for (let i = 0; i < stripCount; i++) {
      const sy = i * stripH;
      const midY = sy + stripH / 2;
      const frac = smoothBlend(midY, pivotY, blendHalfWidth);
      const angle = angleRad * frac;

      ctx.save();
      ctx.translate(pivotX, pivotY);
      ctx.rotate(angle);
      ctx.translate(-pivotX, -pivotY);
      // わずかな重なりを持たせて隙間を目立ちにくくする実運用上の工夫も
      // 試せるが、ここでは素朴な実装(重なり無し)で比較する。
      ctx.drawImage(img, 0, sy, w, stripH, 0, sy, w, stripH);
      ctx.restore();
    }
    ctx.restore();
  }

  global.S2DExperiment = global.S2DExperiment || {};
  global.S2DExperiment.drawBentStrips = drawBentStrips;
})(window);
