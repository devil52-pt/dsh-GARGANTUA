#!/usr/bin/env python3
"""GARGANTUA — dependency-free PNG analyzer (pure stdlib).

Decodes a PNG (all common filter types) and reports:
  - basic stats (size, mean/min/max/std per channel)
  - probe points given as "fx,fy" fractions of width/height (0..1)
  - a radial brightness profile around a center point

Usage:
  python tools/analyze_png.py <file.png> [--probes 0.5,0.5 0.62,0.5 ...]
                                  [--center 0.5,0.5] [--profile 0.02 0.6]
"""
import sys, zlib, struct

def decode_png(path):
    data = open(path, 'rb').read()
    assert data[:8] == b'\x89PNG\r\n\x1a\n', 'not a PNG'
    pos = 8
    idat = b''
    width = height = bitdepth = colortype = None
    while pos < len(data):
        ln, typ = struct.unpack('>I4s', data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + ln]
        if typ == b'IHDR':
            width, height, bitdepth, colortype, comp, filt, interlace = struct.unpack('>IIBBBBB', chunk)
            assert interlace == 0, 'interlaced PNG not supported'
            assert bitdepth == 8, 'only 8-bit supported'
            assert colortype in (0, 2, 3, 6), 'unsupported colortype %d' % colortype
        elif typ == b'IDAT':
            idat += chunk
        elif typ == b'IEND':
            break
        pos += 12 + ln
    raw = zlib.decompress(idat)
    channels = {0: 1, 2: 3, 3: 1, 6: 4}[colortype]
    stride = width * channels
    out = bytearray(width * height * channels)
    prev = bytearray(stride)
    p = 0
    for y in range(height):
        f = raw[p]; p += 1
        line = bytearray(raw[p:p + stride]); p += stride
        if f == 1:  # sub
            for i in range(channels, stride): line[i] = (line[i] + line[i - channels]) & 0xFF
        elif f == 2:  # up
            for i in range(stride): line[i] = (line[i] + prev[i]) & 0xFF
        elif f == 3:  # average
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                line[i] = (line[i] + ((a + prev[i]) >> 1)) & 0xFF
        elif f == 4:  # paeth
            for i in range(stride):
                a = line[i - channels] if i >= channels else 0
                b = prev[i]
                c = prev[i - channels] if i >= channels else 0
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 0xFF
        elif f != 0:
            raise ValueError('bad filter %d' % f)
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return width, height, channels, out

def load(path):
    w, h, ch, buf = decode_png(path)
    if ch == 3:  # palette -> expand crudely via first 256 palette entries not available; abort
        raise ValueError('palette PNG unsupported')
    return w, h, ch, buf

def pixel(buf, w, h, ch, x, y):
    i = (y * w + x) * ch
    if ch >= 3:
        return (buf[i], buf[i + 1], buf[i + 2])
    return (buf[i], buf[i], buf[i])

def stats(buf, w, h, ch):
    import statistics
    if ch >= 3:
        chans = [statistics.mean(buf[c::ch]) for c in range(3)]
        mn = min(buf[::ch]); mx = max(buf[::ch])
        return chans, mn, mx
    return (statistics.mean(buf),), min(buf), max(buf)

def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__); return 1
    path = args[0]
    probes = []
    center = (0.5, 0.5)
    profile = None
    i = 1
    while i < len(args):
        if args[i] == '--probes':
            i += 1
            while i < len(args) and ',' in args[i]:
                fx, fy = args[i].split(',')
                probes.append((float(fx), float(fy))); i += 1
            continue
        if args[i] == '--center' and i + 1 < len(args):
            fx, fy = args[i + 1].split(','); center = (float(fx), float(fy)); i += 2; continue
        if args[i] == '--profile' and i + 2 < len(args):
            profile = (float(args[i + 1]), float(args[i + 2])); i += 3; continue
        i += 1

    w, h, ch, buf = load(path)
    print('image: %dx%d channels=%d' % (w, h, ch))
    means, mn, mx = stats(buf, w, h, ch)
    print('stats: mean=%s min=%d max=%d' % (tuple(round(v, 2) for v in means), mn, mx))

    for fx, fy in probes:
        x, y = int(fx * (w - 1)), int(fy * (h - 1))
        print('probe (%.2f,%.2f) px(%d,%d): %s' % (fx, fy, x, y, tuple(pixel(buf, w, h, ch, x, y))))

    if profile:
        r0, r1 = profile
        cx, cy = int(center[0] * (w - 1)), int(center[1] * (h - 1))
        maxr = max(w, h) // 2
        samples = 48
        print('radial profile (center %d,%d, radius %g..%g of maxr):' % (cx, cy, r0, r1))
        for k in range(samples):
            t = r0 + (r1 - r0) * k / (samples - 1)
            rr = t * maxr
            # sample along a horizontal scanline through center
            x = int(cx + rr)
            if 0 <= x < w:
                c = pixel(buf, w, h, ch, x, cy)
                lum = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
                print('r=%.3f lum=%.1f %s' % (t, lum, tuple(c)))
    return 0

if __name__ == '__main__':
    sys.exit(main())
