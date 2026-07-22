// マッティング(切り抜き)。PLAN.md「アルファの決定論化」節の第一候補
// 「デュアル背景マッティング」を実装する: 同一パーツを白背景・黒背景の
// 2回生成し(in-situなので位置は同一のはず)、2枚の画素差からα値を
// 計算で求める(半透明の毛先まで厳密に復元できる)。
//
// 原理: 前景色F・不透明度aの画素を白(255)背景に合成するとI0=a*F+(1-a)*255、
// 黒(0)背景に合成するとI1=a*Fになる。差分I0-I1=(1-a)*255からaが求まり、
// I1=a*Fからαで割り戻せばFが求まる(a=0付近は数値不安定なので0扱いにする)。
//
// 位置ズレ検出(2回の生成間でズレていないか)は、白背景側は白から、
// 黒背景側は黒からの色距離で「内容」のバウンディングボックスをそれぞれ
// 検出し、両者の左上のズレ量を返す(閾値超過を呼び出し側の不合格判定に使う)。
(function (global) {
  "use strict";

  const BG_DIFF_THRESHOLD = 18; // js/normalize.jsと同じ閾値(内容とみなす差分)
  const ALPHA_EPSILON = 0.02; // これ未満のalphaは前景色復元をせず透明画素として扱う

  function getImageData(canvasLike) {
    if (canvasLike instanceof ImageData) return canvasLike;
    const ctx = canvasLike.getContext("2d");
    return ctx.getImageData(0, 0, canvasLike.width, canvasLike.height);
  }

  // 単色背景(白 or 黒)からの色距離でバウンディングボックスを求める。
  // js/normalize.jsのcontentBBoxと同じロジックだが、背景色を四隅から
  // 検出するのではなく既知の単色(bgRGB)を直接使う点だけが違う。
  function contentBBoxAgainst(imageData, bgRGB) {
    const { data, width: w, height: h } = imageData;
    let left = w, right = 0, top = h, bottom = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x += 2) {
        const i = (y * w + x) * 4;
        const diff =
          Math.abs(data[i] - bgRGB[0]) +
          Math.abs(data[i + 1] - bgRGB[1]) +
          Math.abs(data[i + 2] - bgRGB[2]);
        if (diff > BG_DIFF_THRESHOLD) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (left > right || top > bottom) return null;
    return { left, top, right, bottom };
  }

  // 白背景版・黒背景版の2枚からアルファ付きImageDataを復元する。
  // 戻り値: { imageData, positionMismatch: {dx, dy} | null }
  function recoverDualBackgroundAlpha(whiteCanvasLike, blackCanvasLike) {
    const white = getImageData(whiteCanvasLike);
    const black = getImageData(blackCanvasLike);
    if (white.width !== black.width || white.height !== black.height) {
      throw new Error("白背景版と黒背景版のサイズが一致しません");
    }
    const w = white.width;
    const h = white.height;
    const out = new Uint8ClampedArray(w * h * 4);

    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      let alphaSum = 0;
      const fPremult = [0, 0, 0];
      for (let c = 0; c < 3; c++) {
        const i0 = white.data[i + c];
        const i1 = black.data[i + c];
        const a = 1 - (i0 - i1) / 255;
        alphaSum += a;
        fPremult[c] = i1; // = a * F(元の意味でのF)。aで割るのは後段でまとめて行う
      }
      const alpha = Math.min(1, Math.max(0, alphaSum / 3));
      out[i + 3] = Math.round(alpha * 255);
      if (alpha < ALPHA_EPSILON) {
        out[i] = 0;
        out[i + 1] = 0;
        out[i + 2] = 0;
      } else {
        out[i] = Math.min(255, Math.max(0, Math.round(fPremult[0] / alpha)));
        out[i + 1] = Math.min(255, Math.max(0, Math.round(fPremult[1] / alpha)));
        out[i + 2] = Math.min(255, Math.max(0, Math.round(fPremult[2] / alpha)));
      }
    }

    const whiteBBox = contentBBoxAgainst(white, [255, 255, 255]);
    const blackBBox = contentBBoxAgainst(black, [0, 0, 0]);
    let positionMismatch = null;
    if (whiteBBox && blackBBox) {
      positionMismatch = {
        dx: blackBBox.left - whiteBBox.left,
        dy: blackBBox.top - whiteBBox.top,
      };
    }

    return { imageData: new ImageData(out, w, h), positionMismatch };
  }

  // フォールバック: クロマキー(単色、既定#00FF00)+色距離ベースのα算出。
  // 位置ズレ検出は2枚要求するデュアル背景と違い単独画像なので対象外。
  function computeChromaKeyAlpha(canvasLike, opts) {
    opts = opts || {};
    const keyRGB = opts.keyRGB || [0, 255, 0];
    const tolerance = opts.tolerance != null ? opts.tolerance : 40; // これ未満の距離は完全透明
    const feather = opts.feather != null ? opts.feather : 40; // toleranceからこの幅で不透明へ遷移

    const src = getImageData(canvasLike);
    const w = src.width;
    const h = src.height;
    const out = new Uint8ClampedArray(w * h * 4);

    for (let p = 0; p < w * h; p++) {
      const i = p * 4;
      const dr = src.data[i] - keyRGB[0];
      const dg = src.data[i + 1] - keyRGB[1];
      const db = src.data[i + 2] - keyRGB[2];
      const dist = Math.sqrt(dr * dr + dg * dg + db * db);
      let alpha;
      if (dist <= tolerance) {
        alpha = 0;
      } else if (dist >= tolerance + feather) {
        alpha = 1;
      } else {
        alpha = (dist - tolerance) / feather;
      }
      out[i] = src.data[i];
      out[i + 1] = src.data[i + 1];
      out[i + 2] = src.data[i + 2];
      out[i + 3] = Math.round(alpha * 255);
    }

    return new ImageData(out, w, h);
  }

  global.S2D = global.S2D || {};
  global.S2D.matting = { recoverDualBackgroundAlpha, computeChromaKeyAlpha };
})(window);
