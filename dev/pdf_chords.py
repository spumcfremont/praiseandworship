"""Turn a chord-sheet PDF (fixed-width font, e.g. Ultimate Guitar's "Print/PDF") back into
plain "chords over lyrics" text with the original spacing, so the app can import it.

Usage:  python3 dev/pdf_chords.py sheet.pdf [more.pdf ...] [--out folder]

Reads the PDF's drawing commands directly: each text run's x position is turned into a
column using the font's character width. Standard library only.
"""
import argparse, os, re, sys, zlib

RUN = re.compile(
    rb"([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+cm\s+BT(.*?)ET", re.S)
STRING = re.compile(rb"\(((?:\\.|[^\\)])*)\)\s*Tj", re.S)
SIZE = re.compile(rb"([-\d.]+)\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+[-\d.]+\s+Tm")


def unescape(b):
    out, i = bytearray(), 0
    while i < len(b):
        c = b[i]
        if c == 0x5C and i + 1 < len(b):  # backslash
            n = b[i + 1]
            m = re.match(rb"[0-7]{1,3}", b[i + 1:i + 4])
            if m:
                out.append(int(m.group(), 8) & 0xFF); i += 1 + len(m.group()); continue
            out.append({ord("n"): 10, ord("r"): 13, ord("t"): 9, ord("b"): 8, ord("f"): 12}.get(n, n)); i += 2; continue
        out.append(c); i += 1
    return out.decode("cp1252", "replace")


def streams(data):
    for m in re.finditer(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        try:
            yield zlib.decompress(m.group(1))
        except zlib.error:
            continue


def runs(data):
    """Yield (page_index, x, y, text, font_scale) for every text run, in drawing order."""
    page = 0
    for s in streams(data):
        found = False
        for m in RUN.finditer(s):
            sx, x, y, body = float(m.group(1)), float(m.group(5)), float(m.group(6)), m.group(7)
            size = SIZE.search(body)
            text = "".join(unescape(t) for t in STRING.findall(body))
            if text:
                found = True
                yield page, x, y, text, abs(sx) * (float(size.group(1)) if size else 1)
        if found:
            page += 1


def char_width(items):
    # Two adjacent runs on a line: x gap / characters in the first run = width of one character.
    widths = []
    by_line = {}
    for p, x, y, t, _ in items:
        by_line.setdefault((p, round(y, 1)), []).append((x, t))
    for line in by_line.values():
        line.sort()
        for (x1, t1), (x2, _) in zip(line, line[1:]):
            if len(t1) and x2 > x1:
                widths.append((x2 - x1) / len(t1))
    if not widths:
        return None
    widths.sort()
    return widths[len(widths) // 2]


def to_text(path):
    items = list(runs(open(path, "rb").read()))
    if not items:
        raise ValueError("no text found (scanned image PDF?)")
    w = char_width(items) or items[0][4] * 0.6
    left = min(x for _, x, _, _, _ in items)
    lines = {}
    for p, x, y, t, _ in items:
        row = lines.setdefault((p, -round(y, 1)), [])
        row.append((round((x - left) / w), t))
    out, last = [], None
    for (p, negy), parts in sorted(lines.items()):
        y = -negy
        if last is not None and last[0] == p and last[1] - y > 1.8 * 14.4 * 0.8:
            out.append("")  # visible gap between blocks
        buf = []
        for col, t in sorted(parts):
            if len(buf) < col:
                buf.extend(" " * (col - len(buf)))
            buf[col:col + len(t)] = list(t)
        out.append("".join(buf).rstrip())
        last = (p, y)
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).strip() + "\n"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdfs", nargs="+")
    ap.add_argument("--out", default=None, help="folder for .txt files (default: next to each PDF)")
    a = ap.parse_args()
    for pdf in a.pdfs:
        try:
            text = to_text(pdf)
        except Exception as e:
            print(f"failed  {pdf}: {e}", file=sys.stderr)
            continue
        dest = os.path.join(a.out or os.path.dirname(pdf), os.path.splitext(os.path.basename(pdf))[0] + ".txt")
        open(dest, "w").write(text)
        print(f"saved   {dest}")


if __name__ == "__main__":
    main()
