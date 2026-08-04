#!/usr/bin/env python3
"""Build a compact visual audit sheet from the production scene masters."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SCENES = ROOT / "assets" / "scenes"
OUTPUT = ROOT / "assets" / "audits" / "scene-contact-sheet.png"
ORDER = (
    "lv1_dormant",
    "lv1_exhausted",
    "lv1_sad_puppy",
    "lv1_curious_hopeful",
    "lv2_worried_gloomy",
    "lv2_neutral_attentive",
    "lv2_energized",
    "lv3_tired_concerned",
    "lv3_happy_confident",
    "lv3_supercharged",
    "no_connection",
)


def main() -> None:
    thumb_width, thumb_height = 240, 180
    label_height = 22
    columns = 3
    rows = (len(ORDER) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * thumb_width, rows * (thumb_height + label_height)), (7, 11, 18))
    draw = ImageDraw.Draw(sheet)
    for index, key in enumerate(ORDER):
        x = index % columns * thumb_width
        y = index // columns * (thumb_height + label_height)
        image = Image.open(SCENES / f"{key}.png").convert("RGB")
        image = image.resize((thumb_width, thumb_height), Image.Resampling.LANCZOS)
        sheet.paste(image, (x, y))
        draw.rectangle((x, y + thumb_height, x + thumb_width, y + thumb_height + label_height), fill=(7, 11, 18))
        draw.text((x + 6, y + thumb_height + 5), key, fill=(255, 203, 76))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUTPUT, optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
