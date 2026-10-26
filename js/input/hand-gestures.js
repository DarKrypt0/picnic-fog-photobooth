/** Scale-relative hand geometry. No fist action; ambiguous poses stay neutral. */
export function evaluateHandPose(points) {
  const empty = { pose: 'none', indexTip: null, palmCenter: null, beakCenter: null, handScale: .1 };
  if (!points || points.length < 21 || points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return empty;
  const dist = (a,b) => Math.hypot(a.x-b.x,a.y-b.y,(a.z||0)-(b.z||0));
  const wrist=points[0], middle=points[9], width=dist(points[5],points[17]);
  const length=dist(wrist,middle);
  if (width<.015 || length<.02) return empty;
  const palmCenter={x:(wrist.x+middle.x)/2,y:(wrist.y+middle.y)/2};
  const tips=[4,8,12,16,20].map(i=>points[i]);
  const beakCenter={x:tips.reduce((s,p)=>s+p.x,0)/5,y:tips.reduce((s,p)=>s+p.y,0)/5,z:tips.reduce((s,p)=>s+(p.z||0),0)/5};
  const cluster=Math.max(...tips.map(p=>dist(p,beakCenter)));
  const extended=[8,12,16,20].map(i=>dist(points[i],wrist)>dist(points[i-2],wrist)*1.12 && dist(points[i],points[i-3])>length*.7);
  const a={x:points[5].x-wrist.x,y:points[5].y-wrist.y,z:(points[5].z||0)-(wrist.z||0)};
  const b={x:points[17].x-wrist.x,y:points[17].y-wrist.y,z:(points[17].z||0)-(wrist.z||0)};
  const normal={x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x};
  const facing=Math.abs(normal.z)/Math.max(.00001,Math.hypot(normal.x,normal.y,normal.z));
  const spread=dist(points[8],points[20])>width*.85 && dist(points[4],points[8])>width*.55;
  // A fist also clusters fingertips, but its tips fold back toward the wrist.
  const distal=(beakCenter.x-middle.x)*(middle.x-wrist.x)+(beakCenter.y-middle.y)*(middle.y-wrist.y);
  let pose='neutral';
  if (cluster<width*.36 && distal>length*length*.35 && dist(points[4],beakCenter)<width*.4) pose='beak';
  else if (extended.every(Boolean) && spread && facing>.7) pose='palm';
  else if (extended[0] && !extended[1] && !extended[2] && !extended[3]) pose='point';
  return {pose,indexTip:{x:points[8].x,y:points[8].y},palmCenter,beakCenter,handScale:length};
}

/** Dwell prevents one-frame erases. Missing/changed poses release immediately. */
export class GestureGate {
  constructor() { this.reset(); }
  reset() { this.candidate='none';this.since=0;this.fed=false;this.releaseSince=null; }
  update(raw, now) {
    if(raw!==this.candidate){this.candidate=raw;this.since=now;}
    if(raw!=='beak'){
      if(this.releaseSince===null)this.releaseSince=now;
      if(now-this.releaseSince>=300)this.fed=false;
    }else this.releaseSince=null;
    const dwell=raw==='palm'?180:raw==='beak'?250:90;
    const pose=['point','palm','beak'].includes(raw)&&now-this.since>=dwell?raw:'none';
    const feed=pose==='beak'&&!this.fed;
    if(feed)this.fed=true;
    return {pose,feed};
  }
}
