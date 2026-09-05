import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {compactStepNumbers,wiringCopy,wiringEndpointLabel} from '../apps/circuit-lab/wiring-presentation.mjs';
import {retailerPrice} from '../apps/landing/app/project-retailer-links.mjs';

test('parts use content-sized rows with flat retailer columns and no footer disclaimer',async()=>{
 const source=await readFile(new URL('../apps/landing/app/project-overview.tsx',import.meta.url),'utf8');
 const css=await readFile(new URL('../apps/landing/app/approved-workspace.css',import.meta.url),'utf8');
 assert.match(source,/data-parts-layout="rows"/);
 assert.doesNotMatch(source,/Prices are estimates\. Check pack size before buying\./);
 assert.match(css,/\.mk-overview-frame \.mk-project-part-list \{ display: flex; flex-direction: column;/);
 assert.match(css,/\.mk-overview-frame \.mk-project-part-card \{[^}]*flex: 0 0 auto;[^}]*height: auto;/);
 assert.match(css,/\.mk-app-shell \.mk-overview-frame \.mk-project-retailer \{[^}]*border-radius: 0;/);
});

test('compact stepper always includes current and endpoints without a scrolling label strip',()=>{
 assert.deepEqual(compactStepNumbers(9,0),[0,1,2,'gap',8]);
 assert.deepEqual(compactStepNumbers(9,4),[0,'gap',3,4,5,'gap',8]);
 for(let n=1;n<40;n++)for(let i=0;i<n;i++){const list=compactStepNumbers(n,i),numbers=list.filter(x=>typeof x==='number');assert.ok(numbers.includes(i));assert.ok(numbers.includes(0));assert.ok(numbers.includes(n-1));assert.ok(numbers.length<=5);assert.equal(new Set(numbers).size,numbers.length);}
});
test('friendly copy is display-only and keeps exact pins and original source',()=>{
 const part={id:'controller-a',role:'controller',label:'AITRIP ESP32-S3 DevKitC-1 N8R2'};
 const step={kind:'mount',title:`Seat ${part.label}`,beginnerInstruction:'Match the polarity and USB orientation.',safetyNote:'Never force a reversed board.',activeWires:[]};
 const before=JSON.stringify(step);const copy=wiringCopy(step,{parts:[part]});assert.equal(copy.title,'Add the controller');assert.match(copy.instruction,/USB port/);assert.equal(copy.safety,step.safetyNote);assert.equal(JSON.stringify(step),before);
 assert.equal(wiringEndpointLabel({partId:part.id,label:`${part.id} · GPIO11`},{parts:[part]}),'Controller · GPIO11');
});
test('merchant prices are separate and never fabricate AliExpress prices',()=>{
 const part={name:'Controller',asin:'B0H336QRXX',price:14.99};
 assert.deepEqual(retailerPrice(part,'amazon'),{value:'$14.99',status:'Estimate'});
 assert.deepEqual(retailerPrice(part,'aliexpress'),{value:'Check price',status:''});
 const quote={destinationUrl:'https://www.aliexpress.com/item/123.html',price:{amount:599,currency:'USD'}};
 assert.deepEqual(retailerPrice(part,'aliexpress',quote),{value:'$5.99',status:'Quoted price'});
 assert.deepEqual(retailerPrice(part,'amazon',quote),{value:'$14.99',status:'Estimate'});
 assert.deepEqual(retailerPrice({},'amazon'),{value:'Check price',status:''});
});
test('interaction modes map primary mouse drag to real rotate, pan and dolly controls',async()=>{
 const source=await readFile(new URL('../apps/circuit-lab/app.js',import.meta.url),'utf8');
 const fn=source.slice(source.indexOf('function setInteractionMode('),source.indexOf('\ndocument.querySelectorAll("[data-interaction]")'));
 const controls={mouseButtons:{},touches:{}};const hint={};const context={controls,renderer:{domElement:{style:{}}},THREE:{MOUSE:{ROTATE:0,PAN:2,DOLLY:1},TOUCH:{ROTATE:0,PAN:1,DOLLY_PAN:2}},document:{querySelectorAll:()=>[],querySelector:()=>hint}};
 const mode=vm.runInNewContext(`(${fn})`,context);
 for(const [name,value]of[['rotate',0],['pan',2],['zoom',1]]){mode(name);assert.equal(controls.mouseButtons.LEFT,value);assert.equal(controls.mouseButtons.RIGHT,2);assert.equal(controls.touches.TWO,2);}
});
