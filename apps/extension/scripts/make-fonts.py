"""Makes the popup's fonts from the website's: the same three families, cut down to what a
360 px popup needs. Each file pins the axes the website sets for small display text
(Fraunces at opsz 48, SOFT 100, like the site's wordmark), keeps a narrow weight range and
only the characters the popup shows, so all four together stay under 100 KB.

Run from apps/extension after `pnpm install` (it reads the website's @fontsource packages):
    uv run --with fonttools --with brotli python scripts/make-fonts.py
"""

from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

HERE = Path(__file__).resolve().parents[1]
SRC = HERE.parent / "website" / "node_modules" / "@fontsource-variable"
OUT = HERE / "public" / "fonts"

ASCII = list(range(0x20, 0x7F))
# Latin-1 for names and titles ("Amélie"); quotes, dashes, the middle dot and the ellipsis.
TEXT = ASCII + list(range(0xA0, 0x100)) + [0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026]
LABELS = ASCII + [0xB7, 0x2026]

# name: (source, pinned or limited axes, characters)
JOBS = {
    "fraunces": (
        "fraunces/files/fraunces-latin-full-normal.woff2",
        {"opsz": 48, "SOFT": 100, "WONK": 1, "wght": (400, 700)},
        TEXT,
    ),
    "fraunces-italic": (
        "fraunces/files/fraunces-latin-full-italic.woff2",
        {"opsz": 48, "SOFT": 100, "WONK": 1, "wght": (300, 500)},
        LABELS,
    ),
    "figtree": ("figtree/files/figtree-latin-wght-normal.woff2", {"wght": (400, 700)}, TEXT),
    "jetbrains-mono": (
        "jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
        {"wght": (400, 600)},
        LABELS,
    ),
}


def make(
    name: str, source: str, axes: dict[str, float | tuple[float, float]], chars: list[int]
) -> int:
    font = TTFont(SRC / source)
    opts = subset.Options()
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=chars)
    sub.subset(font)  # before instancing: the instancer drops glyphs the subsetter expects
    font = instancer.instantiateVariableFont(font, axes)
    font.flavor = "woff2"
    out = OUT / f"{name}.woff2"
    font.save(out)
    return out.stat().st_size


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    total = 0
    for name, (source, axes, chars) in JOBS.items():
        size = make(name, source, axes, chars)
        total += size
        print(f"{name}.woff2 {size / 1024:.1f} KB")
    print(f"total {total / 1024:.1f} KB")


if __name__ == "__main__":
    main()
