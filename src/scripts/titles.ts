// The live section titles. The word is the page's own flat type, as the name is in the hero; over it, on a
// transparent canvas, are the robots its section is about, drawn in three.js and played by the scroll.
// Same models and look as the hero (HeroStage.astro): the G1 of /g1-hero.glb with its baked motions, the Go2 of
// /go2.glb (written by figures/publications.py), white shells, soft shadows on the page, and translucent orange
// ghosts for where something will be next.
//
// The stage is measured from the type: the word's baseline is the floor line, its left edge is x = 0, and its
// cap height is a known number of meters, so a robot can stand on a letter or meet one. Positions are written
// with x to the right, y away from the viewer and z up, in meters; at() turns them into three.js's axes.

type V3 = import('three').Vector3;
type Obj = import('three').Object3D;

const libs = () =>
  Promise.all([
    import('three'),
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/environments/RoomEnvironment.js'),
  ]);
let ready: ReturnType<typeof libs> | undefined;
const models = new Map<string, Promise<any>>();

const ease = (u: number) => { u = Math.min(Math.max(u, 0), 1); return u * u * (3 - 2 * u); };
const FRONT = -Math.PI / 2; // a heading that faces the viewer
const ELEVATION = (15 * Math.PI) / 180; // the camera looks down on the floor by this much
const GHOST = '#ff8a4d';
const GHOST_OPACITY = [0.5, 0.26, 0.13];

// The Go2's trot: two poses, half a stride apart, and the blend between them for any distance traveled.
const REST: Record<string, number> = { hip: 0, thigh: 0.8, calf: -1.5 };
const TROT: Record<string, number> = { FL_thigh: 0.55, FL_calf: -1.75, RR_thigh: 0.62, RR_calf: -1.75, FR_thigh: 1.0, FR_calf: -1.45, RL_thigh: 1.0, RL_calf: -1.45 };
const TROT_B: Record<string, number> = { FR_thigh: 0.55, FR_calf: -1.75, RL_thigh: 0.62, RL_calf: -1.75, FL_thigh: 1.0, FL_calf: -1.45, RR_thigh: 1.0, RR_calf: -1.45 };

// ── The type, measured ───────────────────────────────────────────────────────────────────────────────────────────
// Everything here is in pixels of the stage (its canvas, which reaches a little past the heading on each side)
// unless it says meters.
function makeType(el: HTMLElement, frame: HTMLElement, capMeters: number) {
  const word = el.querySelector<HTMLElement>('.word')!;
  const base = document.createElement('i'); // an empty inline box sits on the baseline
  base.style.cssText = 'display:inline-block;width:0;height:0';
  word.append(base);

  const textNodes = () => {
    const out: Text[] = [], walk = document.createTreeWalker(word, NodeFilter.SHOW_TEXT);
    while (walk.nextNode()) if (!(walk.currentNode.parentElement as HTMLElement).dataset.over) out.push(walk.currentNode as Text);
    return out;
  };
  const charRange = (i: number) => {
    for (const node of textNodes()) {
      if (i < node.length) {
        const r = document.createRange();
        r.setStart(node, i);
        r.setEnd(node, i + 1);
        return { node, offset: i, range: r };
      }
      i -= node.length;
    }
    throw new Error('no such letter');
  };
  const type = {
    frame,
    word,
    scale: 1, // pixels per meter
    em: 1,
    left: 0, // of the word
    floor: 0, // the baseline
    width: 0,
    height: 0,
    /** Call when the layout may have changed. */
    measure() {
      const box = frame.getBoundingClientRect();
      type.em = parseFloat(getComputedStyle(word).fontSize);
      type.scale = (0.716 * type.em) / capMeters; // Google Sans: cap height is 0.716 em
      type.left = word.getBoundingClientRect().left - box.left;
      type.floor = base.getBoundingClientRect().bottom - box.top;
      type.width = box.width;
      type.height = box.height;
    },
    /** Left edge of the i-th character. */
    x: (i: number) => charRange(i).range.getBoundingClientRect().left - frame.getBoundingClientRect().left,
    /** Puts the i-th character in an element of its own, so it can be moved or replaced. */
    wrap(i: number) {
      const { node, offset } = charRange(i);
      const rest = node.splitText(offset);
      rest.splitText(1);
      const span = document.createElement('span');
      span.style.display = 'inline-block';
      rest.replaceWith(span);
      span.append(rest);
      return span;
    },
    /** Meters along the word for a stage pixel, and meters up the face of the type for a height in pixels. */
    meters: (px: number) => (px - type.left) / type.scale,
    up: (px: number) => px / (type.scale * Math.cos(ELEVATION)),
    /** The word's width in meters. */
    get w() { return (base.getBoundingClientRect().left - word.getBoundingClientRect().left) / type.scale; },
  };
  type.measure();
  return type;
}
type Type = ReturnType<typeof makeType>;

// A piece of flat type or a flat dot laid over the word: the ghost of a letter, the dot of an i.
const overlay = (type: Type, css: string) => {
  const el = document.createElement('span');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.over = '1';
  el.style.cssText = `position:absolute;left:0;top:0;pointer-events:none;${css}`;
  type.word.append(el);
  return el;
};

// ── The robots ───────────────────────────────────────────────────────────────────────────────────────────────────
async function makeKit(canvas: HTMLCanvasElement) {
  const [THREE, { GLTFLoader }, { RoomEnvironment }] = await (ready ??= libs());
  const load = (url: string) => {
    if (!models.has(url)) models.set(url, new GLTFLoader().loadAsync(url));
    return models.get(url)!;
  };
  const at = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, -y);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap; // with the light's radius: soft-edged, as in the hero
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();

  // Materials: the hero's white shell and dark parts, the arm's black, the ghosts' orange.
  const shell = new THREE.MeshPhysicalMaterial({ color: 0xf3f3f1, metalness: 0, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x33363b, metalness: 0.2, roughness: 0.45 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.3, roughness: 0.25 });
  const gray = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, metalness: 0.3, roughness: 0.36 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc7ccd1, metalness: 0.85, roughness: 0.3 });
  const armBlack = new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.22, clearcoat: 0.7 });
  const band = new THREE.MeshStandardMaterial({ color: 0x80838a, metalness: 0.7, roughness: 0.35 });
  const glow = new THREE.MeshBasicMaterial({ color: 0xff9a4a, toneMapped: false });
  const ghostShape = new THREE.MeshBasicMaterial({ colorWrite: false, transparent: true, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });

  const solid = (root: Obj, pick: (kind: string) => import('three').Material) =>
    root.traverse((o: any) => {
      if (!o.isMesh) return;
      o.material = pick(o.material?.name ?? '');
      o.castShadow = true;
      o.frustumCulled = false;
    });
  // A ghost is drawn as one even layer: its shape goes into the depth buffer first, so crossing limbs do not add up.
  const ghost = (root: Obj, rank: number) => {
    const mat = new THREE.MeshStandardMaterial({ color: GHOST, emissive: GHOST, emissiveIntensity: 0.3, roughness: 0.7, metalness: 0, transparent: true, depthWrite: false, opacity: 0.55 * 0.5 ** rank });
    const meshes: any[] = [];
    root.traverse((o: any) => { if (o.isMesh) meshes.push(o); });
    for (const m of meshes) {
      m.material = mat; m.castShadow = false; m.frustumCulled = false; m.renderOrder = 1;
      const shape = new THREE.Mesh(m.geometry, ghostShape);
      shape.frustumCulled = false;
      m.add(shape);
    }
    const group = new THREE.Group();
    group.renderOrder = 4 - rank; // farthest ahead first
    group.add(root);
    scene.add(group);
  };

  // The floor shows only the shadows that fall on it: on the page, under the robots.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.ShadowMaterial({ opacity: 0.17, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.004;
  floor.receiveShadow = true;
  floor.renderOrder = -2;
  scene.add(floor);

  const box = new THREE.Box3();
  const yawOf = (q: { x: number; y: number; z: number; w: number }) => Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));

  // A G1: one copy of the hero's model, posed at any frame of any of its motions.
  const g1src = load('/g1-hero.glb');
  const g1 = async (ghostRank?: number) => {
    const src = await g1src;
    if (!src.userData.trimmed) { // the path each motion traveled is dropped: the figures are placed by hand
      for (const clip of src.animations) clip.tracks = clip.tracks.filter((tr: any) => !tr.name.startsWith('track.'));
      src.userData.trimmed = true;
    }
    const model = src.scene.clone(true);
    const turn = new THREE.Group();
    turn.add(model);
    if (ghostRank === undefined) { solid(model, kind => (kind === 'glow' ? visor : kind === 'dark' ? dark : shell)); scene.add(turn); }
    else ghost(turn, ghostRank);
    let pelvis: Obj | undefined;
    model.traverse((o: Obj) => { if (!pelvis && /pelvis$/i.test(o.name)) pelvis = o; });
    const mixer = new THREE.AnimationMixer(model);
    const actions = new Map<string, any>(src.animations.map((c: any) => [c.name, mixer.clipAction(c)]));
    let current: any = null;
    return {
      /** Frame `frame` (24 a second) of `clip`, standing at (x, y) on `ground`, heading `facing`. */
      set(clip: string, frame: number, x: number, y: number, facing: number, ground = 0) {
        const action = actions.get(clip);
        if (action !== current) { current?.stop(); action.reset().play(); current = action; }
        action.time = Math.min(Math.max(frame / 24, 0), action.getClip().duration - 1e-3);
        mixer.update(0);
        turn.rotation.y = facing - yawOf(pelvis!.quaternion);
        turn.position.copy(at(x, y, 0));
        turn.updateMatrixWorld(true);
        turn.position.y = ground - box.setFromObject(turn).min.y;
      },
    };
  };

  // A Go2: bodies and joints as exported, posed by setting its joint angles.
  const go2src = load('/go2.glb');
  const go2 = async (ghostRank?: number) => {
    const model = (await go2src).scene.clone(true);
    const root = new THREE.Group();
    root.add(model);
    if (ghostRank === undefined) { solid(model, kind => (kind === 'black' ? dark : kind === 'gray' ? gray : kind === 'metal' ? metal : shell)); scene.add(root); }
    else ghost(root, ghostRank);
    const joints: { node: Obj; axis: V3; name: string }[] = [];
    model.traverse((o: Obj) => {
      if (!o.name.startsWith('joint_')) return;
      const a = o.userData.axis as number[]; // in the model's own z-up axes
      joints.push({ node: o, axis: new THREE.Vector3(a[0], a[2], -a[1]), name: o.name.slice(6) });
    });
    return {
      base: model.getObjectByName('body_base') ?? model,
      /** `dist` meters into its trot, at (x, y), heading `yaw`. */
      set(dist: number, x: number, y: number, yaw: number) {
        const a = 0.5 - 0.5 * Math.cos((2 * Math.PI * dist) / 0.56);
        for (const j of joints) {
          const angle = j.name in TROT ? TROT[j.name] + (TROT_B[j.name] - TROT[j.name]) * a : REST[j.name.split('_')[1]] ?? 0;
          j.node.quaternion.setFromAxisAngle(j.axis, angle);
        }
        root.rotation.y = yaw;
        root.position.copy(at(x, y, 0));
        root.updateMatrixWorld(true);
        root.position.y = -box.setFromObject(root).min.y;
        root.updateMatrixWorld(true);
      },
    };
  };

  const rod = (parent: Obj, material: import('three').Material, p0: V3, p1: V3, r: number) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, p0.distanceTo(p1), 28), material);
    mesh.position.copy(p0).lerp(p1, 0.5);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
    mesh.castShadow = true;
    parent.add(mesh);
  };
  // The arm on the Go2's back, after the Kinova in the paper. Points are in the robot's base frame.
  const arm = (base: Obj) => {
    const link = (p0: V3, p1: V3, r: number, bands = [0.12, 0.88]) => {
      rod(base, armBlack, p0, p1, r);
      for (const t of bands) {
        const c = p0.clone().lerp(p1, t), h = p1.clone().sub(p0).normalize().multiplyScalar(0.016);
        rod(base, band, c.clone().sub(h), c.clone().add(h), r + 0.003);
      }
    };
    const mount = at(-0.03, 0, 0.055), shoulder = at(-0.03, 0, 0.21), elbow = at(-0.13, 0, 0.62), wrist = at(0.24, 0, 0.67), hand = at(0.35, 0, 0.665);
    rod(base, band, mount, at(-0.03, 0, 0.075), 0.055);
    link(at(-0.03, 0, 0.075), shoulder, 0.046, [0.5]);
    link(shoulder, elbow, 0.04);
    link(elbow, wrist, 0.036);
    link(wrist, hand, 0.032, [0.5]);
    for (const [p, r] of [[shoulder, 0.05], [elbow, 0.046], [wrist, 0.04]] as [V3, number][]) {
      const joint = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 14), armBlack);
      joint.position.copy(p);
      joint.castShadow = true;
      base.add(joint);
    }
    rod(base, armBlack, hand, at(0.385, 0, 0.663), 0.036);
    for (const side of [1, -1]) rod(base, band, at(0.385, 0.024 * side, 0.663), at(0.46, 0.034 * side, 0.655), 0.009);
  };
  const ring = () => {
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(0.56, 0.011, 10, 96), glow);
    mesh.rotation.x = Math.PI / 2;
    scene.add(mesh);
    return mesh;
  };

  return { THREE, renderer, scene, at, g1, go2, arm, ring };
}
type Kit = Awaited<ReturnType<typeof makeKit>>;
/** Where a point of the scene is on the stage, in pixels. */
type Project = (p: V3) => { x: number; y: number };
type Scene = { cap: number; build: (k: Kit, type: Type, project: Project) => Promise<(t: number) => void> };

// ── The four scenes ──────────────────────────────────────────────────────────────────────────────────────────────
const SCENES: Record<string, Scene> = {
  // A G1 throws a punch and the last letter goes over. It ends caught mid-fall; its ghosts are the rest of the way.
  skills: {
    cap: 1.15,
    async build(k, type) {
      const s = type.wrap(5);
      const ghosts = GHOST_OPACITY.map(opacity => {
        const g = overlay(type, `color:${GHOST};opacity:${opacity}`);
        g.textContent = 's';
        return g;
      });
      const fighter = await k.g1();
      const fall = (v: number) => 1 - (1 - Math.min(Math.max(v, 0), 1)) ** 2; // hit hard, then coming to rest
      return t => {
        // where the letter sits in the word, and its far corner on the baseline, which it turns about
        s.style.transform = '';
        const word = type.word.getBoundingClientRect(), r = s.getBoundingClientRect();
        const x0 = r.left - word.left, y0 = r.top - word.top;
        const pivot = `${r.width - 0.03 * type.em}px ${type.floor - (r.top - type.frame.getBoundingClientRect().top)}px`;
        const u = (0.2 * (t - 0.3)) / 0.7; // the punch lands at t = 0.3; we see a fifth of the fall
        [s, ...ghosts].forEach((el, i) => {
          const v = u > 0 ? fall(u + 0.2 * i) : 0;
          el.style.visibility = i === 0 || v > fall(u) + 1e-3 ? 'visible' : 'hidden';
          el.style.transformOrigin = pivot;
          el.style.transform = `translate(${(i ? x0 : 0) + 1.8 * v * type.scale}px, ${i ? y0 : 0}px) rotate(${90 * v}deg)`;
        });
        fighter.set('fight', 20 * t, type.meters(x0 + type.left) + 0.22, -0.6, FRONT + 0.2); // where the s stood
      };
    },
  },

  // The arm-carrying quadruped walks up with the dot for the last i and sets it in place. Two more of the team walk
  // past, each in its safety ring.
  publications: {
    cap: 1.0,
    async build(k, type, project) {
      const { THREE, at } = k;
      type.wrap(8).textContent = 'ı'; // the last i loses its dot, which arrives by robot
      const dotCss = (color: string, opacity = 1) => `width:0.146em;height:0.146em;margin:-0.073em 0 0 -0.073em;border-radius:50%;background:${color};opacity:${opacity};z-index:2`;
      const dot = overlay(type, dotCss('currentColor'));
      const ghosts = GHOST_OPACITY.map(o => overlay(type, dotCss(GHOST, o)));
      const carrier = await k.go2();
      k.arm(carrier.base);
      const team = [
        { robot: await k.go2(), ring: k.ring(), y: -1.7, d0: 0.5, speed: 2.0, from: 0.2 },
        { robot: await k.go2(), ring: k.ring(), y: -2.15, d0: 0.6, speed: 2.4, from: 2.4 },
      ];
      const held = new THREE.Vector3();
      return t => {
        const w = type.w, r = (0.073 * type.em) / type.scale;
        const walk = 2.2 * (1 - ease(t / 0.55)); // the carrier comes in from the right, and stops
        carrier.set(walk, w + 0.95 + walk, -0.15, Math.PI - 0.06);
        carrier.base.localToWorld(held.copy(at(0.46 + r, 0, 0.66))); // in the gripper
        const from = project(held);
        const to = { x: type.x(8) + 0.116 * type.em, y: type.floor - 0.6575 * type.em }; // where Google Sans puts the dot
        const stage = type.frame.getBoundingClientRect(), word = type.word.getBoundingClientRect();
        const ox = stage.left - word.left, oy = stage.top - word.top; // overlays are placed in the word's own box
        const flight = (v: number) => {
          const e = ease(v);
          return `translate(${from.x + (to.x - from.x) * e + ox}px, ${from.y + (to.y - from.y) * e - 0.22 * type.scale * Math.sin(Math.PI * e) + oy}px)`;
        };
        const u = (t - 0.6) / 0.4; // then the dot goes over the last letters to its place
        dot.style.transform = flight(u);
        ghosts.forEach((g, i) => {
          const v = u + 0.2 * (i + 1);
          g.style.visibility = u > 0 && ease(v) > ease(u) + 1e-3 ? 'visible' : 'hidden';
          g.style.transform = flight(v);
        });
        for (const m of team) {
          const d = m.d0 + m.speed * t, x = m.from + d;
          m.robot.set(d, x, m.y, 0);
          m.ring.position.copy(at(x + 0.02, m.y, 0.011));
        }
      };
    },
  },

  // The crowd from the project cards, all over the word: dancing on it and in front of it, one falling over and
  // getting up again.
  projects: {
    cap: 1.3,
    async build(k, type) {
      const crowd = await Promise.all(Array.from({ length: 7 }, () => k.g1()));
      return t => {
        const w = type.w, f = 46 * t, em = type.em;
        // on the P and on the t: where their flat tops are, from the typeface's own measurements
        crowd[0].set('dance', 114 + f, type.meters(type.x(0) + 0.22 * em), 0, FRONT + 0.25, type.up(0.716 * em));
        crowd[1].set('dance', 60 + f, type.meters(type.x(6) + 0.169 * em), 0, FRONT - 0.2, type.up(0.654 * em));
        crowd[2].set('fight', 21 * t, 0.14 * w, -2.1, FRONT + 0.5);
        crowd[3].set('dance', 78 + f, 0.4 * w, -2.7, FRONT - 0.2);
        crowd[4].set('fallAndGetUp', 24 + 234 * t, 0.64 * w, -2.1, 0.3); // goes down, and gets up again
        crowd[5].set('dance', 150 + f, 0.86 * w, -2.8, FRONT + 0.15);
        crowd[6].set('fight', 150 + 21 * t, 1.02 * w, -1.9, FRONT - 0.4);
      };
    },
  },

  // Everyone on the move, left to right, each with the ghosts of where it will be next.
  activity: {
    cap: 1.15,
    async build(k, type) {
      const bezier = (p0: number[], c: number[], p1: number[], n = 80) =>
        Array.from({ length: n }, (_, i) => { const u = i / (n - 1); return [(1 - u) ** 2 * p0[0] + 2 * (1 - u) * u * c[0] + u * u * p1[0], (1 - u) ** 2 * p0[1] + 2 * (1 - u) * u * c[1] + u * u * p1[1]]; });
      const along = (path: number[][], dist: number) => {
        let i = 0, seg = 0;
        for (; i < path.length - 1; i++) {
          seg = Math.hypot(path[i + 1][0] - path[i][0], path[i + 1][1] - path[i][1]);
          if (dist <= seg || i === path.length - 2) break;
          dist -= seg;
        }
        const u = Math.min(dist / seg, 1), a = path[i], b = path[i + 1];
        return { x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u, yaw: Math.atan2(b[1] - a[1], b[0] - a[0]) };
      };
      const runners = [await k.g1(), await k.g1(0), await k.g1(1), await k.g1(2)];
      const packs = await Promise.all(
        [{ y: [-3.1, -2.4, -3.0], d0: 0.4, pace: 0.62 }, { y: [-1.7, -2.0, -1.5], d0: 1.9, pace: 0.55 }]
          .map(async p => ({ ...p, robots: [await k.go2(), await k.go2(0), await k.go2(1), await k.go2(2)] })),
      );
      return t => {
        const w = type.w;
        runners.forEach((r, i) => r.set('run', (96 + 46 * t + 6 * i) % 280, -1.6 + (w + 2.5) * t + 0.6 * i, -2.3, 0));
        for (const p of packs) {
          const path = bezier([-1.5, p.y[0]], [w / 2, p.y[1]], [w + 5, p.y[2]]);
          p.robots.forEach((robot, i) => {
            const d = p.d0 + p.pace * w * t + 0.97 * i, q = along(path, d);
            robot.set(d, q.x, q.y, q.yaw);
          });
        }
      };
    },
  },
};

// ── Stage: lights, a camera fitted to the type, and the scroll ──────────────────────────────────────────────────
async function mount(el: HTMLElement) {
  const def = SCENES[el.dataset.title!], canvas = el.querySelector('canvas')!;
  const k = await makeKit(canvas);
  const { THREE, renderer, scene } = k;
  const type = makeType(el, canvas, def.cap);

  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9ccd2, 1.1));
  const key = new THREE.DirectionalLight(0xfff4ea, 1.9); // from the front right, casting the shadows
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 16;
  const rim = new THREE.DirectionalLight(0xcfe0ff, 0.9);
  scene.add(key, key.target, rim);

  // The camera has no perspective: it looks straight at the type from a little above, and is set so that the word's
  // left end on its baseline is the floor's origin and a meter is type.scale pixels. Flat type and the scene then
  // share one ruler, wherever on the stage they are.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  const v = new THREE.Vector3();
  const fit = () => {
    type.measure();
    const { width: W, height: H, scale: S } = type;
    if (!W || !H) return;
    renderer.setSize(W, H, false);
    Object.assign(camera, { left: -W / (2 * S), right: W / (2 * S), top: H / (2 * S), bottom: -H / (2 * S) });
    camera.updateProjectionMatrix();
    const target = new THREE.Vector3((W / 2 - type.left) / S, (type.floor - H / 2) / (S * Math.cos(ELEVATION)), 0);
    camera.position.copy(target).add(new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION)).multiplyScalar(100));
    camera.lookAt(target);
    camera.updateMatrixWorld(true);
    const reach = W / (2 * S) + 3;
    key.position.set(target.x + 3, 12, 6);
    key.target.position.set(target.x, 0, 0);
    Object.assign(key.shadow.camera, { left: -reach, right: reach, top: 8, bottom: -8, near: 0.5, far: 40 });
    key.shadow.camera.updateProjectionMatrix();
    rim.position.set(target.x - 6, 5, -7);
  };
  const project: Project = p => {
    v.copy(p).project(camera);
    return { x: ((v.x + 1) / 2) * type.width, y: ((1 - v.y) / 2) * type.height };
  };
  fit();

  el.querySelector('h2')!.setAttribute('aria-label', type.word.textContent ?? ''); // the scenes move its letters about
  const play = await def.build(k, type, project);

  // The scroll sets where the film should be; what is shown eases after it, so wheel steps come out as motion.
  const goal = () => {
    const r = el.getBoundingClientRect(), vh = window.innerHeight;
    return Math.min(Math.max((vh * 0.92 - r.top) / (vh * 0.6), 0), 1);
  };
  let shown = goal(), last = 0, running = false;
  const draw = () => { play(shown); renderer.render(scene, camera); };
  const step = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const to = goal();
    shown += (to - shown) * (1 - Math.exp(-9 * dt));
    if (Math.abs(to - shown) < 5e-4) shown = to;
    draw();
    if (shown !== to) requestAnimationFrame(step);
    else running = false;
  };
  const wake = () => {
    if (running) return;
    const r = el.getBoundingClientRect();
    if (r.bottom < -200 || r.top > window.innerHeight + 200) { shown = goal(); return; } // off screen: nothing to draw
    running = true;
    last = performance.now();
    requestAnimationFrame(step);
  };
  window.addEventListener('scroll', wake, { passive: true });
  new ResizeObserver(() => { fit(); draw(); }).observe(canvas);
  new ResizeObserver(wake).observe(document.body); // the page growing above the title moves it without a scroll event
  document.fonts?.ready.then(() => { fit(); draw(); });

  draw();
  el.classList.add('is-live');
}

/** Starts every title stage on the page when it comes near the screen. A stage that cannot start is just its word. */
export function startTitles() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const watch = new IntersectionObserver(
    entries => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        watch.unobserve(e.target);
        mount(e.target as HTMLElement).catch(err => console.warn('Title stage unavailable:', err));
      }
    },
    { rootMargin: '700px 0px' },
  );
  document.querySelectorAll<HTMLElement>('.title-stage[data-title]').forEach(el => watch.observe(el));
}
