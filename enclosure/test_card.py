"""Part card tests. Run: .venv/Scripts/python -m unittest test_card"""
import copy
import json
import unittest

from card import CARDS, CardError, load_nodes, measure, build_card
from parts import ensure_part

C6 = "esp32-c6-1-47inch-ips-touch-display-development-board-with-pre-soldered-header"


class C6Card(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.card = build_card(C6)
        cls.spec = json.loads((CARDS / f"{C6}.json").read_text(encoding="utf-8"))
        cls.nodes = load_nodes(ensure_part(C6))

    def size(self, feature):
        return self.card["features"][feature]["size"]

    def test_sizes_match_the_model(self):
        for actual, expected in zip(self.card["envelope"]["size"], (24.55, 44.77, 15.61)):
            self.assertAlmostEqual(actual, expected, delta=0.02)
        self.assertAlmostEqual(self.size("glass")[0], 22.05, delta=0.02)
        self.assertAlmostEqual(self.size("glass")[1], 42.0, delta=0.02)
        self.assertAlmostEqual(self.size("pcb")[0], 24.07, delta=0.02)
        self.assertAlmostEqual(self.size("pcb")[1], 44.02, delta=0.02)

    def test_usb_is_at_the_bottom_edge(self):
        usb = self.card["features"]["usb"]
        self.assertAlmostEqual(usb["mouth"], -22.52, delta=0.02)
        self.assertAlmostEqual(usb["min"][2], -6.6, delta=0.02)
        self.assertAlmostEqual(usb["max"][2], -2.44, delta=0.02)

    def test_missing_node_is_refused(self):
        bad = copy.deepcopy(self.spec)
        bad["features"]["usb"]["nodes"] = ["9999"]
        with self.assertRaisesRegex(CardError, "no node"):
            measure(bad, self.nodes)

    def test_usb_on_the_wrong_side_is_refused(self):
        bad = copy.deepcopy(self.spec)
        bad["features"]["usb"]["opens_toward"] = "+y"
        with self.assertRaisesRegex(CardError, "usb: mouth"):
            measure(bad, self.nodes)

    def test_glass_not_at_the_front_is_refused(self):
        bad = copy.deepcopy(self.spec)
        bad["features"]["glass"]["nodes"] = ["0003"]
        with self.assertRaisesRegex(CardError, "glass: front face"):
            measure(bad, self.nodes)

    def test_screen_larger_than_glass_is_refused(self):
        bad = copy.deepcopy(self.spec)
        bad["features"]["glass"]["nodes"] = ["finish:display:neutral-unpowered-touch-glass"]
        bad["features"]["screen"]["nodes"] = ["0001"]
        with self.assertRaisesRegex(CardError, "screen: active area"):
            measure(bad, self.nodes)

    def test_changed_model_is_refused(self):
        path = CARDS / f"{C6}.json"
        original = path.read_text(encoding="utf-8")
        changed = json.loads(original)
        changed["sha256"] = "0" * 64
        path.write_text(json.dumps(changed), encoding="utf-8")
        try:
            with self.assertRaisesRegex(CardError, "review it again"):
                build_card(C6)
        finally:
            path.write_text(original, encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
