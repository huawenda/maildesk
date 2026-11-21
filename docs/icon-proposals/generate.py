"""MailDesk icon (direction B: two-tone M) -> build/icon*.png, build/icon.ico, resources/tray*.png.

主稿在 4096 画布上绘制再降采样；16/24 用略放大的字形，保证任务栏里还能读出 M。
托盘是同一字形的单色版（白 / 深灰），不带瓦片。
"""
from PIL import Image, ImageDraw
import os

ROOT = r"D:\Dev\MailDesk"
S = 4096
K = S / 1024.0

TILE_TOP = (35, 35, 35)
TILE_BOTTOM = (20, 20, 20)
BLUE = (38, 89, 204)
WHITE = (243, 244, 246)

M_POINTS = [(272, 752), (272, 300), (512, 604), (752, 300), (752, 752)]
M_STROKE = 108
# 16/24 专用：中缝抬高、笔画加粗，否则降采样后中间 V 会糊成一坨
M_POINTS_SMALL = [(280, 748), (280, 308), (512, 560), (744, 308), (744, 748)]
M_STROKE_SMALL = 120


def sc(v):
    return v * K


def gradient(size, top, bottom):
    img = Image.new("RGB", (1, size), top)
    px = img.load()
    for y in range(size):
        t = y / (size - 1)
        px[0, y] = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
    return img.resize((size, size))


def tile():
    base = gradient(S, TILE_TOP, TILE_BOTTOM).convert("RGBA")
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=sc(228), fill=255)
    base.putalpha(mask)
    return base


def stroke_m(draw, points, width, color):
    pts = [(sc(x), sc(y)) for x, y in points]
    draw.line(pts, fill=color, width=int(sc(width)), joint="curve")
    r = width / 2
    for x, y in (pts[0], pts[-1]):
        draw.ellipse([x - sc(r), y - sc(r), x + sc(r), y + sc(r)], fill=color)


def app_icon(scale=1.0, points=M_POINTS, stroke=M_STROKE):
    """White M on the left half, brand blue on the right half, split at the apex."""
    img = tile()
    d = ImageDraw.Draw(img)

    pts = [(512 + (x - 512) * scale, 512 + (y - 512) * scale) for x, y in points]
    width = stroke * scale
    stroke_m(d, pts, width, WHITE)

    right = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    stroke_m(ImageDraw.Draw(right), pts, width, BLUE)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rectangle([sc(512), 0, S, S], fill=255)
    right.putalpha(Image.composite(right.getchannel("A"), Image.new("L", (S, S), 0), mask))
    img.alpha_composite(right)
    return img


def tray_icon(color, scale=1.0):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    pts = [(512 + (x - 512) * scale, 512 + (y - 512) * scale) for x, y in M_POINTS]
    stroke_m(ImageDraw.Draw(img), pts, M_STROKE * scale, color)
    return img


def save_png(img, path, size):
    img.resize((size, size), Image.LANCZOS).save(path)


def main():
    out_app = os.path.join(ROOT, "build")
    out_res = os.path.join(ROOT, "resources")

    big = app_icon(1.0)
    small = app_icon(1.04, M_POINTS_SMALL, M_STROKE_SMALL)

    save_png(big, os.path.join(out_app, "icon.png"), 512)
    for size in (32, 48, 64, 128, 256):
        save_png(big, os.path.join(out_app, f"icon-{size}.png"), size)
    for size in (16, 24):
        save_png(small, os.path.join(out_app, f"icon-{size}.png"), size)

    ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
    frames = []
    for w, h in ico_sizes:
        src = small if w <= 24 else big
        frames.append(src.resize((w, h), Image.LANCZOS))
    frames[-1].save(
        os.path.join(out_app, "icon.ico"),
        format="ICO",
        sizes=ico_sizes,
        append_images=frames[:-1],
    )

    save_png(tray_icon((255, 255, 255, 255), 1.06), os.path.join(out_res, "tray.png"), 32)
    save_png(tray_icon((255, 255, 255, 255), 1.06), os.path.join(out_res, "tray@2x.png"), 64)
    # 浅色任务栏用深色 M；#3F3F3F 在实际浅色任务栏上偏灰，压到 #1C1C1C
    save_png(tray_icon((28, 28, 28, 255), 1.06), os.path.join(out_res, "tray-dark.png"), 32)
    save_png(tray_icon((28, 28, 28, 255), 1.06), os.path.join(out_res, "tray-dark@2x.png"), 64)

    print("wrote build/icon.png, icon-16..256.png, icon.ico, resources/tray*.png")


if __name__ == "__main__":
    main()
