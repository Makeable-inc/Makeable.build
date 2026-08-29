#!/usr/bin/env node

import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const port = Number(process.argv[2] || 8899);
const threeRoot = path.resolve("apps/landing/node_modules/three");

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Makeable ESP32 Direct Connection Review</title>
<style>
:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#07090c;color:#f6f7f8}
canvas{display:block;width:100%;height:100%}.shell{position:fixed;inset:0;pointer-events:none}
.top{display:flex;justify-content:space-between;align-items:flex-start;padding:24px 26px;background:linear-gradient(180deg,rgba(5,7,10,.96),rgba(5,7,10,0));}
.eyebrow{font:600 11px/1.2 ui-monospace,monospace;letter-spacing:.13em;text-transform:uppercase;color:#8ef2c4}.title{font-size:24px;font-weight:650;letter-spacing:-.025em;margin-top:7px}.subtitle{font-size:12px;color:#a9b0ba;margin-top:6px}
.status{display:flex;gap:8px}.pill{border:1px solid #2b323b;background:rgba(15,19,24,.86);border-radius:999px;padding:7px 10px;font:600 10px ui-monospace,monospace;color:#c9d0d9}.pill.good{border-color:#1f604b;color:#8ef2c4}
.controls{position:absolute;left:26px;bottom:26px;width:min(610px,calc(100vw - 52px));pointer-events:auto;background:rgba(11,14,18,.91);border:1px solid #262c34;border-radius:17px;padding:14px;box-shadow:0 20px 50px rgba(0,0,0,.38);backdrop-filter:blur(15px)}
.row{display:flex;gap:7px;flex-wrap:wrap}.row+.row{margin-top:9px}button{appearance:none;border:1px solid #303741;background:#151a20;color:#bfc6cf;border-radius:9px;padding:8px 11px;font:600 11px ui-monospace,monospace;cursor:pointer}button:hover{border-color:#65707d;color:white}button.active{background:#dbffef;color:#07130e;border-color:#dbffef}
.wiring{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:10px;margin-top:12px;padding-top:12px;border-top:1px solid #292f37}.wire{height:4px;border-radius:4px}.wire.red{background:#ef5a5a}.wire.black{background:#606a78}.wire.green{background:#54e58e}.net{font:600 10px ui-monospace,monospace;color:#c9d0d9}.to{font:500 10px ui-monospace,monospace;color:#7f8995;text-align:right}
.boardnote{position:absolute;right:26px;bottom:26px;width:300px;padding:15px;background:rgba(11,14,18,.91);border:1px solid #262c34;border-radius:17px}.boardname{font-size:14px;font-weight:650}.boardstate{font:600 10px ui-monospace,monospace;color:#8ef2c4;margin-top:6px}.warning{font-size:11px;line-height:1.45;color:#9fa8b4;margin-top:8px}
.loading{position:absolute;inset:0;display:grid;place-items:center;background:#07090c;font:600 12px ui-monospace,monospace;color:#8ef2c4;transition:opacity .25s}.loading.done{opacity:0;pointer-events:none}
</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js"}}</script></head>
<body><div id="loading" class="loading">LOADING AWS PRODUCTION ASSETS…</div><div id="stage"></div>
<div class="shell"><div class="top"><div><div class="eyebrow">Makeable • production asset simulation</div><div class="title">ESP32 direct-connection visual review</div><div class="subtitle">AWS GLBs • physical scale preserved • no breadboard • three-wire sensor path</div></div><div class="status"><span class="pill good">AWS VERIFIED</span><span class="pill">GLB / CORS / SHA-256</span></div></div>
<div class="controls"><div class="row" id="boards"></div><div class="row" id="views"><button data-view="top">TOP</button><button data-view="iso" class="active">ISOMETRIC</button><button data-view="rear">UNDERSIDE</button><button data-view="wiring">DIRECT WIRING</button></div><div class="wiring"><span class="wire red"></span><span class="net">3V3 → VCC</span><span class="to">factory lead</span><span class="wire black"></span><span class="net">GND → GND</span><span class="to">shared ground</span><span class="wire green"></span><span class="net">GPIO / ADC → AOUT</span><span class="to">signal only</span></div></div>
<div class="boardnote"><div class="boardname" id="boardname"></div><div class="boardstate" id="boardstate"></div><div class="warning" id="warning"></div></div></div>
<script type="module">
import * as THREE from "three";
import { GLTFLoader } from "/three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "/three/examples/jsm/controls/OrbitControls.js";

const CDN="https://dvy6bet209exg.cloudfront.net/v1/approved-visual-catalog-v1/objects/sha256";
const sensor={url:CDN+"/08cd3eca63228c25600bd50d435d07cfd6a5d2b8acd632b9f7bda541651cb893.glb",anchors:{gnd:"anchor:diyables-capacitive-soil-moisture-tlc555i:pin:J1:01:GND",vcc:"anchor:diyables-capacitive-soil-moisture-tlc555i:pin:J1:02:VCC",sig:"anchor:diyables-capacitive-soil-moisture-tlc555i:pin:J1:03:AOUT"}};
const boards={
 c3:{label:"ESP32-C3 SuperMini",name:"AITRIP C3 SuperMini + exact pre-soldered controller",hash:"af48aac2094ae56e3350417f477b0068f1308e2523486c6d0d55f10eead4fe1d",controllerHash:"9a89b82e82e6c0e44533f40d4b95f432b787cfd26028a7b9d21d5ecfb3b46c9c",controllerSeat:[0,0,.0032],state:"POPULATED ASSEMBLY REVIEW • RESTRICTED POWER CONTRACT",warning:"Controller is seated in the two 8-way sockets with the 5V/GND/3V3 end aligned to the power block. Production may use USB-C power and factory-default 3V3 rails only; battery input and rail rework stay forbidden.",anchors:{vcc:"anchor:c3-3v3",gnd:"anchor:c3-gnd",sig:"anchor:c3-gpio0"}},
 s3:{label:"ESP32-S3 DevKitC",name:"AITRIP ESP32-S3 44-pin V2775 + exact N8R2 controller",hash:"aec8e5e6e81deb28f3a1da8ab56a76aba0429501964e7c86227cef0e4006a9da",controllerHash:"027017fb2b7859fc4842d482760f557447930441242ba4beaca152f19ec2262c",controllerSeat:[0,.008,.0032],state:"POPULATED ASSEMBLY REVIEW • RESTRICTED POWER CONTRACT",warning:"Exact 44-pin DevKitC is seated in both 1x22 sockets with its USB-C edge aligned to the board arrow. Production may use controller USB-C power and 3V3 sensor rows only; the DC jack and 5V sensor rail stay forbidden.",anchors:{vcc:"anchor:s3-3v3",gnd:"anchor:s3-gnd",sig:"anchor:s3-gpio1"}},
 xiao:{label:"Seeed XIAO",name:"Seeed XIAO Expansion Base 103030356",hash:"6eb3cc6be0872f3c79af55b8d004dfd2d9481fe24a646c59cbf9924a29916a9d",state:"VISUAL + INTERFACE + ASSEMBLY READY",warning:"Uses the official Grove A0 contact contract: GND, 3V3, and D0. Select the exact supported XIAO family before final power validation.",anchors:{vcc:"anchor:xiao-grove-a0-3v3",gnd:"anchor:xiao-grove-a0-gnd",sig:"anchor:xiao-grove-a0-d0"}}
};
for(const [id,b] of Object.entries(boards)){const el=document.createElement("button");el.textContent=b.label;el.dataset.board=id;el.onclick=()=>setBoard(id);document.querySelector("#boards").append(el)}
const renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.setSize(innerWidth,innerHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;document.querySelector("#stage").append(renderer.domElement);
const scene=new THREE.Scene();scene.background=new THREE.Color(0x07090c);scene.fog=new THREE.Fog(0x07090c,.35,.7);
scene.add(new THREE.HemisphereLight(0xe9f4ff,0x202832,2.4));const key=new THREE.DirectionalLight(0xffffff,4);key.position.set(-.16,-.18,.32);key.castShadow=true;scene.add(key);const rim=new THREE.DirectionalLight(0x63f2c0,2);rim.position.set(.22,.18,.16);scene.add(rim);const under=new THREE.DirectionalLight(0xdce8ff,3.2);under.position.set(-.08,.12,-.32);scene.add(under);
const grid=new THREE.GridHelper(.5,25,0x243039,0x151b21);grid.rotation.x=Math.PI/2;grid.position.z=-.002;scene.add(grid);
const camera=new THREE.PerspectiveCamera(29,innerWidth/innerHeight,.0001,5);const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.target.set(0,0,.02);
const loader=new GLTFLoader();let assemblyRoot=null,boardRoot=null,controllerRoot=null,sensorRoot=null,wires=new THREE.Group(),active="c3",view="iso";scene.add(wires);
function fitOnGround(root,targetX,targetY){root.updateMatrixWorld(true);let box=new THREE.Box3().setFromObject(root),c=box.getCenter(new THREE.Vector3());root.position.add(new THREE.Vector3(targetX-c.x,targetY-c.y,-box.min.z));root.updateMatrixWorld(true)}
function point(root,name){const sanitized=name.replace(/[\\[\\]\\.:\\/]/g,"");const obj=root.getObjectByName(name)||root.getObjectByName(sanitized);if(!obj)throw new Error("Missing semantic anchor: "+name);return obj.getWorldPosition(new THREE.Vector3())}
function addWire(start,end,color){const lift=Math.max(.012,Math.min(.032,start.distanceTo(end)*.27));const curve=new THREE.CatmullRomCurve3([start,start.clone().add(new THREE.Vector3(0,0,lift)),start.clone().lerp(end,.5).add(new THREE.Vector3(0,0,lift*1.45)),end.clone().add(new THREE.Vector3(0,0,lift)),end]);const tube=new THREE.Mesh(new THREE.TubeGeometry(curve,40,.00075,10,false),new THREE.MeshStandardMaterial({color,roughness:.55,metalness:.03}));tube.castShadow=true;wires.add(tube)}
function buildWires(){scene.remove(wires);wires=new THREE.Group();scene.add(wires);const b=boards[active];addWire(point(boardRoot,b.anchors.vcc),point(sensorRoot,sensor.anchors.vcc),0xef5a5a);addWire(point(boardRoot,b.anchors.gnd),point(sensorRoot,sensor.anchors.gnd),0x303844);addWire(point(boardRoot,b.anchors.sig),point(sensorRoot,sensor.anchors.sig),0x54e58e)}
function updateLabels(){const b=boards[active];document.querySelector("#boardname").textContent=b.name;document.querySelector("#boardstate").textContent=b.state;document.querySelector("#warning").textContent=b.warning;document.querySelectorAll("[data-board]").forEach(x=>x.classList.toggle("active",x.dataset.board===active));document.querySelectorAll("[data-view]").forEach(x=>x.classList.toggle("active",x.dataset.view===view))}
function seatController(root,seat){const box=new THREE.Box3().setFromObject(root),c=box.getCenter(new THREE.Vector3());root.position.add(new THREE.Vector3(seat[0]-c.x,seat[1]-c.y,seat[2]-box.min.z+.00035));root.updateMatrixWorld(true)}
async function setBoard(id){active=id;document.querySelector("#loading").classList.remove("done");if(assemblyRoot)scene.remove(assemblyRoot);const b=boards[id];boardRoot=(await loader.loadAsync(CDN+"/"+b.hash+".glb")).scene;assemblyRoot=new THREE.Group();assemblyRoot.add(boardRoot);controllerRoot=null;if(b.controllerHash){controllerRoot=(await loader.loadAsync(CDN+"/"+b.controllerHash+".glb")).scene;seatController(controllerRoot,b.controllerSeat);assemblyRoot.add(controllerRoot)}scene.add(assemblyRoot);fitOnGround(assemblyRoot,-.055,.025);buildWires();setView(view);updateLabels();document.querySelector("#loading").classList.add("done");window.__review.ready=true}
function setView(next){view=next;const direct=next==="wiring";sensorRoot.visible=direct;wires.visible=direct;const all=direct?new THREE.Box3().setFromObject(assemblyRoot).union(new THREE.Box3().setFromObject(sensorRoot)):new THREE.Box3().setFromObject(assemblyRoot);const c=all.getCenter(new THREE.Vector3()),s=all.getSize(new THREE.Vector3()),r=Math.max(s.x,s.y,s.z)*(direct?2.8:2.65);let d,up=new THREE.Vector3(0,1,0);if(next==="top")d=new THREE.Vector3(0,0,1);else if(next==="rear")d=new THREE.Vector3(0,0,-1);else if(next==="wiring")d=new THREE.Vector3(1.25,-1.5,.72);else d=new THREE.Vector3(1.15,-1.4,1.0);controls.target.copy(c);camera.up.copy(up);camera.position.copy(c).add(d.normalize().multiplyScalar(r));camera.lookAt(c);controls.update();updateLabels()}
document.querySelectorAll("[data-view]").forEach(el=>el.onclick=()=>setView(el.dataset.view));
window.__review={ready:false,setBoard,setView,getState:()=>({board:active,view,boardName:boards[active].name})};
sensorRoot=(await loader.loadAsync(sensor.url)).scene;scene.add(sensorRoot);fitOnGround(sensorRoot,.055,-.018);await setBoard("c3");
window.__review.ready=true;document.querySelector("#loading").classList.add("done");
function loop(){requestAnimationFrame(loop);controls.update();renderer.render(scene,camera)}loop();
addEventListener("resize",()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)});
</script></body></html>`;

function safeJoin(root, requestPath) {
  const resolved = path.resolve(root, requestPath.replace(/^\/+/, ""));
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) throw new Error("path escape");
  return resolved;
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://127.0.0.1");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.setHeader("Cache-Control", "no-store");
      response.end(html);
      return;
    }
    if (!url.pathname.startsWith("/three/")) throw new Error("not found");
    const file = safeJoin(threeRoot, decodeURIComponent(url.pathname.slice(7)));
    await stat(file);
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    response.end(await readFile(file));
  } catch {
    response.statusCode = 404;
    response.end("not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ESP32 breakout review listening on http://127.0.0.1:${port}/`);
});
