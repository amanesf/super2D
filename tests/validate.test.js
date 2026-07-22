// A3: js/validate.js(S2D.validateCharacter)の単体テスト。
// validate.jsはブラウザのwindowにS2Dを生やすIIFEなので、Node実行用に
// 最小限のwindowをモックしてから読み込む。
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");

global.window = global.window || {};
require("../js/validate.js");
const { validateCharacter } = global.window.S2D;

const CHARACTER_PATH = path.join(__dirname, "..", "characters", "placeholder-zero", "character.json");
const baseManifest = JSON.parse(fs.readFileSync(CHARACTER_PATH, "utf8"));

test("正常なcharacter.jsonはエラー0件", () => {
  const { errors } = validateCharacter(baseManifest);
  assert.deepEqual(errors, []);
});

test("isRig状態(B4)はsrc無し警告の対象にならない", () => {
  const { warnings } = validateCharacter(baseManifest);
  assert.equal(
    warnings.some((w) => w.includes('body_pose') && w.includes('"rig"')),
    false
  );
});

test("srcの無いstateは警告として列挙される", () => {
  const { warnings } = validateCharacter(baseManifest);
  assert.ok(warnings.some((w) => w.includes('パーツ"arm_upper_r"のstate"rest"')));
});

test("親パーツ名のタイポはエラーになる", () => {
  const broken = structuredClone(baseManifest);
  broken.parts.head_base.parent = "torsoo";
  const { errors } = validateCharacter(broken);
  assert.ok(errors.some((e) => e.includes('parent"torsoo"はpartsに存在しません')));
});

test("parentAnchorのタイポはエラーになる", () => {
  const broken = structuredClone(baseManifest);
  broken.parts.eye_l.parentAnchor = "eye_l_typo";
  const { errors } = validateCharacter(broken);
  assert.ok(errors.some((e) => e.includes("parentAnchor")));
});

test("drawOrderからパーツが漏れるとエラーになる", () => {
  const broken = structuredClone(baseManifest);
  broken.drawOrder = broken.drawOrder.filter((n) => n !== "mouth");
  const { errors } = validateCharacter(broken);
  assert.ok(errors.some((e) => e.includes("drawOrderに含まれていないパーツ")));
});

test("drawOrderに未知のパーツ名があるとエラーになる", () => {
  const broken = structuredClone(baseManifest);
  broken.drawOrder = [...broken.drawOrder, "no_such_part"];
  const { errors } = validateCharacter(broken);
  assert.ok(errors.some((e) => e.includes("drawOrderに未知のパーツ名")));
});

test("formatが不正だとエラーになる", () => {
  const broken = structuredClone(baseManifest);
  broken.format = "something-else";
  const { errors } = validateCharacter(broken);
  assert.ok(errors.some((e) => e.includes("format")));
});

test("defaultStateがstatesに存在しないとエラーになる", () => {
  const broken = structuredClone(baseManifest);
  broken.parts.mouth.defaultState = "no_such_state";
  const { errors } = validateCharacter(broken);
  assert.ok(errors.some((e) => e.includes('defaultState"no_such_state"がstatesに存在しません')));
});
