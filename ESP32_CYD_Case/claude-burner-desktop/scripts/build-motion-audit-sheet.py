#!/usr/bin/env python3
"""Build a six-pose filmstrip for every production device GIF."""

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
GIFS = ROOT / "assets" / "device-gifs"
OUTPUT = ROOT / "assets" / "audits" / "device-motion-filmstrip.png"
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
)


def main() -> None:
    samples = 6
    width, height = 160, 120
    label_width = 172
    sheet = Image.new("RGB", (label_width + samples * width, len(ORDER) * height), (7, 11, 18))
    draw = ImageDraw.Draw(sheet)
    for row, key in enumerate(ORDER):
        animation = Image.open(GIFS / f"{key}.gif")
        indices = [round(index * (animation.n_frames - 1) / (samples - 1)) for index in range(samples)]
        draw.text((8, row * height + 10), key, fill=(255, 203, 76))
        draw.text((8, row * height + 28), f"{animation.n_frames}f / 3s", fill=(185, 197, 211))
        for column, frame_index in enumerate(indices):
            animation.seek(frame_index)
            frame = animation.convert("RGB").resize((width, height), Image.Resampling.NEAREST)
            sheet.paste(frame, (label_width + column * width, row * height))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(OUTPUT, optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
