// The page for an address with nothing behind it (src/pages/404.astro): "404" as flat type, and in front of its
// zero the hero's robot, falling over and getting up again for as long as anyone watches. The motion has two falls
// in it, one forward and one backward. The robot is stood so that the first lands it against the right-hand 4 and
// the second against the left-hand one, and each 4 leans away under it and comes back when the robot is up.
//
// Built as the section titles are (titles.ts): the type is the page's own, measured, and the robot is drawn over it
// on a transparent canvas whose camera has no perspective, so that a meter is a known number of pixels and the
// baseline of the type is the floor. Unlike the titles it is played by the clock, not the scroll: a page that is
// not there has nothing to scroll. Without WebGL, or for visitors who ask for reduced motion, it is just the number.

import { libs, loadModel, calm } from './kit';

const ELEVATION = (15 * Math.PI) / 180; // the camera looks down on the floor by this much
const CAP = 1.0; // meters the digits' height stands for: the robot stands a head taller than they do, as in the hero
const FRONT = 0.5; // meters the robot stands in front of the type
const HEADING = 0.5; // which way it faces to begin with: to the right and a little away, so that it falls along the number
const FADE = 0.6; // seconds over which the end of the motion is blended into its beginning
const GHOST = '#ff8a4d';
const GHOST_OPACITY = [0.5, 0.26, 0.13];
const LEAD = 0.16; // seconds between a digit and each of its ghosts

// When, in the motion, the robot is against each 4, and when it has let go of it again.
const LEANS = {
  right: { down: [1.6, 2.0], up: [4.1, 5.0], most: 20 }, // it dives at the right 4, and lies with its head against it
  left: { down: [7.75, 8.15], up: [9.2, 10.2], most: -17 }, // it sits down backward, and its head finds the left one
};
const ramp = (t: number, [a, b]: number[]) => { const u = Math.min(Math.max((t - a) / (b - a), 0), 1); return u * u * (3 - 2 * u); };

export async function startFallen(stage: HTMLElement) {
  if (calm()) return;
  const canvas = stage.querySelector('canvas'), word = stage.querySelector<HTMLElement>('.word');
  const zero = stage.querySelector<HTMLElement>('.digit.zero');
  if (!canvas || !word || !zero) return;
  const [THREE, , { RoomEnvironment }] = await libs();
  const source = await loadModel('/g1-hero.glb');
  if (!source.userData.trimmed) { // the path each motion traveled is dropped, as in the titles: the robot stays put
    for (const clip of source.animations) clip.tracks = clip.tracks.filter((tr: any) => !tr.name.startsWith('track.'));
    source.userData.trimmed = true;
  }
  const clip = source.animations.find((c: any) => c.name === 'fallAndGetUp');
  if (!clip) throw new Error('motion not found');

  // The look of the hero and the titles: a white shell on white paper, soft shadows on the page.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.7;
  pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc9ccd2, 1.1));
  const key = new THREE.DirectionalLight(0xfff4ea, 1.9);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.radius = 7;
  key.shadow.blurSamples = 16;
  const rim = new THREE.DirectionalLight(0xcfe0ff, 0.9);
  scene.add(key, key.target, rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(60, 30), new THREE.ShadowMaterial({ opacity: 0.17, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.004;
  floor.receiveShadow = true;
  scene.add(floor);

  const shell = new THREE.MeshPhysicalMaterial({ color: 0xf3f3f1, metalness: 0, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x33363b, metalness: 0.2, roughness: 0.45 });
  const visor = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.3, roughness: 0.25 });
  const model = source.scene.clone(true);
  model.traverse((o: any) => {
    if (!o.isMesh) return;
    const kind = o.material?.name ?? '';
    o.material = kind === 'glow' ? visor : kind === 'dark' ? dark : shell;
    o.castShadow = true;
    o.frustumCulled = false;
  });
  const turn = new THREE.Group();
  turn.add(model);
  scene.add(turn);

  // The motion, round and round: two copies of it, so that its end can be blended into its beginning.
  const mixer = new THREE.AnimationMixer(model);
  const takes = [mixer.clipAction(clip), mixer.clipAction(clip.clone())];
  let take = 0;
  takes[0].play();
  let pelvis: import('three').Object3D | undefined;
  model.traverse((o: any) => { if (!pelvis && /pelvis$/i.test(o.name)) pelvis = o; });
  const q = pelvis!.quaternion;
  turn.rotation.y = HEADING - Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));

  // The 4s, and for each the orange ghosts of where it will be next. A digit turns about its outer foot.
  const fours = (['left', 'right'] as const).map(side => {
    const el = stage.querySelector<HTMLElement>(`.digit[data-side="${side}"]`)!;
    el.style.transformOrigin = side === 'right' ? '82% 86%' : '70% 86%'; // under the stem: where a 4 stands
    const ghosts = GHOST_OPACITY.map(opacity => {
      const g = document.createElement('span');
      g.textContent = el.textContent;
      g.setAttribute('aria-hidden', 'true');
      g.className = 'digit-ghost';
      g.style.cssText = `color:${GHOST};opacity:${opacity};transform-origin:${el.style.transformOrigin};visibility:hidden`;
      el.parentElement!.insertBefore(g, el); // into the digit's slot, under the digit
      return g;
    });
    // each has a spring of its own, pulled toward where the motion says it should lean
    return { side, el, ghosts, springs: [el, ...ghosts].map(() => ({ a: 0, v: 0 })) };
  });
  const leanAt = (side: 'left' | 'right', t: number) => {
    const l = LEANS[side], time = ((t % clip.duration) + clip.duration) % clip.duration;
    return l.most * ramp(time, l.down) * (1 - ramp(time, l.up));
  };

  // The camera, fitted to the type: the middle of the zero on its baseline is the floor's origin.
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  const base = document.createElement('i'); // an empty inline box sits on the baseline
  base.style.cssText = 'display:inline-block;width:0;height:0';
  word.append(base);
  const fit = () => {
    const box = canvas.getBoundingClientRect(), W = box.width, H = box.height;
    if (!W || !H) return;
    const em = parseFloat(getComputedStyle(word).fontSize), S = (0.716 * em) / CAP; // Google Sans: cap height is 0.716 em
    const z = zero.getBoundingClientRect();
    const originX = z.left + z.width / 2 - box.left, floorY = base.getBoundingClientRect().bottom - box.top;
    renderer.setSize(W, H, false);
    Object.assign(camera, { left: -W / (2 * S), right: W / (2 * S), top: H / (2 * S), bottom: -H / (2 * S) });
    camera.updateProjectionMatrix();
    const target = new THREE.Vector3((W / 2 - originX) / S, (floorY - H / 2) / (S * Math.cos(ELEVATION)), 0);
    camera.position.copy(target).add(new THREE.Vector3(0, Math.sin(ELEVATION), Math.cos(ELEVATION)).multiplyScalar(100));
    camera.lookAt(target);
    key.position.set(target.x + 3, 12, 6);
    key.target.position.set(target.x, 0, 0);
    const reach = W / (2 * S) + 3;
    Object.assign(key.shadow.camera, { left: -reach, right: reach, top: 8, bottom: -8, near: 0.5, far: 40 });
    key.shadow.camera.updateProjectionMatrix();
    rim.position.set(target.x - 6, 5, -7);
    turn.position.set(0, 0, FRONT);
  };
  fit();

  let visible = true, running = false, last = 0;
  const frame = (dt: number) => {
    mixer.update(dt);
    // a little before the motion ends, start it again underneath and cross over
    const now = takes[take];
    if (now.time >= clip.duration - FADE - 0.02) {
      const next = takes[1 - take];
      next.reset().play();
      now.crossFadeTo(next, FADE, false);
      take = 1 - take;
    }
    const t = takes[take].time; // both 4s stand upright across the join, so nothing jumps when the clock does
    for (const four of fours) {
      four.springs.forEach((s, i) => {
        const want = leanAt(four.side, t + i * LEAD);
        s.v += ((want - s.a) * 190 - s.v * 15) * dt; // a stiff spring, damped enough to rock once and settle
        s.a += s.v * dt;
        const el = i === 0 ? four.el : four.ghosts[i - 1];
        el.style.transform = `rotate(${s.a.toFixed(3)}deg)`;
        if (i > 0) el.style.visibility = Math.abs(s.a - four.springs[0].a) > 0.4 ? 'visible' : 'hidden';
      });
    }
    renderer.render(scene, camera);
  };
  const loop = (time: number) => {
    if (!visible || document.hidden) { running = false; return; }
    frame(Math.min(Math.max((time - last) / 1000, 0), 0.05));
    last = time;
    requestAnimationFrame(loop);
  };
  const wake = () => {
    if (running || !visible || document.hidden) return;
    running = true;
    last = performance.now();
    requestAnimationFrame(loop);
  };
  new IntersectionObserver(entries => { visible = entries.some(e => e.isIntersecting); wake(); }).observe(stage);
  document.addEventListener('visibilitychange', wake);
  new ResizeObserver(() => { fit(); renderer.render(scene, camera); }).observe(canvas);
  document.fonts?.ready.then(() => { fit(); });

  frame(0);
  stage.classList.add('is-live');
  wake();
}
