// character.jsonのスキーマ検査+参照整合チェック。
// docs/character-format.mdの必須フィールド・整合条件と一致させる
// (viewer読込時とstudio書き出し前の両方で同じコードを使う想定、
// PLAN.md「バリデータを共通モジュール化」)。
(function (global) {
  "use strict";

  function isNumber(v) {
    return typeof v === "number" && Number.isFinite(v);
  }

  function isXY(v) {
    return Array.isArray(v) && v.length === 2 && isNumber(v[0]) && isNumber(v[1]);
  }

  // character.jsonを検査し { errors: string[], warnings: string[] } を返す。
  // errorsが1件でもあれば読込・書き出しを拒否すべき致命的な不整合。
  function validateCharacter(manifest) {
    const errors = [];
    const warnings = [];

    if (!manifest || typeof manifest !== "object") {
      return { errors: ["character.jsonの中身がオブジェクトではありません"], warnings };
    }

    if (manifest.format !== "super2d-character") {
      errors.push(`formatが"super2d-character"ではありません(値: ${JSON.stringify(manifest.format)})`);
    }
    if (!isNumber(manifest.formatVersion)) {
      errors.push("formatVersionが数値で指定されていません");
    }
    if (!isXY(manifest.canvasStandard)) {
      errors.push("canvasStandardが[幅, 高さ]の数値2要素配列ではありません");
    }
    if (!isXY(manifest.rootAnchor)) {
      errors.push("rootAnchorが[x, y]の数値2要素配列ではありません");
    }
    if (!manifest.parts || typeof manifest.parts !== "object" || Array.isArray(manifest.parts)) {
      errors.push("partsがオブジェクトではありません");
      return { errors, warnings };
    }
    if (!Array.isArray(manifest.drawOrder)) {
      errors.push("drawOrderが配列ではありません");
    }

    const partNames = Object.keys(manifest.parts);
    if (partNames.length === 0) {
      errors.push("partsが空です(パーツが1つもありません)");
    }

    for (const name of partNames) {
      const part = manifest.parts[name];
      if (!part || typeof part !== "object") {
        errors.push(`パーツ"${name}": 定義がオブジェクトではありません`);
        continue;
      }

      if (!isNumber(part.w) || !isNumber(part.h)) {
        errors.push(`パーツ"${name}": wまたはhが数値で指定されていません`);
      }
      if (!isXY(part.pivot)) {
        errors.push(`パーツ"${name}": pivotが[x, y]の数値2要素配列ではありません`);
      }

      const hasSrc = typeof part.src === "string" && part.src.length > 0;
      const hasStates = part.states && typeof part.states === "object";
      if (!hasSrc && !hasStates) {
        errors.push(`パーツ"${name}": srcもstatesも無く、画像を特定できません`);
      }

      if (part.parent === null || part.parent === undefined) {
        // ルートパーツ。parentAnchor不要。
      } else if (typeof part.parent !== "string" || !partNames.includes(part.parent)) {
        errors.push(`パーツ"${name}": parent"${part.parent}"はpartsに存在しません`);
      } else {
        const parentPart = manifest.parts[part.parent];
        const parentAnchors = (parentPart && parentPart.anchors) || {};
        if (typeof part.parentAnchor !== "string" || !(part.parentAnchor in parentAnchors)) {
          errors.push(
            `パーツ"${name}": parentAnchor"${part.parentAnchor}"が親"${part.parent}"のanchorsに存在しません`
          );
        }
      }

      if (hasStates) {
        const stateNames = Object.keys(part.states);
        if (typeof part.defaultState !== "string" || !stateNames.includes(part.defaultState)) {
          errors.push(`パーツ"${name}": defaultState"${part.defaultState}"がstatesに存在しません`);
        }
        for (const stateName of stateNames) {
          const entry = part.states[stateName];
          if (!entry || typeof entry.src !== "string" || entry.src.length === 0) {
            warnings.push(`パーツ"${name}"のstate"${stateName}": srcが無いため未生成(ボタン非表示になります)`);
          }
        }
      }
    }

    if (Array.isArray(manifest.drawOrder)) {
      const drawSet = new Set(manifest.drawOrder);
      const unknown = manifest.drawOrder.filter((n) => !partNames.includes(n));
      const missing = partNames.filter((n) => !drawSet.has(n));
      const duplicates = manifest.drawOrder.filter((n, i) => manifest.drawOrder.indexOf(n) !== i);
      if (unknown.length > 0) {
        errors.push(`drawOrderに未知のパーツ名があります: ${unknown.join(", ")}`);
      }
      if (missing.length > 0) {
        errors.push(`drawOrderに含まれていないパーツがあります: ${missing.join(", ")}`);
      }
      if (duplicates.length > 0) {
        errors.push(`drawOrderに重複したパーツ名があります: ${[...new Set(duplicates)].join(", ")}`);
      }
    }

    return { errors, warnings };
  }

  global.S2D = global.S2D || {};
  global.S2D.validateCharacter = validateCharacter;
})(window);
