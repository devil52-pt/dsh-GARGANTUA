#!/usr/bin/env python3
"""Coarse ASCII visualization of a PNG (downsampled) to inspect layout.
Usage: python tools/ascii_viz.py <file.png> [cols] [rows]
Char map by luminance: ' .:-=+*#%@'
For the type view: B=black-ish, D=cyan-ish, S=warm.
"""
import sys
sys.path.insert(0, __import__('os').path.dirname(__file__))
from analyze_png import decode_png

path = sys.argv[1]
cols = int(sys.argv[2]) if len(sys.argv) > 2 else 96
rows = int(sys.argv[3]) if len(sys.argv) > 3 else 34

w, h, ch, buf = decode_png(path)

def px(x, y):
    i = (y * w + x) * ch
    return (buf[i], buf[i + 1], buf[i + 2])

for ry in range(rows):
    line = ''
    for rx in range(cols):
        x = int((rx + 0.5) * w / cols)
        y = int((ry + 0.5) * h / rows)
        r, g, b = px(x, y)
        lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
        if r > 200 and g < 80 and b < 80:
            c = 'R'   # red
        elif g > 200 and r < 120 and b < 120:
            c = 'G'   # green
        elif b > 150 and g < 120 and r < 120:
            c = 'B'   # blue
        elif lum > 200 and r > 150 and g > 150:
            c = 'S'   # bright warm/sky
        elif lum < 30:
            c = ' '
        elif lum < 80:
            c = '.'
        elif lum < 150:
            c = 'o'
        else:
            c = '@'
        line += c
    print(line)
