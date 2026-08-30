#!/usr/bin/env python3
"""產生 JARVIS 的 App 圖示（純 Python，不需要外部套件）。

用法：python3 tools/make-icons.py
輸出：icons/icon-192.png、icons/icon-512.png、icons/icon-maskable-512.png、
      icons/apple-touch-icon.png（180x180，iOS 加入主畫面用）
"""
import math
import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent.parent / "icons"

BG = (5, 10, 18)
CYAN = (94, 234, 255)
DEEP = (34, 132, 176)


def mix(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def ring(d, radius, width):
    """距離 d 落在半徑 radius 的環上時回傳 0~1 的強度（邊緣做抗鋸齒）。"""
    return max(0.0, 1.0 - abs(d - radius) / width)


def render(size, pad):
    """畫出同心弧線構成的核心圖形。pad 是安全邊距比例（maskable 用）。"""
    cx = cy = (size - 1) / 2
    scale = (size / 2) * (1 - pad)
    px = bytearray()
    for y in range(size):
        px.append(0)  # PNG filter type 0
        for x in range(size):
            dx, dy = (x - cx) / scale, (y - cy) / scale
            d = math.hypot(dx, dy)
            ang = math.atan2(dy, dx)
            c = BG
            # 中央核心與光暈
            c = mix(c, CYAN, max(0.0, 1.0 - d / 0.20) ** 2)
            c = mix(c, DEEP, max(0.0, 1.0 - d / 0.55) ** 3 * 0.7)
            # 內圈：完整細環
            c = mix(c, CYAN, ring(d, 0.34, 2.6 / scale) * 0.85)
            # 中圈：四段弧
            gap = 0.30
            seg = (ang + math.pi) % (math.pi / 2)
            if seg > gap:
                c = mix(c, CYAN, ring(d, 0.58, 5.0 / scale))
            # 外圈：兩段長弧
            seg2 = (ang + math.pi) % math.pi
            if 0.22 < seg2 < math.pi - 0.22:
                c = mix(c, DEEP, ring(d, 0.86, 4.0 / scale))
            px.extend(c)
    return bytes(px)


def write_png(path, size, raw):
    def chunk(tag, data):
        b = tag + data
        return struct.pack(">I", len(data)) + b + struct.pack(">I", zlib.crc32(b))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)  # 8-bit truecolor
    png = (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw, 9))
        + chunk(b"IEND", b"")
    )
    path.write_bytes(png)
    print(f"{path.name}: {len(png):,} bytes")


def main():
    OUT.mkdir(exist_ok=True)
    for name, size, pad in [
        ("icon-192.png", 192, 0.06),
        ("icon-512.png", 512, 0.06),
        ("icon-maskable-512.png", 512, 0.22),
        ("apple-touch-icon.png", 180, 0.06),
    ]:
        write_png(OUT / name, size, render(size, pad))


if __name__ == "__main__":
    main()
