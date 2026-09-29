"""Generate crisp RescueMemory brand icons (SVG, ICO, and PNGs) using the official brand logo.

Handles:
1. Favicon (64x64 PNG, multi-res ICO, SVG)
2. PWA icons (icon-192.png, icon-512.png)
3. Android adaptive maskable icon (icon-maskable-512.png with safe-zone margin)
4. Android native mipmap launcher icons in frontend/android/app/src/main/res/
5. Clean-up of any duplicate PNGs in the Android assets folder
"""
import base64
import io
from pathlib import Path
from PIL import Image, ImageDraw

ROOT_DIR = Path(__file__).resolve().parents[2]
FRONTEND_DIR = ROOT_DIR / "frontend"
PUBLIC_DIR = FRONTEND_DIR / "public"
LOGO_PATH = PUBLIC_DIR / "logo.png"
ANDROID_RES_DIR = FRONTEND_DIR / "android" / "app" / "src" / "main" / "res"
ANDROID_ASSETS_DIR = FRONTEND_DIR / "android" / "app" / "src" / "main" / "assets" / "public"

# Master logo background color
BG_COLOR = (243, 242, 242, 255)  # #f3f2f2


def load_master_logo() -> tuple[Image.Image, Image.Image, Image.Image]:
    """Loads master logo and extracts emblem and full logo."""
    if not LOGO_PATH.exists():
        raise FileNotFoundError(f"Master logo not found at {LOGO_PATH}")

    im = Image.open(LOGO_PATH).convert("RGBA")

    # Tight emblem crop: wifi waves + slash, mountains, pin, open book, connected nodes
    # Content boundaries: x: 98..314, y: 50..228
    emblem = im.crop((98, 50, 314, 228))

    # Full logo crop: emblem + 'RescueMemory' wordmark (x: 44..324, y: 48..276)
    full_logo = im.crop((44, 48, 324, 276))

    return im, emblem, full_logo


def create_centered_badge(
    artwork: Image.Image,
    target_size: int,
    padding_ratio: float = 0.12,
    bg_color: tuple[int, int, int, int] = BG_COLOR,
    rounded_radius: int = 0
) -> Image.Image:
    """Centers artwork within a square canvas of target_size x target_size."""
    canvas = Image.new("RGBA", (target_size, target_size), (0, 0, 0, 0))

    # Draw rounded background if radius > 0, else full fill
    draw = ImageDraw.Draw(canvas)
    if rounded_radius > 0:
        draw.rounded_rectangle([(0, 0), (target_size - 1, target_size - 1)], radius=rounded_radius, fill=bg_color)
    else:
        draw.rectangle([(0, 0), (target_size, target_size)], fill=bg_color)

    # Scale artwork preserving aspect ratio to fit inside (target_size * (1 - 2*padding_ratio))
    available_w = target_size * (1.0 - 2 * padding_ratio)
    available_h = target_size * (1.0 - 2 * padding_ratio)
    scale = min(available_w / artwork.width, available_h / artwork.height)

    new_w = max(1, int(round(artwork.width * scale)))
    new_h = max(1, int(round(artwork.height * scale)))
    resized_art = artwork.resize((new_w, new_h), Image.Resampling.LANCZOS)

    offset_x = (target_size - new_w) // 2
    offset_y = (target_size - new_h) // 2
    canvas.paste(resized_art, (offset_x, offset_y), resized_art)

    return canvas


def generate_svg(emblem: Image.Image) -> str:
    """Creates a clean SVG favicon with tightly zoomed high-res emblem."""
    # Scale emblem to 128x128 canvas with minimal margin
    badge_128 = create_centered_badge(emblem, 128, padding_ratio=0.02, rounded_radius=20)
    buffer = io.BytesIO()
    badge_128.save(buffer, format="PNG")
    b64_png = base64.b64encode(buffer.getvalue()).decode("ascii")

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128">
  <defs>
    <clipPath id="squircle">
      <rect width="128" height="128" rx="20" ry="20" />
    </clipPath>
  </defs>
  <g clip-path="url(#squircle)">
    <image href="data:image/png;base64,{b64_png}" width="128" height="128" />
  </g>
</svg>
"""


def update_android_native_icons(full_logo: Image.Image, emblem: Image.Image):
    """Generates standard Android mipmap launcher icons if directory exists."""
    if not ANDROID_RES_DIR.exists():
        print(f"Android res dir not found at {ANDROID_RES_DIR}, skipping native icons.")
        return

    densities = {
        "mipmap-mdpi": (48, 108),
        "mipmap-hdpi": (72, 162),
        "mipmap-xhdpi": (96, 216),
        "mipmap-xxhdpi": (144, 324),
        "mipmap-xxxhdpi": (192, 432),
    }

    for folder, (size, fg_size) in densities.items():
        dir_path = ANDROID_RES_DIR / folder
        if not dir_path.exists():
            continue

        # Standard squircle launcher icon
        r = max(4, int(size * 0.22))
        launcher = create_centered_badge(full_logo, size, padding_ratio=0.10, rounded_radius=r)
        launcher.save(dir_path / "ic_launcher.png", "PNG")

        # Round launcher icon
        r_round = size // 2
        launcher_round = create_centered_badge(full_logo, size, padding_ratio=0.14, rounded_radius=r_round)
        launcher_round.save(dir_path / "ic_launcher_round.png", "PNG")

        # Foreground adaptive icon (transparent background, art inside center 66%)
        fg_canvas = Image.new("RGBA", (fg_size, fg_size), (0, 0, 0, 0))
        avail = fg_size * 0.60
        scale = min(avail / full_logo.width, avail / full_logo.height)
        nw, nh = int(round(full_logo.width * scale)), int(round(full_logo.height * scale))
        fg_art = full_logo.resize((nw, nh), Image.Resampling.LANCZOS)
        fg_canvas.paste(fg_art, ((fg_size - nw) // 2, (fg_size - nh) // 2), fg_art)
        fg_canvas.save(dir_path / "ic_launcher_foreground.png", "PNG")

        print(f"Updated Android native icons in {folder} ({size}x{size})")


def clean_duplicate_android_pngs():
    """Removes duplicate web PNGs copied into the Android assets folder."""
    if not ANDROID_ASSETS_DIR.exists():
        return

    duplicates = [
        ANDROID_ASSETS_DIR / "favicon.png",
        ANDROID_ASSETS_DIR / "icon-192.png",
        ANDROID_ASSETS_DIR / "icon-512.png",
        ANDROID_ASSETS_DIR / "icon-maskable-512.png",
    ]
    deleted_count = 0
    for f in duplicates:
        if f.exists():
            f.unlink()
            deleted_count += 1
            print(f"Deleted duplicate: {f}")

    if deleted_count > 0:
        print(f"Cleaned up {deleted_count} duplicate PNG(s) from {ANDROID_ASSETS_DIR}")
    else:
        print("No duplicate PNGs found in Android assets folder.")


def main():
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)
    _, emblem, full_logo = load_master_logo()

    # 1. Favicon (64x64 PNG): Emblem tightly zoomed with minimal edge padding
    fav_64 = create_centered_badge(emblem, 64, padding_ratio=0.02, rounded_radius=10)
    fav_64.save(PUBLIC_DIR / "favicon.png", "PNG")
    print(f"Generated: {PUBLIC_DIR / 'favicon.png'}")

    # 2. Favicon (Multi-res ICO): 16x16, 32x32, 48x48
    fav_16 = create_centered_badge(emblem, 16, padding_ratio=0.0, rounded_radius=2)
    fav_32 = create_centered_badge(emblem, 32, padding_ratio=0.01, rounded_radius=4)
    fav_48 = create_centered_badge(emblem, 48, padding_ratio=0.02, rounded_radius=6)
    fav_32.save(
        PUBLIC_DIR / "favicon.ico",
        format="ICO",
        sizes=[(16, 16), (32, 32), (48, 48)],
        append_images=[fav_16, fav_48]
    )
    print(f"Generated: {PUBLIC_DIR / 'favicon.ico'}")

    # 3. Favicon (SVG)
    svg_content = generate_svg(emblem)
    (PUBLIC_DIR / "favicon.svg").write_text(svg_content.strip(), encoding="utf-8")
    print(f"Generated: {PUBLIC_DIR / 'favicon.svg'}")

    # 4. Standard PWA Icon 192x192 (Full Logo with wordmark)
    icon_192 = create_centered_badge(full_logo, 192, padding_ratio=0.08, rounded_radius=36)
    icon_192.save(PUBLIC_DIR / "icon-192.png", "PNG")
    print(f"Generated: {PUBLIC_DIR / 'icon-192.png'}")

    # 5. Standard PWA Icon 512x512 (Full Logo with wordmark)
    icon_512 = create_centered_badge(full_logo, 512, padding_ratio=0.08, rounded_radius=96)
    icon_512.save(PUBLIC_DIR / "icon-512.png", "PNG")
    print(f"Generated: {PUBLIC_DIR / 'icon-512.png'}")

    # 6. Android Maskable PWA Icon 512x512
    # Full bleed background with artwork strictly inside the inner 66% circle (padding = 18%)
    # This prevents any part of the emblem or text from being cropped by Android circular/squircle masks.
    maskable_512 = create_centered_badge(full_logo, 512, padding_ratio=0.18, rounded_radius=0)
    maskable_512.save(PUBLIC_DIR / "icon-maskable-512.png", "PNG")
    print(f"Generated: {PUBLIC_DIR / 'icon-maskable-512.png'}")

    # 7. Update Android native mipmap icons
    update_android_native_icons(full_logo, emblem)

    # 8. Clean up duplicates in Android assets
    clean_duplicate_android_pngs()

    print("All RescueMemory brand icons successfully generated!")


if __name__ == "__main__":
    main()
