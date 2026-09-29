"""Generate crisp RescueMemory brand icons (SVG and PNGs) with Android maskable safe-zone padding."""
from pathlib import Path
from PIL import Image, ImageDraw

PUBLIC_DIR = Path(__file__).resolve().parents[2] / "frontend" / "public"

# SVG with crisp gradient squircle and heartbeat pulse waveform
FAVICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
  <defs>
    <linearGradient id="rescueGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#fb7185" />
      <stop offset="50%" stop-color="#ef4444" />
      <stop offset="100%" stop-color="#b91c1c" />
    </linearGradient>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur stdDeviation="1.5" result="blur" />
      <feComposite in="SourceGraphic" in2="blur" operator="over" />
    </filter>
  </defs>
  <!-- Background Squircle -->
  <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#rescueGrad)" stroke="#fda4af" stroke-width="1.5" />
  <!-- ECG Heartbeat Pulse Line -->
  <path d="M 10 33 L 20 33 L 26 17 L 34 47 L 41 24 L 46 33 L 54 33"
        fill="none"
        stroke="#ffffff"
        stroke-width="5"
        stroke-linecap="round"
        stroke-linejoin="round"
        filter="url(#glow)" />
  <circle cx="54" cy="33" r="2.5" fill="#ffffff" />
</svg>
"""


def draw_icon(size: int, is_maskable: bool = False) -> Image.Image:
    """Draws high-resolution RescueMemory brand icon.
    
    If is_maskable is True, background extends to the edges and the emblem
    is drawn strictly inside the central 70% safe zone to prevent Android clipping.
    """
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    scale = size / 512.0

    if is_maskable:
        # Full-bleed dark background with red brand card centered in safe zone
        draw.rectangle([(0, 0), (size, size)], fill=(11, 22, 37, 255))  # #0b1625

        # Safe zone bounds: 512 * 0.15 = ~77px padding on all sides
        pad = int(80 * scale)
        r = int(72 * scale)
        card_box = [(pad, pad), (size - pad, size - pad)]
        draw.rounded_rectangle(card_box, radius=r, fill=(239, 68, 68, 255), outline=(253, 164, 175, 255), width=int(4 * scale))
        
        # Center coordinates for pulse inside safe zone
        mid_y = size / 2.0
        pts = [
            (pad + 30 * scale, mid_y),
            (pad + 75 * scale, mid_y),
            (pad + 115 * scale, mid_y - 80 * scale),
            (pad + 175 * scale, mid_y + 90 * scale),
            (pad + 225 * scale, mid_y - 45 * scale),
            (pad + 265 * scale, mid_y),
            (size - pad - 30 * scale, mid_y),
        ]
        stroke_w = max(2, int(22 * scale))
    else:
        # Standard rounded icon
        r = int(110 * scale)
        pad = int(12 * scale)
        card_box = [(pad, pad), (size - pad, size - pad)]
        draw.rounded_rectangle(card_box, radius=r, fill=(239, 68, 68, 255), outline=(253, 164, 175, 255), width=max(1, int(5 * scale)))

        mid_y = size / 2.0
        pts = [
            (60 * scale, mid_y),
            (145 * scale, mid_y),
            (210 * scale, mid_y - 140 * scale),
            (305 * scale, mid_y + 150 * scale),
            (380 * scale, mid_y - 70 * scale),
            (430 * scale, mid_y),
            (470 * scale, mid_y),
        ]
        stroke_w = max(2, int(26 * scale))

    # Draw continuous anti-aliased line
    for i in range(len(pts) - 1):
        p1 = pts[i]
        p2 = pts[i + 1]
        draw.line([p1, p2], fill=(255, 255, 255, 255), width=stroke_w)
        # Round joint
        draw.ellipse([
            (p1[0] - stroke_w / 2, p1[1] - stroke_w / 2),
            (p1[0] + stroke_w / 2, p1[1] + stroke_w / 2)
        ], fill=(255, 255, 255, 255))

    # Final point cap
    last = pts[-1]
    draw.ellipse([
        (last[0] - stroke_w / 2, last[1] - stroke_w / 2),
        (last[0] + stroke_w / 2, last[1] + stroke_w / 2)
    ], fill=(255, 255, 255, 255))

    return img


def main():
    PUBLIC_DIR.mkdir(parents=True, exist_ok=True)

    # 1. Save favicon.svg
    svg_path = PUBLIC_DIR / "favicon.svg"
    svg_path.write_text(FAVICON_SVG.strip(), encoding="utf-8")
    print(f"Written: {svg_path}")

    # 2. Save favicon.png (64x64)
    fav_png = draw_icon(64, is_maskable=False)
    fav_png.save(PUBLIC_DIR / "favicon.png", "PNG")
    print(f"Written: {PUBLIC_DIR / 'favicon.png'}")

    # 3. Save icon-192.png (192x192)
    icon_192 = draw_icon(192, is_maskable=False)
    icon_192.save(PUBLIC_DIR / "icon-192.png", "PNG")
    print(f"Written: {PUBLIC_DIR / 'icon-192.png'}")

    # 4. Save icon-512.png (512x512)
    icon_512 = draw_icon(512, is_maskable=False)
    icon_512.save(PUBLIC_DIR / "icon-512.png", "PNG")
    print(f"Written: {PUBLIC_DIR / 'icon-512.png'}")

    # 5. Save icon-maskable-512.png (512x512 with safe-zone for Android adaptive icon)
    maskable_512 = draw_icon(512, is_maskable=True)
    maskable_512.save(PUBLIC_DIR / "icon-maskable-512.png", "PNG")
    print(f"Written: {PUBLIC_DIR / 'icon-maskable-512.png'}")


if __name__ == "__main__":
    main()
