// 圧縮(Stage E)。source(フル品質PNG)からpublic(配信用WebP)を作り、
// character.json+public+任意source+generation_logをZIP一括で書き出す。
// canvas.toBlob("image/webp", q)はChromiumベースのブラウザでネイティブ
// 対応しており、sharp等のNode依存パッケージは不要(PLAN.md「Stage E」節)。
// ZIP化は既存のjs/vendor/jszip.min.js(B5のZIP読込で既に使用)を再利用する。
(function (global) {
  "use strict";

  const DEFAULT_QUALITY = 0.9;

  // drawable(Image/ImageBitmap/canvas等drawImage可能なもの)をWebP Blobに変換する。
  function compressToWebp(drawable, quality) {
    const q = quality != null ? quality : DEFAULT_QUALITY;
    const w = drawable.naturalWidth || drawable.width;
    const h = drawable.naturalHeight || drawable.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    canvas.getContext("2d").drawImage(drawable, 0, 0, w, h);
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("WebPエンコードに失敗しました(toBlobがnullを返した)"))),
        "image/webp",
        q
      );
    });
  }

  function replaceExtToWebp(srcPath) {
    return srcPath.replace(/\.png$/i, ".webp");
  }

  // manifest内のsrcフィールド(parts[name].src / states[..].src)を全て
  // .png→.webpに書き換えたディープコピーを返す(元のmanifestは変更しない)。
  function rewriteManifestSrcsToWebp(manifest) {
    const clone = JSON.parse(JSON.stringify(manifest));
    for (const part of Object.values(clone.parts || {})) {
      if (part.src) part.src = replaceExtToWebp(part.src);
      if (part.states) {
        for (const st of Object.values(part.states)) {
          if (st.src) st.src = replaceExtToWebp(st.src);
        }
      }
    }
    return clone;
  }

  // sourcePngBlobs: { "public/torso.png": Blob(PNG), ... }
  // 戻り値: { blob(ZIP), totalSourceBytes, totalPublicBytes, publicPaths }
  async function buildCharacterZip({ manifest, sourcePngBlobs, quality, includeSource, generationLogText }) {
    if (!global.JSZip) throw new Error("JSZipが読み込まれていません(js/vendor/jszip.min.js)");
    const zip = new global.JSZip();
    const newManifest = rewriteManifestSrcsToWebp(manifest);

    let totalSourceBytes = 0;
    let totalPublicBytes = 0;
    const publicPaths = [];

    for (const [srcPath, blob] of Object.entries(sourcePngBlobs || {})) {
      totalSourceBytes += blob.size;
      const bitmap = await createImageBitmap(blob);
      const webpBlob = await compressToWebp(bitmap, quality);
      const webpPath = replaceExtToWebp(srcPath);
      zip.file(webpPath, webpBlob);
      publicPaths.push(webpPath);
      totalPublicBytes += webpBlob.size;
      if (includeSource) {
        zip.file(srcPath.replace(/^public\//, "source/"), blob);
      }
    }

    zip.file("character.json", JSON.stringify(newManifest, null, 2));
    if (generationLogText) zip.file("generation_log.json", generationLogText);

    const blob = await zip.generateAsync({ type: "blob" });
    return { blob, totalSourceBytes, totalPublicBytes, publicPaths };
  }

  global.S2D = global.S2D || {};
  global.S2D.compress = { DEFAULT_QUALITY, compressToWebp, rewriteManifestSrcsToWebp, buildCharacterZip };
})(window);
