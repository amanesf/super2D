// super2D 試作ビューア(プレースホルダーパーツで動作確認用)
// character.json(characters/<id>/character.json)の親子階層・ピボットを読み、
// Canvas2Dで組み立てて描画・アニメーションする。
// 本番はWebGL+メッシュ変形を想定しているが、リグ・アニメーションの
// ロジック(階層変換・呼吸/揺れ/まばたき・クロスフェード)自体は
// レンダラを問わず共通のため、まずCanvas2Dで検証する。
(function () {
  "use strict";

  const canvas = document.getElementById("stage");
  const ctx = canvas.getContext("2d");
  const statusEl = document.getElementById("status");

  let manifest = null;
  let characterDir = ""; // character.jsonがあるディレクトリ(相対src解決の基点)
  const images = {}; // src -> HTMLImageElement
  const state = {}; // partName -> { angle, offsetX, offsetY, currentState }

  function getCharacterId() {
    const params = new URLSearchParams(window.location.search);
    return params.get("character") || "placeholder-zero";
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      if (images[src]) return resolve(images[src]);
      const img = new Image();
      img.onload = () => {
        images[src] = img;
        resolve(img);
      };
      img.onerror = reject;
      img.src = characterDir + src;
    });
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

  async function preloadAll() {
    const srcs = new Set();
    for (const [name, part] of Object.entries(manifest.parts)) {
      if (part.src) srcs.add(part.src);
      if (part.states) {
        for (const st of Object.values(part.states)) {
          if (st.src) srcs.add(st.src);
        }
      }
      state[name] = {
        angle: 0,
        offsetX: 0,
        offsetY: 0,
        scaleX: 1,
        scaleY: 1,
        currentState: part.defaultState || null,
      };
    }
    await Promise.all([...srcs].map(loadImage));
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
        // draw()でのctx.rotate(angle)→ctx.scale(sx,sy)の適用順(スケールは
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

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const world = computeWorldTransforms();

    for (const name of manifest.drawOrder) {
      const part = manifest.parts[name];
      const w = world[name];
      const src = partCurrentSrc(name, part);
      if (!src) continue;
      const img = images[src];
      if (!img) continue;
      const s = state[name];

      ctx.save();
      ctx.translate(w.x, w.y);
      ctx.rotate(w.angle);
      ctx.scale(s.scaleX, s.scaleY);
      ctx.drawImage(img, -part.pivot[0], -part.pivot[1], part.w, part.h);
      ctx.restore();
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
  // srcの無いstate(未生成の予約枠)はボタン化しない(B3受け入れ条件)。
  function buildStateControls() {
    const container = document.getElementById("state-controls");
    if (!container) return;
    container.innerHTML = "";

    for (const [name, part] of Object.entries(manifest.parts)) {
      if (!part.states) continue;
      const withSrc = Object.entries(part.states).filter(([, entry]) => entry && entry.src);
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

  function updateWave(dt, waving) {
    if (!waving) {
      state.arm_upper_r.angle += (Math.sin(t * 1.1 + 1.0) * 0.02 - state.arm_upper_r.angle) * 0;
      return;
    }
    // 肩を上げ、肘を曲げて手を振る(2剛体パーツで肘の曲げ点デモ)
    state.arm_upper_r.angle = -1.9 + Math.sin(t * 6) * 0.05;
    state.arm_lower_r.angle = -0.6 + Math.sin(t * 6 + 0.5) * 0.35;
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

  async function main() {
    const characterId = getCharacterId();
    characterDir = `characters/${characterId}/`;
    statusEl.textContent = "character.json読み込み中…";
    const res = await fetch(`${characterDir}character.json`);
    if (!res.ok) throw new Error(`character.jsonの読み込みに失敗(${res.status}): ${characterDir}character.json`);
    manifest = await res.json();

    const { errors, warnings } = window.S2D.validateCharacter(manifest);
    if (warnings.length > 0) console.warn("character.json警告:\n" + warnings.join("\n"));
    if (errors.length > 0) {
      statusEl.style.color = "#f87171";
      statusEl.textContent = "character.jsonが不正です:\n" + errors.join("\n");
      console.error("character.jsonエラー:\n" + errors.join("\n"));
      return;
    }

    await preloadAll();
    statusEl.textContent = `読み込み完了(パーツ${Object.keys(manifest.parts).length}個、プレースホルダー画像)`;

    buildStateControls();
    setupExport();

    const controls = setupControls();
    let last = performance.now();
    function frame(now) {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      updateIdle(dt);
      updateWave(dt, controls.waving);
      updateTalk(dt, controls.talking);
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
