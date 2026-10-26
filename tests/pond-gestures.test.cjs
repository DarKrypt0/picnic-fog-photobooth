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
test('palm requires dwell and releases immediately on pose loss; beak fires once until rearmed',async()=>{
  const {GestureGate}=await load('js/input/hand-gestures.js');const gate=new GestureGate();
  assert.equal(gate.update('palm',0).pose,'none');
  assert.equal(gate.update('palm',200).pose,'palm');
  assert.equal(gate.update('neutral',210).pose,'none');
  gate.update('beak',300);assert.equal(gate.update('beak',600).feed,true);
  assert.equal(gate.update('beak',2000).feed,false);
  gate.update('none',2100);gate.update('none',2500);gate.update('beak',2600);
  assert.equal(gate.update('beak',2900).feed,true);
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
  pose='palm';for(let t=350;t<=600;t+=50)app.processTracking(t,.05);assert.ok(cleared.length>0);assert.equal(cleared[0][4],.085);
  pose='beak';for(let t=650;t<=1400;t+=50)app.processTracking(t,.05);assert.equal(food.length,1);
  pose=null;for(let t=1450;t<=1850;t+=50)app.processTracking(t,.05);assert.equal(app.pondHand,null);assert.equal(app.lastHandStrokePos,null);
  pose='beak';for(let t=1900;t<=2250;t+=50)app.processTracking(t,.05);assert.equal(food.length,2);
});

test('fish remain drawable when Three.js or WebGL is unavailable',async()=>{
  const {FishRenderer}=await load('js/scenes/fish-renderer.js');
  const {PondSimulation}=await load('js/scenes/pond.js');
  const pond=new PondSimulation(()=>.5);const renderer=new FishRenderer(null,640,480,pond.fish);
  let bodies=0;const gradient={addColorStop(){}};
  const ctx={save(){},restore(){},translate(){},rotate(){},createRadialGradient(){return gradient;},beginPath(){},ellipse(){bodies++;},fill(){},moveTo(){},lineTo(){},closePath(){},arc(){},stroke(){}};
  assert.doesNotThrow(()=>renderer.render(ctx,pond));assert.ok(bodies>=8);assert.doesNotThrow(()=>renderer.dispose());
});
