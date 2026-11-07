"""The concept drawn from the real parts: the block is the parts' room (plus a little, inside the face limits), with
the screen and the knob or touch button at their real size. No image call is made here.
Run: .venv/Scripts/python -W ignore -m unittest test_concepts"""
import unittest
from unittest import mock

import concepts
from part_data import required_space

LIMITS = {"max_width": 140, "max_height": 37, "tight_width": 111, "tight_height": 30}


class Block(unittest.TestCase):
    def block(self, parts):
        base = {"parts": parts, "max_depth": 80, "look": "a test", "width_to_height": [2.2, 3.4]}
        with mock.patch("review_facts.screen_limits", lambda _b: LIMITS):
            return base, concepts.layout_block(base)

    def test_the_block_holds_the_room_and_stays_inside_the_face_limits(self):
        parts = "esp32-s3-wroom-n16r8-camera-board,st7789-225-tft-display-module,ky-040-rotary-encoder"
        _, (block, shown) = self.block(parts)
        w, d, h = block.extents
        room = required_space(parts.split(","))
        self.assertGreaterEqual(w, room["width"])
        self.assertGreaterEqual(h, room["height"] - 0.01)
        self.assertLessEqual(h, LIMITS["max_height"] + 0.01)
        self.assertLessEqual(w, LIMITS["tight_width"] + 0.01, "a 36 mm tall room keeps the face under the tight width")

    def test_the_screen_and_knob_are_their_real_size(self):
        _, (block, shown) = self.block("esp32-s3-wroom-n16r8-camera-board,st7789-225-tft-display-module,ky-040-rotary-encoder")
        screen, knob = shown[0][0], shown[1][0]
        self.assertAlmostEqual(screen.extents[0], 55.3, delta=0.2)
        self.assertAlmostEqual(knob.extents[0], 14.0, delta=0.3)
        self.assertLess(screen.bounds[1][0], knob.bounds[0][0], "the screen is left of the knob")

    def test_a_touch_design_shows_a_flat_disc_not_a_knob(self):
        _, (block, shown) = self.block("esp32-s3-wroom-n16r8-camera-board,ssd1309-242-oled,ttp223-touch")
        self.assertLess(shown[1][0].extents[1], 1.0)

    def test_the_prompt_keeps_the_real_parts_and_names_the_look(self):
        base = {"parts": "esp32-s3-wroom-n16r8-camera-board,ssd1309-242-oled,ttp223-touch", "max_depth": 80,
                "look": "a loaf-shaped kitten", "width_to_height": [1.5, 2.6]}
        sent = {}
        with mock.patch("review_facts.screen_limits", lambda _b: LIMITS), \
                mock.patch.object(concepts, "edit", lambda image, prompt: sent.setdefault("p", prompt) and b"png"), \
                mock.patch.object(concepts, "FOLDER", concepts.Path(__import__("tempfile").mkdtemp())):
            concepts.layout_picture(base)
        self.assertIn("a loaf-shaped kitten", sent["p"])
        self.assertIn("the round touch button exactly where", sent["p"])
        self.assertIn("no stripes", sent["p"])


if __name__ == "__main__":
    unittest.main()
