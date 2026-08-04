#!/usr/bin/env python3
"""Build the final 320x240 Ember loops, previews, and RGB565 stream assets."""

from __future__ import annotations

import json
import math
import shutil
import zlib
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter


PROJECT = Path(__file__).resolve().parents[2]
DESKTOP = Path(__file__).resolve().parents[1]
APPROVAL = PROJECT / "ember_growth_visuals" / "approval-v1"
FINAL = PROJECT / "ember_growth_visuals" / "final-v1"
APP_ASSETS = DESKTOP / "assets"
FRAME_FOLDERS = FINAL / "frame_folders_320x240_48fps"
WIDTH, HEIGHT, FPS, FRAME_COUNT = 320, 240, 48, 96
DEVICE_FPS, DEVICE_FRAME_COUNT = 24, 48
# GIF stores time in centiseconds. Eleven 20 ms frames followed by one 30 ms
# frame averages exactly 20.833 ms, so each 96-frame preview lasts two seconds.
GIF_FRAME_DURATIONS_MS = tuple(30 if (index + 1) % 12 == 0 else 20 for index in range(FRAME_COUNT))
# Five 40 ms frames followed by one 50 ms frame averages 41.666 ms, making a
# two-second, 48-frame device loop exactly 24 FPS within GIF's 10 ms timing unit.
DEVICE_GIF_FRAME_DURATIONS_MS = tuple(
    50 if (index + 1) % 6 == 0 else 40
    for index in range(DEVICE_FRAME_COUNT)
)
RICH_DEVICE_SCENES = frozenset({
    "lv1_dormant",
    "lv1_exhausted",
    "lv1_sad_puppy",
    "lv1_curious_hopeful",
    "lv2_worried_gloomy",
    "lv2_neutral_attentive",
    "lv3_tired_concerned",
})
BANDWIDTH_CONSTRAINED_SCENES = frozenset({
    "lv2_energized",
    "lv3_happy_confident",
    "lv3_supercharged",
})
PROGRESSIVE_APPROVED_SCENES = frozenset({
    "lv1_curious_hopeful",
    "lv2_neutral_attentive",
})
PREVIEW_BODY_BOUNDS = {
    "lv1_dormant": (102, 126, 218, 207),
    "lv1_exhausted": (102, 128, 218, 207),
    "lv1_sad_puppy": (102, 122, 218, 207),
    "lv1_curious_hopeful": (102, 120, 218, 207),
    "lv2_worried_gloomy": (90, 94, 230, 208),
    "lv2_neutral_attentive": (88, 88, 232, 208),
    "lv2_energized": (72, 48, 248, 216),
    "lv3_tired_concerned": (38, 58, 282, 224),
    "lv3_happy_confident": (34, 46, 286, 226),
    "lv3_supercharged": (30, 36, 290, 228),
}
PREVIEW_MOTION = {
    "lv1_dormant": (0.024, 0.045),
    "lv1_exhausted": (0.026, 0.048),
    "lv1_sad_puppy": (0.024, 0.042),
    "lv1_curious_hopeful": (0.022, 0.038),
    "lv2_worried_gloomy": (0.021, 0.036),
    "lv2_neutral_attentive": (0.019, 0.032),
    "lv2_energized": (0.016, 0.026),
    "lv3_tired_concerned": (0.018, 0.032),
    "lv3_happy_confident": (0.014, 0.022),
    "lv3_supercharged": (0.012, 0.020),
}


@dataclass(frozen=True)
class Scene:
    key: str
    source: Path
    level: int
    life: int
    shift_y: int = 0


SCENES = (
    Scene("lv1_dormant", APPROVAL / "scale_corrected_source/01_level_1_dormant.png", 1, 0, 6),
    Scene("lv1_exhausted", FINAL / "generated_source/lv1_exhausted.png", 1, 4, 6),
    Scene("lv1_sad_puppy", APPROVAL / "scale_corrected_source/02_level_1_low_energy.png", 1, 12, 3),
    Scene("lv1_curious_hopeful", FINAL / "generated_source/lv1_hopeful.png", 1, 27, 4),
    Scene("lv2_worried_gloomy", FINAL / "generated_source/lv2_worried.png", 2, 38, 3),
    Scene("lv2_neutral_attentive", APPROVAL / "scale_corrected_source/03_level_2_neutral.png", 2, 49, 4),
    Scene("lv2_energized", APPROVAL / "scale_corrected_source/04_level_2_energized.png", 2, 62, 0),
    Scene("lv3_tired_concerned", APPROVAL / "scale_corrected_source/05_level_3_tired.png", 3, 70, -6),
    Scene("lv3_happy_confident", FINAL / "generated_source/lv3_happy_confident.png", 3, 80, -5),
    Scene("lv3_supercharged", APPROVAL / "scale_corrected_source/06_level_3_supercharged.png", 3, 100, -8),
    Scene("no_connection", APPROVAL / "scale_corrected_source/07_no_connection.png", 1, 0, 16),
)


def shift_vertical(image: Image.Image, delta: int) -> Image.Image:
    if delta == 0:
        return image
    output = Image.new("RGB", image.size)
    if delta > 0:
        output.paste(image.crop((0, 0, image.width, 1)).resize((image.width, delta)), (0, 0))
        output.paste(image.crop((0, 0, image.width, image.height - delta)), (0, delta))
    else:
        amount = -delta
        output.paste(image.crop((0, amount, image.width, image.height)), (0, 0))
        output.paste(image.crop((0, image.height - 1, image.width, image.height)).resize((image.width, amount)), (0, image.height - amount))
    return output


def normalize(scene: Scene) -> Image.Image:
    if not scene.source.exists():
        raise FileNotFoundError(scene.source)
    image = Image.open(scene.source).convert("RGB").resize((WIDTH, HEIGHT), Image.Resampling.BOX)
    return shift_vertical(image, scene.shift_y)


def warm_mask(image: Image.Image, flame_only: bool = False, flame_bottom: int = 170) -> Image.Image:
    pixels = image.load()
    mask = Image.new("L", image.size, 0)
    target = mask.load()
    for y in range(HEIGHT):
        for x in range(WIDTH):
            # Level 1's tiny flame sits lower than the taller Level 2/3 flames.
            # Keep the central glow (including the expressive eye highlights)
            # alive without animating the entire volcano background.
            if flame_only and (y > flame_bottom or x < 105 or x > 215):
                continue
            red, green, blue = pixels[x, y]
            if red > 145 and red > green * 1.12 and green > blue * 1.18:
                target[x, y] = 210
    return mask.filter(ImageFilter.GaussianBlur(0.35))


def animate(base: Image.Image, key: str) -> list[Image.Image]:
    if key == "no_connection":
        return [base.copy() for _ in range(FRAME_COUNT)]
    flame_bottom = 170 if key.startswith("lv1_") else 145 if key.startswith("lv2_") else 120
    flame = warm_mask(base, flame_only=True, flame_bottom=flame_bottom)
    cracks = warm_mask(base, flame_only=False)
    frames: list[Image.Image] = []
    phase_offset = (sum(ord(character) for character in key) % 11) / 11 * math.tau
    flame_alpha = flame.point(lambda value: value * 2 // 3) if key == "lv3_supercharged" else flame
    crack_alpha = (
        Image.new("L", base.size, 0)
        if key in BANDWIDTH_CONSTRAINED_SCENES
        else cracks.point(lambda value: value // 3)
    )
    amplitude = {
        "lv1_dormant": 0.12,
        "lv1_exhausted": 0.14,
        "lv1_sad_puppy": 0.14,
        "lv1_curious_hopeful": 0.13,
        "lv2_worried_gloomy": 0.13,
        "lv2_neutral_attentive": 0.12,
        "lv2_energized": 0.075,
        "lv3_tired_concerned": 0.11,
        "lv3_happy_confident": 0.045,
        "lv3_supercharged": 0.035,
    }.get(key, 0.10)
    flame_bounds = flame_alpha.getbbox()
    for index in range(FRAME_COUNT):
        phase = index / FRAME_COUNT * math.tau + phase_offset
        frame = base.copy()

        # A smooth two-second fire/face pulse changes only warm pixels. Low-life
        # scenes get a larger pulse so their tiny flames visibly move after
        # RGB565 quantization; high-energy scenes stay within the USB budget.
        flame_gain = 1.0 + amplitude * math.sin(phase) + amplitude * 0.34 * math.sin(phase * 3)
        crack_gain = 1.0 + min(0.042, amplitude * 0.35) * math.sin(phase - 0.7)
        flame_layer = ImageEnhance.Brightness(base).enhance(flame_gain)
        crack_layer = ImageEnhance.Color(ImageEnhance.Brightness(base).enhance(crack_gain)).enhance(1.03)
        frame.paste(crack_layer, (0, 0), crack_alpha)
        frame.paste(flame_layer, (0, 0), flame_alpha)

        # Sway only the upper half of the detected central flame/glow. The body
        # remains locked to x=160 and the ground line never moves.
        if flame_bounds:
            left, top, right, bottom = flame_bounds
            tip_bottom = min(bottom, top + max(18, (bottom - top) // 2))
            tip_box = (left, top, right, tip_bottom)
            sway = round(2 * math.sin(phase * 2))
            lift = -1 if math.sin(phase) > 0.72 else 0
            tip_mask = flame_alpha.crop(tip_box)
            tip = frame.crop(tip_box)
            frame.paste(base.crop(tip_box), (left, top))
            frame.paste(tip, (left + sway, top + lift), tip_mask)
        frames.append(frame)
    return frames


def staggered_device_frames(frames: list[Image.Image], bottom: int, rows_per_tick: int = 8) -> list[Image.Image]:
    """Make high-energy motion cheap to draw as top-to-bottom row groups.

    Two warm-up cycles make the returned two-second loop perfectly periodic.
    Only the central flame/eye region advances on a given tick; the richer GIF
    preview remains untouched.
    """
    current = frames[0].copy()
    output: list[Image.Image] = []
    for step in range(FRAME_COUNT * 2):
        desired = frames[step % FRAME_COUNT]
        start_row = (step % FRAME_COUNT * rows_per_tick) % bottom
        for offset in range(rows_per_tick):
            row = (start_row + offset) % bottom
            strip = desired.crop((105, row, 216, row + 1))
            current.paste(strip, (105, row))
        if step >= FRAME_COUNT:
            output.append(current.copy())
    return output


def smoothstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * (3.0 - 2.0 * value)


def preview_frames(source: Path, fallback: list[Image.Image]) -> list[Image.Image]:
    """Resample an approved moving loop into a smooth, two-second 48 FPS loop."""
    if not source.exists():
        return [frame.copy() for frame in fallback]

    animation = Image.open(source)
    originals: list[Image.Image] = []
    durations: list[int] = []
    for index in range(animation.n_frames):
        animation.seek(index)
        originals.append(animation.convert("RGB").resize((WIDTH, HEIGHT), Image.Resampling.BOX))
        durations.append(max(10, int(animation.info.get("duration", 40))))
    if len(originals) <= 1:
        return [originals[0].copy() for _ in range(FRAME_COUNT)]

    total_duration = sum(durations)
    boundaries: list[int] = []
    elapsed = 0
    for duration in durations:
        boundaries.append(elapsed)
        elapsed += duration

    output: list[Image.Image] = []
    for index in range(FRAME_COUNT):
        time_ms = index * total_duration / FRAME_COUNT
        source_index = len(originals) - 1
        for candidate, start in enumerate(boundaries):
            if time_ms < start + durations[candidate]:
                source_index = candidate
                break
        local = (time_ms - boundaries[source_index]) / durations[source_index]
        following = (source_index + 1) % len(originals)
        output.append(Image.blend(originals[source_index], originals[following], smoothstep(local)))
    return output


def cute_preview_motion(frames: list[Image.Image], key: str) -> list[Image.Image]:
    """Add visible, seamless body breathing without moving Ember's ground line."""
    bounds = PREVIEW_BODY_BOUNDS[key]
    width_gain, height_gain = PREVIEW_MOTION[key]
    left, top, right, bottom = bounds
    body_width = right - left
    body_height = bottom - top
    native_mask = Image.new("L", (body_width, body_height), 0)
    ImageDraw.Draw(native_mask).ellipse((1, 1, body_width - 2, body_height - 2), fill=255)
    native_mask = native_mask.filter(ImageFilter.GaussianBlur(0.8))
    maximum_width = math.ceil(body_width * (1.0 + width_gain))
    if (maximum_width - body_width) % 2:
        maximum_width += 1
    maximum_height = math.ceil(body_height * (1.0 + height_gain))
    paste_x = round((left + right - maximum_width) / 2)
    paste_y = bottom - maximum_height

    output: list[Image.Image] = []
    for index, source in enumerate(frames):
        phase = index / FRAME_COUNT * math.tau
        # Starts and ends at the canonical pose, expands at mid-loop, and uses
        # a tiny second harmonic so the motion reads as a cute inhale/exhale.
        inhale = 0.5 - 0.5 * math.cos(phase)
        inhale = min(1.0, max(0.0, inhale + 0.08 * math.sin(phase * 2)))
        frame = source.copy()
        body = source.crop(bounds).convert("RGBA")
        body.putalpha(native_mask)
        scale_x = 1.0 + width_gain * inhale
        scale_y = 1.0 + height_gain * inhale
        inverse = (
            1.0 / scale_x,
            0.0,
            body_width / 2.0 - maximum_width / (2.0 * scale_x),
            0.0,
            1.0 / scale_y,
            body_height - maximum_height / scale_y,
        )
        rendered = body.transform(
            (maximum_width, maximum_height),
            Image.Transform.AFFINE,
            inverse,
            resample=Image.Resampling.BICUBIC,
            fillcolor=(0, 0, 0, 0),
        )
        frame.paste(rendered.convert("RGB"), (paste_x, paste_y), rendered.getchannel("A"))
        output.append(frame)
    return output


def cute_device_motion(frames: list[Image.Image], key: str) -> list[Image.Image]:
    """Animate Ember's face inside a compact rectangle the ESP32 can decode at 24 FPS.

    The full desktop breathing transform touches most of a large Level 3 body,
    which makes a GIF decoder revisit nearly the whole 320x240 canvas. This
    face-and-flame motion retains the character's cute inhale/exhale while the
    display controller keeps the static body and background pixels untouched.
    """
    if key == "no_connection":
        return [frame.copy() for frame in frames]
    left, top, right, bottom = PREVIEW_BODY_BOUNDS[key]
    body_width = right - left
    body_height = bottom - top
    face_box = (
        round(left + body_width * 0.17),
        round(top + body_height * 0.22),
        round(right - body_width * 0.17),
        min(bottom - 8, round(top + body_height * 0.72)),
    )
    face_width = face_box[2] - face_box[0]
    face_height = face_box[3] - face_box[1]
    mask = Image.new("L", (face_width, face_height), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (1, 1, face_width - 2, face_height - 2),
        radius=max(5, face_height // 4),
        fill=255,
    )
    mask = mask.filter(ImageFilter.GaussianBlur(1.0))

    output: list[Image.Image] = []
    for index, source in enumerate(frames):
        phase = index / FRAME_COUNT * math.tau
        inhale = 0.5 - 0.5 * math.cos(phase)
        lift = 2.2 * inhale + 0.25 * math.sin(phase * 2)
        face = source.crop(face_box).convert("RGBA")
        face.putalpha(mask)
        lifted = face.transform(
            face.size,
            Image.Transform.AFFINE,
            (1.0, 0.0, 0.0, 0.0, 1.0, lift),
            resample=Image.Resampling.BICUBIC,
            fillcolor=(0, 0, 0, 0),
        )
        frame = source.copy()
        frame.paste(lifted.convert("RGB"), face_box[:2], lifted.getchannel("A"))
        output.append(frame)
    return output


def save_preview_gif(
    frames: list[Image.Image],
    output: Path,
    marker_position: tuple[int, int] = (WIDTH - 1, HEIGHT - 1),
    durations: tuple[int, ...] = GIF_FRAME_DURATIONS_MS,
) -> None:
    """Write a looping GIF with a caller-selected exact average cadence."""
    if len(frames) != len(durations):
        raise ValueError(f"{output.name}: {len(frames)} frames but {len(durations)} durations")
    palette_source = Image.new("RGB", (WIDTH * 4, HEIGHT * 3))
    palette_step = max(1, len(frames) // 12)
    for index, frame in enumerate(frames[::palette_step][:12]):
        palette_source.paste(frame, ((index % 4) * WIDTH, (index // 4) * HEIGHT))
    palette = palette_source.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    indexed = [frame.quantize(palette=palette, dither=Image.Dither.NONE) for frame in frames]
    if len({frame.tobytes() for frame in indexed}) > 1:
        # Pillow otherwise coalesces subtle pixel-art holds. Alternate the two
        # palette colors nearest the existing bottom-right pixel so the file
        # retains all 96 timed frames without a visible marker.
        target = frames[0].getpixel(marker_position)
        values = palette.getpalette()[: 256 * 3]
        nearest = sorted(
            range(len(values) // 3),
            key=lambda index: sum(
                (values[index * 3 + channel] - target[channel]) ** 2
                for channel in range(3)
            ),
        )[:2]
        for index, frame in enumerate(indexed):
            frame.putpixel(marker_position, nearest[index % 2])
    indexed[0].save(
        output,
        save_all=True,
        append_images=indexed[1:],
        duration=list(durations),
        loop=0,
        disposal=1,
        # Let Pillow store changed rectangles instead of a full 320x240 image
        # for every frame. The resulting file is the exact same preview the
        # desktop shows, but small enough to install in the CYD's 1.4 MB
        # LittleFS partition and decode locally.
        optimize=True,
    )


def validate_preview_gif(output: Path, animated: bool) -> dict[str, int | float]:
    image = Image.open(output)
    frames: list[Image.Image] = []
    durations: list[int] = []
    for index in range(image.n_frames):
        image.seek(index)
        frames.append(image.convert("RGB").copy())
        durations.append(int(image.info.get("duration", 0)))

    if sum(durations) != 2000:
        raise ValueError(f"{output.name}: expected a 2000 ms loop, got {sum(durations)} ms")
    if not animated:
        if len(frames) != 1:
            raise ValueError(f"{output.name}: static fallback unexpectedly contains {len(frames)} frames")
        return {"frames": 1, "durationMs": 2000, "uniqueFrames": 1, "meaningfulTransitions": 0}
    if len(frames) != FRAME_COUNT:
        raise ValueError(f"{output.name}: expected {FRAME_COUNT} frames, got {len(frames)}")

    changes: list[int] = []
    for previous, current in zip(frames, frames[1:] + frames[:1]):
        difference = ImageChops.difference(previous, current)
        changes.append(
            0
            if difference.getbbox() is None
            else sum(pixel != (0, 0, 0) for pixel in difference.getdata())
        )
    unique_frames = len({frame.tobytes() for frame in frames})
    meaningful_transitions = sum(changed > 25 for changed in changes)
    median_changed = sorted(changes)[len(changes) // 2]
    if unique_frames < 80:
        raise ValueError(f"{output.name}: only {unique_frames} visually unique frames")
    if meaningful_transitions < 72 or median_changed < 100:
        raise ValueError(
            f"{output.name}: motion is too subtle "
            f"({meaningful_transitions} meaningful transitions, median {median_changed} pixels)"
        )
    if changes[-1] > 1000:
        raise ValueError(f"{output.name}: visible loop seam changes {changes[-1]} pixels")
    return {
        "frames": len(frames),
        "durationMs": sum(durations),
        "effectiveFps": len(frames) / (sum(durations) / 1000),
        "uniqueFrames": unique_frames,
        "meaningfulTransitions": meaningful_transitions,
        "medianChangedPixels": median_changed,
        "averageChangedPixels": round(sum(changes) / len(changes), 1),
        "loopSeamChangedPixels": changes[-1],
    }


def rgb565_bytes(image: Image.Image) -> bytes:
    output = bytearray(WIDTH * HEIGHT * 2)
    offset = 0
    for red, green, blue in image.getdata():
        value = ((red & 0xF8) << 8) | ((green & 0xFC) << 3) | (blue >> 3)
        output[offset] = value & 0xFF
        output[offset + 1] = value >> 8
        offset += 2
    return bytes(output)


def rle_palette(image: Image.Image) -> tuple[list[tuple[int, int, int]], bytes]:
    quantized = image.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    palette_data = quantized.getpalette()[: 128 * 3]
    palette = [tuple(palette_data[i : i + 3]) for i in range(0, len(palette_data), 3)]
    indices = list(quantized.getdata())
    encoded = bytearray()
    cursor = 0
    while cursor < len(indices):
        value = indices[cursor]
        count = 1
        while cursor + count < len(indices) and indices[cursor + count] == value and count < 255:
            count += 1
        encoded.extend((count, value))
        cursor += count
    return palette, bytes(encoded)


def write_fallback_header(image: Image.Image) -> None:
    firmware_include = PROJECT / "firmware/claude-burner-cyd/include"
    firmware_include.mkdir(parents=True, exist_ok=True)
    palette, encoded = rle_palette(image)
    palette565 = [((r & 0xF8) << 8) | ((g & 0xFC) << 3) | (b >> 3) for r, g, b in palette]
    palette_lines = [", ".join(f"0x{value:04x}" for value in palette565[i : i + 12]) for i in range(0, len(palette565), 12)]
    data_lines = [", ".join(f"0x{value:02x}" for value in encoded[i : i + 24]) for i in range(0, len(encoded), 24)]
    header = (
        "#pragma once\n#include <Arduino.h>\n\n"
        "static const uint16_t kNoConnectionPalette[] PROGMEM = {\n  "
        + ",\n  ".join(palette_lines)
        + "\n};\n\nstatic const uint8_t kNoConnectionRle[] PROGMEM = {\n  "
        + ",\n  ".join(data_lines)
        + "\n};\n"
        + f"static constexpr size_t kNoConnectionRleSize = {len(encoded)};\n"
    )
    (firmware_include / "fallback_scene.h").write_text(header)


def build() -> None:
    scenes_dir = APP_ASSETS / "scenes"
    animations_dir = APP_ASSETS / "animations"
    previews_dir = APP_ASSETS / "previews"
    device_gifs_dir = APP_ASSETS / "device-gifs"
    scenes_dir.mkdir(parents=True, exist_ok=True)
    animations_dir.mkdir(parents=True, exist_ok=True)
    previews_dir.mkdir(parents=True, exist_ok=True)
    device_gifs_dir.mkdir(parents=True, exist_ok=True)
    for generated_animation in animations_dir.glob("*"):
        if generated_animation.is_file():
            generated_animation.unlink()
    for generated_preview in previews_dir.glob("*"):
        if generated_preview.is_file():
            generated_preview.unlink()
    for generated_device_gif in device_gifs_dir.glob("*"):
        if generated_device_gif.is_file():
            generated_device_gif.unlink()
    FRAME_FOLDERS.mkdir(parents=True, exist_ok=True)
    manifest: dict[str, object] = {"version": 1, "width": WIDTH, "height": HEIGHT, "fps": FPS, "frameBytes": WIDTH * HEIGHT * 2, "scenes": {}}
    masters: dict[str, Image.Image] = {}
    preview_audit: dict[str, dict[str, int | float]] = {}

    for scene in SCENES:
        master = normalize(scene)
        masters[scene.key] = master
        master.save(scenes_dir / f"{scene.key}.png", optimize=True)
        bandwidth_frames = animate(master, scene.key)
        if scene.key != "no_connection":
            # A classic ESP32 cannot decode a full 320x240 changed rectangle on
            # every tick. Keep the complete first frame, then restrict later
            # local-playback changes to Ember's central flame/face area. The
            # firmware redraws frame zero at every loop boundary so the ILI9341
            # never retains stale delta pixels from the previous loop.
            flame_bottom = 170 if scene.key.startswith("lv1_") else 150 if scene.key.startswith("lv2_") else 130
            rows_per_tick = 8 if scene.key.startswith(("lv1_", "lv2_")) else 6
            bandwidth_frames = staggered_device_frames(bandwidth_frames, flame_bottom, rows_per_tick)
        approved_preview = FINAL / f"{scene.key}_loop_25fps.gif"
        approved_moving_frames = preview_frames(approved_preview, bandwidth_frames)
        moving_preview_frames = (
            approved_moving_frames
            if scene.key == "no_connection"
            else cute_preview_motion(approved_moving_frames, scene.key)
        )
        app_preview = previews_dir / f"{scene.key}.gif"
        save_preview_gif(moving_preview_frames, app_preview)
        preview_audit[scene.key] = validate_preview_gif(app_preview, scene.key != "no_connection")
        device_gif_path = device_gifs_dir / f"{scene.key}.gif"
        # The alternating timing-preservation pixel lives inside the central
        # animation rectangle so it never expands a delta frame to 320x240.
        local_playback_frames = cute_device_motion(bandwidth_frames, scene.key)[::2]
        save_preview_gif(
            local_playback_frames,
            device_gif_path,
            marker_position=(160, 100),
            durations=DEVICE_GIF_FRAME_DURATIONS_MS,
        )
        device_gif = device_gif_path.read_bytes()
        shutil.copy2(app_preview, FINAL / f"{scene.key}_loop_48fps.gif")
        frames = approved_moving_frames if scene.key in RICH_DEVICE_SCENES else bandwidth_frames
        if scene.key in PROGRESSIVE_APPROVED_SCENES:
            frames = staggered_device_frames(frames, 190, 4)
        folder = FRAME_FOLDERS / scene.key
        if folder.exists():
            shutil.rmtree(folder)
        folder.mkdir(parents=True)
        raw_frames = bytearray()
        for index, frame in enumerate(frames):
            frame.save(folder / f"frame_{index:03d}.png", compress_level=3)
            raw_frames.extend(rgb565_bytes(frame))
        raw_path = animations_dir / f"{scene.key}.rgb565.zlib"
        raw_path.write_bytes(zlib.compress(bytes(raw_frames), level=9))
        manifest["scenes"][scene.key] = {
            "file": f"animations/{scene.key}.rgb565.zlib",
            "preview": f"previews/{scene.key}.gif",
            "deviceGif": f"device-gifs/{scene.key}.gif",
            "frames": FRAME_COUNT,
            "compression": "deflate",
            "level": scene.level,
            "referenceLife": scene.life,
            "deviceGifBytes": len(device_gif),
            "deviceGifCrc32": zlib.crc32(device_gif) & 0xFFFFFFFF,
            "deviceGifFps": DEVICE_FPS,
            "deviceGifFrames": DEVICE_FRAME_COUNT,
            "deviceGifDurationMs": sum(DEVICE_GIF_FRAME_DURATIONS_MS),
        }

    manifest["frameLoadOrder"] = "top-to-bottom"
    manifest["previewFrameDurationsMs"] = list(GIF_FRAME_DURATIONS_MS)
    manifest["previewAudit"] = "preview-audit.json"
    (APP_ASSETS / "animation-pack.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (APP_ASSETS / "preview-audit.json").write_text(json.dumps(preview_audit, indent=2) + "\n")
    write_fallback_header(masters["no_connection"])
    print(f"Built {len(SCENES)} scene loops, {FRAME_COUNT} frames each, at {FPS} FPS")


if __name__ == "__main__":
    build()
