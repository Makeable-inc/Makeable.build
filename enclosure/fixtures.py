"""A hand-made C6 Carrier, for testing the checks only. It is not part of the product: on a real run the AI writes the design."""
import json
from pathlib import Path

from build123d import Box, Pos, export_stl

C6 = "esp32-c6-1-47inch-ips-touch-display-development-board-with-pre-soldered-header"
IDENTITY = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]]


def block(x0, x1, y0, y1, z0, z1):
    return Pos((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2) * Box(x1 - x0, y1 - y0, z1 - z0)


def make_carrier(side_gap=0.1, ledge_gap=0.1, wall=2.0, ledge_thickness=2.0, ledge_inner=10.4, usb_slot=12.6, button_notch=True, lip=False, extra_piece=False):
    """A wall around the board, with ledges under the PCB's long edges and a slot for the USB plug."""
    x_in, y_in = 12.275 + side_gap, 22.25 + side_gap
    x_out, y_out = x_in + wall, y_in + wall
    ledge_top = -3.35 - ledge_gap
    z_bottom = ledge_top - ledge_thickness
    z_top = 0.0

    shape = block(-x_out, x_out, -y_out, y_out, z_bottom, z_top) - block(-x_in, x_in, -y_in, y_in, z_bottom - 1, z_top + 1)
    shape -= block(-usb_slot / 2, usb_slot / 2, -y_out - 1, -y_in + 1, z_bottom - 1, z_top + 1)
    for sign in (1, -1):
        x0, x1 = sorted((sign * ledge_inner, sign * x_in))
        ledge = block(x0, x1, -y_in, y_in, z_bottom, ledge_top)
        if button_notch:
            ledge -= block(x0 - 1, x1 + 1, -16.9, -12.1, z_bottom - 1, ledge_top + 1)
        shape += ledge
    if lip:
        shape += block(-x_out, x_out, y_in, y_out, 0.0, 5.5) + block(-x_out, x_out, y_in - 1.0, y_in, 3.5, 5.5)
    if extra_piece:
        shape += block(30, 35, 30, 35, 0, 5)
    return shape


def write_design(folder, shape=None, part_id=C6, transform=None, insert_from="+z", **carrier):
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    export_stl(shape if shape is not None else make_carrier(**carrier), str(folder / "PRINT_Carrier.stl"), tolerance=0.01)
    design = {
        "print": {"PRINT_Carrier": "PRINT_Carrier.stl"},
        "purchased": {"PURCHASE_Board": {"part_id": part_id, "transform": transform or IDENTITY}},
        "holds": {"PRINT_Carrier": {"part": "PURCHASE_Board", "insert_from": insert_from}},
    }
    (folder / "design.json").write_text(json.dumps(design, indent=1), encoding="utf-8")
    return folder
