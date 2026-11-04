/**
 * 3D Picnic Creature Renderer (Three.js PerspectiveCamera + GLTFLoader with true 3D flight & hinged 3D wings).
 *
 * Renders the 3D butterfly GLB models in full 3D perspective space:
 *  1. butterfly_poly      - Poly by Google Butterfly (Monarch)
 *  2. butterfly_hugo      - Hugo Gibson Butterfly (Purple/Azure/Orange)
 *  3. butterfly_sirkitree - Sirkitree Butterfly (Blue Swallowtail)
 *
 * 3D Model Credits & Attribution:
 *  - Butterfly (https://poly.pizza/m/2ZwYwkTVnfG) by Poly by Google (https://poly.pizza/u/Poly%20by%20Google) [CC-BY (https://creativecommons.org/licenses/by/3.0/)] via Poly Pizza
 *  - butterfly (https://poly.pizza/m/0Wt0Mc31Qsj) by Hugo Gibson (https://poly.pizza/u/Hugo%20Gibson) [CC-BY (https://creativecommons.org/licenses/by/3.0/)] via Poly Pizza
 *  - Butterfly (https://poly.pizza/m/fv6J8XW4hvC) by sirkitree (https://poly.pizza/u/sirkitree) [CC-BY (https://creativecommons.org/licenses/by/3.0/)] via Poly Pizza
 *
 * Randomized behavioral personalities ("not all follow finger"):
 *  - 'curious': gently follows and playfully orbits in 3D loops near the user's finger/hand
 *  - 'wanderer': ignores finger completely, gliding and fluttering freely across the meadow
 *  - 'shy': darts away in 3D space if the finger gets too close
 *  - 'hoverer': hovers over blooms with rapid 3D wingbeats, darting between spots
 */

export const SPECIES_CATALOG = {
  butterfly_poly: {
    id: 'butterfly_poly',
    name: 'Monarch Butterfly',
    file: './models/butterfly_poly.glb',
    baseSize: 44,
    wingSpeed: 9.5,
    flapType: 'hinge_wings',
    hingeX: 0.045,
    hingeY: -0.14,
    flapCenter: -0.28,
    flapAmp: 0.78,
    wingTwist: 0.25,
    basePitch: 0.62,
    color: '#F2994A',
    secondaryColor: '#2D3748',
    type: 'butterfly'
  },
  butterfly_hugo: {
    id: 'butterfly_hugo',
    name: 'Emperor Butterfly',
    file: './models/butterfly_hugo.glb',
    baseSize: 42,
    wingSpeed: 10.5,
    flapType: 'hinge_wings',
    hingeX: 0.05,
    hingeY: -0.02,
    flapCenter: 0.12,
    flapAmp: 0.82,
    wingTwist: 0.28,
    basePitch: 0.62,
    color: '#8E44AD',
    secondaryColor: '#00BCD4',
    type: 'butterfly'
  },
  butterfly_sirkitree: {
    id: 'butterfly_sirkitree',
    name: 'Blue Swallowtail',
    file: './models/butterfly_sirkitree.glb',
    baseSize: 46,
    wingSpeed: 9.0,
    flapType: 'hinge_wings',
    permuteAxes: 'zxy', // maps raw (x,y,z) -> (z,x,y) so X=wingspan, +Y=dorsal up, +Z=head forward
    hingeX: 0.035,
    hingeY: -0.02,
    flapCenter: 0.10,
    flapAmp: 0.80,
    wingTwist: 0.24,
    basePitch: 0.62,
    color: '#00A8E8',
    secondaryColor: '#1B263B',
    type: 'butterfly'
  }
};

const PERSONALITIES = ['curious', 'wanderer', 'shy', 'hoverer'];

function decodeBase64ToArrayBuffer(b64) {
  if (typeof atob === 'function') {
    const bin = atob(b64);
    const len = bin.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = bin.charCodeAt(i);
    }
    return bytes.buffer;
  }
  if (typeof Buffer !== 'undefined') {
    const buf = Buffer.from(b64, 'base64');
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  }
  return null;
}

export class CreatureRenderer {
  constructor(THREE, width, height) {
    this.THREE = THREE;
    this.width = width || 1280;
    this.height = height || 720;
    this.creatures = [];
    this.modelBuffers = new Map();
    this.normalizedTemplates = new Map();
    this.isThreeReady = false;
    this.activeScene = 'meadow';

    if (THREE && typeof THREE.Scene === 'function') {
      try {
        this.initThree();
      } catch (err) {
        console.warn('3D CreatureRenderer: WebGL init failed, using 2D fallback.', err);
      }
    }

    this.initCreaturePool();

    if (this.isThreeReady) {
      this.loadAssets();
    }
  }

  initThree() {
    const T = this.THREE;
    this.scene = new T.Scene();

    // True 3D PerspectiveCamera configured so the z = 0 plane maps 1:1 to (0..width, 0..height)
    // in standard right-handed coordinates (+X right, +Y up, +Z toward viewer).
    this.fov = 38;
    this.camera = new T.PerspectiveCamera(this.fov, this.width / Math.max(1, this.height), 10, 5000);
    this.updateCameraFrustum();

    this.renderer = new T.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1, 2));
    this.renderer.setSize(this.width, this.height, false);
    if (T.sRGBEncoding !== undefined) {
      this.renderer.outputEncoding = T.sRGBEncoding;
    }

    // Sculptural 3D lighting: low ambient + sky/meadow hemisphere + strong directional key & rim lights
    const ambient = new T.AmbientLight(0xfff8f0, 0.34);
    this.scene.add(ambient);

    const hemi = new T.HemisphereLight(0xeaf6ff, 0x3a5f38, 0.42);
    hemi.position.set(0, 1, 0);
    this.scene.add(hemi);

    const sunKey = new T.DirectionalLight(0xfff1d6, 0.98);
    sunKey.position.set(420, 680, 750);
    this.scene.add(sunKey);

    const rimLight = new T.DirectionalLight(0xd4f0ff, 0.48);
    rimLight.position.set(-480, -320, -420);
    this.scene.add(rimLight);

    const fillLight = new T.DirectionalLight(0xffe4b8, 0.32);
    fillLight.position.set(-300, 200, 600);
    this.scene.add(fillLight);

    this.isThreeReady = true;

    this.renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.isThreeReady = false;
    });
    this.renderer.domElement.addEventListener('webglcontextrestored', () => {
      this.isThreeReady = true;
    });
  }

  updateCameraFrustum() {
    if (!this.camera) return;
    const w = Math.max(1, this.width);
    const h = Math.max(1, this.height);
    const halfFovRad = (this.fov * 0.5 * Math.PI) / 180;
    this.camDist = (h * 0.5) / Math.tan(halfFovRad);
    this.camera.aspect = w / h;
    this.camera.position.set(w * 0.5, h * 0.5, this.camDist);
    this.camera.lookAt(w * 0.5, h * 0.5, 0);
    this.camera.updateProjectionMatrix();
  }

  getLoader() {
    if (!this.THREE) return null;
    const LoaderClass =
      this.THREE.GLTFLoader ||
      (typeof window !== 'undefined' && window.THREE && window.THREE.GLTFLoader);
    return LoaderClass ? new LoaderClass() : null;
  }

  loadAssets() {
    const loader = this.getLoader();
    if (!loader) return;

    const bundled = typeof window !== 'undefined' ? window.CREATURE_GLB_BASE64 : null;
    const speciesKeys = Object.keys(SPECIES_CATALOG);

    speciesKeys.forEach((key) => {
      const cfg = SPECIES_CATALOG[key];
      if (bundled && bundled[key]) {
        const buffer = decodeBase64ToArrayBuffer(bundled[key]);
        if (buffer) {
          this.modelBuffers.set(key, buffer);
          this.parseAndRegisterSpecies(key, buffer, loader);
          return;
        }
      }

      // Fallback network load if bundle is not present
      if (typeof fetch === 'function') {
        fetch(cfg.file)
          .then((res) => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.arrayBuffer();
          })
          .then((buffer) => {
            this.modelBuffers.set(key, buffer);
            this.parseAndRegisterSpecies(key, buffer, loader);
          })
          .catch((err) => {
            console.warn(`Could not fetch GLB asset ${cfg.file}:`, err);
          });
      }
    });
  }

  parseAndRegisterSpecies(key, buffer, loader) {
    const cfg = SPECIES_CATALOG[key];
    if (cfg.flapType === 'armature') {
      // SkinnedMesh species (like bee.glb) are parsed fresh per creature instance
      // so each instance has its own bound THREE.Skeleton and AnimationMixer.
      this.creatures.forEach((c) => {
        if (c.species === key && !c.threeGroup) {
          this.attachThreeObject(c);
        }
      });
      return;
    }

    loader.parse(
      buffer,
      '',
      (gltf) => {
        const template = this.buildNormalizedTemplate(key, gltf.scene);
        this.normalizedTemplates.set(key, template);
        this.creatures.forEach((c) => {
          if (c.species === key && !c.threeGroup) {
            this.attachThreeObject(c);
          }
        });
      },
      (err) => {
        console.warn(`Failed to parse GLB for ${key}:`, err);
      }
    );
  }

  enhanceMaterial(mat, speciesKey) {
    if (!mat) return;
    const T = this.THREE;
    mat.side = T.DoubleSide;
    if ('roughness' in mat) {
      mat.roughness = 0.36;
      mat.metalness = 0.06;
    }
    if (speciesKey === 'bee') {
      if (mat.name === 'Armabee_Secondary') {
        mat.color?.setHex(0xffbe24);
        mat.emissive?.setHex(0x281800);
      } else if (mat.name === 'Armabee_Main' || mat.name === 'Eye_Black') {
        mat.color?.setHex(0x221a16);
      } else if (mat.name === 'Eye_White') {
        mat.color?.setHex(0xf7fbff);
      } else if (mat.name === 'Wings') {
        mat.color?.setHex(0xe8f7ff);
        mat.transparent = true;
        mat.opacity = 0.72;
      }
    }
    mat.needsUpdate = true;
  }

  buildNormalizedTemplate(key, modelScene) {
    const T = this.THREE;
    const cfg = SPECIES_CATALOG[key];

    modelScene.updateMatrixWorld(true);

    // Collect all meshes and bake their world transforms into clean local geometries
    const meshes = [];
    modelScene.traverse((child) => {
      if (child.isMesh && child.geometry) {
        meshes.push(child);
      }
    });

    const clonedMeshes = meshes.map((m) => {
      const geom = m.geometry.clone();
      geom.applyMatrix4(m.matrixWorld);

      // If species needs axis permutation (e.g. butterfly_sirkitree: raw (x,y,z) -> (z,x,y))
      if (cfg.permuteAxes === 'zxy') {
        const pos = geom.attributes.position;
        if (pos) {
          const arr = pos.array;
          for (let i = 0; i < arr.length; i += 3) {
            const ox = arr[i];
            const oy = arr[i + 1];
            const oz = arr[i + 2];
            arr[i] = oz;
            arr[i + 1] = ox;
            arr[i + 2] = oy;
          }
          pos.needsUpdate = true;
        }
        const norm = geom.attributes.normal;
        if (norm) {
          const narr = norm.array;
          for (let i = 0; i < narr.length; i += 3) {
            const nx = narr[i];
            const ny = narr[i + 1];
            const nz = narr[i + 2];
            narr[i] = nz;
            narr[i + 1] = nx;
            narr[i + 2] = ny;
          }
          norm.needsUpdate = true;
        }
      }

      geom.computeBoundingBox();
      return {
        name: m.name || m.parent?.name || '',
        geometry: geom,
        material: Array.isArray(m.material)
          ? m.material.map((mt) => {
              const cm = mt.clone();
              this.enhanceMaterial(cm, key);
              return cm;
            })
          : (() => {
              const cm = m.material.clone();
              this.enhanceMaterial(cm, key);
              return cm;
            })()
      };
    });

    // Compute combined bounding box across all meshes
    const totalBox = new T.Box3();
    clonedMeshes.forEach((cm) => {
      if (cm.geometry.boundingBox) {
        totalBox.union(cm.geometry.boundingBox);
      }
    });

    const size = totalBox.getSize(new T.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
    const center = totalBox.getCenter(new T.Vector3());
    const invScale = 1 / maxDim;

    // Normalize all vertices so the model is centered at (0, 0, 0) with unit span 1.0
    clonedMeshes.forEach((cm) => {
      const pos = cm.geometry.attributes.position;
      if (pos) {
        const arr = pos.array;
        for (let i = 0; i < arr.length; i += 3) {
          arr[i] = (arr[i] - center.x) * invScale;
          arr[i + 1] = (arr[i + 1] - center.y) * invScale;
          arr[i + 2] = (arr[i + 2] - center.z) * invScale;
        }
        pos.needsUpdate = true;
      }
      if (!cm.geometry.attributes.normal) {
        cm.geometry.computeVertexNormals();
      }
      cm.geometry.computeBoundingBox();
      cm.geometry.computeBoundingSphere();
    });

    return clonedMeshes;
  }

  attachThreeObject(c) {
    if (!this.isThreeReady) return;
    const T = this.THREE;
    const cfg = c.cfg;

    if (cfg.flapType === 'armature') {
      // Parse fresh SkinnedMesh instance for bee so skeleton and AnimationMixer work cleanly
      const buffer = this.modelBuffers.get(c.species);
      const loader = this.getLoader();
      if (!buffer || !loader || c.loadingThree) return;
      c.loadingThree = true;

      loader.parse(
        buffer,
        '',
        (gltf) => {
          c.loadingThree = false;
          const modelScene = gltf.scene;
          modelScene.updateMatrixWorld(true);

          const box = new T.Box3().setFromObject(modelScene);
          const size = box.getSize(new T.Vector3());
          const maxDim = Math.max(size.x, size.y, size.z) || 1.0;
          const center = box.getCenter(new T.Vector3());

          modelScene.traverse((child) => {
            if (child.isMesh) {
              child.frustumCulled = false;
              if (Array.isArray(child.material)) {
                child.material.forEach((m) => this.enhanceMaterial(m, c.species));
              } else {
                this.enhanceMaterial(child.material, c.species);
              }
            }
          });

          const normGroup = new T.Group();
          modelScene.position.set(-center.x / maxDim, -center.y / maxDim, -center.z / maxDim);
          modelScene.scale.setScalar(1 / maxDim);
          normGroup.add(modelScene);

          const outerGroup = new T.Group();
          outerGroup.rotation.order = 'YXZ';
          outerGroup.add(normGroup);

          if (gltf.animations && gltf.animations.length > 0) {
            const mixer = new T.AnimationMixer(modelScene);
            const clip =
              gltf.animations.find((a) => a.name.includes('Fast_Flying')) ||
              gltf.animations.find((a) => a.name.includes('Flying')) ||
              gltf.animations[0];
            if (clip) {
              const action = mixer.clipAction(clip);
              action.play();
              c.mixer = mixer;
            }
          }

          c.threeGroup = outerGroup;
          this.scene.add(outerGroup);
        },
        () => {
          c.loadingThree = false;
        }
      );
      return;
    }

    const templateMeshes = this.normalizedTemplates.get(c.species);
    if (!templateMeshes) return;

    const group = new T.Group();
    group.rotation.order = 'YXZ';
    const deformableMeshes = [];

    templateMeshes.forEach((tm) => {
      const geom = tm.geometry.clone();
      const posAttr = geom.attributes.position;
      const normAttr = geom.attributes.normal;
      const origPos = posAttr ? new Float32Array(posAttr.array) : null;
      const origNorm = normAttr ? new Float32Array(normAttr.array) : null;

      const mesh = new T.Mesh(geom, tm.material);
      mesh.name = tm.name;
      mesh.frustumCulled = false;
      group.add(mesh);

      const isWingMesh = !cfg.wingMeshOnly || /wing/i.test(tm.name);
      if (isWingMesh && origPos) {
        deformableMeshes.push({ geom, posAttr, normAttr, origPos, origNorm });
      }
    });

    c.threeGroup = group;
    c.deformableMeshes = deformableMeshes;
    this.scene.add(group);
  }

  deformWings3D(c) {
    if (!c.deformableMeshes || c.deformableMeshes.length === 0) return;
    const cfg = c.cfg;
    const hingeX = cfg.hingeX ?? 0.045;
    const hingeY = cfg.hingeY ?? 0.0;
    const flapCenter = cfg.flapCenter ?? 0.0;
    const flapAmp = cfg.flapAmp ?? 0.78;
    const wingTwist = cfg.wingTwist ?? 0.24;
    const foreAft = cfg.foreAftSweep ? Math.cos(c.wingPhase) * cfg.foreAftSweep : 0;

    // Smooth asymmetric wingstroke (snappy downstroke, graceful upstroke)
    const s = Math.sin(c.wingPhase);
    const cWave = Math.cos(c.wingPhase);
    const baseAngle = flapCenter + flapAmp * (s + 0.15 * Math.sin(c.wingPhase * 2));

    for (const dm of c.deformableMeshes) {
      const posArr = dm.posAttr.array;
      const origPos = dm.origPos;
      const normArr = dm.normAttr ? dm.normAttr.array : null;
      const origNorm = dm.origNorm;
      const len = origPos.length;

      for (let i = 0; i < len; i += 3) {
        const x0 = origPos[i];
        const y0 = origPos[i + 1];
        const z0 = origPos[i + 2];
        const absX = Math.abs(x0);

        if (absX <= hingeX) {
          posArr[i] = x0;
          posArr[i + 1] = y0;
          posArr[i + 2] = z0;
          if (normArr && origNorm) {
            normArr[i] = origNorm[i];
            normArr[i + 1] = origNorm[i + 1];
            normArr[i + 2] = origNorm[i + 2];
          }
          continue;
        }

        const sign = x0 >= 0 ? 1 : -1;
        const span = absX - hingeX;
        const weight = Math.min(1, span / 0.045);
        // Spanwise twist gives a 3D supple camber wave along the wing
        const theta = weight * (baseAngle - cWave * wingTwist * span);
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);

        const dy = y0 - hingeY;
        const rx = span * cosT - dy * sinT;
        const ry = span * sinT + dy * cosT;

        posArr[i] = sign * (hingeX + rx);
        posArr[i + 1] = hingeY + ry;
        posArr[i + 2] = z0 + foreAft * span;

        if (normArr && origNorm) {
          const nx0 = origNorm[i];
          const ny0 = origNorm[i + 1];
          const nz0 = origNorm[i + 2];
          const signedSin = sign * sinT;
          normArr[i] = nx0 * cosT - ny0 * signedSin;
          normArr[i + 1] = nx0 * signedSin + ny0 * cosT;
          normArr[i + 2] = nz0;
        }
      }

      dm.posAttr.needsUpdate = true;
      if (dm.normAttr) dm.normAttr.needsUpdate = true;
    }
  }

  buildRandomizedRoster() {
    const butterflyPool = ['butterfly_poly', 'butterfly_hugo', 'butterfly_sirkitree'];

    // Randomize butterfly count between 3 and 5 max (no birds or bees)
    const numButterflies = 3 + Math.floor(Math.random() * 3); // 3..5

    const roster = [];
    const offsetB = Math.floor(Math.random() * butterflyPool.length);
    for (let i = 0; i < numButterflies; i++) {
      roster.push(butterflyPool[(offsetB + i) % butterflyPool.length]);
    }
    return roster;
  }

  initCreaturePool() {
    // Clean up any existing Three.js objects before rebuilding
    if (this.creatures && this.creatures.length > 0 && this.scene) {
      for (const old of this.creatures) {
        if (old.threeGroup) {
          this.scene.remove(old.threeGroup);
        }
      }
    }
    this.creatures = [];

    const speciesRoster = this.buildRandomizedRoster();

    // Randomized personalities so NOT all creatures follow the finger:
    // Guarantee a mix of 'curious', 'wanderer', 'shy', and 'hoverer'
    const basePersonalities = ['curious', 'wanderer', 'shy', 'hoverer'];

    speciesRoster.forEach((speciesKey, idx) => {
      const cfg = SPECIES_CATALOG[speciesKey] || SPECIES_CATALOG.butterfly_poly;
      const personality =
        idx < basePersonalities.length
          ? basePersonalities[idx]
          : PERSONALITIES[Math.floor(Math.random() * PERSONALITIES.length)];
      const vx = (idx % 2 === 0 ? 1 : -1) * (42 + Math.random() * 38);
      const vy = (Math.random() - 0.5) * 48;

      const creature = {
        id: idx + 1,
        species: speciesKey,
        personality,
        cfg,
        x: 80 + Math.random() * Math.max(100, this.width - 160),
        y: 80 + Math.random() * Math.max(100, this.height - 160),
        z: (Math.random() - 0.5) * 180,
        vx,
        vy,
        vz: (Math.random() - 0.5) * 35,
        yaw: vx >= 0 ? 0.65 : -0.65,
        pitch: cfg.basePitch || 0.35,
        roll: 0,
        zPhase: Math.random() * Math.PI * 2,
        targetX: Math.random() * this.width,
        targetY: Math.random() * this.height,
        targetTimer: 1 + Math.random() * 3,
        orbitAngle: Math.random() * Math.PI * 2,
        orbitRadius: 55 + Math.random() * 65,
        wingPhase: Math.random() * Math.PI * 2,
        wingSpeed: cfg.wingSpeed * (0.9 + Math.random() * 0.25),
        scale: cfg.baseSize * (0.80 + Math.random() * 0.24),
        threeGroup: null,
        deformableMeshes: null,
        mixer: null
      };

      this.creatures.push(creature);
      this.attachThreeObject(creature);
    });
  }

  onSceneChanged(sceneId) {
    this.activeScene = sceneId;
    this.creatures.forEach((c, i) => {
      c.personality = PERSONALITIES[(i + Math.floor(Math.random() * PERSONALITIES.length)) % PERSONALITIES.length];
      c.targetX = 70 + Math.random() * Math.max(100, this.width - 140);
      c.targetY = 70 + Math.random() * Math.max(100, this.height - 140);
      c.targetTimer = 0.5 + Math.random() * 2;
    });
  }

  randomizeRoster() {
    this.initCreaturePool();
  }

  resize(width, height) {
    const sx = this.width > 0 ? width / this.width : 1;
    const sy = this.height > 0 ? height / this.height : 1;
    this.width = width;
    this.height = height;

    this.creatures.forEach((c) => {
      c.x *= sx;
      c.y *= sy;
      c.targetX *= sx;
      c.targetY *= sy;
    });

    if (this.isThreeReady && this.renderer && this.camera) {
      this.updateCameraFrustum();
      this.renderer.setSize(width, height, false);
    }
  }

  update(dt, playTarget = null) {
    if (dt <= 0) return;
    const w = this.width;
    const h = this.height;

    const targetPx = playTarget
      ? {
          x: playTarget.x <= 1.5 ? playTarget.x * w : playTarget.x,
          y: playTarget.y <= 1.5 ? playTarget.y * h : playTarget.y
        }
      : null;

    for (const c of this.creatures) {
      c.targetTimer -= dt;
      if (c.targetTimer <= 0) {
        c.targetTimer = 2.5 + Math.random() * 4.0;
        c.targetX = 75 + Math.random() * Math.max(100, w - 150);
        c.targetY = 75 + Math.random() * Math.max(100, h - 150);
      }

      switch (c.personality) {
        case 'curious': {
          if (targetPx) {
            const dx = targetPx.x - c.x;
            const dy = targetPx.y - c.y;
            const dist = Math.hypot(dx, dy);

            if (dist > c.orbitRadius + 25) {
              const desiredSpeed = 115;
              c.vx += ((dx / dist) * desiredSpeed - c.vx) * 3.0 * dt;
              c.vy += ((dy / dist) * desiredSpeed - c.vy) * 3.0 * dt;
            } else {
              c.orbitAngle += dt * 2.8;
              const ox = targetPx.x + Math.cos(c.orbitAngle) * c.orbitRadius;
              const oy = targetPx.y + Math.sin(c.orbitAngle) * c.orbitRadius;
              c.vx += ((ox - c.x) * 3.8 - c.vx) * 3.4 * dt;
              c.vy += ((oy - c.y) * 3.8 - c.vy) * 3.4 * dt;
            }
          } else {
            const dx = c.targetX - c.x;
            const dy = c.targetY - c.y;
            const d = Math.hypot(dx, dy) || 1;
            c.vx += ((dx / d) * 68 - c.vx) * 1.6 * dt;
            c.vy += ((dy / d) * 68 - c.vy) * 1.6 * dt;
          }
          break;
        }

        case 'wanderer': {
          const dx = c.targetX - c.x;
          const dy = c.targetY - c.y;
          const d = Math.hypot(dx, dy) || 1;
          const cruiseSpeed = c.cfg.type === 'bird' ? 98 : 72;
          const sineFlutter = Math.sin(c.wingPhase * 0.55) * 24;
          c.vx += ((dx / d) * cruiseSpeed - c.vx) * 1.8 * dt;
          c.vy += ((dy / d) * cruiseSpeed + sineFlutter - c.vy) * 1.8 * dt;
          break;
        }

        case 'shy': {
          if (targetPx) {
            const dx = c.x - targetPx.x;
            const dy = c.y - targetPx.y;
            const dist = Math.hypot(dx, dy);

            if (dist < 150 && dist > 1) {
              const fleeSpeed = 155;
              c.vx += ((dx / dist) * fleeSpeed - c.vx) * 5.0 * dt;
              c.vy += ((dy / dist) * fleeSpeed - c.vy) * 5.0 * dt;
            } else {
              const wdx = c.targetX - c.x;
              const wdy = c.targetY - c.y;
              const wd = Math.hypot(wdx, wdy) || 1;
              c.vx += ((wdx / wd) * 68 - c.vx) * 1.5 * dt;
              c.vy += ((wdy / wd) * 68 - c.vy) * 1.5 * dt;
            }
          } else {
            const dx = c.targetX - c.x;
            const dy = c.targetY - c.y;
            const d = Math.hypot(dx, dy) || 1;
            c.vx += ((dx / d) * 62 - c.vx) * 1.5 * dt;
            c.vy += ((dy / d) * 62 - c.vy) * 1.5 * dt;
          }
          break;
        }

        case 'hoverer': {
          const dx = c.targetX - c.x;
          const dy = c.targetY - c.y;
          const dist = Math.hypot(dx, dy);

          if (dist > 38) {
            const dartSpeed = 135;
            c.vx += ((dx / dist) * dartSpeed - c.vx) * 3.4 * dt;
            c.vy += ((dy / dist) * dartSpeed - c.vy) * 3.4 * dt;
          } else {
            const microX = Math.sin(c.wingPhase * 1.6) * 18;
            const microY = Math.cos(c.wingPhase * 1.3) * 14;
            c.vx += (microX - c.vx) * 4.5 * dt;
            c.vy += (microY - c.vy) * 4.5 * dt;
          }

          if (targetPx) {
            const fdx = c.x - targetPx.x;
            const fdy = c.y - targetPx.y;
            const fdist = Math.hypot(fdx, fdy);
            if (fdist < 75 && fdist > 1) {
              c.vx += (fdx / fdist) * 120 * dt;
              c.vy += (fdy / fdist) * 120 * dt;
            }
          }
          break;
        }
      }

      // 3D Z-depth oscillation (swooping closer to the glass and deeper into the garden)
      c.zPhase += dt * 0.85;
      c.z = Math.sin(c.zPhase) * 130;

      c.x += c.vx * dt;
      c.y += c.vy * dt;

      const margin = 52;
      if (c.x < margin) {
        c.vx += 160 * dt;
        c.x = margin;
      } else if (c.x > w - margin) {
        c.vx -= 160 * dt;
        c.x = w - margin;
      }
      if (c.y < margin) {
        c.vy += 160 * dt;
        c.y = margin;
      } else if (c.y > h - margin) {
        c.vy -= 160 * dt;
        c.y = h - margin;
      }

      c.wingPhase += dt * c.wingSpeed;

      // Update 3D Three.js Object with genuine 3D yaw, pitch, roll, and hinged 3D wing flapping
      if (c.threeGroup) {
        const vy3D = -c.vy; // +Y is UP in 3D space
        const bobY = Math.sin(c.wingPhase) * (c.cfg.type === 'butterfly' ? 5.5 : 2.5);

        c.threeGroup.position.set(c.x, h - c.y + bobY, c.z);

        // 3D Yaw: smoothly rotates around the vertical Y axis to face left/right in a rich 3/4 3D angle
        // (never flipping creatures upside-down!)
        const targetYaw = Math.atan2(c.vx, Math.abs(c.vx) * 0.48 + 26);
        const yawDiff = targetYaw - c.yaw;
        c.yaw += yawDiff * Math.min(1, dt * 6.5);

        // 3D Pitch: tilts toward viewer + climbs/dives with vertical velocity
        const basePitch = c.cfg.basePitch ?? 0.35;
        const climbPitch = Math.max(-0.42, Math.min(0.42, -vy3D * 0.0038));
        const flutterPitch = Math.cos(c.wingPhase) * (c.cfg.type === 'butterfly' ? 0.10 : 0.04);
        const targetPitch = basePitch + climbPitch + flutterPitch;
        c.pitch += (targetPitch - c.pitch) * Math.min(1, dt * 7.0);

        // 3D Banking Roll: banks into turns and weaves gently
        const targetRoll = Math.max(
          -0.52,
          Math.min(0.52, -yawDiff * 1.4 - (c.vx / 130) * 0.16 + Math.sin(c.wingPhase * 0.5) * 0.09)
        );
        c.roll += (targetRoll - c.roll) * Math.min(1, dt * 7.0);

        c.threeGroup.rotation.set(c.pitch, c.yaw, c.roll, 'YXZ');
        c.threeGroup.scale.setScalar(c.scale);

        // Animate 3D wings
        if (c.mixer) {
          c.mixer.update(dt * 1.45);
        } else if (c.deformableMeshes) {
          this.deformWings3D(c);
        }
      }
    }
  }

  render(ctx, dt, playTarget = null) {
    this.update(dt, playTarget);

    let rendered3D = false;
    if (this.isThreeReady && this.renderer && this.scene && this.camera) {
      const has3D = this.creatures.some((c) => c.threeGroup !== null);
      if (has3D) {
        try {
          this.renderer.render(this.scene, this.camera);
          ctx.drawImage(this.renderer.domElement, 0, 0, this.width, this.height);
          rendered3D = true;
        } catch (e) {
          console.warn('3D render error:', e);
          rendered3D = false;
        }
      }
    }

    if (!rendered3D) {
      this.render2DFallback(ctx);
    }
  }

  render2DFallback(ctx) {
    for (const c of this.creatures) {
      ctx.save();
      ctx.translate(c.x, c.y);
      const angle = Math.atan2(c.vy, c.vx);
      ctx.rotate(angle);
      const s = c.scale * 0.25;
      const spread = s * 0.65 * Math.max(0.2, Math.abs(Math.cos(c.wingPhase)));
      ctx.fillStyle = c.cfg.color;
      ctx.beginPath();
      ctx.ellipse(0, -spread * 0.6, s * 0.8, spread * 0.8, 0.2, 0, Math.PI * 2);
      ctx.ellipse(0, spread * 0.6, s * 0.8, spread * 0.8, -0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  dispose() {
    this.scene?.traverse((object) => {
      object.geometry?.dispose();
      if (object.material) {
        if (Array.isArray(object.material)) object.material.forEach((m) => m.dispose());
        else object.material.dispose();
      }
    });
    this.renderer?.dispose();
  }
}
