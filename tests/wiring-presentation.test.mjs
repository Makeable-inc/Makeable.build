import test from 'node:test';
import assert from 'node:assert/strict';
import {friendlyPartName,wiringCopy,wiringEndpointLabel} from '../apps/circuit-lab/wiring-presentation.mjs';
test('retailer compatibility names do not relabel peripherals as controllers',()=>{
 const parts=[
  {id:'touch',role:'input',assetId:'ttp223-touch',label:'DIYables Touch Sensor Button Switch for Arduino, ESP32, ESP8266, Raspberry Pi, 2 Pieces'},
  {id:'led',role:'output',assetId:'rgb-led-module',label:'DIYables RGB LED Module for Arduino, ESP32, ESP8266'},
  {id:'carrier',role:'carrier',label:'ESP32 expansion board'},
  {id:'controller',role:'controller',label:'ESP32-S3 DevKitC-1'},
 ];
 assert.deepEqual(parts.map(friendlyPartName),['Touch sensor','Status light','Expansion board','Controller']);
 assert.equal(friendlyPartName({role:'input',label:'Rotary encoder for Arduino ESP32'}),'Control knob');
 assert.equal(wiringEndpointLabel({partId:'touch',label:'touch · SIG'},{parts}),'Touch sensor · SIG');
 assert.equal(wiringEndpointLabel({partId:'carrier',label:'carrier · GPIO4'},{parts}),'Expansion board · GPIO4');
 const step={kind:'connection',title:'Connect DIYables Touch Sensor Button Switch for Arduino, ES…',beginnerInstruction:'Match every labeled pin on DIYables Touch Sensor Button Switch for Arduino, ES…',safetyNote:'Disconnect USB power.'};
 const before=JSON.stringify({parts,step});
 const copy=wiringCopy(step,{parts});assert.equal(copy.title,'Connect the touch sensor');assert.doesNotMatch(copy.instruction,/DIYables|Arduino|ESP32|…/);
 assert.equal(copy.safety,step.safetyNote);assert.equal(JSON.stringify({parts,step}),before);
 assert.equal(wiringCopy({...step,title:'Connect DIYables RGB LED Module for Arduino, ESP…',beginnerInstruction:''},{parts}).title,'Connect the light');
});
