import { test, expect } from './test.mjs';
import { signIn, primaryNav } from './helpers.mjs';
import { TEST_USER_BUILDS, COMMUNITY_BUILDS } from './fixture-data.mjs';
test('My builds is a searchable collection and project navigation survives refresh, back and forward', async ({page})=>{
  await signIn(page); await primaryNav(page).getByRole('button',{name:'My builds'}).click();
  await expect(page).toHaveURL(/\/app\//);
  await expect(page.getByRole('heading',{name:'My builds',exact:true})).toBeVisible();
  await expect(page.getByRole('navigation',{name:'Project areas'})).toBeHidden();
  const search=page.getByRole('searchbox',{name:'Search your builds'});
  await search.fill('clock'); await expect(page.getByRole('button',{name:`Open ${TEST_USER_BUILDS[0].title}`,exact:true})).toHaveCount(0);
  await expect(page.getByRole('button',{name:`Open ${TEST_USER_BUILDS[1].title}`,exact:true})).toBeVisible();
  await search.fill('');
  await page.getByRole('button',{name:`Open ${TEST_USER_BUILDS[0].title}`,exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`build=${TEST_USER_BUILDS[0].id}`));
  await page.reload(); await expect(page.getByRole('heading',{name:TEST_USER_BUILDS[0].title,exact:true})).toBeVisible();
  await page.goBack(); await expect(page.getByRole('heading',{name:'My builds',exact:true})).toBeVisible();
  await page.goForward(); await expect(page.getByRole('heading',{name:TEST_USER_BUILDS[0].title,exact:true})).toBeVisible();
});
test('a bookmarked project outside the first gallery page loads without an unbounded gallery request',async({page})=>{
  const unbounded=[]; page.on('request',r=>{const u=new URL(r.url());if(u.pathname==='/api/builds'&&!u.searchParams.has('limit'))unbounded.push(u.href);});
  const build=COMMUNITY_BUILDS.at(-1);
  await page.goto(`/app/?build=${build.id}`);
  await expect(page.getByRole('heading',{name:build.title,exact:true})).toBeVisible();
  expect(unbounded).toEqual([]);
});
test('My builds has no hide control',async({page})=>{
  await signIn(page,{next:'/app/'});
  await expect(page.getByRole('heading',{name:'My builds',exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:/hide from community|confirm hide/i})).toHaveCount(0);
});
test('software guidance and all download buttons share one destination',async({page})=>{
  await page.goto('/ember/');
  const links=page.locator('[data-download-link]'); expect(await links.count()).toBeGreaterThanOrEqual(3);
  for(const link of await links.all())await expect(link).toHaveAttribute('href','/ember/download');
  await page.getByRole('link',{name:'Read the setup guide →',exact:true}).click();
  await expect(page.getByRole('heading',{name:'From download to desk.'})).toBeVisible();
  await page.getByText('Ember isn’t connecting',{exact:true}).click();
  await expect(page.getByText(/Check USB-C power, move Ember/)).toBeVisible();
});

test('unavailable products explain their state and stay open until dismissed',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'}); await page.goto('/');
  await page.getByRole('button',{name:/Study Desk Companion product render/}).click();
  await page.locator('.mk-hero-actions').getByRole('button',{name:'Coming soon',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Study Desk Companion',exact:true});
  await expect(dialog).toBeVisible(); await expect(dialog).toContainText('isn’t available to order yet');
  await page.getByRole('button',{name:'Continue browsing',exact:true}).click(); await expect(dialog).toHaveCount(0);
});

test('the community collection renders twelve builds at a time and fetches the next bounded page',async({page})=>{
  await page.goto('/app/'); await expect(page.locator('.library-card')).toHaveCount(12);
  await page.getByRole('button',{name:'Show more builds',exact:true}).click(); await expect(page.locator('.library-card')).toHaveCount(24);
  await page.getByRole('button',{name:'Load more community builds',exact:true}).click(); await expect(page.locator('.library-card')).toHaveCount(30);
  await page.getByRole('searchbox').fill(COMMUNITY_BUILDS.at(-1).title);
  await expect(page.locator('.library-card')).toHaveCount(1);
});
