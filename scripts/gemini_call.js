#!/usr/bin/env node
/**
 * Gemini画像生成APIを呼び、応答をそのまま保存する専用ツール。
 *
 * 【最重要・唯一の目的】Geminiの生成物(画像バイト列・応答JSON全体)を
 * 一切加工せず(リサイズ・再圧縮・切り抜きをしない)、受け取った直後に
 * ディスクへ保存する。過去に生成パイプライン内でリサイズ後の画素だけを
 * 保存し、元解像度のデータを永久に失った実装バグがあったため、
 * 「生データの保存」と「その後の加工」を物理的に別ファイル・別工程に
 * 分離する。このファイルにリサイズ・crop・再圧縮のコードを追加しては
 * いけない(加工が必要なら、保存された生ファイルのコピーに対して別
 * スクリプトで行う)。
 *
 * 開発補助専用(CLAUDE.md「コア処理はブラウザ実装が正」「開発セッション
 * から実APIを呼ぶことは想定しない」の例外として、ユーザーの明示許可の
 * もとで検証目的に使う)。APIキーはこのファイルに埋め込まず、環境変数
 * GEMINI_KEYから読む。
 *
 * 使い方:
 *   GEMINI_KEY=... node scripts/gemini_call.js \
 *     --prompt prompts/segmentation_v1.txt \
 *     --image fixtures/gemini-verification-2026-07-23/master_tpose_1024.png \
 *     --out /path/to/output/dir \
 *     [--label seg] [--model gemini-3.1-flash-image] [--imageSize 1K] [--aspectRatio 1:1]
 *
 * 出力(すべて<out>配下、一切加工なしの生データ):
 *   <timestamp>_<label>_response_raw.json  … API応答全体(usageMetadata含む)
 *   <timestamp>_<label>_raw_<n>.<ext>      … 応答に含まれる画像パートをbase64デコードしただけのバイト列
 *   generation_log.jsonl                    … 呼び出し1回ごとに1行追記する来歴ログ
 *     (時刻・モデル・プロンプトファイル・入力画像・imageSize・トークン数・保存先)
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const MIME_TO_EXT = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };

function parseArgs(argv) {
  const args = { images: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--prompt") args.promptFile = argv[++i];
    else if (a === "--image") args.images.push(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--label") args.label = argv[++i];
    else if (a === "--model") args.model = argv[++i];
    else if (a === "--imageSize") args.imageSize = argv[++i];
    else if (a === "--aspectRatio") args.aspectRatio = argv[++i];
    else throw new Error(`unknown arg: ${a}`);
  }
  return args;
}

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16);
}

function mimeFromPath(p) {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  throw new Error(`unsupported image extension: ${ext}`);
}

/**
 * Gemini generateContentを呼ぶ(503は指数バックオフで最大5回リトライ)。
 * 戻り値はAPI応答をJSON.parseしただけの生オブジェクト(加工しない)。
 */
async function callGemini({ promptText, imagePaths, model, imageSize, aspectRatio }) {
  const key = process.env.GEMINI_KEY;
  if (!key) throw new Error("環境変数GEMINI_KEYが設定されていない");

  const parts = [{ text: promptText }];
  for (const p of imagePaths) {
    const data = fs.readFileSync(p).toString("base64");
    parts.push({ inlineData: { mimeType: mimeFromPath(p), data } });
  }
  const generationConfig = {};
  if (imageSize || aspectRatio) {
    generationConfig.imageConfig = {};
    if (imageSize) generationConfig.imageConfig.imageSize = imageSize;
    if (aspectRatio) generationConfig.imageConfig.aspectRatio = aspectRatio;
  }
  const body = { contents: [{ role: "user", parts }], generationConfig };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

  let res, text;
  for (let attempt = 0; attempt < 5; attempt++) {
    res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    text = await res.text();
    if (res.status !== 503) break;
    await new Promise((r) => setTimeout(r, 15000 * (attempt + 1)));
  }
  if (!res.ok) throw new Error(`Gemini API error ${res.status}: ${text.slice(0, 500)}`);
  return JSON.parse(text);
}

/**
 * API応答を一切加工せずディスクへ保存し、来歴ログに1行追記する。
 */
function saveRaw({ response, outDir, label, promptFile, imagePaths, model, imageSize, aspectRatio }) {
  fs.mkdirSync(outDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const prefix = `${ts}_${label}`;

  const responsePath = path.join(outDir, `${prefix}_response_raw.json`);
  fs.writeFileSync(responsePath, JSON.stringify(response, null, 2));

  const savedImages = [];
  const candidateParts = response.candidates?.[0]?.content?.parts ?? [];
  candidateParts.forEach((part, i) => {
    if (!part.inlineData) return;
    const ext = MIME_TO_EXT[part.inlineData.mimeType] ?? "bin";
    const imgPath = path.join(outDir, `${prefix}_raw_${i}.${ext}`);
    // 生バイト列をそのまま書く。ここにリサイズ・再圧縮を絶対に挟まない。
    fs.writeFileSync(imgPath, Buffer.from(part.inlineData.data, "base64"));
    savedImages.push(imgPath);
  });

  const logEntry = {
    timestamp: ts,
    label,
    model,
    promptFile: promptFile ?? null,
    inputImages: imagePaths.map((p) => ({ path: p, sha256: sha256(fs.readFileSync(p)) })),
    imageSize: imageSize ?? null,
    aspectRatio: aspectRatio ?? null,
    finishReason: response.candidates?.[0]?.finishReason ?? null,
    usageMetadata: response.usageMetadata ?? null,
    savedResponsePath: responsePath,
    savedImages,
  };
  fs.appendFileSync(path.join(outDir, "generation_log.jsonl"), JSON.stringify(logEntry) + "\n");

  return { responsePath, savedImages, logEntry };
}

async function run(args) {
  if (!args.promptFile || args.images.length === 0 || !args.out) {
    throw new Error("必須引数不足: --prompt, --image(1つ以上), --out");
  }
  const promptText = fs.readFileSync(args.promptFile, "utf8");
  const model = args.model ?? "gemini-3.1-flash-image";
  const label = args.label ?? path.basename(args.promptFile, ".txt");

  const response = await callGemini({
    promptText,
    imagePaths: args.images,
    model,
    imageSize: args.imageSize,
    aspectRatio: args.aspectRatio,
  });

  const { responsePath, savedImages, logEntry } = saveRaw({
    response,
    outDir: args.out,
    label,
    promptFile: args.promptFile,
    imagePaths: args.images,
    model,
    imageSize: args.imageSize,
    aspectRatio: args.aspectRatio,
  });

  console.log("saved response:", responsePath);
  console.log("saved images:", savedImages);
  console.log("usageMetadata:", JSON.stringify(logEntry.usageMetadata));
  if (savedImages.length === 0) {
    console.log("finishReason:", logEntry.finishReason, "(画像が返らなかった)");
  }
  return logEntry;
}

if (require.main === module) {
  run(parseArgs(process.argv.slice(2))).catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { callGemini, saveRaw, run };
