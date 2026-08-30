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

  assert.equal(els.overviewExposures.textContent, "Loading…");
  assert.equal(els.overviewEngagements.textContent, "Loading…");
  assert.equal(els.overviewEngagementRate.textContent, "Loading…");
  assert.equal(els.overviewFollowers.textContent, "Loading…");
  assert.equal(els.overviewSocialRows.children[0].children[1].textContent, "Loading…");
});

test("overview marks customer totals as loading before the dashboard report arrives", () => {
  const element = () => ({ textContent: "", children: [], append(...children) { this.children.push(...children); }, replaceChildren(...children) { this.children = children; } });
  globalThis.document = { createElement: element };
  const els = {
    overviewExposures: element(), overviewEngagements: element(), overviewEngagementRate: element(), overviewFollowers: element(),
    overviewContacts: element(), overviewBuilders: element(), overviewSocialRows: element(), overviewWaitlistRows: element(),
  };

  createOverview({ state: { report: null, socialView: null }, els }).render();

  assert.equal(els.overviewContacts.textContent, "Loading…");
  assert.equal(els.overviewBuilders.textContent, "Loading…");
  assert.equal(els.overviewWaitlistRows.children[0].children[1].textContent, "Loading…");
});
