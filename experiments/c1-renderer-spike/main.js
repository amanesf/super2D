(function () {
  "use strict";

  // テクスチャローカル座標での関節位置(袖と籠手の境目付近)。
  // Canvas2D側・WebGL側で完全に同じ値を使い、条件を揃える。
  const PIVOT_LOCAL = { x: 100, y: 170 };
  const BLEND_HALF_WIDTH = 40;
  const DEST_OFFSET = { x: 80, y: 60 };

  const angleSlider = document.getElementById("angle");
  const angleValue = document.getElementById("angle-value");
  const stripsSlider = document.getElementById("strips");
  const stripsValue = document.getElementById("strip-value");
  const statusEl = document.getElementById("status");

  const canvas2d = document.getElementById("canvas2d");
  const ctx2d = canvas2d.getContext("2d");

  const glCanvas = document.getElementById("webgl");
  const gl = glCanvas.getContext("webgl");

  const img = new Image();
  img.src = "assets/arm_test.png";

  let skinnedRenderer = null;

  function render() {
    const angleDeg = Number(angleSlider.value);
    const angleRad = (angleDeg * Math.PI) / 180;
    const stripCount = Number(stripsSlider.value);
    angleValue.textContent = angleDeg;
    stripsValue.textContent = stripCount;

    ctx2d.clearRect(0, 0, canvas2d.width, canvas2d.height);
    window.S2DExperiment.drawBentStrips(ctx2d, img, {
      pivotX: PIVOT_LOCAL.x,
      pivotY: PIVOT_LOCAL.y,
      angleRad,
      stripCount,
      blendHalfWidth: BLEND_HALF_WIDTH,
      destX: DEST_OFFSET.x,
      destY: DEST_OFFSET.y,
    });

    if (skinnedRenderer) {
      gl.viewport(0, 0, glCanvas.width, glCanvas.height);
      gl.clearColor(1, 1, 1, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      skinnedRenderer.draw(angleRad, PIVOT_LOCAL.x, PIVOT_LOCAL.y, DEST_OFFSET.x, DEST_OFFSET.y);
    }
  }

  angleSlider.addEventListener("input", render);
  stripsSlider.addEventListener("input", render);

  img.onload = () => {
    if (!gl) {
      statusEl.textContent = "このブラウザ/環境ではWebGLコンテキストを取得できませんでした。";
      return;
    }
    skinnedRenderer = window.S2DExperiment.createSkinnedRenderer(gl, img, {
      width: img.naturalWidth,
      height: img.naturalHeight,
      cols: 24,
      rows: 40,
      pivotY: PIVOT_LOCAL.y,
      blendHalfWidth: BLEND_HALF_WIDTH,
    });
    statusEl.textContent = "読み込み完了。スライダーで曲げ角度・短冊数を動かして比較してください。";
    render();
  };
  img.onerror = () => {
    statusEl.textContent = "テスト画像の読み込みに失敗しました: " + img.src;
  };
})();
