const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const load = file => import('data:text/javascript;base64,' + Buffer.from(fs.readFileSync(path.join(__dirname,'..',file))).toString('base64'));
function hand(pose) {
  const p=Array.from({length:21},()=>({x:.5,y:.58,z:0}));
  p[0]={x:.5,y:.85,z:0};
  const bases=[.38,.46,.54,.62];
  [5,9,13,17].forEach((id,i)=>{
    p[id]={x:bases[i],y:.60,z:0};
    p[id+1]={x:bases[i],y:.48,z:0};
    p[id+2]={x:bases[i],y:.4,z:0};
    p[id+3]={x:bases[i],y:pose==='palm'||(pose==='point'&&i===0)?.27:.66,z:0};
  });
  p[1]={x:.40,y:.74,z:0};p[2]={x:.33,y:.68,z:0};p[3]={x:.27,y:.6,z:0};p[4]={x:pose==='palm'?.2:.45,y:pose==='palm'?.49:.66,z:0};
  if(pose==='beak') [4,8,12,16,20].forEach((id,i)=>p[id]={x:.48+i*.01,y:.37+i*.005,z:-.08});
  if(pose==='edge') for(const q of p){q.z=(q.x-.5)*3;q.x=.5+(q.x-.5)*.1;}
  return p;
}
test('classify spread palm, point and five-tip beak without treating fists as erasers',async()=>{
  const {evaluateHandPose}=await load('js/input/hand-gestures.js');
  for(const pose of ['palm','point','beak']) assert.equal(evaluateHandPose(hand(pose)).pose,pose);
  assert.equal(evaluateHandPose(hand('fist')).pose,'neutral');
  assert.notEqual(evaluateHandPose(hand('edge')).pose,'palm');
  assert.equal(evaluateHandPose(null).pose,'none');
  assert.equal(evaluateHandPose(Array(21).fill({x:NaN,y:0})).pose,'none');
});
test('palm requires dwell, survives brief misreads, releases after grace; beak fires once until rearmed',async()=>{
  const {GestureGate}=await load('js/input/hand-gestures.js');const gate=new GestureGate();
  assert.equal(gate.update('palm',0).pose,'none');
  assert.equal(gate.update('palm',200).pose,'palm');
  assert.equal(gate.update('neutral',260).pose,'palm');
  assert.equal(gate.update('neutral',500).pose,'none');
  gate.update('palm',520);gate.update('palm',700);assert.equal(gate.update('beak',710).pose,'none');
  assert.equal(gate.update('beak',1000).feed,true);
  assert.equal(gate.update('beak',2000).feed,false);
  gate.update('none',2100);gate.update('none',2500);gate.update('beak',2600);
  assert.equal(gate.update('beak',2900).feed,true);
});
test('point still classifies when the other fingers are only half curled',async()=>{
  const {evaluateHandPose}=await load('js/input/hand-gestures.js');
  const p=hand('point');
  // middle/ring/pinky bent ~90 degrees at the PIP instead of fully folded
  [12,16,20].forEach(id=>{p[id]={x:p[id].x+.06,y:.48,z:0};});
  assert.equal(evaluateHandPose(p).pose,'point');

  // Center-screen hand with a loosely relaxed middle finger (only 55° bent, while ring & pinky are curled)
  const looseMid=hand('point');
  looseMid[10]={x:.46,y:.48,z:0};looseMid[11]={x:.48,y:.42,z:0};looseMid[12]={x:.51,y:.41,z:0};
  assert.equal(evaluateHandPose(looseMid).pose,'point');

  // Bent index knuckle sticking up while tip folds down: must NOT classify as point
  const knuckle=hand('point');
  knuckle[6]={x:.38,y:.42,z:0};knuckle[7]={x:.38,y:.46,z:0};knuckle[8]={x:.38,y:.53,z:0};
  assert.equal(evaluateHandPose(knuckle).pose,'neutral');

  // All 4 knuckles at top with fingers curled straight down toward wrist: must NOT classify as palm or point
  const curledKnuckles=hand('palm');
  [5,9,13,17].forEach((id,i)=>{
    const x=.38+i*.08;
    curledKnuckles[id]={x,y:.48,z:0};
    curledKnuckles[id+1]={x,y:.50,z:0};
    curledKnuckles[id+2]={x,y:.58,z:0};
    curledKnuckles[id+3]={x,y:.68,z:0};
  });
  assert.equal(evaluateHandPose(curledKnuckles).pose,'neutral');

  // Side-of-screen hand: wrist angled ~75° relative to horizontal/sideways pointing index finger
  const sidePoint=hand('point');
  sidePoint[0]={x:.88,y:.65,z:0};
  sidePoint[5]={x:.90,y:.48,z:0};
  sidePoint[6]={x:.82,y:.47,z:0};
  sidePoint[7]={x:.75,y:.46,z:0};
  sidePoint[8]={x:.67,y:.45,z:0};
  assert.equal(evaluateHandPose(sidePoint).pose,'point');
});
test('one euro filter tracks fast motion and damps jitter',async()=>{
  const {OneEuroPointFilter}=await load('js/input/hand-gestures.js');
  const f=new OneEuroPointFilter();f.update(100,100,0,1000);
  let out;for(let t=33,i=0;t<1000;t+=33,i++)out=f.update(100+(i%2?3:-3),100,t,1000);
  assert.ok(Math.abs(out.x-100)<2.5);
  const g=new OneEuroPointFilter();g.update(0,0,0,1000);
  for(let t=33;t<=330;t+=33)out=g.update(t*2,0,t,1000);
  assert.ok(out.x>660*0.75);
});
test('mixed fish flee non-point hands, follow a finger and seek food',async()=>{
  const {PondSimulation}=await load('js/scenes/pond.js');
  const pond=new PondSimulation(()=>.5);assert.ok(pond.fish.some(f=>f.species==='koi'));assert.ok(pond.fish.some(f=>f.species==='goldfish'));
  pond.fish=pond.fish.slice(0,1);const fish=pond.fish[0];
  Object.assign(fish,{x:.5,y:.5,vx:0,vy:0});pond.step(.05,{x:.6,y:.5,pose:'neutral'});assert.ok(fish.vx<0);
  Object.assign(fish,{x:.5,y:.5,vx:0,vy:0});pond.step(.05,{x:.7,y:.5,pose:'point'});assert.ok(fish.vx>0);
  pond.dropFood(.3,.5);Object.assign(fish,{x:.5,y:.5,vx:0,vy:0});pond.step(.05,null);assert.ok(fish.vx<0);
});
test('food is bounded, consumed and expires; zero dt freezes simulation',async()=>{
  const {PondSimulation}=await load('js/scenes/pond.js');const pond=new PondSimulation(()=>.5);
  for(let i=0;i<30;i++)pond.dropFood(.5,.5);assert.ok(pond.food.length<=24);
  const before=JSON.stringify(pond);pond.step(0,null);assert.equal(JSON.stringify(pond),before);
  const count=pond.food.length;pond.step(.05,null);assert.ok(pond.food.length<count);
  pond.fish=[];for(let i=0;i<250;i++)pond.step(.05,null);assert.equal(pond.food.length,0);
});
test('fish stay inside the pond during prolonged steering',async()=>{
  const {PondSimulation}=await load('js/scenes/pond.js');const pond=new PondSimulation(()=>.5);
  for(let i=0;i<1000;i++)pond.step(.05,{x:0,y:0,pose:'point'});
  for(const fish of pond.fish){assert.ok(fish.x>=.04&&fish.x<=.96);assert.ok(fish.y>=.06&&fish.y<=.94);assert.ok(Number.isFinite(fish.vx));}
});

test('gestures survive mirrored, rotated and scaled hands; four fingertips alone do not feed',async()=>{
  const {evaluateHandPose}=await load('js/input/hand-gestures.js');
  for(const pose of ['palm','point','beak'])for(const scale of [.5,1.4])for(const mirror of [-1,1]){
    const angle=.65;
    const transformed=hand(pose).map(p=>{const x=(p.x-.5)*scale*mirror,y=(p.y-.5)*scale;return {x:.5+x*Math.cos(angle)-y*Math.sin(angle),y:.5+x*Math.sin(angle)+y*Math.cos(angle),z:p.z*scale};});
    assert.equal(evaluateHandPose(transformed).pose,pose);
  }
  const four=hand('beak');four[4]={x:.2,y:.6,z:0};assert.notEqual(evaluateHandPose(four).pose,'beak');
});

test('live page erases only after palm dwell and feeds once per beak gesture',async()=>{
  const vm=require('node:vm');const {evaluateHandPose,GestureGate}=await load('js/input/hand-gestures.js');
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const source=html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*?;$/gm,'');
  const sandbox={window:{addEventListener(){}},evaluateHandPose,GestureGate,document:{getElementById(){return {textContent:''};}}};
  vm.createContext(sandbox);vm.runInContext(`'use strict';${source}\nglobalThis.App=PicnicPhotoboothApp`,sandbox);
  const app=Object.create(sandbox.App.prototype);const cleared=[],food=[];let pose='fist';
  Object.assign(app,{cameraActive:true,tracker:{isReady:true,detect(){return {handLandmarks:pose?hand(pose):null};}},
    videoEl:{videoWidth:1000,videoHeight:1000},stageCanvas:{width:1000,height:1000},uiCanvas:{width:1000,height:1000},uiCtx:{clearRect(){}},
    gestureGate:new GestureGate(),lastHandSeen:0,activeTool:'write',pointerDown:false,
    handSmoother:{reset(){},update(x,y){return {x,y};}},fogEngine:{clearSegment(...args){cleared.push(args);}},
    sceneManager:{currentScene:'aquarium',paused:false,pond:{dropFood(x,y){food.push([x,y]);}}},showToast(){},applyToolSegment(){throw new Error('Unexpected write');}
  });
  for(let t=0;t<=300;t+=50)app.processTracking(t,.05);assert.equal(cleared.length,0);
  pose='palm';for(let t=350;t<=600;t+=50)app.processTracking(t,.05);assert.ok(cleared.length>0);assert.ok(cleared[0][4]>=.05&&cleared[0][4]<=.16);
  pose='beak';for(let t=650;t<=1400;t+=50)app.processTracking(t,.05);assert.equal(food.length,1);
  pose=null;for(let t=1450;t<=1850;t+=50)app.processTracking(t,.05);assert.equal(app.pondHand,null);assert.equal(app.lastHandStrokePos,null);
  pose='beak';for(let t=1900;t<=2250;t+=50)app.processTracking(t,.05);assert.equal(food.length,2);

  // Pinch thumb+index -> release index finger -> clears fog; pinch back -> stops clearing fog
  const writes=[];app.applyToolSegment=(...a)=>writes.push(a);
  const pinchHand=()=>{const h=hand('point');h[8]={x:.39,y:.52,z:0};h[4]={x:.40,y:.53,z:0};return h;};
  app.tracker.detect=()=>({handLandmarks:pinchHand()});
  for(let t=2300;t<=2400;t+=50)app.processTracking(t,.05);
  assert.equal(app.pinchWriteLatched,true);assert.equal(writes.length,0); // doesn't smudge while still pinched
  app.tracker.detect=()=>({handLandmarks:hand('point')});
  for(let t=2450;t<=2600;t+=50)app.processTracking(t,.05);
  assert.ok(writes.length>0); // clears fog once index finger extends
  const countAfterWrite=writes.length;

  // Moving finger outside the 10% edge boundary box (e.g. y = 0.95) stops detection & clearing completely
  const edgeHand=()=>hand('point').map(q=>({...q,y:.95}));
  app.tracker.detect=()=>({handLandmarks:edgeHand()});
  for(let t=2620;t<=2640;t+=10)app.processTracking(t,.05);
  assert.equal(writes.length,countAfterWrite);
  assert.equal(app.handOutsideZone,true);

  app.tracker.detect=()=>({handLandmarks:pinchHand()});
  for(let t=2650;t<=2750;t+=50)app.processTracking(t,.05);
  assert.equal(app.pinchWriteLatched,false);
  app.tracker.detect=()=>({handLandmarks:hand('point')});
  for(let t=2800;t<=2950;t+=50)app.processTracking(t,.05);
  assert.equal(writes.length,countAfterWrite); // stays stopped after pinching back
});

test('fish remain drawable when Three.js or WebGL is unavailable',async()=>{
  const {FishRenderer}=await load('js/scenes/fish-renderer.js');
  const {PondSimulation}=await load('js/scenes/pond.js');
  const pond=new PondSimulation(()=>.5);const renderer=new FishRenderer(null,640,480,pond.fish);
  let bodies=0;const gradient={addColorStop(){}};
  const ctx={save(){},restore(){},translate(){},rotate(){},createRadialGradient(){return gradient;},beginPath(){},ellipse(){bodies++;},fill(){},moveTo(){},lineTo(){},closePath(){},arc(){},stroke(){}};
  assert.doesNotThrow(()=>renderer.render(ctx,pond));assert.ok(bodies>=8);assert.doesNotThrow(()=>renderer.dispose());
});
