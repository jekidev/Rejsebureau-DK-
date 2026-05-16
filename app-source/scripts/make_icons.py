import sys
from pathlib import Path


def _fail(msg: str, code: int = 1) -> None:
    print(msg, file=sys.stderr)
    raise SystemExit(code)


def main() -> int:
    if len(sys.argv) != 2:
        _fail("Usage: python scripts/make_icons.py <source_image.(png|jpg|jpeg)>")

    src = Path(sys.argv[1]).expanduser().resolve()
    if not src.exists():
        _fail(f"Source image not found: {src}")

    try:
        from PIL import Image
    except Exception as e:
        _fail(
            "Missing dependency: Pillow.\n"
            "Install it with: python -m pip install Pillow\n"
            f"Details: {e}"
        )

    project_root = Path(__file__).resolve().parents[1]
    assets_dir = project_root / "assets"
    assets_dir.mkdir(parents=True, exist_ok=True)

    icon_png = assets_dir / "icon.png"
    icon_ico = assets_dir / "icon.ico"

    with Image.open(src) as im:
        im = im.convert("RGBA")

        # Make a square crop centered, then scale.
        w, h = im.size
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        im_sq = im.crop((left, top, left + side, top + side))

        # Electron window icon: PNG
        im_sq.resize((512, 512), Image.LANCZOS).save(icon_png, format="PNG")

        # Windows app icon: multi-size ICO
        sizes = [(256, 256), (128, 128), (64, 64), (48, 48), (32, 32), (16, 16)]
        base = im_sq.resize((256, 256), Image.LANCZOS)
        base.save(icon_ico, format="ICO", sizes=sizes)

    print(f"Wrote: {icon_png}")
    print(f"Wrote: {icon_ico}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

