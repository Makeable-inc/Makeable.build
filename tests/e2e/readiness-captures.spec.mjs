// Optional visual record; not part of normal CI.
import { test, expect } from './test.mjs';
import { signIn, primaryNav } from './helpers.mjs';
import { TEST_USER_BUILDS } from './fixture-data.mjs';
import path from 'node:path';
test('capture local readiness review', async ({page}, info) => {
  test.skip(!process.env.CAPTURE_PHASE, 'Run with CAPTURE_PHASE=before or after');
  await page.emulateMedia({reducedMotion:'reduce'});
  const output = process.env.READINESS_REVIEW_DIR || path.resolve('test-results/readiness-review');
  const capture = async name => page.screenshot({path:path.join(output,process.env.CAPTURE_PHASE,`${name}-${info.project.name}.png`)});
  await page.goto('/'); await expect(primaryNav(page).getByRole('button',{name:'Sign in',exact:true})).toBeVisible(); await capture('home');
  await page.getByRole('button',{name:'Pre-order Ember',exact:true}).click(); await expect(page.getByRole('dialog',{name:'Make Ember yours.'})).toBeVisible(); await capture('checkout');
  await signIn(page); await primaryNav(page).getByRole('button',{name:'My builds'}).click(); await expect(page.locator('.mk-app-shell')).toBeVisible(); await expect(page.getByRole('heading',{name:'My builds',exact:true})).toBeVisible(); await expect(page.locator('.library-card')).toHaveCount(2); await expect(page.getByRole('navigation',{name:'Project areas'})).toBeHidden(); await page.evaluate(()=>document.fonts.ready); await page.evaluate(()=>window.scrollTo({top:0,behavior:'instant'})); await capture('library');
  await page.goto(`/app/?build=${TEST_USER_BUILDS[0].id}`); await expect(page.getByRole('heading',{name:TEST_USER_BUILDS[0].title,exact:true})).toBeVisible(); await capture('project');
  await page.goto('/ember#setup'); await expect(page.getByRole('heading',{name:'Leave Ember on your desk.'})).toBeVisible(); await page.locator('#setup').scrollIntoViewIfNeeded(); await capture('setup');
  if(process.env.CAPTURE_PHASE === 'after') { await page.goto('/ember#installation'); await expect(page.getByRole('heading',{name:'From download to desk.'})).toBeVisible(); await page.locator('#installation').evaluate(el=>el.scrollIntoView({behavior:'instant',block:'start'})); await page.locator('#installation').screenshot({path:path.join(output,process.env.CAPTURE_PHASE,`guide-${info.project.name}.png`)}); }
  await page.goto('/missing-review-page'); await expect(page.getByRole('link',{name:/back.*home|home/i}).first()).toBeVisible(); await capture('404');
  if(process.env.CAPTURE_PHASE === 'after') { await page.goto('/'); await page.getByRole('button',{name:/Study Desk Companion product render/}).click(); await page.locator('.mk-hero-actions').getByRole('button',{name:'Coming soon',exact:true}).click(); await expect(page.getByRole('dialog',{name:'Study Desk Companion',exact:true})).toBeVisible(); await capture('availability'); }
});
