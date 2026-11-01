"""One self-contained page for any design folder: the exact exported files, real millimetres, pull apart, cut through and measuring."""
import base64
import json
import sys
from pathlib import Path

import numpy as np
import trimesh

from card import DIRECTIONS, build_card, load_nodes
from parts import ensure_part

COLOURS = {"PRINT_Shell": "#8fb39a", "PRINT_Base": "#c98f6b", "PRINT_Carrier": "#e4dccb"}
PART_COLOUR = "#1f5f46"
LABELS = {"PRINT_Shell": "Shell (printed)", "PRINT_Base": "Base (printed)", "PRINT_Carrier": "Holder (printed)"}


def pack(mesh):
    return {"v": base64.b64encode(np.asarray(mesh.vertices, np.float32).tobytes()).decode(), "f": base64.b64encode(np.asarray(mesh.faces, np.uint32).tobytes()).decode()}


def pack_smooth(mesh):
    """The same surfaces with edges under 30 degrees shaded smoothly, for the finished look only. No point moves."""
    smooth = trimesh.graph.smooth_shade(mesh, angle=np.radians(30))
    return {**pack(smooth), "n": base64.b64encode(np.asarray(smooth.vertex_normals, np.float32).tobytes()).decode()}


def explode_vectors(design):
    """Each part pulls away along the direction it is assembled from, so the page shows how it really goes together."""
    vectors = {}
    for step in (design.get("case") or {}).get("assembly") or []:
        direction = step.get("from")
        if direction in DIRECTIONS:
            axis, side = DIRECTIONS[direction]
            vector = [0, 0, 0]
            vector[axis] = (1 if side else -1) * (1.0 if step["add"].startswith("PRINT_") else 0.5)
            vectors[step["add"]] = vector
    return vectors


def wire_meshes(design):
    """The compiler's plugs and the design's wire routes, so a person can see the wiring the checks measured. The sizes are the assumed ones in wiring_checks."""
    if len(design["purchased"]) < 2:
        return []
    import wiring_checks as w
    transforms = {p["part_id"]: np.array(p["transform"], dtype=float) for p in design["purchased"].values()}
    controller = next(i for i in transforms if build_card(i).get("role") == "controller")
    compiled = w.wires_for([controller] + [i for i in transforms if i != controller])
    colours = w.wire_colours(compiled)
    labels = {x["net"]: f"Wire {x['from']['label']} to {x['to']['label']}" for x in compiled}
    plugs = []
    for wire in compiled:
        for end in (wire["from"], wire["to"]):
            plugs.append(w.plug_box(w.plug_local(end), transforms[end["part_id"]]))
    found = [{"key": "plugs", "label": "Jumper plugs (assumed size)", "colour": "#23262b", "explode": [0, 0, 0], **pack(trimesh.util.concatenate(plugs))}] if plugs else []
    for wire in design.get("wires") or []:
        path = np.array(wire["path"], dtype=float)
        pieces = []
        for a, b in zip(path[:-1], path[1:]):
            if np.linalg.norm(b - a) > 1e-6:
                pieces.append(trimesh.creation.cylinder(radius=w.WIRE_RADIUS, segment=(a, b), sections=12))
            pieces.append(trimesh.creation.icosphere(subdivisions=1, radius=w.WIRE_RADIUS).apply_translation(b))
        if pieces:
            found.append({"key": wire["net"], "label": labels.get(wire["net"], wire["net"]), "colour": str(colours.get(wire["net"], "#c0392b")), "keep": True, "explode": [0, 0, 0], **pack(trimesh.util.concatenate(pieces))})
    return found


def build(folder, title=None):
    folder = Path(folder)
    design = json.loads((folder / "design.json").read_text(encoding="utf-8"))
    vectors = explode_vectors(design)
    meshes, printed = [], []
    for name, filename in design["print"].items():
        mesh = trimesh.load_mesh(folder / filename)
        printed.append(mesh)
        meshes.append({"key": name, "label": LABELS.get(name, name), "colour": COLOURS.get(name, "#a9b4bd"), "explode": vectors.get(name, [0, 0, 0]), "smooth": pack_smooth(mesh), **pack(mesh)})
    for name, part in design["purchased"].items():
        mesh = trimesh.util.concatenate(list(load_nodes(ensure_part(part["part_id"])).values()))
        mesh.apply_transform(np.array(part["transform"], dtype=float))
        meshes.append({"key": name, "label": f"{name.replace('PURCHASE_', '')} (real AWS model)", "colour": PART_COLOUR, "explode": vectors.get(name, [0, 0, 0]), **pack(mesh)})
    meshes.extend(wire_meshes(design))
    bounds = np.array([m.bounds for m in printed])
    data = {"meshes": meshes, "lo": bounds[:, 0].min(axis=0).tolist(), "hi": bounds[:, 1].max(axis=0).tolist()}
    report_path = folder / "report.json"
    checks = "Checks have not run."
    failures = ""
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        passed = sum(r["ok"] for r in report["results"])
        checks = f"{passed} of {len(report['results'])} checks pass."
        failures = "".join(f"<li>{r['check']}: {r['part']}</li>" for r in report["results"] if not r["ok"])
    html = TEMPLATE.replace("__TITLE__", title or folder.name).replace("__DATA__", json.dumps(data)).replace("__CHECKS__", checks).replace("__FAILS__", failures)
    out = folder / "viewer.html"
    out.write_text(html, encoding="utf-8")
    return out


TEMPLATE = r"""<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Case Viewer</title>
<style>
:root{--bg:#e9edef;--p:#fff;--i:#17242b;--m:#566772;--r:#cdd6da;--a:#2f6fb4;--scene:#e9edef}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#17191b;--p:#212427;--i:#ecefef;--m:#a3adb3;--r:#3a4045;--a:#6ea5e0;--scene:#26292c}}
:root[data-theme="dark"]{--bg:#17191b;--p:#212427;--i:#ecefef;--m:#a3adb3;--r:#3a4045;--a:#6ea5e0;--scene:#26292c}
*{box-sizing:border-box}html,body{height:100%;margin:0}body{display:grid;grid-template-columns:300px minmax(0,1fr);background:var(--bg);color:var(--i);font:14px/1.45 system-ui,"Segoe UI",sans-serif}
aside{background:var(--p);border-right:1px solid var(--r);padding:16px;overflow:auto;display:grid;gap:16px;align-content:start}
h1{font-size:19px;margin:0}h2{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--m);margin:0 0 6px}.s{color:var(--m);font-size:13px;margin:4px 0 0}
ul{margin:4px 0 0;padding-left:18px;font-size:13px}
label{display:flex;gap:8px;align-items:center;padding:3px 0}input[type=range]{width:100%;accent-color:var(--a)}.sw{width:12px;height:12px;border-radius:2px;flex:none}
button{font:inherit;padding:5px 9px;border:1px solid var(--r);background:var(--p);color:var(--i);border-radius:4px;cursor:pointer}button[aria-pressed=true]{background:var(--a);color:#fff;border-color:var(--a)}.row{display:flex;flex-wrap:wrap;gap:6px}
#v{position:relative;min-width:0}#v canvas{display:block;width:100%;height:100%}#r{position:absolute;left:12px;top:12px;background:var(--p);border:1px solid var(--r);border-radius:4px;padding:6px 10px;font-variant-numeric:tabular-nums}
output{font-variant-numeric:tabular-nums;font-weight:600}
@media(max-width:760px){body{grid-template-columns:1fr;grid-template-rows:auto 60vh}}
</style>
<aside>
<div><h1>__TITLE__</h1><p class="s" id="size"></p><p class="s">__CHECKS__ Shown exactly as exported, with flat facets. Not printed.</p><ul>__FAILS__</ul></div>
<section><h2>Look</h2><div class="row"><button id="exact" aria-pressed="true">Exact parts</button><button id="finish" aria-pressed="false">Finished</button></div><div class="row" id="tones" style="margin-top:6px"><button data-tone="#a9bfa4">Sage</button><button data-tone="#efe6d6">Cream</button><button data-tone="#34383c">Charcoal</button></div><p class="s">Finished is one colour with soft light and smooth shading, to judge the look. The shape is unchanged. Use Exact parts to check the fit.</p></section>
<section><h2>Parts</h2><div id="parts"></div></section>
<section><h2>Pull apart</h2><input id="ex" type="range" min="0" max="1" step="0.01" value="0" aria-label="Pull apart"></section>
<section><h2>Cut through</h2><div class="row" id="axes"><button data-a="">Off</button><button data-a="0">Left-right</button><button data-a="1">Front-back</button><button data-a="2">Top-bottom</button></div>
<input id="cut" type="range" min="0" max="1" step="0.002" value="0.5" aria-label="Cut position" style="margin-top:8px"><p class="s">Position: <output id="cv">-</output> mm</p></section>
<section><h2>Measure</h2><div class="row"><button id="m" aria-pressed="false">Click two points</button><button id="mc">Clear</button></div><p class="s">Measures the real geometry, in millimetres.</p></section>
<section><h2>View</h2><div class="row"><button data-v="f">Front</button><button data-v="b">Back</button><button data-v="s">Side</button><button data-v="i">Angle</button></div><p class="s">Drag to turn. Scroll to zoom. Right-drag to move.</p></section>
</aside>
<div id="v"><div id="r" hidden></div></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
const D=__DATA__;const $=i=>document.getElementById(i);const V=$('v');
function dec(b,T){const s=atob(b),a=new Uint8Array(s.length);for(let i=0;i<s.length;i++)a[i]=s.charCodeAt(i);return new T(a.buffer)}
const lo=new THREE.Vector3(...D.lo),hi=new THREE.Vector3(...D.hi),c=lo.clone().add(hi).multiplyScalar(.5),sz=hi.clone().sub(lo);
$('size').textContent=`Case size ${sz.x.toFixed(1)} x ${sz.y.toFixed(1)} x ${sz.z.toFixed(1)} mm`;
const R=new THREE.WebGLRenderer({antialias:true});R.setPixelRatio(Math.min(devicePixelRatio,2));R.localClippingEnabled=true;V.appendChild(R.domElement);
const S=new THREE.Scene();S.background=new THREE.Color(getComputedStyle(document.documentElement).getPropertyValue('--scene').trim());const C=new THREE.PerspectiveCamera(30,1,1,5000);C.up.set(0,0,1);
const H=new THREE.HemisphereLight(0xffffff,0x8a939b,.75);H.position.set(0,0,1);S.add(H);const sun=new THREE.DirectionalLight(0xffffff,.6);S.add(sun);
const G=new THREE.Group();S.add(G);const plane=new THREE.Plane(new THREE.Vector3(1,0,0),0);const clip=[];const items=[];
for(const m of D.meshes){const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.BufferAttribute(dec(m.v,Float32Array),3));g.setIndex(new THREE.BufferAttribute(dec(m.f,Uint32Array),1));
 const mat=new THREE.MeshStandardMaterial({color:m.colour,flatShading:true,side:THREE.DoubleSide,roughness:.8,metalness:0,clippingPlanes:clip,clipShadows:false});const o=new THREE.Mesh(g,mat);o.castShadow=o.receiveShadow=true;G.add(o);
 let f=null;if(m.smooth){const q=new THREE.BufferGeometry();q.setAttribute('position',new THREE.BufferAttribute(dec(m.smooth.v,Float32Array),3));q.setAttribute('normal',new THREE.BufferAttribute(dec(m.smooth.n,Float32Array),3));q.setIndex(new THREE.BufferAttribute(dec(m.smooth.f,Uint32Array),1));
  f=new THREE.Mesh(q,new THREE.MeshStandardMaterial({color:'#a9bfa4',side:THREE.DoubleSide,roughness:.65,metalness:0,clippingPlanes:clip}));f.castShadow=f.receiveShadow=true;f.visible=false;G.add(f)}
 const item={m,o,f,on:true};items.push(item);
 const l=document.createElement('label');const x=document.createElement('input');x.type='checkbox';x.checked=true;x.onchange=e=>{item.on=e.target.checked;show();draw()};const w=document.createElement('span');w.className='sw';w.style.background=m.colour;l.append(x,w,m.label);$('parts').appendChild(l)}
const groundMat=new THREE.ShadowMaterial({opacity:.22});const ground=new THREE.Mesh(new THREE.PlaneGeometry(4000,4000),groundMat);ground.position.set(c.x,c.y,lo.z-.05);ground.receiveShadow=true;ground.visible=false;S.add(ground);
const fill=new THREE.DirectionalLight(0xffe9d6,0);S.add(fill);let finished=false;const exactBg=S.background.clone(),finishBg=new THREE.Color('#ece7df');
sun.shadow.mapSize.set(2048,2048);sun.shadow.radius=6;const r=sz.length()*1.5;Object.assign(sun.shadow.camera,{left:-r,right:r,top:r,bottom:-r,near:1,far:5000});sun.shadow.bias=-.0005;R.shadowMap.type=THREE.PCFSoftShadowMap;
function show(){for(const i of items){i.o.visible=i.on&&!(finished&&i.f);if(i.f)i.f.visible=i.on&&finished;if(finished&&!i.f&&!i.m.keep)i.o.material.color.set('#15181b');else i.o.material.color.set(i.m.colour)}}
function setLook(on){finished=on;R.shadowMap.enabled=on;sun.castShadow=on;ground.visible=on;S.background=on?finishBg:exactBg;R.toneMapping=on?THREE.ACESFilmicToneMapping:THREE.NoToneMapping;R.toneMappingExposure=1.05;H.color.set(on?0xfff4e6:0xffffff);H.groundColor.set(on?0xb8ad9d:0x8a939b);H.intensity=on?.8:.75;sun.intensity=on?1.15:.6;fill.intensity=on?.35:0;$('exact').setAttribute('aria-pressed',!on);$('finish').setAttribute('aria-pressed',on);for(const i of items){i.o.material.needsUpdate=true;if(i.f)i.f.material.needsUpdate=true}show();draw()}
$('exact').onclick=()=>setLook(false);$('finish').onclick=()=>setLook(true);
document.querySelectorAll('[data-tone]').forEach(b=>b.onclick=()=>{for(const i of items)if(i.f)i.f.material.color.set(b.dataset.tone);setLook(true)});
let th=.5,ph=1.2,d=sz.length()*2.4;const T=c.clone();
function view(a,b){th=a;ph=b;draw()}
function cam(){C.position.set(T.x+d*Math.sin(ph)*Math.sin(th),T.y-d*Math.sin(ph)*Math.cos(th),T.z+d*Math.cos(ph));C.lookAt(T);if(finished){sun.position.set(T.x-sz.length()*.9,T.y-sz.length()*1.4,T.z+sz.length()*2);sun.target.position.copy(T);sun.target.updateMatrixWorld();fill.position.set(T.x+sz.length(),T.y-sz.length()*.6,T.z+sz.length()*.3)}else sun.position.copy(C.position).add(new THREE.Vector3(30,0,60))}
function draw(){const w=V.clientWidth||600,h=V.clientHeight||400;R.setSize(w,h,false);C.aspect=w/h;C.updateProjectionMatrix();cam();R.render(S,C)}
new ResizeObserver(draw).observe(V);
const el=R.domElement;let drag=null,moved=0;el.addEventListener('contextmenu',e=>e.preventDefault());
el.addEventListener('pointerdown',e=>{drag={x:e.clientX,y:e.clientY,b:e.button};moved=0;el.setPointerCapture(e.pointerId)});
el.addEventListener('pointermove',e=>{if(!drag)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;moved+=Math.abs(dx)+Math.abs(dy);drag.x=e.clientX;drag.y=e.clientY;
 if(drag.b===2){const k=d*.0012,r=new THREE.Vector3().setFromMatrixColumn(C.matrix,0),u=new THREE.Vector3().setFromMatrixColumn(C.matrix,1);T.addScaledVector(r,-dx*k).addScaledVector(u,dy*k)}else{th-=dx*.008;ph=Math.min(3.05,Math.max(.09,ph-dy*.008))}draw()});
el.addEventListener('pointerup',e=>{const was=moved;drag=null;if(was<4&&mOn)pick(e)});
el.addEventListener('wheel',e=>{e.preventDefault();d*=e.deltaY>0?1.1:.9;draw()},{passive:false});
document.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>({f:()=>view(0,1.5),b:()=>view(Math.PI,1.5),s:()=>view(Math.PI/2,1.5),i:()=>view(.6,1.15)}[b.dataset.v]()));
$('ex').oninput=e=>{const s=e.target.value*sz.length()*.9;for(const{m,o,f}of items){o.position.set(m.explode[0]*s,m.explode[1]*s,m.explode[2]*s);if(f)f.position.copy(o.position)}draw()};
let ax='';function setCut(){clip.length=0;document.querySelectorAll('[data-a]').forEach(b=>b.setAttribute('aria-pressed',b.dataset.a===ax));if(ax===''){$('cv').textContent='-';for(const{o,f}of items){o.material.needsUpdate=true;if(f)f.material.needsUpdate=true}draw();return}
 const i=+ax,v=lo.getComponent(i)+(hi.getComponent(i)-lo.getComponent(i))*$('cut').value;plane.normal.set(i==0?-1:0,i==1?-1:0,i==2?-1:0);plane.constant=v;clip.push(plane);$('cv').textContent=v.toFixed(1);for(const{o,f}of items){o.material.needsUpdate=true;if(f)f.material.needsUpdate=true}draw()}
document.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>{ax=b.dataset.a;setCut()});$('cut').oninput=setCut;
let mOn=false,pts=[],marks=new THREE.Group();S.add(marks);const ray=new THREE.Raycaster();
$('m').onclick=()=>{mOn=!mOn;$('m').setAttribute('aria-pressed',mOn)};$('mc').onclick=()=>{pts=[];marks.clear();$('r').hidden=true;draw()};
function pick(e){const b=el.getBoundingClientRect();ray.setFromCamera({x:(e.clientX-b.left)/b.width*2-1,y:-(e.clientY-b.top)/b.height*2+1},C);
 const hits=ray.intersectObjects(items.flatMap(i=>[i.o,i.f]).filter(o=>o&&o.visible)).filter(h=>clip.length==0||clip[0].distanceToPoint(h.point)>=0);if(!hits.length)return;
 if(pts.length==2){pts=[];marks.clear()}pts.push(hits[0].point.clone());const s=new THREE.Mesh(new THREE.SphereGeometry(sz.length()*.006),new THREE.MeshBasicMaterial({color:0xd0021b,depthTest:false}));s.position.copy(hits[0].point);s.renderOrder=9;marks.add(s);
 if(pts.length==2){const l=new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts),new THREE.LineBasicMaterial({color:0xd0021b,depthTest:false}));l.renderOrder=9;marks.add(l);const a=pts[0],z=pts[1];$('r').textContent=`${a.distanceTo(z).toFixed(2)} mm  (x ${Math.abs(a.x-z.x).toFixed(2)}, y ${Math.abs(a.y-z.y).toFixed(2)}, z ${Math.abs(a.z-z.z).toFixed(2)})`;$('r').hidden=false}draw()}
setCut();view(.6,1.15);
</script></html>"""

if __name__ == "__main__":
    print(build(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else None))
