/** Procedural Three.js fish: no network model downloads or missing GLB assets. */
export class FishRenderer {
  constructor(THREE, width, height, fish) {
    this.THREE=THREE;this.models=[];this.renderer=null;
    try {
      if(!THREE)throw new Error('Three.js unavailable');
      this.scene=new THREE.Scene();
      this.camera=new THREE.OrthographicCamera(0,width,0,height,.1,2000);
      this.camera.position.z=1000;
      this.renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
      this.renderer.setPixelRatio(1);
      this.scene.add(new THREE.AmbientLight(0xb9deda,.85));
      const light=new THREE.DirectionalLight(0xfff3d1,1.3);light.position.set(-1,-2,5);this.scene.add(light);
      this.models=fish.map(f=>this.createFish(f));
      this.resize(width,height);
      this.renderer.domElement.addEventListener('webglcontextlost',e=>{e.preventDefault();this.unavailable=true;});
      this.renderer.domElement.addEventListener('webglcontextrestored',()=>{this.unavailable=false;});
    } catch(error) {
      this.renderer?.dispose();this.renderer=null;
      console.warn('3D pond unavailable; using canvas fish.',error.message);
    }
  }
  createFish(fish) {
    const T=this.THREE,group=new T.Group();
    const gold=fish.species==='goldfish';
    const material=new T.MeshPhongMaterial({color:gold?0xf6a32c:0xf4eee0,shininess:65});
    const finMaterial=new T.MeshPhongMaterial({color:gold?0xec7921:0xe6d3ab,transparent:true,opacity:.78,side:T.DoubleSide,shininess:35});
    const sphere=(x,y,z,sx,sy,sz,mat)=>{
      const mesh=new T.Mesh(new T.SphereGeometry(1,20,12),mat);
      mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);group.add(mesh);return mesh;
    };
    sphere(0,0,0,gold?.58:.78,gold?.33:.25,.23,material);
    // Snout and a subtle dark mouth at the leading end.
    sphere(gold?.5:.7,0,.02,.13,.13,.15,material);
    sphere(gold?.61:.8,0,.08,.018,.055,.045,new T.MeshPhongMaterial({color:0x704c30}));
    const eyeMaterial=new T.MeshPhongMaterial({color:0x172b2e,shininess:90});
    for(const sign of [-1,1]){
      sphere(gold?.34:.53,sign*(gold?.22:.16),.17,.054,.054,.045,new T.MeshPhongMaterial({color:0xf6d778}));
      sphere(gold?.36:.55,sign*(gold?.23:.17),.205,.027,.03,.025,eyeMaterial);
    }
    if(!gold){
      const colors=fish.variant===1?[0xe36229,0x263b3c]:[0xc84d30,0xd97032];
      for(let i=0;i<4;i++){
        const x=-.42+i*.25, y=(i%2?1:-1)*.07;
        sphere(x,y,.19,.13+i*.009,.11,.055,new T.MeshPhongMaterial({color:colors[i%2],shininess:45}));
      }
    } else {
      // Overlapping metallic scale highlights distinguish the rounder goldfish.
      for(let i=0;i<5;i++)sphere(-.3+i*.14,-.1,.21,.06,.075,.015,new T.MeshPhongMaterial({color:i%2?0xffcb62:0xf8b846,shininess:80}));
    }
    const fin=(vertices,parent=group)=>{
      const shape=new T.Shape();shape.moveTo(...vertices[0]);for(const v of vertices.slice(1))shape.lineTo(...v);shape.closePath();
      const mesh=new T.Mesh(new T.ShapeGeometry(shape),finMaterial);parent.add(mesh);return mesh;
    };
    const tail=new T.Group();tail.position.x=gold?-.49:-.7;group.add(tail);
    fin([[0,0],[-.6,-.39],[-.43,0],[-.6,.39]],tail);
    if(gold){const twin=fin([[0,0],[-.57,-.32],[-.33,0],[-.57,.32]],tail);twin.rotation.x=.7;}
    const fins=[fin([[.12,.14],[-.13,.61],[-.3,.2]]),fin([[.12,-.14],[-.13,-.61],[-.3,-.2]])];
    const dorsal=fin([[.15,0],[-.12,-.26],[-.4,0]]);dorsal.rotation.x=Math.PI/2;dorsal.position.z=.18;
    this.scene.add(group);return {group,tail,fins};
  }
  resize(width,height) {
    this.width=width;this.height=height;
    if(!this.renderer)return;
    this.camera.right=width;this.camera.bottom=height;this.camera.updateProjectionMatrix();
    this.renderer.setSize(width,height);
  }
  render(ctx,pond) {
    if(this.renderer&&!this.unavailable){
      const size=Math.max(18,Math.min(this.width,this.height)*.058);
      pond.fish.forEach((f,i)=>{
        const m=this.models[i];m.group.position.set(f.x*this.width,f.y*this.height,f.z*50);
        m.group.scale.setScalar(size*(f.species==='koi'?1.1:.95));
        m.group.rotation.set(Math.sin(f.phase*.5)*.12,Math.sin(f.phase*.4)*.1,Math.atan2(f.vy,f.vx));
        m.tail.rotation.z=Math.sin(f.phase)*.34;m.fins.forEach((fin,j)=>{fin.rotation.x=Math.sin(f.phase+j)*.24;});
      });
      this.renderer.render(this.scene,this.camera);ctx.drawImage(this.renderer.domElement,0,0);
    } else this.renderFallback(ctx,pond);
    for(const pellet of pond.food){
      ctx.fillStyle='#624324';ctx.strokeStyle='#f2d399';ctx.lineWidth=1.5;ctx.beginPath();
      ctx.arc(pellet.x*this.width,pellet.y*this.height,3.5,0,Math.PI*2);ctx.fill();ctx.stroke();
    }
  }
  renderFallback(ctx,pond) {
    const size=Math.max(14,Math.min(this.width,this.height)*.045);
    for(const f of pond.fish){
      ctx.save();ctx.translate(f.x*this.width,f.y*this.height);ctx.rotate(Math.atan2(f.vy,f.vx));
      const color=f.species==='koi'?'#f3e9d1':'#f7a22d';
      const body=ctx.createRadialGradient(0,-size*.12,1,0,0,size);body.addColorStop(0,'#fff4cb');body.addColorStop(.45,color);body.addColorStop(1,'#b46a26');
      ctx.fillStyle=body;ctx.beginPath();ctx.ellipse(0,0,size,size*(f.species==='koi'?.31:.48),0,0,Math.PI*2);ctx.fill();
      ctx.fillStyle=f.species==='koi'?'#d35b36':'#e77d27';ctx.beginPath();ctx.moveTo(-size*.8,0);ctx.lineTo(-size*1.6,-size*.5+Math.sin(f.phase)*3);ctx.lineTo(-size*1.6,size*.5+Math.sin(f.phase)*3);ctx.closePath();ctx.fill();
      if(f.species==='koi')for(let i=0;i<3;i++){ctx.beginPath();ctx.ellipse((i-1)*size*.4,0,size*.15,size*.22,0,0,Math.PI*2);ctx.fill();}
      ctx.fillStyle='#192b2c';ctx.beginPath();ctx.arc(size*.65,-size*.15,2,0,Math.PI*2);ctx.fill();ctx.restore();
    }
  }
  dispose() {
    this.scene?.traverse(object=>{object.geometry?.dispose();if(object.material)object.material.dispose();});
    this.renderer?.dispose();
  }
}
