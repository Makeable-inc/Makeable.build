import {test} from 'node:test';
import assert from 'node:assert/strict';
import {verifySite} from '../scripts/verify-site-readiness.mjs';
import {EMBER_OFFER} from '../lib/ember-offer.mjs';
test('readiness verifier detects broken routes, preview metadata, staging indexing and split download paths without writes',async()=>{
 const calls=[];
 const result=await verifySite('https://staging.example',{fetchImpl:async(url,init={})=>{
  calls.push(init.method||'GET'); const p=new URL(url).pathname;
  if(p==='/robots.txt')return new Response('User-agent: *\nAllow: /\n');
  if(p==='/ember/download')return new Response('',{status:302,headers:{location:'https://files.example/app.dmg'}});
  if(p==='/app.dmg')return new Response('',{status:404});
  if(p.includes('does-not-exist'))return new Response('<a href="/">Home</a>',{status:404});
  return new Response('<meta property="og:image" content="http://localhost:3000/test.png"><a href="/old.dmg" data-download-link>Download</a>',{status:p==='/terms/'?500:200});
 }});
 assert(result.some(r=>r.name==='/terms/ available'&&!r.pass));
 assert(result.some(r=>r.name==='/ metadata'&&!r.pass));
 assert(result.some(r=>r.name==='/ indexing'&&!r.pass));
 assert(result.some(r=>r.name==='Ember download buttons'&&!r.pass));
 assert(result.some(r=>r.name==='Download artifact'&&!r.pass));
 assert(calls.every(m=>['GET','HEAD'].includes(m)));
});
test('offer defaults retain supported checkout pricing and remove expired shipping promise',()=>{
 assert.equal(EMBER_OFFER.markets[EMBER_OFFER.market].unitAmount,'3499');
 assert.equal(EMBER_OFFER.colors[EMBER_OFFER.color],'Beige');
 assert.equal(EMBER_OFFER.shippingMessage,"Pre-orders are expected to ship by end November 2026.");
 assert.doesNotMatch(EMBER_OFFER.shippingMessage,/October|not been confirmed|Contact/);
});
