#!/usr/bin/env python3
"""キャラクター参照画像を標準キャンバスに正規化する。

Geminiに渡す入力画像(元画像・派生画像とも)は、構図(キャラクターの
サイズ・位置)を毎回揃えることでモデルへの依存を減らす。手作業のリサイズ
ではなく、このスクリプトを常に通すことでキャラクターサイズ基準を固定する。

ルール(PLAN.md「入力画像の前処理」節に対応):
- 出力キャンバス: 900x1600、白背景
- 背景色(四隅サンプリングで自動検出、既定は白)と異なる領域を
  キャラクター本体とみなしバウンディングボックスを検出する
- バウンディングボックスの高さがキャンバス高さの87.5%(1400px)に
  なるよう等比拡大縮小し、水平方向は中央揃え、垂直方向は上下均等余白
"""
import sys
from pathlib import Path

from PIL import Image

CANVAS_W, CANVAS_H = 900, 1600
TARGET_CONTENT_H = 1400  # キャンバス高さの87.5%
BG_SAMPLE_MARGIN = 4
BG_DIFF_THRESHOLD = 18  # 背景色からの差分がこれを超えたら「内容」とみなす


def detect_background_color(im: Image.Image) -> tuple[int, int, int]:
    w, h = im.size
    corners = [
        im.getpixel((BG_SAMPLE_MARGIN, BG_SAMPLE_MARGIN)),
        im.getpixel((w - 1 - BG_SAMPLE_MARGIN, BG_SAMPLE_MARGIN)),
        im.getpixel((BG_SAMPLE_MARGIN, h - 1 - BG_SAMPLE_MARGIN)),
        im.getpixel((w - 1 - BG_SAMPLE_MARGIN, h - 1 - BG_SAMPLE_MARGIN)),
    ]
    r = sum(c[0] for c in corners) // 4
    g = sum(c[1] for c in corners) // 4
    b = sum(c[2] for c in corners) // 4
    return (r, g, b)


def content_bbox(im: Image.Image, bg: tuple[int, int, int]) -> tuple[int, int, int, int]:
    w, h = im.size
    px = im.load()
    left, right, top, bottom = w, 0, h, 0
    for y in range(h):
        for x in range(0, w, 2):  # 高速化のため2px間引き
            r, g, b = px[x, y][:3]
            if abs(r - bg[0]) + abs(g - bg[1]) + abs(b - bg[2]) > BG_DIFF_THRESHOLD:
                left = min(left, x)
                right = max(right, x)
                top = min(top, y)
                bottom = max(bottom, y)
    if left > right or top > bottom:
        raise ValueError("背景と区別できるコンテンツが見つからなかった")
    return left, top, right, bottom


def normalize(src_path: str, dst_path: str) -> None:
    im = Image.open(src_path).convert("RGB")
    bg = detect_background_color(im)
    left, top, right, bottom = content_bbox(im, bg)
    content = im.crop((left, top, right + 1, bottom + 1))

    scale = TARGET_CONTENT_H / content.height
    new_w = max(1, round(content.width * scale))
    new_h = TARGET_CONTENT_H
    resized = content.resize((new_w, new_h), Image.LANCZOS)

    canvas = Image.new("RGB", (CANVAS_W, CANVAS_H), (255, 255, 255))
    x_off = (CANVAS_W - new_w) // 2
    y_off = (CANVAS_H - new_h) // 2
    canvas.paste(resized, (x_off, y_off))
    canvas.save(dst_path)
    print(
        f"saved {dst_path}: canvas={CANVAS_W}x{CANVAS_H} "
        f"content={new_w}x{new_h} offset=({x_off},{y_off}) bg={bg}"
    )


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print("usage: normalize_reference.py <src.png> <dst.png>", file=sys.stderr)
        raise SystemExit(1)
    normalize(sys.argv[1], sys.argv[2])
