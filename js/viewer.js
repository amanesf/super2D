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

  function partCurrentSrc(part) {
    if (part.src) return part.src;
    if (part.states && part.defaultState) {
      const st = state[part._name].currentState || part.defaultState;
      const entry = part.states[st];
      return (entry && entry.src) || null;
    }
    return null;
  }

  async function preloadAll() {
    const srcs = new Set();
    for (const [name, part] of Object.entries(manifest.parts)) {
      part._name = name;
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
        const anchorLocal = parentPart.anchors && parentPart.anchors[part.parentAnchor];
        const [ax, ay] = anchorLocal || [0, 0];
        // 親のローカルアンカー点を、親のワールド回転を適用して変換
        const cos = Math.cos(parentWorld.angle);
        const sin = Math.sin(parentWorld.angle);
        const relX = ax - parentPart.pivot[0];
        const relY = ay - parentPart.pivot[1];
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
      const src = partCurrentSrc(part);
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

  function updateIdle(dt) {
    t += dt;

    // 呼吸(胴体のY方向スケールをゆっくり脈動)
    const breathe = 1 + Math.sin(t * 1.1) * 0.012;
    state.torso.scaleY = breathe;
    state.torso.scaleX = 1 + Math.sin(t * 1.1) * 0.006;

    // 頭の首振り(緩やかにゆらゆら)
    state.head_base.angle = Math.sin(t * 0.6) * 0.035;

    // 髪(前髪・サイド・後ろ髪)は頭より少し遅れて追従するバネ風の揺れ。
    // 単純な位相遅れ+減衰サインで疑似的にバネらしさを出す(本番は
    // Verlet等の簡易物理を想定、まずは見た目の確認用)。
    const headAngle = state.head_base.angle;
    state.hair_front.angle = headAngle * 0.6 + Math.sin(t * 0.6 - 0.4) * 0.05;
    state.hair_side_l.angle = headAngle * 0.5 + Math.sin(t * 0.55 - 0.6) * 0.06;
    state.hair_side_r.angle = headAngle * 0.5 + Math.sin(t * 0.55 - 0.6) * 0.06;
    state.hair_back.angle = headAngle * 0.4 + Math.sin(t * 0.4 - 0.9) * 0.09;
    state.cape.angle = Math.sin(t * 0.35 - 0.3) * 0.05;

    // 腕はごく僅かに呼吸と連動して揺れる(生命感)
    state.arm_upper_r.angle = Math.sin(t * 1.1 + 1.0) * 0.02;
    state.arm_upper_l.angle = Math.sin(t * 1.1 + 1.6) * 0.02;
    state.arm_lower_r.angle = Math.sin(t * 1.1 + 1.0) * 0.015;
    state.arm_lower_l.angle = Math.sin(t * 1.1 + 1.6) * 0.015;

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

  function updateTalk(dt, talking) {
    if (!talking) {
      state.mouth.currentState = "rest";
      return;
    }
    state.mouth.currentState = Math.sin(t * 14) > 0.2 ? "aa" : "rest";
  }

  async function main() {
    const characterId = getCharacterId();
    characterDir = `characters/${characterId}/`;
    statusEl.textContent = "character.json読み込み中…";
    const res = await fetch(`${characterDir}character.json`);
    if (!res.ok) throw new Error(`character.jsonの読み込みに失敗(${res.status}): ${characterDir}character.json`);
    manifest = await res.json();
    await preloadAll();
    statusEl.textContent = `読み込み完了(パーツ${Object.keys(manifest.parts).length}個、プレースホルダー画像)`;

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
