/** Normalized pond coordinates keep camera, pointer, food and fish aligned. */
export class PondSimulation {
  constructor(random=Math.random) {
    this.random=random;this.time=0;this.food=[];
    this.fish=Array.from({length:8},(_,i)=>({
      species:i%2===0?'koi':'goldfish',variant:i%3,
      x:.15+random()*.7,y:.15+random()*.7,z:(random()-.5)*.7,
      vx:Math.cos(i*2.4)*.06,vy:Math.sin(i*2.4)*.06,phase:random()*Math.PI*2,behavior:'roam'
    }));
  }
  dropFood(x,y) {
    for(let i=0;i<5;i++)this.food.push({x:Math.max(.06,Math.min(.94,x+(this.random()-.5)*.05)),y:Math.max(.08,Math.min(.92,y+(this.random()-.5)*.05)),life:10});
    this.food=this.food.slice(-24);
  }
  step(seconds,hand) {
    const dt=Math.min(.05,Math.max(0,seconds));if(!dt)return;
    this.time+=dt;
    this.food=this.food.filter(p=>(p.life-=dt)>0);
    for(let i=0;i<this.fish.length;i++){
      const f=this.fish[i];let tx=Math.cos(this.time*.45+i*2.4),ty=Math.sin(this.time*.36+i*1.7),speed=.065;
      const distance=hand?Math.hypot(hand.x-f.x,hand.y-f.y):Infinity;
      const food=this.food.reduce((best,p)=>!best||Math.hypot(p.x-f.x,p.y-f.y)<Math.hypot(best.x-f.x,best.y-f.y)?p:best,null);
      if(hand&&!['point','beak'].includes(hand.pose)&&distance<.3){tx=f.x-hand.x;ty=f.y-hand.y;speed=.24;f.behavior='flee';}
      else if(food){tx=food.x-f.x;ty=food.y-f.y;speed=.14;f.behavior='feed';if(Math.hypot(tx,ty)<.035)this.food.splice(this.food.indexOf(food),1);}
      else if(hand?.pose==='point'&&distance<.75){tx=hand.x-f.x;ty=hand.y-f.y;speed=distance<.065?0:.115;f.behavior='follow';}
      else f.behavior='roam';
      const norm=Math.hypot(tx,ty)||1;let desiredX=tx/norm*speed,desiredY=ty/norm*speed;
      for(const other of this.fish){const dx=f.x-other.x,dy=f.y-other.y,d=Math.hypot(dx,dy);if(other!==f&&d>.001&&d<.07){desiredX+=dx/d*.04;desiredY+=dy/d*.04;}}
      const blend=1-Math.exp(-dt*4);f.vx+=(desiredX-f.vx)*blend;f.vy+=(desiredY-f.vy)*blend;
      f.x+=f.vx*dt;f.y+=f.vy*dt;
      if(f.x<.04||f.x>.96){f.x=Math.max(.04,Math.min(.96,f.x));f.vx*=-1;}
      if(f.y<.06||f.y>.94){f.y=Math.max(.06,Math.min(.94,f.y));f.vy*=-1;}
      f.phase+=dt*(f.behavior==='flee'?14:7);
    }
  }
}
