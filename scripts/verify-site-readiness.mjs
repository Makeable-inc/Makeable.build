// Read-only checks: GET HTML/robots, HEAD download redirects. No sign-in or checkout.
import { pathToFileURL } from 'node:url';
export async function verifySite(base, {production = false, fetchImpl = fetch} = {}) {
  const origin = new URL(base).origin;
  const results = [];
  const check = (name, pass, detail) => results.push({name, pass, detail});
  for (const route of ['/', '/app/', '/ember/', '/terms/', '/privacy/']) {
    try {
      const response = await fetchImpl(new URL(route, origin), {signal: AbortSignal.timeout(15000)});
      const html = await response.text();
      check(`${route} available`, response.ok, `HTTP ${response.status}`);
      const metadata = html.match(/<(?:meta|link)\b[^>]*>/gi)?.join('\n') || '';
      check(`${route} metadata`, !/https?:\/\/(?:localhost|127\.0\.0\.1)/i.test(metadata), 'No local preview addresses');
      const canonical = html.match(/<link[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)/i)?.[1];
      check(`${route} canonical`, Boolean(canonical?.startsWith('https://')) && !/localhost|127\.0\.0\.1/.test(canonical || ''), canonical || 'Missing canonical');
      const noindex = /<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html);
      check(`${route} indexing`, production && route !== '/app/' ? !noindex : noindex, route === '/app/' ? 'Workspace: noindex' : production ? 'Production: indexable' : 'Staging: noindex');
      if (route === '/ember/') {
        const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*data-download-link/g)].map(m=>m[1]);
        check('Ember download buttons', links.length >= 3 && links.every(l=>l === '/ember/download'), `${links.length} buttons use /ember/download`);
      }
    } catch (error) {check(route, false, error.message);}
  }
  try {
    const robots = await fetchImpl(new URL('/robots.txt',origin)).then(r=>r.text());
    check('robots policy', production ? /Allow: \/\s/.test(robots) : /Disallow: \/\s/.test(robots), production ? 'Production crawling allowed' : 'Staging crawling blocked');
    const missing = await fetchImpl(new URL('/readiness-page-that-does-not-exist',origin));
    check('404 recovery', missing.status === 404 && /back to making|href="\/"/.test(await missing.text()), `HTTP ${missing.status}`);
    const download = await fetchImpl(new URL('/ember/download',origin), {method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(15000)});
    const destination = download.headers.get('location');
    check('Download redirect', [301,302,303,307,308].includes(download.status) && /^https:\/\//.test(destination || ''), destination || `HTTP ${download.status}`);
    if (destination?.startsWith('https://')) {
      const artifact = await fetchImpl(destination, {method:'HEAD',signal:AbortSignal.timeout(15000)});
      check('Download artifact', artifact.ok && /\.dmg(?:\?|$)/i.test(destination) && !/text\/html/i.test(artifact.headers.get('content-type') || ''), `HEAD HTTP ${artifact.status} (installer not downloaded)`);
    }
  } catch (error) {check('Delivery checks',false,error.message);}
  return results;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const urls = args.filter(a=>!a.startsWith('--'));
  if (!urls.length) throw new Error('Usage: npm run verify:site -- https://staging.example [https://old.example] [--production]');
  let failed = false;
  for (const url of urls) {
    console.log(`\n${url}`);
    for (const result of await verifySite(url, {production:args.includes('--production')})) {
      console.log(`${result.pass?'PASS':'FAIL'} ${result.name}: ${result.detail}`); failed ||= !result.pass;
    }
  }
  process.exitCode = failed ? 1 : 0;
}
