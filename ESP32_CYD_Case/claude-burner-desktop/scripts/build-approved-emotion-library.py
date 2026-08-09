#!/usr/bin/env python3
"""Build the approved 3x5 Ember emotion library for desktop and CYD.

The approved contact sheet is treated as immutable key art. Each panel is
normalized to 320x240, then animated with a deterministic, bounded rig. The
rig never extracts or moves the character silhouette, which eliminates the
dark fringe / copied-background artifacts seen in the old sprite pipeline.

Animation is communicated through authored expression key art plus eased
eyelids, living head/tail flames, fissure light, eye glints, shadows, and
emotion-specific warm particles. The HUD and central volcano summit are copied
back from the anchor after every frame operation.
"""

from __future__ import annotations

import argparse
import colorsys
import hashlib
import json
import math
import statistics
import zlib
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageEnhance, ImageFilter, ImageOps


SCRIPT = Path(__file__).resolve()
PROJECT_ROOT = SCRIPT.parents[2]
SOURCE_SHEET = (
    PROJECT_ROOT
    / "ember_animations"
    / "emotion-prototypes-v1"
    / "ember-3x5-emotion-prototype-v2.png"
)
OUTPUT_ROOT = PROJECT_ROOT / "ember_animations" / "emotion-library-v2-production"
ANCHOR_ROOT = OUTPUT_ROOT / "anchors"
GIF_ROOT = OUTPUT_ROOT / "gifs"

WIDTH = 320
HEIGHT = 240
FRAME_COUNT = 96
FRAME_DURATIONS_MS = [40, 40, 40, 40, 40, 50] * 16
LOOP_DURATION_MS = sum(FRAME_DURATIONS_MS)
FPS = FRAME_COUNT / (LOOP_DURATION_MS / 1000)
HUD_SAFE = (8, 8, 128, 35)
# Only the sharp crater/top edge needs a hard lock. The approved large forms
# overlap the lower mountain with their foreground flame, so a broad rectangle
# would erase the very motion the user approved.
SUMMIT_PROTECT = (144, 18, 178, 48)
DEVICE_GIF_LIMIT_BYTES = 550 * 1024
# Preserve the central 76% of every source panel at one uniform X/Y scale.
# Only the far scenery bands are widened to fill the 4:3 LCD. The character,
# eyes, flames, volcano and ground therefore retain their authored geometry.
PERIPHERAL_EXTENSION_FRACTION = 0.12

# Exact non-white panel bounds in the approved sheet. Keeping these explicit
# prevents a future contact-sheet layout change from silently changing art.
CELL_X = ((17, 350), (360, 665), (674, 979), (988, 1291), (1300, 1600))
CELL_Y = ((25, 305), (326, 612), (634, 927))
SIZES = ("small", "medium", "large")
EMOTIONS = ("moody", "hopeful", "cheerful", "excited", "explosion")


@dataclass(frozen=True)
class MotionProfile:
    flame_scale: float
    glow_gain: float
    particle_count: int
    particle_rise: float
    glint_amount: float
    shadow_pulse: float
    blink_count: int
    blink_depth: float
    motion_label: str


PROFILES = {
    "moody": MotionProfile(0.48, 0.025, 1, 9.0, 0.15, 0.05, 1, 0.55, "low sputter and weary half-blink"),
    "hopeful": MotionProfile(0.72, 0.045, 2, 14.0, 0.35, 0.08, 1, 0.82, "gentle flame lift, eye shine, and rising mote"),
    "cheerful": MotionProfile(0.96, 0.070, 3, 18.0, 0.55, 0.12, 2, 0.92, "playful flame sway, bright eyes, and warm motes"),
    "excited": MotionProfile(1.22, 0.105, 5, 23.0, 0.78, 0.18, 2, 0.86, "quick flame snap, bounce shadow, and sparks"),
    "explosion": MotionProfile(1.52, 0.145, 8, 30.0, 1.00, 0.24, 1, 0.72, "crown flame, star glints, eruption sparks, and impact ring"),
}


@dataclass(frozen=True)
class StateSpec:
    key: str
    size: str
    emotion: str
    row: int
    column: int
    body_box: tuple[int, int, int, int]
    motion_box: tuple[int, int, int, int]

    @property
    def anchor_path(self) -> Path:
        return ANCHOR_ROOT / f"{self.key}.png"

    @property
    def gif_path(self) -> Path:
        return GIF_ROOT / f"{self.key}.gif"


SIZE_BOXES = {
    "small": ((92, 110, 232, 226), (72, 72, 258, 232)),
    "medium": ((76, 84, 250, 228), (58, 50, 276, 234)),
    "large": ((55, 62, 269, 231), (38, 38, 292, 236)),
}

STATES = tuple(
    StateSpec(
        key=f"{size}_{emotion}",
        size=size,
        emotion=emotion,
        row=row,
        column=column,
        body_box=SIZE_BOXES[size][0],
        motion_box=SIZE_BOXES[size][1],
    )
    for row, size in enumerate(SIZES)
    for column, emotion in enumerate(EMOTIONS)
)


# Generated scene landmarks are visually clear but not machine-separable by
# warm-pixel components: eyes compete with paws/fissures, while head flames
# align with the distant crater. Coordinates are locked per approved panel.
EYE_BOXES = {
    "small_moody": ((123, 143, 145, 163), (150, 143, 174, 163)),
    "small_hopeful": ((120, 134, 146, 164), (150, 134, 177, 164)),
    "small_cheerful": ((114, 114, 143, 149), (145, 114, 174, 149)),
    "small_excited": ((109, 105, 142, 142), (145, 105, 179, 142)),
    "small_explosion": ((108, 107, 146, 146), (147, 107, 184, 146)),
    "medium_moody": ((112, 137, 146, 162), (151, 137, 184, 162)),
    "medium_hopeful": ((111, 108, 145, 143), (151, 108, 186, 143)),
    "medium_cheerful": ((106, 101, 144, 139), (149, 101, 187, 139)),
    "medium_excited": ((94, 88, 137, 132), (142, 88, 185, 132)),
    "medium_explosion": ((91, 100, 139, 148), (146, 100, 195, 148)),
    "large_moody": ((97, 112, 141, 144), (149, 112, 194, 144)),
    "large_hopeful": ((96, 89, 138, 131), (146, 89, 189, 131)),
    "large_cheerful": ((91, 81, 139, 130), (144, 81, 192, 130)),
    "large_excited": ((82, 70, 137, 121), (140, 70, 196, 121)),
    "large_explosion": ((87, 87, 141, 137), (144, 87, 197, 137)),
}

# Coordinates are the bases of the authored flames, not their brightest
# centroid.  Procedural tongues grow upward from these points and therefore
# remain visually welded to Ember instead of appearing on the volcano or
# ground cracks.
FLAME_SOURCES: dict[str, tuple[tuple[int, int], tuple[int, int] | None]] = {
    "small_moody": ((149, 123), None),
    "small_hopeful": ((153, 108), (205, 177)),
    "small_cheerful": ((157, 101), (214, 151)),
    "small_excited": ((151, 91), (211, 129)),
    "small_explosion": ((161, 91), (211, 169)),
    "medium_moody": ((145, 102), None),
    "medium_hopeful": ((145, 84), (225, 158)),
    "medium_cheerful": ((150, 77), (220, 143)),
    "medium_excited": ((141, 67), (217, 136)),
    "medium_explosion": ((160, 75), (209, 156)),
    "large_moody": ((128, 72), None),
    "large_hopeful": ((136, 55), (229, 162)),
    "large_cheerful": ((124, 47), (218, 128)),
    "large_excited": ((124, 43), (221, 136)),
    "large_explosion": ((146, 58), (222, 143)),
}


def smootherstep(value: float) -> float:
    value = max(0.0, min(1.0, value))
    return value * value * value * (value * (value * 6 - 15) + 10)


def normalization_geometry(spec: StateSpec) -> dict[str, object]:
    left, right = CELL_X[spec.column]
    top, bottom = CELL_Y[spec.row]
    source_width = right - left
    source_height = bottom - top
    uniform_scale = HEIGHT / source_height
    fitted_width = round(source_width * uniform_scale)
    if fitted_width > WIDTH:
        raise ValueError(f"{spec.key}: source panel cannot fit the 320x240 canvas")

    added_width = WIDTH - fitted_width
    source_edge_width = max(1, round(fitted_width * PERIPHERAL_EXTENSION_FRACTION))
    central_width = fitted_width - source_edge_width * 2
    left_width = source_edge_width + added_width // 2
    right_width = WIDTH - left_width - central_width
    scale_x = fitted_width / source_width
    scale_y = uniform_scale
    relative_scale_error = abs(scale_x / scale_y - 1.0)
    if relative_scale_error > 0.005:
        raise ValueError(
            f"{spec.key}: central art would be scaled non-uniformly "
            f"({scale_x=:.6f}, {scale_y=:.6f})"
        )
    return {
        "sourceCanvas": [source_width, source_height],
        "sourceAspectRatio": source_width / source_height,
        "fittedCanvas": [fitted_width, HEIGHT],
        "centralScaleX": scale_x,
        "centralScaleY": scale_y,
        "relativeScaleError": relative_scale_error,
        "peripheralSourceWidth": source_edge_width,
        "leftExtendedWidth": left_width,
        "centralPreservedWidth": central_width,
        "rightExtendedWidth": right_width,
        "leftAddedPixels": left_width - source_edge_width,
        "rightAddedPixels": right_width - source_edge_width,
        "aspectPreservingCentralArt": True,
        "peripheralBackgroundExtensionOnly": True,
    }


def corrected_x(spec: StateSpec, legacy_x: float) -> int:
    """Map an old 320px-wide rig landmark into aspect-corrected art."""
    geometry = normalization_geometry(spec)
    fitted_width = int(geometry["fittedCanvas"][0])
    edge = int(geometry["peripheralSourceWidth"])
    left_width = int(geometry["leftExtendedWidth"])
    central_width = int(geometry["centralPreservedWidth"])
    right_width = int(geometry["rightExtendedWidth"])
    fitted_x = max(0.0, min(float(fitted_width), legacy_x * fitted_width / WIDTH))
    if fitted_x < edge:
        mapped = fitted_x * left_width / edge
    elif fitted_x <= edge + central_width:
        mapped = left_width + fitted_x - edge
    else:
        mapped = left_width + central_width + (
            (fitted_x - edge - central_width) * right_width / edge
        )
    return max(0, min(WIDTH, round(mapped)))


def corrected_point(spec: StateSpec, point: tuple[int, int]) -> tuple[int, int]:
    return corrected_x(spec, point[0]), point[1]


def corrected_box(
    spec: StateSpec,
    box: tuple[int, int, int, int],
) -> tuple[int, int, int, int]:
    return corrected_x(spec, box[0]), box[1], corrected_x(spec, box[2]), box[3]


def normalize_cell(sheet: Image.Image, spec: StateSpec) -> Image.Image:
    left, right = CELL_X[spec.column]
    top, bottom = CELL_Y[spec.row]
    cell = sheet.crop((left, top, right, bottom)).convert("RGB")
    geometry = normalization_geometry(spec)
    fitted_width = int(geometry["fittedCanvas"][0])
    edge = int(geometry["peripheralSourceWidth"])
    left_width = int(geometry["leftExtendedWidth"])
    central_width = int(geometry["centralPreservedWidth"])
    right_width = int(geometry["rightExtendedWidth"])

    # Scale the authored panel uniformly first. Then widen only the distant
    # peripheral scenery. This preserves every flame/foot pixel without bars
    # and never changes Ember's X/Y proportions.
    fitted = cell.resize((fitted_width, HEIGHT), Image.Resampling.LANCZOS)
    anchor = Image.new("RGB", (WIDTH, HEIGHT))
    anchor.paste(
        fitted.crop((0, 0, edge, HEIGHT)).resize(
            (left_width, HEIGHT), Image.Resampling.LANCZOS
        ),
        (0, 0),
    )
    anchor.paste(
        fitted.crop((edge, 0, edge + central_width, HEIGHT)),
        (left_width, 0),
    )
    anchor.paste(
        fitted.crop((edge + central_width, 0, fitted_width, HEIGHT)).resize(
            (right_width, HEIGHT), Image.Resampling.LANCZOS
        ),
        (left_width + central_width, 0),
    )
    return anchor.filter(ImageFilter.UnsharpMask(radius=0.58, percent=72, threshold=4))


def warm_mask(anchor: Image.Image, spec: StateSpec) -> Image.Image:
    mask = Image.new("L", anchor.size, 0)
    source = anchor.load()
    target = mask.load()
    # Pulse Ember's fissures, never the eruption/background. Using the broader
    # motion box here made explosion states rewrite thousands of lava pixels
    # every frame and exceeded the device's atomic incoming-GIF budget.
    left, top, right, bottom = corrected_box(spec, spec.body_box)
    for y in range(top, bottom):
        for x in range(left, right):
            red, green, blue = source[x, y]
            hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
            if (hue <= 0.16 or hue >= 0.98) and saturation >= 0.38 and value >= 0.38 and red - blue >= 28:
                target[x, y] = max(0, min(255, round((saturation * 0.58 + value * 0.42) * 255 - 54)))
    ImageDraw.Draw(mask).rectangle(HUD_SAFE, fill=0)
    ImageDraw.Draw(mask).rectangle(SUMMIT_PROTECT, fill=0)
    return mask.filter(ImageFilter.GaussianBlur(0.62))


def connected_components(mask: Image.Image, minimum_pixels: int = 3) -> list[tuple[int, tuple[int, int, int, int], list[tuple[int, int]]]]:
    pixels = mask.load()
    width, height = mask.size
    seen: set[tuple[int, int]] = set()
    output: list[tuple[int, tuple[int, int, int, int], list[tuple[int, int]]]] = []
    for y in range(height):
        for x in range(width):
            if pixels[x, y] == 0 or (x, y) in seen:
                continue
            queue = deque([(x, y)])
            seen.add((x, y))
            points: list[tuple[int, int]] = []
            while queue:
                px, py = queue.popleft()
                points.append((px, py))
                for nx, ny in ((px - 1, py), (px + 1, py), (px, py - 1), (px, py + 1)):
                    if 0 <= nx < width and 0 <= ny < height and mask.getpixel((nx, ny)) and (nx, ny) not in seen:
                        seen.add((nx, ny))
                        queue.append((nx, ny))
            if len(points) < minimum_pixels:
                continue
            xs = [point[0] for point in points]
            ys = [point[1] for point in points]
            output.append((len(points), (min(xs), min(ys), max(xs) + 1, max(ys) + 1), points))
    return output


def eye_boxes(anchor: Image.Image, spec: StateSpec) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    """Return approved eye envelopes; never infer them from background art.

    ``anchor`` remains in the signature because callers provide it and future
    authored revisions may validate the coordinates against it.  Warm-pixel
    auto-detection is intentionally avoided: paws, fissures and eruption
    debris are brighter than the eyes in several approved states.
    """
    del anchor
    return tuple(corrected_box(spec, box) for box in EYE_BOXES[spec.key])


def sample_charcoal(anchor: Image.Image, eye_box: tuple[int, int, int, int]) -> tuple[int, int, int]:
    x0, y0, x1, y1 = eye_box
    colors: list[tuple[int, int, int]] = []
    pixels = anchor.load()
    for y in range(max(0, y0 - 6), min(HEIGHT, y1 + 5)):
        for x in range(max(0, x0 - 6), min(WIDTH, x1 + 6)):
            if x0 <= x < x1 and y0 <= y < y1:
                continue
            color = pixels[x, y]
            light = 0.2126 * color[0] + 0.7152 * color[1] + 0.0722 * color[2]
            if 18 <= light <= 108 and max(color) - min(color) <= 72:
                colors.append(color)
    if not colors:
        return (52, 48, 47)
    colors.sort(key=lambda color: sum(color))
    return colors[len(colors) // 2]


def blink_amount(index: int, profile: MotionProfile) -> float:
    centers = (0.54,) if profile.blink_count == 1 else (0.29, 0.72)
    amount = 0.0
    position = (index + 0.5) / FRAME_COUNT
    for center in centers:
        distance = abs(position - center)
        width = 0.052 if profile.blink_count == 1 else 0.043
        if distance < width:
            normalized = distance / width
            amount = max(amount, smootherstep(1.0 - normalized))
    return amount * profile.blink_depth


def eyelid_masks(box: tuple[int, int, int, int], amount: float) -> tuple[Image.Image, Image.Image, Image.Image]:
    """Build curved eyelids clipped to the authored eye oval.

    A rectangular wipe reads as a dark censor bar on the 320x240 panel.  The
    upper lid performs almost all visible travel; the lower lid joins only
    near full closure, and the crease appears at the end of the motion.
    """
    x0, y0, x1, y1 = box
    width = x1 - x0
    height = y1 - y0
    scale = 4
    scaled_width = width * scale
    scaled_height = height * scale
    center_x = scaled_width / 2.0
    center_y = scaled_height / 2.0
    radius_x = max(1.0, scaled_width / 2.0 - scale)
    radius_y = max(1.0, scaled_height / 2.0 - scale)

    oval = Image.new("L", (scaled_width, scaled_height), 0)
    ImageDraw.Draw(oval).ellipse(
        (scale, scale, scaled_width - scale - 1, scaled_height - scale - 1),
        fill=255,
    )
    upper_boundary: list[tuple[int, int]] = []
    lower_boundary: list[tuple[int, int]] = []
    crease_points: list[tuple[int, int]] = []
    for x in range(scaled_width):
        normalized_x = (x + 0.5 - center_x) / radius_x
        arc = math.sqrt(max(0.0, 1.0 - min(1.0, normalized_x * normalized_x)))
        eye_top = center_y - radius_y * arc
        eye_bottom = center_y + radius_y * arc
        crease = center_y + scaled_height * 0.055 * (1.0 - min(1.0, normalized_x * normalized_x))
        lower_amount = smootherstep(max(0.0, (amount - 0.70) / 0.30))
        upper_boundary.append((x, round(eye_top + (crease - eye_top) * amount)))
        lower_boundary.append((x, round(eye_bottom + (crease - eye_bottom) * lower_amount)))
        crease_points.append((x, round(crease)))

    upper = Image.new("L", oval.size, 0)
    lower = Image.new("L", oval.size, 0)
    ImageDraw.Draw(upper).polygon(
        [(0, 0), (scaled_width - 1, 0), *reversed(upper_boundary)],
        fill=255,
    )
    ImageDraw.Draw(lower).polygon(
        [*lower_boundary, (scaled_width - 1, scaled_height - 1), (0, scaled_height - 1)],
        fill=255,
    )
    upper = ImageChops.multiply(upper, oval)
    lower = ImageChops.multiply(lower, oval)

    crease_mask = Image.new("L", oval.size, 0)
    if amount >= 0.72:
        opacity = round(178 * smootherstep((amount - 0.72) / 0.28))
        ImageDraw.Draw(crease_mask).line(crease_points, fill=opacity, width=max(2, scale))
        crease_mask = ImageChops.multiply(crease_mask, oval)

    size = (width, height)
    return (
        upper.resize(size, Image.Resampling.LANCZOS),
        lower.resize(size, Image.Resampling.LANCZOS),
        crease_mask.resize(size, Image.Resampling.LANCZOS),
    )


def render_blink(frame: Image.Image, anchor: Image.Image, box: tuple[int, int, int, int], amount: float) -> Image.Image:
    if amount <= 0.01:
        return frame
    x0, y0, x1, y1 = box
    width = x1 - x0
    height = y1 - y0
    if width < 4 or height < 4:
        return frame
    upper_mask, lower_mask, crease_mask = eyelid_masks(box, amount)
    charcoal = sample_charcoal(anchor, box)
    lid = Image.new("RGB", (width, height), charcoal)
    lid_pixels = lid.load()
    for y in range(height):
        delta = round(5 * y / max(1, height - 1) - 2)
        for x in range(width):
            lid_pixels[x, y] = tuple(max(0, min(255, channel + delta)) for channel in charcoal)
    local = frame.crop(box)
    local = Image.composite(lid, local, upper_mask)
    local = Image.composite(lid, local, lower_mask)
    if crease_mask.getbbox() is not None:
        crease = Image.new("RGB", local.size, tuple(max(0, channel - 18) for channel in charcoal))
        local = Image.composite(crease, local, crease_mask)
    output = frame.copy()
    output.paste(local, (x0, y0))
    return output


def warm_sources(anchor: Image.Image, spec: StateSpec) -> tuple[tuple[int, int], tuple[int, int] | None]:
    """Return the authored head/tail flame bases for this approved state."""
    del anchor
    head, tail = FLAME_SOURCES[spec.key]
    return corrected_point(spec, head), corrected_point(spec, tail) if tail else None


def add_rgba_light(base: Image.Image, layer: Image.Image, gain: float) -> Image.Image:
    alpha = layer.getchannel("A")
    black = Image.new("RGB", base.size, (0, 0, 0))
    premultiplied = Image.composite(layer.convert("RGB"), black, alpha)
    premultiplied = premultiplied.point(lambda value: round(value * gain))
    return ImageChops.add(base.convert("RGB"), premultiplied, scale=1.0, offset=0)


def add_flame_and_particles(
    frame: Image.Image,
    spec: StateSpec,
    profile: MotionProfile,
    index: int,
    head: tuple[int, int],
    tail: tuple[int, int] | None,
) -> Image.Image:
    phase = math.tau * index / FRAME_COUNT
    glow = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    crisp = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    crisp_draw = ImageDraw.Draw(crisp)

    sources = [(head, profile.flame_scale)]
    if tail is not None:
        sources.append((tail, profile.flame_scale * 0.56))
    for source_index, ((sx, sy), scale) in enumerate(sources):
        tongue_count = 1 if spec.emotion == "moody" else 2 if spec.emotion in {"hopeful", "cheerful"} else 3
        for tongue_index in range(tongue_count):
            local = phase * (2 + tongue_index) + source_index * 1.7 + tongue_index * 2.1
            lean = round(scale * (2.2 * math.sin(local) + 0.8 * math.sin(local * 0.5 + 0.8)))
            lift = max(2, round(scale * (4.6 + 2.4 * (0.5 + 0.5 * math.sin(local + 0.6)))))
            spread = max(1, round(scale * (1.6 + 0.4 * tongue_index)))
            bx = sx + round((tongue_index - (tongue_count - 1) / 2) * max(1.0, scale * 1.8))
            by = sy
            outer = [(bx - spread, by), (bx + spread, by), (bx + lean + 1, by - lift // 2), (bx + lean, by - lift)]
            core = [(bx - 1, by), (bx + 1, by), (bx + round(lean * 0.55), by - max(2, round(lift * 0.58)))]
            pulse = 0.5 + 0.5 * math.sin(local + 0.4)
            alpha = round(112 + 92 * pulse)
            glow_draw.polygon(outer, fill=(255, 86, 13, max(24, alpha // 3)))
            crisp_draw.polygon(outer, fill=(255, 119 + round(32 * pulse), 21, alpha))
            crisp_draw.polygon(core, fill=(255, 230, 121, min(240, alpha + 24)))

    # Loop-safe particles rise and fade without teleporting at the seam.
    for particle_index in range(profile.particle_count):
        period = 24 + (particle_index % 3) * 8
        offset = (particle_index * 11 + spec.row * 5 + spec.column * 3) % period
        age = ((index + offset) % period) / period
        opacity = math.sin(math.pi * age) ** 2
        if opacity < 0.025:
            continue
        direction = -1 if particle_index % 2 == 0 else 1
        spread = (particle_index // 2 + 1) * (3.0 + profile.flame_scale)
        x = round(head[0] + direction * spread + math.sin(phase * 2 + particle_index) * (2 + profile.flame_scale * 2))
        y = round(head[1] - 4 - profile.particle_rise * age - (particle_index % 3) * 2)
        if HUD_SAFE[0] <= x < HUD_SAFE[2] and HUD_SAFE[1] <= y < HUD_SAFE[3]:
            continue
        if SUMMIT_PROTECT[0] <= x < SUMMIT_PROTECT[2] and SUMMIT_PROTECT[1] <= y < SUMMIT_PROTECT[3]:
            continue
        alpha = round(220 * opacity)
        radius = 1 if spec.emotion != "explosion" or particle_index % 3 else 2
        crisp_draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=(255, 178, 58, alpha))
        if radius > 1:
            crisp_draw.point((x, y), fill=(255, 244, 162, min(255, alpha + 24)))
        glow_draw.ellipse((x - 3, y - 3, x + 3, y + 3), fill=(255, 88, 18, alpha // 4))

    glow = glow.filter(ImageFilter.GaussianBlur(1.15))
    frame = add_rgba_light(frame, glow, gain=0.38)
    return add_rgba_light(frame, crisp, gain=0.50)


def add_eye_glints(frame: Image.Image, boxes: tuple[tuple[int, int, int, int], tuple[int, int, int, int]], profile: MotionProfile, index: int) -> Image.Image:
    if profile.glint_amount <= 0.05:
        return frame
    phase = math.tau * index / FRAME_COUNT
    overlay = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    for eye_index, (x0, y0, x1, y1) in enumerate(boxes):
        width = x1 - x0
        height = y1 - y0
        x = round(x0 + width * (0.35 + 0.05 * math.sin(phase * 2 + eye_index)))
        y = round(y0 + height * (0.28 + 0.04 * math.sin(phase * 2 + eye_index + 0.9)))
        alpha = round((55 + 110 * (0.5 + 0.5 * math.sin(phase * 2 + eye_index))) * profile.glint_amount)
        draw.point((x, y), fill=(255, 248, 200, alpha))
        if profile.glint_amount >= 0.70:
            draw.point((x + 1, y), fill=(255, 225, 135, alpha // 2))
    return add_rgba_light(frame, overlay, gain=0.58)


def add_shadow_energy(frame: Image.Image, spec: StateSpec, profile: MotionProfile, index: int) -> Image.Image:
    if profile.shadow_pulse <= 0:
        return frame
    phase = math.tau * index / FRAME_COUNT
    left, top, right, bottom = corrected_box(spec, spec.body_box)
    center_x = (left + right) // 2
    width = round((right - left) * (0.46 + profile.shadow_pulse * 0.06 * math.sin(phase * (2 if spec.emotion != "excited" else 4))))
    y = min(HEIGHT - 5, bottom - 4)
    overlay = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    alpha = round(18 + 34 * profile.shadow_pulse * (0.5 + 0.5 * math.sin(phase * 2)))
    draw.ellipse((center_x - width, y - 3, center_x + width, y + 3), fill=(255, 104, 23, alpha))
    return add_rgba_light(frame, overlay.filter(ImageFilter.GaussianBlur(1.6)), gain=0.38)


def add_cloud_motion(frame: Image.Image, index: int) -> Image.Image:
    """Subtle far-left warm clouds; never touches the central summit."""
    phase = math.tau * index / FRAME_COUNT
    overlay = Image.new("RGBA", frame.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    drift = round(4 * math.sin(phase))
    lift = round(math.sin(phase * 2 + 0.4))
    x = 20 + drift
    y = 51 + lift
    draw.ellipse((x, y + 2, x + 28, y + 9), fill=(255, 232, 198, 42))
    draw.ellipse((x + 7, y, x + 18, y + 8), fill=(255, 239, 209, 47))
    return add_rgba_light(frame, overlay.filter(ImageFilter.GaussianBlur(0.55)), gain=0.28)


def restore_protected(frame: Image.Image, anchor: Image.Image) -> Image.Image:
    output = frame.copy()
    output.paste(anchor.crop(HUD_SAFE), HUD_SAFE[:2])
    output.paste(anchor.crop(SUMMIT_PROTECT), SUMMIT_PROTECT[:2])
    return output


def build_frames(anchor: Image.Image, spec: StateSpec) -> tuple[list[Image.Image], dict[str, object]]:
    profile = PROFILES[spec.emotion]
    local_warm = warm_mask(anchor, spec)
    local_halo = local_warm.filter(ImageFilter.GaussianBlur(1.8))
    eyes = eye_boxes(anchor, spec)
    head, tail = warm_sources(anchor, spec)
    frames: list[Image.Image] = []
    for index in range(FRAME_COUNT):
        phase = math.tau * index / FRAME_COUNT
        rate = 2 if spec.emotion in {"moody", "hopeful"} else 3 if spec.emotion == "cheerful" else 4
        pulse = 0.5 + 0.5 * math.sin(phase * rate + 0.35)
        brightened = ImageEnhance.Brightness(anchor).enhance(1.0 + profile.glow_gain * pulse)
        frame = Image.composite(brightened, anchor, local_warm)
        halo_alpha = local_halo.point(lambda value: round(value * profile.glow_gain * (0.14 + 0.18 * pulse)))
        frame = ImageChops.add(frame, Image.merge("RGB", (halo_alpha, halo_alpha.point(lambda v: round(v * 0.47)), halo_alpha.point(lambda v: round(v * 0.12)))))
        frame = add_shadow_energy(frame, spec, profile, index)
        frame = add_flame_and_particles(frame, spec, profile, index, head, tail)
        frame = add_eye_glints(frame, eyes, profile, index)
        frame = add_cloud_motion(frame, index)
        blink = blink_amount(index, profile)
        if blink > 0:
            for eye in eyes:
                frame = render_blink(frame, anchor, eye, blink)
        frames.append(restore_protected(frame, anchor))
    return frames, {
        "eyes": [list(box) for box in eyes],
        "headFlame": list(head),
        "tailFlame": list(tail) if tail else None,
        "motionProfile": profile.motion_label,
        "geometry": normalization_geometry(spec),
    }


def stable_palette(frames: list[Image.Image], colors: int = 127) -> list[Image.Image]:
    # The ILI9341 ultimately displays RGB565. A stable 127-color authored
    # palette keeps the vivid orange/charcoal separation while materially
    # shrinking eruption deltas enough for atomic dual-GIF storage.
    sample_indices = [round(index * (FRAME_COUNT - 1) / 15) for index in range(16)]
    source = Image.new("RGB", (WIDTH * 4, HEIGHT * 4))
    for slot, frame_index in enumerate(sample_indices):
        source.paste(frames[frame_index], ((slot % 4) * WIDTH, (slot // 4) * HEIGHT))
    palette_source = source.quantize(colors=colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    authored_palette = (palette_source.getpalette() or [])[: colors * 3]
    authored_palette.extend([0] * max(0, colors * 3 - len(authored_palette)))
    shifted = authored_palette[:3] + authored_palette
    shifted = (shifted + [0] * 768)[:768]
    template = Image.new("P", (1, 1), 1)
    template.putpalette(shifted)
    normalize_zero = [1] + list(range(1, 256))
    indexed: list[Image.Image] = []
    for frame in frames:
        quantized = frame.quantize(palette=template, dither=Image.Dither.NONE).point(normalize_zero)
        quantized.putpalette(shifted)
        indexed.append(quantized)
    return indexed


def save_gif(frames: list[Image.Image], destination: Path, colors: int = 127) -> list[Image.Image]:
    composites = stable_palette(frames, colors=colors)
    palette = composites[0].getpalette()
    deltas: list[Image.Image] = [composites[0].copy()]
    previous = composites[0].tobytes()
    for composite in composites[1:]:
        current = composite.tobytes()
        pixels = bytes(value if value != previous[index] else 0 for index, value in enumerate(current))
        delta = Image.frombytes("P", (WIDTH, HEIGHT), pixels)
        delta.putpalette(palette)
        delta.info["transparency"] = 0
        deltas.append(delta)
        previous = current
    deltas[0].save(
        destination,
        save_all=True,
        append_images=deltas[1:],
        duration=FRAME_DURATIONS_MS,
        loop=0,
        disposal=1,
        transparency=0,
        background=0,
        optimize=False,
        interlace=False,
    )
    return composites


def changed_pixels(first: Image.Image, second: Image.Image, box: tuple[int, int, int, int] | None = None) -> int:
    if box:
        first = first.crop(box)
        second = second.crop(box)
    diff = ImageChops.difference(first.convert("RGB"), second.convert("RGB"))
    return sum(pixel != (0, 0, 0) for pixel in diff.getdata())


def decode_gif(path: Path) -> tuple[list[Image.Image], list[int], list[tuple[int, int, int, int]], dict[str, object]]:
    animation = Image.open(path)
    frames: list[Image.Image] = []
    durations: list[int] = []
    rectangles: list[tuple[int, int, int, int]] = []
    for index in range(animation.n_frames):
        animation.seek(index)
        rectangles.append(tuple(animation.tile[0][1]) if animation.tile else (0, 0, 0, 0))
        frames.append(animation.convert("RGB").copy())
        durations.append(int(animation.info.get("duration", 0)))
    return frames, durations, rectangles, dict(animation.info)


def validate(spec: StateSpec, expected: list[Image.Image], rig: dict[str, object]) -> dict[str, object]:
    decoded, durations, rectangles, info = decode_gif(spec.gif_path)
    errors: list[str] = []
    if not decoded or decoded[0].size != (WIDTH, HEIGHT):
        errors.append("canvas mismatch")
    if len(decoded) != FRAME_COUNT:
        errors.append(f"frame count={len(decoded)}")
    if durations != FRAME_DURATIONS_MS:
        errors.append("timing mismatch")
    if info.get("loop") != 0:
        errors.append("loop is not infinite")
    if rectangles[0] != (0, 0, WIDTH, HEIGHT):
        errors.append(f"frame zero rectangle={rectangles[0]}")
    if spec.gif_path.stat().st_size > DEVICE_GIF_LIMIT_BYTES:
        errors.append(f"bytes={spec.gif_path.stat().st_size}")
    reconstruction = [changed_pixels(actual, wanted) for actual, wanted in zip(decoded, expected)]
    if len(reconstruction) != FRAME_COUNT or max(reconstruction, default=1):
        errors.append(f"delta reconstruction={max(reconstruction, default=-1)}")
    summit = [changed_pixels(decoded[0], frame, SUMMIT_PROTECT) for frame in decoded]
    hud = [changed_pixels(decoded[0], frame, HUD_SAFE) for frame in decoded]
    if max(summit, default=0):
        errors.append(f"summit drift={max(summit)}")
    if max(hud, default=0):
        errors.append(f"HUD drift={max(hud)}")
    transitions = [changed_pixels(a, b) for a, b in zip(decoded, decoded[1:] + decoded[:1])]
    moving = sum(value > 0 for value in transitions)
    if moving < 80:
        errors.append(f"moving transitions={moving}")
    regular_max = max(transitions[:-1], default=0)
    if regular_max == 0 or transitions[-1] > regular_max * 1.25:
        errors.append(f"loop seam={transitions[-1]} regular={regular_max}")
    if errors:
        raise ValueError(f"{spec.key}: " + "; ".join(errors))
    payload = spec.gif_path.read_bytes()
    return {
        "passed": True,
        "key": spec.key,
        "size": spec.size,
        "emotion": spec.emotion,
        "canvas": [WIDTH, HEIGHT],
        "frames": FRAME_COUNT,
        "durationMs": sum(durations),
        "effectiveFps": FPS,
        "frameTimingPatternMs": [40, 40, 40, 40, 40, 50],
        "loop": "infinite",
        "bytes": len(payload),
        "crc32": zlib.crc32(payload) & 0xFFFFFFFF,
        "sha256": hashlib.sha256(payload).hexdigest(),
        "movingTransitions": moving,
        "medianChangedPixelsPerTransition": statistics.median(transitions),
        "maximumChangedPixelsPerTransition": max(transitions),
        "loopSeamChangedPixels": transitions[-1],
        "maximumHudDeltaPixels": max(hud),
        "maximumSummitDeltaPixels": max(summit),
        "transparentChangedPixelDeltas": True,
        "frameZeroFullCanvas": True,
        "darkWispPixelsAdded": False,
        "silhouetteMoved": False,
        **rig,
    }


def build_contact_sheet(anchors: dict[str, Image.Image], destination: Path) -> None:
    thumb_size = (256, 192)
    label_height = 24
    sheet = Image.new("RGB", (thumb_size[0] * 5, (thumb_size[1] + label_height) * 3), (20, 16, 18))
    draw = ImageDraw.Draw(sheet)
    for spec in STATES:
        x = spec.column * thumb_size[0]
        y = spec.row * (thumb_size[1] + label_height)
        sheet.paste(anchors[spec.key].resize(thumb_size, Image.Resampling.LANCZOS), (x, y))
        draw.rectangle((x, y + thumb_size[1], x + thumb_size[0], y + thumb_size[1] + label_height), fill=(31, 23, 22))
        draw.text((x + 7, y + thumb_size[1] + 6), spec.key, fill=(255, 205, 105))
    sheet.save(destination, optimize=True)


def build_motion_sheet(samples: dict[str, list[Image.Image]], destination: Path) -> None:
    keys = ("small_moody", "medium_hopeful", "medium_cheerful", "medium_excited", "large_explosion")
    indices = (0, 18, 36, 54, 72, 90)
    thumb = (240, 180)
    sheet = Image.new("RGB", (thumb[0] * len(indices), (thumb[1] + 22) * len(keys)), (18, 14, 16))
    draw = ImageDraw.Draw(sheet)
    for row, key in enumerate(keys):
        for column, index in enumerate(indices):
            x = column * thumb[0]
            y = row * (thumb[1] + 22)
            sheet.paste(samples[key][index].resize(thumb, Image.Resampling.LANCZOS), (x, y))
            draw.text((x + 5, y + 5), f"F{index:02d}", fill=(255, 231, 160))
        draw.text((7, row * (thumb[1] + 22) + thumb[1] + 5), key, fill=(255, 194, 88))
    sheet.save(destination, optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--preview-only", action="store_true", help="extract anchors and contact sheet without encoding GIFs")
    arguments = parser.parse_args()
    if not SOURCE_SHEET.exists():
        raise FileNotFoundError(SOURCE_SHEET)
    ANCHOR_ROOT.mkdir(parents=True, exist_ok=True)
    GIF_ROOT.mkdir(parents=True, exist_ok=True)
    sheet = Image.open(SOURCE_SHEET).convert("RGB")
    anchors: dict[str, Image.Image] = {}
    for spec in STATES:
        anchor = normalize_cell(sheet, spec)
        anchor.save(spec.anchor_path, optimize=True)
        anchors[spec.key] = anchor
    contact_sheet = OUTPUT_ROOT / "approved-15-state-anchor-contact-sheet.png"
    build_contact_sheet(anchors, contact_sheet)
    if arguments.preview_only:
        print(contact_sheet)
        return

    reports: list[dict[str, object]] = []
    sample_frames: dict[str, list[Image.Image]] = {}
    for spec in STATES:
        frames, rig = build_frames(anchors[spec.key], spec)
        # Eruption anchors contain much more high-frequency lava detail. A
        # compact state-local palette keeps even the largest form below the
        # 550 KiB atomic-swap ceiling; the panel still resolves it through
        # RGB565, so this does not reduce the device's effective color depth.
        palette_attempts = (95, 79, 63) if spec.emotion == "explosion" else (127, 111, 95)
        expected: list[Image.Image] | None = None
        palette_colors = 0
        for palette_colors in palette_attempts:
            expected = save_gif(frames, spec.gif_path, colors=palette_colors)
            if spec.gif_path.stat().st_size <= DEVICE_GIF_LIMIT_BYTES:
                break
        if expected is None:
            raise RuntimeError(f"{spec.key}: GIF encoder did not produce output")
        rig["paletteColors"] = palette_colors
        reports.append(validate(spec, expected, rig))
        if spec.key in {"small_moody", "medium_hopeful", "medium_cheerful", "medium_excited", "large_explosion"}:
            sample_frames[spec.key] = frames
        print(f"Built {spec.key}: {spec.gif_path.stat().st_size} bytes")

    if len({report["sha256"] for report in reports}) != len(STATES):
        raise ValueError("one or more state GIFs are duplicated")
    build_motion_sheet(sample_frames, OUTPUT_ROOT / "emotion-motion-samples.png")
    manifest = {
        "version": 2,
        "source": str(SOURCE_SHEET),
        "canvas": [WIDTH, HEIGHT],
        "frames": FRAME_COUNT,
        "durationMs": LOOP_DURATION_MS,
        "effectiveFps": FPS,
        "frameDurationsMs": FRAME_DURATIONS_MS,
        "states": [
            {
                "key": report["key"],
                "size": report["size"],
                "emotion": report["emotion"],
                "file": f"gifs/{report['key']}.gif",
                "anchor": f"anchors/{report['key']}.png",
                "bytes": report["bytes"],
                "crc32": report["crc32"],
                "sha256": report["sha256"],
                "geometry": report["geometry"],
            }
            for report in reports
        ],
    }
    (OUTPUT_ROOT / "animation-catalog.json").write_text(json.dumps(manifest, indent=2) + "\n")
    (OUTPUT_ROOT / "validation-report.json").write_text(
        json.dumps({"passed": True, "states": reports}, indent=2) + "\n"
    )
    print(f"Contact sheet: {contact_sheet}")
    print(f"Motion samples: {OUTPUT_ROOT / 'emotion-motion-samples.png'}")


if __name__ == "__main__":
    main()
