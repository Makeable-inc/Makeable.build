"""A case is finished only when each front detail passes its rule and the reviewer sees it done (no AI calls).
Run: .venv/Scripts/python -W ignore -m unittest test_case_details"""
import unittest

import case_details
import harness

KNOB_SCREEN = {"results": [{"check": "window_fit", "ok": True}, {"check": "knob_room", "ok": True},
                           {"check": "knob_turns", "ok": True}]}
ALL_DONE = {d: "done" for d in case_details.DETAILS}


class Details(unittest.TestCase):
    def test_details_follow_the_parts_not_the_design(self):
        self.assertEqual(set(case_details.applies(KNOB_SCREEN)), set(case_details.DETAILS))
        touch = case_details.applies({"results": [{"check": "case_closed", "ok": True}]})
        self.assertNotIn("knob_cap", touch)
        self.assertNotIn("screen_bezel", touch)

    def test_a_reviewer_yes_does_not_finish_a_detail_the_geometry_lacks(self):
        ids = case_details.applies(KNOB_SCREEN)
        states = case_details.verify(ids, "window(screen)", KNOB_SCREEN, {}, ALL_DONE)
        self.assertEqual(set(case_details.unfinished(states)), {"screen_bezel", "knob_cap"})

    def test_passing_geometry_still_needs_the_reviewer(self):
        ids = case_details.applies(KNOB_SCREEN)
        design = {"fitted_on": {"PRINT_Knob": "PURCHASE_Part3"}}
        states = case_details.verify(ids, "screen_bezel(screen, body)", KNOB_SCREEN, design, {**ALL_DONE, "clean_front": "not done"})
        self.assertEqual(case_details.unfinished(states), ["clean_front"])
        self.assertTrue(any("clean_front" in f for f in case_details.fixes(states)))

    def test_a_cap_that_rubs_is_unfinished(self):
        rubbing = {"results": KNOB_SCREEN["results"][:2] + [{"check": "knob_turns", "ok": False}]}
        states = case_details.verify(["knob_cap"], "", rubbing, {"fitted_on": {"PRINT_Knob": "x"}}, ALL_DONE)
        self.assertIn("rub", states["knob_cap"]["why"])

    def test_unfinished_details_make_a_draft(self):
        label = harness.result_label({"score": 9, "unfinished": ["knob_cap"]}, 8)
        self.assertTrue(label.startswith("draft"))
        self.assertIn("knob_cap", label)
        self.assertEqual(harness.result_label({"score": 9, "unfinished": []}, 8), "done")


if __name__ == "__main__":
    unittest.main()
