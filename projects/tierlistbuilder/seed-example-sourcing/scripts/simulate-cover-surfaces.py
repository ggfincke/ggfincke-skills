# projects/tierlistbuilder/seed-example-sourcing/scripts/simulate-cover-surfaces.py
# tierlistbuilder cover-surface framing simulator for picking coverZoom before install

# renders what each cover surface actually shows at a given coverZoom, mirroring
# packages/contracts/lib/coverMedia.ts::zoomedFrameForSurface, so you can pick coverZoom
# per template BEFORE install and confirm the crop is right on every viewport.
# writes surface-sim/surfaces-N.jpg contact sheets and prints any surface that crops
# too hard (<62% source width) or letterboxes too much (>30% matte).
#
# run through the seed venv:
#   uv run --project scripts/seed_pipeline python <this> examples/gaming/street-fighter-6/_cover.jpg
#   uv run --project scripts/seed_pipeline python <this> a/_cover.jpg=1.6 b/_cover.jpg   # per-file zoom w/ path=zoom

import sys
from pathlib import Path

from PIL import Image, ImageDraw

# mirrors COVER_SURFACES in coverMedia.ts; detailHero (4:3) is the tightest crop
SURFACES = {"browseHero": 16 / 9, "detailHero": 4 / 3, "card": 16 / 10}
MATTE = (13, 13, 13)
OUT_W = 520


# mirrors zoomedFrameForSurface; zoom>1 zooms OUT past cover-fit -> letterbox w/ --t-media-matte
def frame(
	sw: int, sh: int, surface_aspect: float, zoom: float
) -> tuple[float, float, float, float]:
	src = sw / sh
	if surface_aspect >= src:
		bw, bh = 1.0, src / surface_aspect
	else:
		bw, bh = surface_aspect / src, 1.0
	w, h = bw * zoom, bh * zoom
	return (1 - w) / 2, (1 - h) / 2, w, h


# fraction of the source visible, and fraction of the surface that is matte
def stats(sw: int, sh: int, sa: float, zoom: float) -> dict:
	x, y, w, h = frame(sw, sh, sa, zoom)
	vis_w = min(x + w, 1) - max(x, 0)
	vis_h = min(y + h, 1) - max(y, 0)
	matte = 1 - (max(vis_w, 0) / w) * (max(vis_h, 0) / h)
	return {
		"srcWidthShown": max(vis_w, 0),
		"srcHeightShown": max(vis_h, 0),
		"matteFrac": max(matte, 0),
	}


def render(img: Image.Image, sa: float, zoom: float) -> Image.Image:
	sw, sh = img.size
	x, y, w, h = frame(sw, sh, sa, zoom)
	px = (x * sw, y * sh, (x + w) * sw, (y + h) * sh)
	out_h = round(OUT_W / sa)
	canvas = Image.new("RGB", (OUT_W, out_h), MATTE)
	# intersect the requested rect with the real image, paste it where it belongs
	ix0, iy0 = max(px[0], 0), max(px[1], 0)
	ix1, iy1 = min(px[2], sw), min(px[3], sh)
	if ix1 <= ix0 or iy1 <= iy0:
		return canvas
	crop = img.crop((round(ix0), round(iy0), round(ix1), round(iy1)))
	scale = OUT_W / (px[2] - px[0])
	cw, ch = max(1, round(crop.width * scale)), max(1, round(crop.height * scale))
	crop = crop.resize((cw, ch), Image.LANCZOS)
	canvas.paste(crop, (round((ix0 - px[0]) * scale), round((iy0 - px[1]) * scale)))
	return canvas


# each arg is a cover path, optionally "path=zoom"; label = parent folder name (the slug)
def parse_args(argv: list[str]) -> list[tuple[str, Path, float]]:
	out = []
	for a in argv:
		path, _, z = a.partition("=")
		p = Path(path)
		out.append((p.parent.name or p.stem, p, float(z) if z else 1.0))
	return out


def main() -> None:
	if len(sys.argv) < 2:
		print("usage: simulate-cover-surfaces.py <cover>[=zoom] [<cover>[=zoom] ...]")
		sys.exit(2)
	rows = []
	for slug, path, z in parse_args(sys.argv[1:]):
		img = Image.open(path).convert("RGB")
		rows.append((slug, img, z, {s: stats(*img.size, a, z) for s, a in SURFACES.items()}))

	PAD, LAB = 10, 30
	cells = len(SURFACES)
	W = cells * OUT_W + (cells + 1) * PAD + 240
	RH = round(OUT_W / min(SURFACES.values())) + LAB
	sheets = [rows[i : i + 6] for i in range(0, len(rows), 6)]
	outdir = Path("surface-sim")
	outdir.mkdir(exist_ok=True)
	for gi, g in enumerate(sheets, 1):
		H = len(g) * (RH + PAD) + PAD
		sh_im = Image.new("RGB", (W, H), (18, 18, 20))
		dr = ImageDraw.Draw(sh_im)
		for r, (slug, img, z, st) in enumerate(g):
			y = PAD + r * (RH + PAD)
			dr.text((PAD, y + 6), f"{slug}", fill=(255, 255, 255))
			dr.text(
				(PAD, y + 24),
				f"{img.width}x{img.height}  ar={img.width / img.height:.2f}",
				fill=(170, 170, 175),
			)
			dr.text((PAD, y + 42), f"zoom={z}", fill=(120, 220, 255) if z != 1 else (170, 170, 175))
			for c, (sname, sa) in enumerate(SURFACES.items()):
				x = 240 + PAD + c * (OUT_W + PAD)
				sh_im.paste(render(img, sa, z), (x, y))
				s = st[sname]
				warn = s["srcWidthShown"] < 0.62 or s["matteFrac"] > 0.30
				dr.text(
					(x, y + round(OUT_W / sa) + 6),
					f"{sname}  w{s['srcWidthShown'] * 100:.0f}% h{s['srcHeightShown'] * 100:.0f}% matte{s['matteFrac'] * 100:.0f}%",
					fill=(255, 120, 120) if warn else (200, 200, 205),
				)
		f = outdir / f"surfaces-{gi}.jpg"
		sh_im.save(f, quality=88)
		print("wrote", f)

	print("\n=== flags (detailHero is the tightest surface, 4:3) ===")
	flagged = False
	for slug, img, z, st in rows:
		for sname, s in st.items():
			if s["srcWidthShown"] < 0.62 or s["matteFrac"] > 0.30:
				flagged = True
				print(
					f"  {slug:24} {sname:11} shows {s['srcWidthShown'] * 100:.0f}% width, "
					f"{s['matteFrac'] * 100:.0f}% matte  (zoom={z})"
				)
	if not flagged:
		print("  none - every surface keeps >=62% width and <=30% matte at the given zoom")


if __name__ == "__main__":
	main()
