// super2D 試作ビューア(プレースホルダーパーツで動作確認用)
// character.json(characters/<id>/character.json)の親子階層・ピボットを読み、
// WebGLで組み立てて描画・アニメーションする。
// レンダラはC1のスパイク実験(experiments/c1-renderer-spike/)の比較結果を
// 踏まえてWebGL(三角メッシュ)に確定した(PLAN.md「C1決定」節参照)。
// リグ・アニメーションのロジック(階層変換・呼吸/揺れ/まばたき・
// クロスフェード)はレンダラ非依存のまま変更していない。
(function () {
  "use strict";

  const canvas = document.getElementById("stage");
  const statusEl = document.getElementById("status");
  // preserveDrawingBuffer: テスト(tests/render_golden.test.js)がフレーム後に
  // gl.readPixels()で描画結果を読み戻せるようにするため有効化する。
  const gl = canvas.getContext("webgl", { alpha: true, preserveDrawingBuffer: true });
  if (!gl) {
    statusEl.style.color = "#f87171";
    statusEl.textContent = "このブラウザ/環境ではWebGLコンテキストを取得できませんでした。";
    throw new Error("WebGL unavailable");
  }

  // 全パーツ共通の矩形描画(ユニットクアッド)シェーダー。
  // パーツごとの違いはすべてuniform(サイズ・ピボット・ワールド位置・
  // 回転・スケール)で表現し、頂点バッファは1つを使い回す。
  const VERT_SRC = `
    attribute vec2 aUnit; // (0,0)〜(1,1)の単位方形
    uniform vec2 uSize;
    uniform vec2 uPivot;
    uniform vec2 uWorldPos;
    uniform float uAngle;
    uniform vec2 uScale;
    uniform vec2 uResolution;
    varying vec2 vTexCoord;

    void main() {
      vec2 localPos = (aUnit * uSize) - uPivot;
      vec2 scaled = localPos * uScale;
      float c = cos(uAngle);
      float s = sin(uAngle);
      vec2 rotated = vec2(scaled.x * c - scaled.y * s, scaled.x * s + scaled.y * c);
      vec2 pixelPos = uWorldPos + rotated;
      vec2 clip = (pixelPos / uResolution) * 2.0 - 1.0;
      gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
      vTexCoord = aUnit;
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

  function compileShader(type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("シェーダーのコンパイルに失敗しました: " + info);
    }
    return shader;
  }

  const program = gl.createProgram();
  gl.attachShader(program, compileShader(gl.VERTEX_SHADER, VERT_SRC));
  gl.attachShader(program, compileShader(gl.FRAGMENT_SHADER, FRAG_SRC));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error("シェーダーのリンクに失敗しました: " + gl.getProgramInfoLog(program));
  }

  const unitBuf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, unitBuf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  const aUnit = gl.getAttribLocation(program, "aUnit");

  const uLoc = {
    size: gl.getUniformLocation(program, "uSize"),
    pivot: gl.getUniformLocation(program, "uPivot"),
    worldPos: gl.getUniformLocation(program, "uWorldPos"),
    angle: gl.getUniformLocation(program, "uAngle"),
    scale: gl.getUniformLocation(program, "uScale"),
    resolution: gl.getUniformLocation(program, "uResolution"),
    texture: gl.getUniformLocation(program, "uTexture"),
  };

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  function createTextureFromImage(img) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  // 矩形1枚を描く(パーツ・全身スプライト共通)。pivotが(0,0)・scaleが
  // (1,1)・angleが0なら、(0,0)-(w,h)のまま画面左上基準で描かれる
  // (body_poseの全身スプライトはこの既定値で使う)。
  function drawQuad(texture, size, pivot, worldPos, angleRad, scaleXY) {
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, unitBuf);
    gl.enableVertexAttribArray(aUnit);
    gl.vertexAttribPointer(aUnit, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(uLoc.size, size[0], size[1]);
    gl.uniform2f(uLoc.pivot, pivot[0], pivot[1]);
    gl.uniform2f(uLoc.worldPos, worldPos[0], worldPos[1]);
    gl.uniform1f(uLoc.angle, angleRad);
    gl.uniform2f(uLoc.scale, scaleXY[0], scaleXY[1]);
    gl.uniform2f(uLoc.resolution, canvas.width, canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(uLoc.texture, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  // manifest/images/textures/stateは差し替え可能(B5、ZIPドロップでの読込
  // 直後にまとめて入れ替える)。draw()等は常にこの時点の値を参照するので、
  // 「読込完了後に一括で差し替える」ことで半端な状態を描画させない。
  let manifest = null;
  let characterDir = ""; // character.jsonがあるディレクトリ(相対src解決の基点)
  let images = {}; // src -> HTMLImageElement
  let textures = {}; // src -> WebGLTexture
  let state = {}; // partName -> { angle, offsetX, offsetY, currentState }

  function getCharacterId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("character") || "placeholder-zero";
  }

  function partCurrentSrc(name, part) {
    if (part.src) return part.src;
    if (part.states && part.defaultState) {
      const st = state[name].currentState || part.defaultState;
      const entry = part.states[st];
      return (entry && entry.src) || null;
    }
    return null;
  }

  // character.jsonが参照する全画像srcの集合(重複なし)。
  // 壊れたmanifestData(parts自体が欠けている等)でも例外を投げない。
  function collectSrcs(manifestData) {
    const srcs = new Set();
    const parts = manifestData && typeof manifestData.parts === "object" ? manifestData.parts : {};
    for (const part of Object.values(parts)) {
      if (!part || typeof part !== "object") continue;
      if (part.src) srcs.add(part.src);
      if (part.states && typeof part.states === "object") {
        for (const st of Object.values(part.states)) {
          if (st && st.src) srcs.add(st.src);
        }
      }
    }
    return srcs;
  }

  function loadImageInto(imagesMap, src, resolver) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        imagesMap[src] = img;
        resolve(img);
      };
      img.onerror = () => reject(new Error(`画像の読み込みに失敗しました: ${src}`));
      img.src = resolver(src);
    });
  }

  // manifestDataの画像を全部読み込み、新しいimages/stateを作って返す
  // (既存の画面が参照している共有の images/state にはまだ触れない)。
  async function buildAssets(manifestData, resolver) {
    const newImages = {};
    const newState = {};
    for (const [name, part] of Object.entries(manifestData.parts)) {
      newState[name] = {
        angle: 0,
        offsetX: 0,
        offsetY: 0,
        scaleX: 1,
        scaleY: 1,
        currentState: part.defaultState || null,
      };
    }
    const srcs = collectSrcs(manifestData);
    await Promise.all([...srcs].map((src) => loadImageInto(newImages, src, resolver)));

    const newTextures = {};
    for (const src of Object.keys(newImages)) {
      newTextures[src] = createTextureFromImage(newImages[src]);
    }

    return { newImages, newTextures, newState };
  }

  // character.jsonを検証→画像読込→検証通過後にまとめて差し替える。
  // 失敗時は既存の表示・アニメーションをそのまま維持する(A3のエラーを
  // #statusに出すだけで、稼働中のキャラは壊さない)。
  async function loadCharacterData(manifestData, resolver) {
    const { errors, warnings } = window.S2D.validateCharacter(manifestData);
    if (warnings.length > 0) console.warn("character.json警告:\n" + warnings.join("\n"));
    if (errors.length > 0) {
      statusEl.style.color = "#f87171";
      statusEl.textContent = "character.jsonが不正です:\n" + errors.join("\n");
      console.error("character.jsonエラー:\n" + errors.join("\n"));
      return false;
    }

    let built;
    try {
      built = await buildAssets(manifestData, resolver);
    } catch (err) {
      statusEl.style.color = "#f87171";
      statusEl.textContent = "画像の読み込みに失敗しました: " + err.message;
      console.error(err);
      return false;
    }

    manifest = manifestData;
    images = built.newImages;
    textures = built.newTextures;
    state = built.newState;

    statusEl.style.color = "#6ee7b7";
    statusEl.textContent = `読み込み完了(パーツ${Object.keys(manifest.parts).length}個、プレースホルダー画像)`;
    buildStateControls();
    return true;
  }

  // 親のワールド変換(位置+回転)を再帰的に解いて、各パーツのワールド
  // 変換を返す。これが「階層構造でパーツを動かす」の核。
  function computeWorldTransforms() {
    const world = {}; // name -> {x,y,angle}

    function resolve(name) {
      if (world[name]) return world[name];
      const part = manifest.parts[name];
      const s = state[name];

      let parentX, parentY, parentAngle;
      if (part.parent === null || part.parent === undefined) {
        parentX = manifest.rootAnchor[0];
        parentY = manifest.rootAnchor[1];
        parentAngle = 0;
      } else {
        const parentWorld = resolve(part.parent);
        const parentPart = manifest.parts[part.parent];
        const parentState = state[part.parent];
        const anchorLocal = parentPart.anchors && parentPart.anchors[part.parentAnchor];
        const [ax, ay] = anchorLocal || [0, 0];
        // 親のローカルアンカー点を、親自身の描画スケール→親のワールド回転の順で変換。
        // drawQuad()の頂点シェーダーでのscale→rotateの適用順(スケールは
        // パーツ自身のローカル空間、回転はその外側)と一致させないと、呼吸等で
        // 親パーツの絵だけが伸縮してアンカー位置が追従せず継ぎ目が開く(B1)。
        const cos = Math.cos(parentWorld.angle);
        const sin = Math.sin(parentWorld.angle);
        const relX = (ax - parentPart.pivot[0]) * parentState.scaleX;
        const relY = (ay - parentPart.pivot[1]) * parentState.scaleY;
        parentX = parentWorld.x + relX * cos - relY * sin;
        parentY = parentWorld.y + relX * sin + relY * cos;
        parentAngle = parentWorld.angle;
      }

      const angle = parentAngle + s.angle;
      const x = parentX + s.offsetX;
      const y = parentY + s.offsetY;
      world[name] = { x, y, angle };
      return world[name];
    }

    for (const name of Object.keys(manifest.parts)) resolve(name);
    return world;
  }

  // body_pose(motion:sprite-select)が"rig"以外の状態のとき、通常のパーツ
  // 合成を全部飛ばしてキャンバス全面に全身スプライト1枚を描く。
  // 角度・アクション・ロコモーションはパーツ単位のstates切替では表現
  // できない(全身のポーズが変わるため)ので、この専用パーツで扱う。
  function drawBodyPoseSprite() {
    const bodyPose = manifest.parts.body_pose;
    if (!bodyPose || !bodyPose.states) return false;
    const stateName = state.body_pose.currentState || bodyPose.defaultState;
    const entry = bodyPose.states[stateName];
    if (!entry || !entry.src) return false; // "rig"状態(またはsrc無し)は通常描画へ
    const texture = textures[entry.src];
    if (!texture) return false;
    // pivot(0,0)・worldPos(0,0)・angle0・scale(1,1)で、キャンバス左上基準
    // (0,0)-(canvas.width,canvas.height)にそのまま全面表示する。
    drawQuad(texture, [canvas.width, canvas.height], [0, 0], [0, 0], 0, [1, 1]);
    return true;
  }

  function draw() {
    gl.clearColor(0, 0, 0, 0); // Canvas2D版のclearRect相当(完全透明、CSS背景を透かす)
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (drawBodyPoseSprite()) return;

    const world = computeWorldTransforms();

    for (const name of manifest.drawOrder) {
      const part = manifest.parts[name];
      const w = world[name];
      const src = partCurrentSrc(name, part);
      if (!src) continue;
      const texture = textures[src];
      if (!texture) continue;
      const s = state[name];

      drawQuad(texture, [part.w, part.h], part.pivot, [w.x, w.y], w.angle, [s.scaleX, s.scaleY]);
    }
  }

  // ---- アイドルアニメーション(呼吸・揺れ・まばたき) ----------------
  let t = 0;
  let nextBlinkAt = 1.5 + Math.random() * 2.5;
  let blinking = false;
  let blinkT = 0;

  // パーツごとのidle角度をmotion種別+motionParamsから解決する。
  // procedural-mesh-swayは親パーツの角度に追従するため、親→子の順で
  // 解決する必要がある(computeWorldTransforms()と同じresolve+memo方式)。
  function resolveIdleAngles() {
    const angleOf = {};

    function resolve(name) {
      if (angleOf[name] !== undefined) return angleOf[name];
      const part = manifest.parts[name];
      const s = state[name];
      const mp = part.motionParams || {};
      let angle = 0;

      switch (part.motion) {
        case "procedural-breathe": {
          const freq = mp.freqHz ?? 1;
          s.scaleX = 1 + Math.sin(t * freq) * (mp.ampScaleX ?? 0);
          s.scaleY = 1 + Math.sin(t * freq) * (mp.ampScaleY ?? 0);
          break;
        }
        case "procedural-sway": {
          angle = Math.sin(t * (mp.freqHz ?? 1)) * (mp.ampRad ?? 0);
          break;
        }
        case "procedural-mesh-sway": {
          const parentAngle = part.parent ? resolve(part.parent) : 0;
          angle =
            parentAngle * (mp.followRatio ?? 0) +
            Math.sin(t * (mp.freqHz ?? 1) + (mp.phase ?? 0)) * (mp.ampRad ?? 0);
          break;
        }
        default:
          break;
      }

      if (mp.idleSway) {
        const isw = mp.idleSway;
        angle += Math.sin(t * (isw.freqHz ?? 1) + (isw.phase ?? 0)) * (isw.ampRad ?? 0);
      }

      s.angle = angle;
      angleOf[name] = angle;
      return angle;
    }

    for (const name of Object.keys(manifest.parts)) resolve(name);
  }

  function updateIdle(dt) {
    t += dt;

    resolveIdleAngles();

    // まばたき(ランダム間隔、たまに素早く2回)
    if (!blinking && t >= nextBlinkAt) {
      blinking = true;
      blinkT = 0;
    }
    if (blinking) {
      blinkT += dt;
      const dur = 0.16;
      const closed = blinkT < dur;
      state.eye_l.currentState = closed ? "closed" : "open";
      state.eye_r.currentState = closed ? "closed" : "open";
      if (blinkT >= dur) {
        blinking = false;
        const doubleBlinkRoll = Math.random();
        nextBlinkAt = t + (doubleBlinkRoll < 0.15 ? 0.2 : 2 + Math.random() * 3.5);
      }
    }
  }

  // ---- 状態切替UI(parts[*].statesから動的生成) ------------------------
  // srcの無いstateは原則ボタン化しない(B3受け入れ条件)が、isRig(B4、
  // 全身スプライトから通常リグ表示へ戻すための特別枠)だけは例外。
  function buildStateControls() {
    const container = document.getElementById("state-controls");
    if (!container) return;
    container.innerHTML = "";

    for (const [name, part] of Object.entries(manifest.parts)) {
      if (!part.states) continue;
      const withSrc = Object.entries(part.states).filter(([, entry]) => entry && (entry.src || entry.isRig));
      if (withSrc.length === 0) continue;

      const group = document.createElement("div");
      group.className = "state-group";
      const label = document.createElement("span");
      label.className = "state-group-label";
      label.textContent = name + ":";
      group.appendChild(label);

      for (const [stateName] of withSrc) {
        const btn = document.createElement("button");
        btn.textContent = stateName;
        btn.addEventListener("click", () => {
          state[name].currentState = stateName;
        });
        group.appendChild(btn);
      }
      container.appendChild(group);
    }
  }

  // ---- character.jsonの書き出し(読込中のmanifestをそのままBlob化) -------
  function setupExport() {
    const btn = document.getElementById("btn-export");
    if (!btn) return;
    btn.addEventListener("click", () => {
      const json = JSON.stringify(manifest, null, 2) + "\n";
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "character.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  // ---- デモ用インタラクション ----------------------------------------
  function setupControls() {
    const waveBtn = document.getElementById("btn-wave");
    const talkBtn = document.getElementById("btn-talk");
    let waving = false;
    let talking = false;

    waveBtn.addEventListener("click", () => {
      waving = !waving;
      waveBtn.textContent = waving ? "手を振るのをやめる" : "手を振る(肘の曲げデモ)";
    });
    talkBtn.addEventListener("click", () => {
      talking = !talking;
      talkBtn.textContent = talking ? "話すのをやめる" : "話す(口パクデモ)";
    });

    return {
      get waving() { return waving; },
      get talking() { return talking; },
    };
  }

  // ---- レイヤー合成(idleベース+アクションオーバーレイ、C2) --------------
  // アクション開始・終了時に角度を即座に上書きすると同フレームで値が
  // 飛び(スナップし)腕が瞬間移動して見える。updateIdle()が設定した
  // idleの角度を「ベース」、手振りの角度を「オーバーレイ」とみなし、
  // 0.3秒のsmoothstepイージングでブレンド率を遷移させることでスナップを
  // 無くす。ブレンド中に目標が反転しても(素早くボタンを連打する等)、
  // その時点の値から新しい目標へ改めて0.3秒かけて遷移する。
  function easeSmoothstep(x) {
    const clamped = Math.max(0, Math.min(1, x));
    return clamped * clamped * (3 - 2 * clamped);
  }

  function updateBlendWeight(blend, target, tNow, duration) {
    if (target !== blend.target) {
      blend.target = target;
      blend.fromValue = blend.value;
      blend.startT = tNow;
    }
    const elapsed = tNow - blend.startT;
    const raw = duration > 0 ? elapsed / duration : 1;
    blend.value = blend.fromValue + (blend.target - blend.fromValue) * easeSmoothstep(raw);
    return blend.value;
  }

  const WAVE_BLEND_DURATION = 0.3;
  const waveBlend = { value: 0, target: 0, fromValue: 0, startT: 0 };

  function updateWave(dt, waving) {
    const weight = updateBlendWeight(waveBlend, waving ? 1 : 0, t, WAVE_BLEND_DURATION);
    if (weight <= 0) return; // 完全にidleのみなので、idleの角度に触れない

    // 肩を上げ、肘を曲げて手を振る(2剛体パーツで肘の曲げ点デモ)
    const waveUpperAngle = -1.9 + Math.sin(t * 6) * 0.05;
    const waveLowerAngle = -0.6 + Math.sin(t * 6 + 0.5) * 0.35;

    // state.arm_*.angleは既にupdateIdle()でidleの値になっている。
    // それを起点にweight分だけ手振りへブレンドする。
    state.arm_upper_r.angle += (waveUpperAngle - state.arm_upper_r.angle) * weight;
    state.arm_lower_r.angle += (waveLowerAngle - state.arm_lower_r.angle) * weight;
  }

  let wasTalking = false;
  function updateTalk(dt, talking) {
    if (!talking) {
      // 話し終わった瞬間だけrestへ戻す。毎フレーム強制すると状態切替
      // ボタン(B3)での手動選択を無条件に上書きしてしまうため。
      if (wasTalking) state.mouth.currentState = "rest";
      wasTalking = false;
      return;
    }
    wasTalking = true;
    state.mouth.currentState = Math.sin(t * 14) > 0.2 ? "aa" : "rest";
  }

  // ---- ZIPのdrag&drop読込(B5) -----------------------------------------
  // characters/<id>/を丸ごとZIP化したものを想定。character.jsonは
  // ZIPのルート直下、またはフォルダごとZIP化した場合の1階層下を探す。
  function showFatalError(message, err) {
    statusEl.style.color = "#f87171";
    statusEl.textContent = message;
    if (err) console.error(err);
  }

  async function loadZipFile(file) {
    if (!/\.zip$/i.test(file.name)) {
      showFatalError(`ZIPファイルではありません: ${file.name}`);
      return;
    }
    statusEl.style.color = "";
    statusEl.textContent = `${file.name} を読み込み中…`;

    let zip;
    try {
      zip = await window.JSZip.loadAsync(file);
    } catch (err) {
      showFatalError("ZIPの読み込みに失敗しました: " + err.message, err);
      return;
    }

    const entryNames = Object.keys(zip.files);
    const characterJsonPath = entryNames.find((p) => p === "character.json" || p.endsWith("/character.json"));
    if (!characterJsonPath) {
      showFatalError("ZIP内にcharacter.jsonが見つかりません(characters/<id>/直下をZIP化したものを想定)");
      return;
    }
    const basePrefix = characterJsonPath.slice(0, characterJsonPath.length - "character.json".length);

    let manifestData;
    try {
      const text = await zip.files[characterJsonPath].async("string");
      manifestData = JSON.parse(text);
    } catch (err) {
      showFatalError("character.jsonの解析に失敗しました: " + err.message, err);
      return;
    }

    // 画像はZIPエントリからBlob URLを作って解決する。参照先が見つからない
    // 場合はここでエラーにする(スキーマ自体が壊れている場合はこの後の
    // loadCharacterData内のA3バリデータがエラーを出す)。
    const blobUrlMap = {};
    try {
      const srcs = collectSrcs(manifestData);
      await Promise.all(
        [...srcs].map(async (src) => {
          const entry = zip.files[basePrefix + src];
          if (!entry) throw new Error(`ZIP内に画像ファイルが見つかりません: ${src}`);
          const blob = await entry.async("blob");
          blobUrlMap[src] = URL.createObjectURL(blob);
        })
      );
    } catch (err) {
      showFatalError("ZIP内の画像展開に失敗しました: " + err.message, err);
      return;
    }

    await loadCharacterData(manifestData, (src) => blobUrlMap[src]);
  }

  function setupDropZone() {
    document.body.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    document.body.addEventListener("drop", (e) => {
      e.preventDefault();
      const file = e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) loadZipFile(file);
    });
  }

  async function main() {
    const characterId = getCharacterId();
    characterDir = `characters/${characterId}/`;
    statusEl.textContent = "character.json読み込み中…";
    const res = await fetch(`${characterDir}character.json`);
    if (!res.ok) throw new Error(`character.jsonの読み込みに失敗(${res.status}): ${characterDir}character.json`);
    const manifestData = await res.json();

    const ok = await loadCharacterData(manifestData, (src) => characterDir + src);
    if (!ok) return;

    setupExport();
    setupDropZone();

    const controls = setupControls();

    // 固定タイムステップ(120Hzサブステップ+アキュムレータ、C2)。
    // 可変dtのまま更新すると同じ入力でも実行タイミング次第で揺れが
    // 微妙に変わり、決定論方針(CLAUDE.md)に反する。実フレーム時間を
    // 貯めて固定刻みで消化することで、同じ経過時間なら同じ回数・同じ
    // dtで更新が走るようにする。描画側補間は行わない(サブステップが
    // 120Hzで一般的な表示のリフレッシュレートより十分細かく、体感できる
    // 差が出ないため)。
    const FIXED_DT = 1 / 120;
    const MAX_FRAME_DT = 0.25; // タブ非アクティブ復帰等での暴走(積み残し急増)を防ぐ上限
    let last = performance.now();
    let accumulator = 0;
    function frame(now) {
      const frameDt = Math.min((now - last) / 1000, MAX_FRAME_DT);
      last = now;
      accumulator += frameDt;

      while (accumulator >= FIXED_DT) {
        updateIdle(FIXED_DT);
        updateWave(FIXED_DT, controls.waving);
        updateTalk(FIXED_DT, controls.talking);
        accumulator -= FIXED_DT;
      }

      draw();
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  main().catch((err) => {
    statusEl.textContent = "エラー: " + err.message;
    console.error(err);
  });
})();
