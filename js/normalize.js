// 入力画像の正規化(参照画像→1024x1024標準キャンバス)。
// scripts/normalize_reference.js(Node/Jimp版)と同じ規則・同じ結果に
// なるようブラウザ実装する(D0b)。ここが正、Nodeスクリプトは開発補助。
//
// リサイズ部分はJimpが内部で使うJS-Image-Resizer(Grant Galitz,
// public domain)のアルゴリズムをそのまま移植している。Canvasの
// drawImageによるネイティブ拡縮はブラウザ実装依存でJimpの結果と
// ピクセル一致しないため、あえてCanvasの自動拡縮を使わずこの
// アルゴリズムで手計算している。
(function (global) {
  "use strict";

  const CANVAS_W = 1024;
  const CANVAS_H = 1024;
  const TARGET_CONTENT_H = 896; // キャンバス高さの87.5%
  const BOTTOM_MARGIN_PX = 24; // 足元は地面に接するため上下均等ではなく下余白を小さく固定する
  const BG_SAMPLE_MARGIN = 4;
  const BG_DIFF_THRESHOLD = 18; // 背景色からの差分がこれを超えたら「内容」とみなす

  function detectBackgroundColor(imageData) {
    const { data, width: w, height: h } = imageData;
    const corners = [
      [BG_SAMPLE_MARGIN, BG_SAMPLE_MARGIN],
      [w - 1 - BG_SAMPLE_MARGIN, BG_SAMPLE_MARGIN],
      [BG_SAMPLE_MARGIN, h - 1 - BG_SAMPLE_MARGIN],
      [w - 1 - BG_SAMPLE_MARGIN, h - 1 - BG_SAMPLE_MARGIN],
    ];
    let r = 0, g = 0, b = 0;
    for (const [x, y] of corners) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return { r: Math.round(r / 4), g: Math.round(g / 4), b: Math.round(b / 4) };
  }

  function contentBBox(imageData, bg) {
    const { data, width: w, height: h } = imageData;
    let left = w, right = 0, top = h, bottom = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x += 2) { // 高速化のため2px間引き(Node版と同じ)
        const i = (y * w + x) * 4;
        const diff =
          Math.abs(data[i] - bg.r) +
          Math.abs(data[i + 1] - bg.g) +
          Math.abs(data[i + 2] - bg.b);
        if (diff > BG_DIFF_THRESHOLD) {
          if (x < left) left = x;
          if (x > right) right = x;
          if (y < top) top = y;
          if (y > bottom) bottom = y;
        }
      }
    }
    if (left > right || top > bottom) {
      throw new Error("背景と区別できるコンテンツが見つからなかった");
    }
    return { left, top, right, bottom };
  }

  // --- JS-Image-Resizer(Jimpのデフォルトresizeと同一アルゴリズム)---
  // RGBA(4チャンネル・blendAlpha=true・interpolationPass=true)専用に
  // 簡略化して移植。ImageDataは常にRGBAなのでRGB(3ch)分岐は不要。

  function resizeWidthInterpolatedRGBA(srcData, srcW, srcH, dstW) {
    const ratioWeight = srcW / dstW;
    const out = new Float32Array(dstW * srcH * 4);
    const targetRowStride = dstW * 4;
    const srcRowStride = srcW * 4;
    const widthPassResultSize = targetRowStride * srcH;

    let weight = 0;
    let targetPosition = 0;
    for (; weight < 1 / 3; targetPosition += 4, weight += ratioWeight) {
      for (
        let finalOffset = targetPosition, pixelOffset = 0;
        finalOffset < widthPassResultSize;
        pixelOffset += srcRowStride, finalOffset += targetRowStride
      ) {
        out[finalOffset] = srcData[pixelOffset];
        out[finalOffset + 1] = srcData[pixelOffset + 1];
        out[finalOffset + 2] = srcData[pixelOffset + 2];
        out[finalOffset + 3] = srcData[pixelOffset + 3];
      }
    }

    weight -= 1 / 3;
    const readStop = srcW - 1;
    for (; weight < readStop; targetPosition += 4, weight += ratioWeight) {
      const secondWeight = weight % 1;
      const firstWeight = 1 - secondWeight;
      for (
        let finalOffset = targetPosition, pixelOffset = Math.floor(weight) * 4;
        finalOffset < widthPassResultSize;
        pixelOffset += srcRowStride, finalOffset += targetRowStride
      ) {
        out[finalOffset + 0] =
          srcData[pixelOffset + 0] * firstWeight + srcData[pixelOffset + 4 + 0] * secondWeight;
        out[finalOffset + 1] =
          srcData[pixelOffset + 1] * firstWeight + srcData[pixelOffset + 4 + 1] * secondWeight;
        out[finalOffset + 2] =
          srcData[pixelOffset + 2] * firstWeight + srcData[pixelOffset + 4 + 2] * secondWeight;
        out[finalOffset + 3] =
          srcData[pixelOffset + 3] * firstWeight + srcData[pixelOffset + 4 + 3] * secondWeight;
      }
    }

    const endReadOffset = srcRowStride - 4;
    for (; targetPosition < targetRowStride; targetPosition += 4) {
      for (
        let finalOffset = targetPosition, pixelOffset = endReadOffset;
        finalOffset < widthPassResultSize;
        pixelOffset += srcRowStride, finalOffset += targetRowStride
      ) {
        out[finalOffset] = srcData[pixelOffset];
        out[finalOffset + 1] = srcData[pixelOffset + 1];
        out[finalOffset + 2] = srcData[pixelOffset + 2];
        out[finalOffset + 3] = srcData[pixelOffset + 3];
      }
    }

    return out; // dstW x srcH, float, RGBA
  }

  function resizeWidthRGBA(srcData, srcW, srcH, dstW) {
    const ratioWeight = srcW / dstW;
    const ratioWeightDivisor = 1 / ratioWeight;
    const srcRowStride = srcW * 4;
    const dstRowStride = dstW * 4;
    const nextLineOffsetOriginalWidth = srcRowStride - 4 + 1;
    const nextLineOffsetTargetWidth = dstRowStride - 4 + 1;
    const output = new Float32Array(srcH * 4);
    const trustworthy = new Float64Array(srcH);
    const outputBuffer = new Float32Array(dstRowStride * srcH);

    let outputOffset = 0;
    // actualPosition/currentPositionは出力列をまたいで読み取りカーソルを
    // 進め続ける必要がある(このdo-while内で毎回0にリセットすると、
    // どの出力列も常にソースの先頭付近だけを平均することになり、縮小時に
    // 実質ソース全体を無視して単色に潰れる)。ループの外側で1回だけ初期化する。
    let actualPosition = 0;
    let currentPosition = 0;
    do {
      for (let line = 0; line < srcH * 4; ) {
        output[line++] = 0;
        output[line++] = 0;
        output[line++] = 0;
        output[line++] = 0;
        trustworthy[line / 4 - 1] = 0;
      }

      let weight = ratioWeight;

      do {
        const amountToNext = 1 + actualPosition - currentPosition;
        const multiplier = Math.min(weight, amountToNext);
        let line = 0;
        for (
          let pixelOffset = actualPosition;
          line < srcH * 4;
          pixelOffset += nextLineOffsetOriginalWidth
        ) {
          const r = srcData[pixelOffset];
          const g = srcData[++pixelOffset];
          const b = srcData[++pixelOffset];
          const a = srcData[++pixelOffset];
          output[line++] += (a ? r : 0) * multiplier;
          output[line++] += (a ? g : 0) * multiplier;
          output[line++] += (a ? b : 0) * multiplier;
          output[line++] += a * multiplier;
          trustworthy[line / 4 - 1] += a ? multiplier : 0;
        }

        if (weight >= amountToNext) {
          actualPosition += 4;
          currentPosition = actualPosition;
          weight -= amountToNext;
        } else {
          currentPosition += weight;
          break;
        }
      } while (weight > 0 && actualPosition < srcRowStride);

      let line = 0;
      for (
        let pixelOffset = outputOffset;
        line < srcH * 4;
        pixelOffset += nextLineOffsetTargetWidth
      ) {
        const w = trustworthy[line / 4];
        const multiplier = w ? 1 / w : 0;
        outputBuffer[pixelOffset] = output[line++] * multiplier;
        outputBuffer[++pixelOffset] = output[line++] * multiplier;
        outputBuffer[++pixelOffset] = output[line++] * multiplier;
        outputBuffer[++pixelOffset] = output[line++] * ratioWeightDivisor;
      }

      outputOffset += 4;
    } while (outputOffset < dstRowStride);

    return outputBuffer; // dstW x srcH, float, RGBA
  }

  function resizeHeightInterpolatedRGBA(srcData, dstW, srcH, dstH) {
    const ratioWeight = srcH / dstH;
    const rowStride = dstW * 4;
    const finalResultSize = rowStride * dstH;
    const outputBuffer = new Uint8ClampedArray(finalResultSize);

    let weight = 0;
    let finalOffset = 0;
    for (; weight < 1 / 3; weight += ratioWeight) {
      for (let pixelOffset = 0; pixelOffset < rowStride; ) {
        outputBuffer[finalOffset++] = Math.round(srcData[pixelOffset++]);
      }
    }

    weight -= 1 / 3;
    const readStop = srcH - 1;
    for (; weight < readStop; weight += ratioWeight) {
      const secondWeight = weight % 1;
      const firstWeight = 1 - secondWeight;
      let acc1 = Math.floor(weight) * rowStride;
      let acc2 = acc1 + rowStride;
      for (let pixelOffset = 0; pixelOffset < rowStride; ++pixelOffset) {
        outputBuffer[finalOffset++] = Math.round(
          srcData[acc1++] * firstWeight + srcData[acc2++] * secondWeight
        );
      }
    }

    while (finalOffset < finalResultSize) {
      let acc = readStop * rowStride;
      for (let pixelOffset = 0; pixelOffset < rowStride; ++pixelOffset) {
        outputBuffer[finalOffset++] = Math.round(srcData[acc++]);
      }
    }

    return outputBuffer; // dstW x dstH, Uint8ClampedArray, RGBA
  }

  function resizeHeightRGBA(srcData, dstW, srcH, dstH) {
    const ratioWeight = srcH / dstH;
    const ratioWeightDivisor = 1 / ratioWeight;
    const rowStride = dstW * 4;
    const finalResultSize = rowStride * dstH;
    const output = new Float32Array(rowStride);
    const trustworthy = new Float64Array(dstW);
    const outputBuffer = new Uint8ClampedArray(finalResultSize);
    const srcSize = dstW * srcH * 4;

    let outputOffset = 0;
    // resizeWidthRGBAと同じ理由でactualPosition/currentPositionはループの
    // 外側で1回だけ初期化し、出力行をまたいで読み取りカーソルを進め続ける。
    let actualPosition = 0;
    let currentPosition = 0;
    do {
      for (let pixelOffset = 0; pixelOffset < rowStride; ) {
        output[pixelOffset++] = 0;
        output[pixelOffset++] = 0;
        output[pixelOffset++] = 0;
        output[pixelOffset++] = 0;
        trustworthy[pixelOffset / 4 - 1] = 0;
      }

      let weight = ratioWeight;

      do {
        const amountToNext = 1 + actualPosition - currentPosition;
        const multiplier = Math.min(weight, amountToNext);
        let caret = actualPosition;
        for (let pixelOffset = 0; pixelOffset < rowStride; ) {
          const r = srcData[caret++];
          const g = srcData[caret++];
          const b = srcData[caret++];
          const a = srcData[caret++];
          output[pixelOffset++] += (a ? r : 0) * multiplier;
          output[pixelOffset++] += (a ? g : 0) * multiplier;
          output[pixelOffset++] += (a ? b : 0) * multiplier;
          output[pixelOffset++] += a * multiplier;
          trustworthy[pixelOffset / 4 - 1] += a ? multiplier : 0;
        }

        if (weight >= amountToNext) {
          actualPosition = caret;
          currentPosition = actualPosition;
          weight -= amountToNext;
        } else {
          currentPosition += weight;
          break;
        }
      } while (weight > 0 && actualPosition < srcSize);

      for (let pixelOffset = 0; pixelOffset < rowStride; ) {
        const w = trustworthy[pixelOffset / 4];
        const multiplier = w ? 1 / w : 0;
        outputBuffer[outputOffset++] = Math.round(output[pixelOffset++] * multiplier);
        outputBuffer[outputOffset++] = Math.round(output[pixelOffset++] * multiplier);
        outputBuffer[outputOffset++] = Math.round(output[pixelOffset++] * multiplier);
        outputBuffer[outputOffset++] = Math.round(output[pixelOffset++] * ratioWeightDivisor);
      }
    } while (outputOffset < finalResultSize);

    return outputBuffer;
  }

  // srcData: Uint8ClampedArray(RGBA) srcW x srcH → dstW x dstH のUint8ClampedArrayを返す。
  function resizeRGBA(srcData, srcW, srcH, dstW, dstH) {
    let widthPassFloat;
    if (srcW === dstW) {
      widthPassFloat = Float32Array.from(srcData);
    } else {
      const ratioWidth = srcW / dstW;
      widthPassFloat =
        ratioWidth < 1
          ? resizeWidthInterpolatedRGBA(srcData, srcW, srcH, dstW)
          : resizeWidthRGBA(srcData, srcW, srcH, dstW);
    }

    if (srcH === dstH) {
      return Uint8ClampedArray.from(widthPassFloat, (v) => Math.round(v));
    }
    const ratioHeight = srcH / dstH;
    return ratioHeight < 1
      ? resizeHeightInterpolatedRGBA(widthPassFloat, dstW, srcH, dstH)
      : resizeHeightRGBA(widthPassFloat, dstW, srcH, dstH);
  }

  // 画像(Image/ImageBitmap/canvas等drawImage可能なもの)を1024x1024の
  // 標準キャンバスに正規化する。戻り値はHTMLCanvasElement。
  function normalizeImage(sourceImage, opts) {
    opts = opts || {};
    const srcW = opts.width || sourceImage.naturalWidth || sourceImage.width;
    const srcH = opts.height || sourceImage.naturalHeight || sourceImage.height;

    const srcCanvas = document.createElement("canvas");
    srcCanvas.width = srcW;
    srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext("2d");
    srcCtx.drawImage(sourceImage, 0, 0, srcW, srcH);
    const srcImageData = srcCtx.getImageData(0, 0, srcW, srcH);

    const bg = detectBackgroundColor(srcImageData);
    const { left, top, right, bottom } = contentBBox(srcImageData, bg);
    const contentW = right - left + 1;
    const contentH = bottom - top + 1;

    const cropCtx = document.createElement("canvas").getContext("2d");
    cropCtx.canvas.width = contentW;
    cropCtx.canvas.height = contentH;
    cropCtx.putImageData(srcImageData, -left, -top);
    const cropData = cropCtx.getImageData(0, 0, contentW, contentH);

    const scale = TARGET_CONTENT_H / contentH;
    const newW = Math.max(1, Math.round(contentW * scale));
    const newH = TARGET_CONTENT_H;
    const resizedData = resizeRGBA(cropData.data, contentW, contentH, newW, newH);

    const outCanvas = document.createElement("canvas");
    outCanvas.width = CANVAS_W;
    outCanvas.height = CANVAS_H;
    const outCtx = outCanvas.getContext("2d");
    outCtx.fillStyle = "#ffffff";
    outCtx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // 横方向は中央寄せのままでよいが、縦方向は上下均等にしない。
    // 足元(下端)は地面に接する想定で余白を必要としない一方、上端側は
    // 髪の揺れ・持ち物・頭上の演出等で動く余地が要るため、余った余白を
    // すべて上に回す(下端だけ固定の小さい余白を残す非対称配置)。
    const xOff = Math.floor((CANVAS_W - newW) / 2);
    const yOff = CANVAS_H - newH - BOTTOM_MARGIN_PX;
    const resizedImageData = new ImageData(resizedData, newW, newH);
    const compositeCanvas = document.createElement("canvas");
    compositeCanvas.width = newW;
    compositeCanvas.height = newH;
    compositeCanvas.getContext("2d").putImageData(resizedImageData, 0, 0);
    outCtx.drawImage(compositeCanvas, xOff, yOff);

    return outCanvas;
  }

  global.S2D = global.S2D || {};
  global.S2D.normalizeImage = normalizeImage;
  // テストからの直接検証用に内部関数も公開する。
  global.S2D._normalizeInternal = {
    detectBackgroundColor,
    contentBBox,
    resizeRGBA,
  };
})(window);
