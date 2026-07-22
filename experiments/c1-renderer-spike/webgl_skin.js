// WebGLの三角メッシュ+頂点ごとの2ボーンブレンドスキニングによる
// テクスチャ曲げ。頂点単位で連続的に変形するため、短冊方式と違い
// メッシュの継ぎ目(隙間・段差)が原理的に生じない。
(function (global) {
  "use strict";

  const VERT_SRC = `
    attribute vec2 aPosition;
    attribute vec2 aTexCoord;
    attribute float aWeight;
    uniform vec2 uPivot;
    uniform float uAngle;
    uniform vec2 uResolution;
    uniform vec2 uOrigin;
    varying vec2 vTexCoord;

    vec2 rotateAround(vec2 p, vec2 pivot, float angle) {
      float c = cos(angle);
      float s = sin(angle);
      vec2 d = p - pivot;
      return pivot + vec2(d.x * c - d.y * s, d.x * s + d.y * c);
    }

    void main() {
      vec2 restPos = aPosition;
      vec2 bentPos = rotateAround(restPos, uPivot, uAngle);
      vec2 skinned = mix(restPos, bentPos, aWeight);
      vec2 pixelPos = skinned + uOrigin;
      vec2 clip = (pixelPos / uResolution) * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      vTexCoord = aTexCoord;
    }
  `;

  const FRAG_SRC = `
    precision mediump float;
    varying vec2 vTexCoord;
    uniform sampler2D uTexture;
    void main() {
      gl_FragColor = texture2D(uTexture, vTexCoord);
    }
  `;

  function compileShader(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("シェーダーのコンパイルに失敗: " + info);
    }
    return shader;
  }

  function createProgram(gl) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, VERT_SRC);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, FRAG_SRC);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error("シェーダーのリンクに失敗: " + gl.getProgramInfoLog(program));
    }
    return program;
  }

  function smoothBlend(y, jointY, blendHalfWidth) {
    const t = (y - (jointY - blendHalfWidth)) / (blendHalfWidth * 2);
    const clamped = Math.max(0, Math.min(1, t));
    return clamped * clamped * (3 - 2 * clamped);
  }

  // Canvas2D側と同じsmoothBlend関数・同じblendHalfWidthを使うことで、
  // 「継ぎ目の有無」以外の条件を揃えたフェアな比較にする。
  function buildMesh(w, h, cols, rows, pivotY, blendHalfWidth) {
    const positions = [];
    const texCoords = [];
    const weights = [];
    const indices = [];

    for (let r = 0; r <= rows; r++) {
      const y = (h * r) / rows;
      const weight = smoothBlend(y, pivotY, blendHalfWidth);
      for (let c = 0; c <= cols; c++) {
        const x = (w * c) / cols;
        positions.push(x, y);
        texCoords.push(x / w, y / h);
        weights.push(weight);
      }
    }

    const rowStride = cols + 1;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i0 = r * rowStride + c;
        const i1 = i0 + 1;
        const i2 = i0 + rowStride;
        const i3 = i2 + 1;
        indices.push(i0, i2, i1, i1, i2, i3);
      }
    }

    return { positions, texCoords, weights, indices };
  }

  function createSkinnedRenderer(gl, img, meshOpts) {
    const program = createProgram(gl);
    const mesh = buildMesh(
      meshOpts.width, meshOpts.height, meshOpts.cols, meshOpts.rows,
      meshOpts.pivotY, meshOpts.blendHalfWidth
    );

    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions), gl.STATIC_DRAW);

    const texBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.texCoords), gl.STATIC_DRAW);

    const weightBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, weightBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.weights), gl.STATIC_DRAW);

    const idxBuf = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);

    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    const aPosition = gl.getAttribLocation(program, "aPosition");
    const aTexCoord = gl.getAttribLocation(program, "aTexCoord");
    const aWeight = gl.getAttribLocation(program, "aWeight");
    const uPivot = gl.getUniformLocation(program, "uPivot");
    const uAngle = gl.getUniformLocation(program, "uAngle");
    const uResolution = gl.getUniformLocation(program, "uResolution");
    const uOrigin = gl.getUniformLocation(program, "uOrigin");
    const uTexture = gl.getUniformLocation(program, "uTexture");

    return {
      draw(angleRad, pivotX, pivotY, originX, originY) {
        gl.useProgram(program);

        gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
        gl.enableVertexAttribArray(aPosition);
        gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, texBuf);
        gl.enableVertexAttribArray(aTexCoord);
        gl.vertexAttribPointer(aTexCoord, 2, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ARRAY_BUFFER, weightBuf);
        gl.enableVertexAttribArray(aWeight);
        gl.vertexAttribPointer(aWeight, 1, gl.FLOAT, false, 0, 0);

        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, idxBuf);

        gl.uniform2f(uPivot, pivotX, pivotY);
        gl.uniform1f(uAngle, angleRad);
        gl.uniform2f(uResolution, gl.canvas.width, gl.canvas.height);
        gl.uniform2f(uOrigin, originX, originY);

        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.uniform1i(uTexture, 0);

        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

        gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
      },
    };
  }

  global.S2DExperiment = global.S2DExperiment || {};
  global.S2DExperiment.createSkinnedRenderer = createSkinnedRenderer;
})(window);
