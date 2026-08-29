import assert from "node:assert/strict";
import test from "node:test";

import { createOverview } from "../dashboard/overview.js";

test("overview marks social totals as loading before the social report arrives", () => {
  const element = () => ({ textContent: "", children: [], append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } });
  globalThis.document = { createElement: element };
  const els = {
    overviewExposures: element(), overviewEngagements: element(), overviewEngagementRate: element(), overviewFollowers: element(),
    overviewContacts: element(), overviewBuilders: element(), overviewSocialRows: element(), overviewWaitlistRows: element(),
  };
  const state = { report: { total: 147, builderAccountsTotal: 43 }, socialView: null };

  createOverview({ state, els }).render();

  assert.equal(els.overviewExposures.textContent, "—");
  assert.equal(els.overviewEngagements.textContent, "—");
  assert.equal(els.overviewSocialRows.children[0].children[1].textContent, "Loading…");
});
