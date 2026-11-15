// The career walk on the resume page: a timeline laid on the floor, and a Unitree G1 that runs along it.
// The line is drawn as the site draws every path a robot is to follow: amber dots, with a small amber ring where
// one role ends and the next begins, and a year under each ring. It has one stretch per role, oldest on the left;
// on a wide page each stretch lies directly over its role's card. The runner goes where the visitor points: move
// the pointer anywhere over the timeline or the cards (or drag a finger along the timeline) and it runs to stay
// under it; the card of the stretch pointed at is marked at once. The dots behind the runner are gray: the time
// already covered. Until the visitor takes over, it runs the timeline once, from the start to the present.
// The second stretch was quadruped research: two Go2s (go2.ts) stand behind it, one to each side of its middle,
// each in its amber safety ring as in the team-of-robots papers, one carrying the arm of the loco-manipulation
// paper. They stay where they are and turn to watch the runner go by; the arm is folded over its Go2's back until
// the runner comes near, reaches out for it as it passes, and folds away again.
// The G1 is the hero's model (/g1-hero.glb). It walks as a walking machine does (g1.ts): its feet are planted where
// it puts them and its legs are worked out from them, so it stands, shifts its weight, steps round to face the way
// it is going, walks, and steps round again to face the viewer when it has arrived, without a stride ever being
// played back. Over a long way it breaks into a jog, which is a stride of the model's baked run, closed into a loop.
// No model of a Foundation robot is shown.
// Without WebGL, or for visitors who ask for reduced motion, the figure is the drawn timeline in the markup.

import { libs, loadModel, liveStage, calm, clamp, ease, wrapAngle, type Live } from './kit';
import { makeStudio } from './go2';
import { bindG1, type Body } from './g1';

const ELEVATION = 26; // degrees the camera looks down by
const FACE = -Math.PI / 2; // a heading that faces the viewer
// The jog: one stride of the baked run (25 frames a second), which covers ground at 1.51 m/s when played as recorded.
const JOG = { from: 114, to: 134, speed: 1.51 };
const FPS = 25;
// How fast it goes is set by how far it has to go: FOLLOW m/s for each meter, a run at most, and never a crawl.
const FOLLOW = 1.15, TOP_SPEED = 2.2, TOUR_SPEED = 1.7, SLOWEST = 0.5, ACCEL = 3.2; // 1/s, m/s, m/s, m/s, m/s²
// It walks up to JOG_ABOVE and jogs beyond it, and once jogging keeps on down to WALK_BELOW. It only goes faster
// than a sidestep once it has turned to face the way it is going, and at a walk until it squarely does.
const JOG_ABOVE = 1.15, WALK_BELOW = 0.9, WALK_TOP = 1.1, SIDESTEP = 0.2; // m/s
// It turns to face the way it is going when that is further than TURN_FOR, and back to the viewer once it is within
// FACE_AT of where it was sent. A quarter turn takes about half a second: as fast as feet can step round.
const TURN_FOR = 0.3, FACE_AT = 0.1, TURN_RATE = 1.9, TURN_ACCEL = 14; // m, m, quarter turns a second, and a second²
const HANDOVER = 0.3; // seconds over which the walk gives way to the jog, or the jog to the walk
const HEAD = 1.6; // room kept over the runner's feet for its head, bounce included, meters
const SHORTEST = 3.3; // the line is never fewer meters long than this, however narrow the page
const LABELS = 34; // pixels kept under the line for the years
const RING = 0.4; // radius of a Go2's safety ring, meters

// The Go2s: both behind the second stretch, one to each side of its middle, the same distance behind the line.
// One carries the arm.
const COMPANY = [{ side: -1, arm: false }, { side: 1, arm: true }];
const LAB = 1, BACK = 1.05; // the stretch they stand behind, and how far behind it, meters
// The arm: where its shoulder is on the Go2's back (forward and up, in the robot's base frame), and its two links.
const ARM = { x: -0.03, z: 0.21, upper: 0.42, fore: 0.59 };

export function startCareer(root: HTMLElement) {
  if (calm()) return;
  const host = root.querySelector<HTMLElement>('[data-career-stage]');
  const years = Array.from(root.querySelectorAll<HTMLElement>('[data-career-year]'));
  const cards = [0, 1, 2].map(i => root.querySelector<HTMLElement>(`[data-stop="${i}"]`));
  if (!host || cards.some(c => !c) || years.length < 4) return;

  // Where the visitor points: a place on the page (the runner goes under it) or a whole stretch (its middle).
  // Nothing yet means the tour.
  let aim: { x: number } | { stop: number } | null = null;
  let seen = false;
  const inRow = () => { // the cards side by side, under the line
    const a = cards[0]!.getBoundingClientRect(), c = cards[2]!.getBoundingClientRect();
    return Math.abs(a.top - c.top) < 4 && a.left < c.left;
  };
  const point = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' && e.type === 'pointermove' && !(e.target as Element).closest('[data-career-stage]')) return; // a finger scrolling past the cards
    const card = (e.target as Element).closest<HTMLElement>('[data-stop]');
    aim = card && !inRow() ? { stop: Number(card.dataset.stop) } : { x: e.clientX };
  };
  root.addEventListener('pointermove', point);
  root.addEventListener('pointerdown', point);
  cards.forEach((c, i) => c!.addEventListener('focusin', e => { if ((e.target as Element).matches(':focus-visible')) aim = { stop: i }; }));
  new IntersectionObserver((list, io) => {
    if (list.some(e => e.isIntersecting)) { seen = true; io.disconnect(); }
  }, { threshold: 0.5 }).observe(host);

  let marked = -1;
  const mark = (stop: number) => {
    if (stop === marked) return;
    marked = stop;
    cards.forEach((c, i) => c!.classList.toggle('is-here', i === stop));
    years.forEach((y, i) => y.classList.toggle('is-here', i === stop || i === stop + 1));
  };

  const build = async (canvas: HTMLCanvasElement): Promise<Live> => {
    const studio = await makeStudio(canvas, ELEVATION);
    const { THREE, scene, at, sinE, cosE } = studio;
    const [, , { RoomEnvironment }] = await libs();
    const css = getComputedStyle(root);
    const amber = new THREE.Color(0xff9a4a);
    const ink = new THREE.Color(css.getPropertyValue('--ink').trim() || '#1f1f1f');
    const rail = new THREE.Color(css.getPropertyValue('--line-strong').trim() || '#c4c9d0');
    const own = <G extends import('three').BufferGeometry>(g: G) => { g.userData.own = true; return g; };
    const flat = (color: import('three').Color) => new THREE.MeshBasicMaterial({ color, toneMapped: false });

    // The line: dots, as the paths in the figures and the safety lab are drawn, and a small ring at each end of
    // each stretch. All flat on the floor.
    const DOT_GAP = 0.15, DOTS = 400, MARK = 0.075;
    const dots = new THREE.InstancedMesh(own(new THREE.CircleGeometry(0.02, 14).rotateX(-Math.PI / 2)), flat(new THREE.Color(1, 1, 1)), DOTS);
    dots.frustumCulled = false;
    scene.add(dots);
    const markShape = own(new THREE.RingGeometry(MARK - 0.02, MARK, 40).rotateX(-Math.PI / 2));
    const marks = [0, 1, 2, 3].map(() => { const mesh = new THREE.Mesh(markShape, flat(amber)); scene.add(mesh); return mesh; });
    const m4 = new THREE.Matrix4(), v3 = new THREE.Vector3(), q0 = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);

    // ── The runner: the hero's G1, in the hero's materials ──
    const pmrem = new THREE.PMREMGenerator(studio.renderer);
    const room = pmrem.fromScene(new RoomEnvironment(), 0.04);
    pmrem.dispose();
    const shell = new THREE.MeshPhysicalMaterial({ color: 0xf3f3f1, metalness: 0, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.3 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x33363b, metalness: 0.2, roughness: 0.45 });
    const visor = new THREE.MeshStandardMaterial({ color: 0x1b1d20, metalness: 0.3, roughness: 0.25 });
    for (const material of [shell, dark, visor]) { material.envMap = room.texture; material.envMapIntensity = 0.7; }

    const source = await loadModel('/g1-hero.glb');
    const model = source.scene.clone(true) as import('three').Object3D;
    model.traverse((o: any) => {
      if (!o.isMesh) return;
      const kind = o.material?.name ?? '';
      o.material = kind === 'glow' ? visor : kind === 'dark' ? dark : shell;
      o.castShadow = true;
      o.frustumCulled = false; // bounds are those of the quantized mesh, not of its animated pose
    });
    scene.add(model); // the model's own axes are the floor's: x along the line, y away from the viewer, z up

    // Its skeleton, the walker that moves it, and the jog: one stride of the baked run.
    const g1 = bindG1(THREE, model);
    const baked = source.animations.find((c: any) => c.name === 'run');
    if (!baked) throw new Error('run motion not found');
    const jog = g1.stride(baked, JOG.from, JOG.to), jogTime = (JOG.to - JOG.from) / FPS;
    const gait = g1.walker();
    // What is drawn is `shown`: the pose of whichever of the two is in charge, plus what is left of the difference
    // there was when it took over (`carry`), which fades away over HANDOVER. So a handover is never a jump.
    const shown = g1.newPose(), made = g1.newPose(), carry = g1.newPose();
    const up = new THREE.Vector3(0, 0, 1), spin = new THREE.Quaternion(), none = new THREE.Quaternion();

    // ── The two that watch ──
    const armBlack = new THREE.MeshPhysicalMaterial({ color: 0x0c0c0e, roughness: 0.22, clearcoat: 0.7 });
    const band = new THREE.MeshStandardMaterial({ color: 0x80838a, metalness: 0.7, roughness: 0.35 });
    for (const material of [armBlack, band]) { material.envMap = room.texture; material.envMapIntensity = 0.7; }
    // The arm on a Go2's back, after the Kinova in the paper and in the look of the one in the Publications title
    // on the home page (titles.ts), but jointed: a turret on the back, a shoulder and an elbow. Each link is built
    // along its own +y, so a joint's angle is a turn about its z. `reach` points the hand at a place in the world.
    const arm = (base: import('three').Object3D) => {
      type V = import('three').Vector3;
      const up = (y: number, z = 0) => new THREE.Vector3(0, y, z);
      const rod = (parent: import('three').Object3D, material: import('three').Material, p0: V, p1: V, r: number) => {
        const mesh = new THREE.Mesh(own(new THREE.CylinderGeometry(r, r, p0.distanceTo(p1), 28)), material);
        mesh.position.copy(p0).lerp(p1, 0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), p1.clone().sub(p0).normalize());
        mesh.castShadow = true;
        parent.add(mesh);
      };
      const link = (parent: import('three').Object3D, y0: number, y1: number, r: number, bands: number[]) => {
        rod(parent, armBlack, up(y0), up(y1), r);
        for (const t of bands) { const y = y0 + (y1 - y0) * t; rod(parent, band, up(y - 0.016), up(y + 0.016), r + 0.003); }
      };
      const ball = (parent: import('three').Object3D, y: number, r: number) => {
        const mesh = new THREE.Mesh(own(new THREE.SphereGeometry(r, 24, 14)), armBlack);
        mesh.position.y = y;
        mesh.castShadow = true;
        parent.add(mesh);
      };
      // The column it stands on, fixed to the back.
      rod(base, band, at(ARM.x, 0, 0.055), at(ARM.x, 0, 0.075), 0.055);
      rod(base, armBlack, at(ARM.x, 0, 0.075), at(ARM.x, 0, ARM.z), 0.046);
      const turret = new THREE.Group(), shoulder = new THREE.Group(), elbow = new THREE.Group();
      turret.position.copy(at(ARM.x, 0, ARM.z));
      elbow.position.y = ARM.upper;
      base.add(turret);
      turret.add(shoulder);
      shoulder.add(elbow);
      ball(shoulder, 0, 0.05);
      link(shoulder, 0, ARM.upper, 0.04, [0.12, 0.88]);
      ball(elbow, 0, 0.046);
      link(elbow, 0, 0.37, 0.036, [0.12, 0.88]);
      ball(elbow, 0.37, 0.04);
      link(elbow, 0.37, 0.48, 0.032, [0.5]);
      rod(elbow, armBlack, up(0.48), up(0.515), 0.036);
      for (const side of [1, -1]) rod(elbow, band, up(0.515, 0.024 * side), up(ARM.fore, 0.034 * side), 0.009);

      // The arm keeps to itself until there is something to reach for. At rest it is folded over the Go2's back,
      // elbow up behind the shoulder and hand low in front of it. As the runner comes near it unfolds toward it,
      // follows it by, and folds away again behind it; it is quicker to reach out than to give up, and it never
      // goes to full stretch. Places are measured from the shoulder in the robot's own axes (x ahead, y up), so
      // the folded arm turns with the robot.
      const REST = new THREE.Vector3(0.2, 0.09, 0), STRETCH = 0.8 * (ARM.upper + ARM.fore);
      const NEAR = 1.2, FAR = 2.3; // all of its interest within NEAR meters along the floor, none beyond FAR
      const hand = REST.clone(), goal = new THREE.Vector3();
      let keen = 0;
      return {
        /** Reaches toward `target` (a place in the world) by how near it is; folded away when it is far. */
        reach(target: V, dt: number) {
          base.updateWorldMatrix(true, false);
          goal.copy(target);
          base.worldToLocal(goal).sub(turret.position);
          const want = 1 - ease((Math.hypot(goal.x, goal.z) - NEAR) / (FAR - NEAR));
          keen += (want - keen) * (1 - Math.exp(-(want > keen ? 4.5 : 2.4) * dt));
          if (goal.length() > STRETCH) goal.setLength(STRETCH);
          goal.lerpVectors(REST, goal, ease(keen));
          hand.lerp(goal, 1 - Math.exp(-9 * dt)); // eased, so it never snaps
          const local = hand, flat = Math.hypot(local.x, local.z);
          turret.rotation.y = Math.atan2(-local.z, local.x);
          // Two links in the plane through the turret's axis and the hand's place, elbow up.
          const far = clamp(Math.hypot(flat, local.y), 0.2, 0.97 * (ARM.upper + ARM.fore));
          const toward = Math.atan2(local.y, flat);
          const lift = Math.acos(clamp((ARM.upper ** 2 + far ** 2 - ARM.fore ** 2) / (2 * ARM.upper * far), -1, 1));
          const bend = Math.acos(clamp((ARM.upper ** 2 + ARM.fore ** 2 - far ** 2) / (2 * ARM.upper * ARM.fore), -1, 1));
          shoulder.rotation.z = toward + lift - Math.PI / 2;
          elbow.rotation.z = bend - Math.PI;
        },
      };
    };
    const ringShape = own(new THREE.TorusGeometry(RING, 0.011, 10, 96).rotateX(Math.PI / 2));
    const company = COMPANY.map(c => {
      const ring = new THREE.Mesh(ringShape, flat(amber));
      scene.add(ring);
      const walker = studio.go2();
      const reacher = c.arm ? arm(walker.root.getObjectByName('body_base') ?? walker.root) : null;
      return { ...c, walker, ring, reacher };
    });

    // ── The timeline, measured from the page ──
    // `edge`: the four ends of the three stretches, in meters along the floor (x). The line is at depth 0.
    let edge = [-3, -1, 1, 3], laid = '', tour = 0;
    // The runner: where it is along the line and how fast it is going; which way it faces, from -1 (to the left)
    // through 0 (the viewer) to 1 (to the right), and which of those it has made up its mind to face; whether it
    // is jogging, and where in a stride the jog is (the right foot lands at 0); how long since the last handover.
    const run = { x: 0, v: 0, facing: 0, turning: 0, set: 0, jog: false, stride: 0, since: HANDOVER };
    const body: Body = { x: 0, y: 0, yaw: FACE, vx: 0, vy: 0, w: 0, wantVx: 0, wantVy: 0, accel: ACCEL, togo: 0, yawGoal: FACE };
    const chest = new THREE.Vector3();
    const middle = (stop: number) => (edge[stop] + edge[stop + 1]) / 2;
    /** Where a Go2 stands: the two mirror each other about the middle of their stretch, never closer than their
     *  rings allow. */
    const post = (c: (typeof COMPANY)[number]) => {
      const reach = clamp((edge[LAB + 1] - edge[LAB]) * 0.36, RING + 0.22, 0.95);
      return { x: middle(LAB) + c.side * reach, y: BACK };
    };
    const stopOf = (x: number) => (x < edge[1] ? 0 : x < edge[2] ? 1 : 2);
    let px = { scale: 100, ox: 0, left: 0 };

    const measure = () => {
      const W = host.clientWidth, H = host.clientHeight;
      if (!W || !H) return;
      const box = host.getBoundingClientRect();
      // The stretches' ends on the page: over the cards' edges when the cards are in a row, thirds of the stage if not.
      let ends: number[];
      if (inRow()) {
        const r = cards.map(c => c!.getBoundingClientRect());
        ends = [r[0].left, (r[0].right + r[1].left) / 2, (r[1].right + r[2].left) / 2, r[2].right].map(v => v - box.left);
      } else {
        const pad = Math.min(18, W * 0.04);
        ends = [0, 1, 2, 3].map(i => pad + ((W - 2 * pad) * i) / 3);
      }
      // Room above the line for the runner's head, and for the arm of the Go2 behind it at its highest.
      const down = 0.16 * sinE, up = Math.max(HEAD * cosE, (BACK + 0.1) * sinE + 1.3 * cosE);
      // As large as the stage's height allows, but never so large that the line is too short to run along. The
      // rings at its two ends are drawn whole: the line stops short of the stage's edges by a ring's radius and a
      // few pixels more. That radius is so many pixels only once the scale is known, so the two are solved together.
      const CLEAR = 4; // pixels between an end ring and the edge of the stage
      const scale = Math.min((H - LABELS) / (up + down), (ends[3] - ends[0] - 2 * CLEAR) / (SHORTEST + 2 * MARK));
      ends[0] += MARK * scale + CLEAR;
      ends[3] -= MARK * scale + CLEAR;
      const ox = W / 2, oy = H - LABELS - down * scale;
      studio.fit(W, H, scale, ox, oy);
      px = { scale, ox, left: box.left };
      edge = ends.map(v => (v - ox) / scale);

      const key = edge.map(v => v.toFixed(3)).join();
      if (key !== laid) {
        // Keep everything where it was along the timeline, as a share of its length.
        const share = (x: number, old: number[]) => clamp((x - old[0]) / (old[3] - old[0]), 0, 1);
        const old = laid ? laid.split(',').map(Number) : null;
        laid = key;
        const span = edge[3] - edge[0];
        run.x = old ? edge[0] + share(run.x, old) * span : edge[0] + 0.45;
        // It is stood where it now is: its feet were planted on a floor that has just been laid out afresh.
        Object.assign(run, { v: 0, turning: 0, jog: false, since: HANDOVER });
        gait.reset(run.x, 0, FACE + run.facing * Math.PI / 2);
        marks.forEach((mesh, i) => mesh.position.copy(at(edge[i], 0, 0.004)));
        company.forEach(c => {
          const spot = post(c);
          c.walker.place(spot.x, spot.y, FACE);
          c.ring.position.copy(at(spot.x, spot.y, 0.01));
        });
      }
      years.forEach((y, i) => {
        const p = studio.project(edge[i], 0);
        y.style.left = `${p.x}px`;
        y.style.top = `${p.y + MARK * sinE * scale + 9}px`;
      });
    };
    measure();

    return {
      frame(dt) {
        // Where the runner is asked to be: under the pointer, at the middle of a stretch, or (the tour) at the present.
        let target = run.x, top = TOP_SPEED;
        if (aim && 'x' in aim) target = (aim.x - px.left - px.ox) / px.scale;
        else if (aim) target = middle(aim.stop);
        else if (seen && (tour += dt) > 0.7) { target = middle(2); top = TOUR_SPEED; }
        target = clamp(target, edge[0] + 0.45, edge[3] - 0.45);
        mark(stopOf(aim ? target : run.x));

        // Which way it faces: the way it is going if that is some way off, the viewer once it is there. It does not
        // turn round at a run: it slows first. The turn itself is eased, and always passes through facing the viewer.
        const off = target - run.x, far = Math.abs(off);
        const face = far > TURN_FOR ? Math.sign(off) : far < FACE_AT ? 0 : run.set;
        if (face !== run.set && (Math.abs(run.v) < WALK_BELOW || face === Math.sign(run.v))) run.set = face;
        const turn = clamp(6 * (run.set - run.facing), -TURN_RATE, TURN_RATE);
        run.turning += clamp(turn - run.turning, -TURN_ACCEL * dt, TURN_ACCEL * dt);
        run.facing = clamp(run.facing + run.turning * dt, -1, 1);

        // It closes on that place in proportion to how far off it is, so it eases in without overshooting. How fast
        // it may go depends on how squarely it faces the way it is going: sideways it only shuffles.
        const square = Math.sign(off) * Math.sin(run.facing * Math.PI / 2);
        const cap = square > 0.96 ? top : SIDESTEP + (WALK_TOP - SIDESTEP) * ease((square - 0.6) / 0.36);
        const want = far > 1e-4 ? Math.sign(off) * Math.min(cap, Math.max(far * FOLLOW, Math.min(SLOWEST, far * 4))) : 0;
        run.v += clamp(want - run.v, -ACCEL * dt, ACCEL * dt);
        if (far < 0.012 && Math.abs(run.v) < 0.25) run.v = 0;
        run.x += run.v * dt;
        const speed = Math.abs(run.v);
        Object.assign(body, { x: run.x, yaw: FACE + run.facing * Math.PI / 2, vx: run.v, w: run.turning * Math.PI / 2, wantVx: want, togo: far, yawGoal: FACE + run.set * Math.PI / 2 });

        // Walking or jogging. The jog takes over in step with the walk, and the walk takes over the jog's feet
        // where they are: whichever foot is down is planted there.
        let handed = false;
        if (!run.jog && speed > JOG_ABOVE && square > 0.96) { run.jog = handed = true; run.stride = gait.phase; }
        else if (run.jog && speed < WALK_BELOW) { run.jog = false; handed = true; gait.adopt(shown, body, run.stride); }
        if (run.jog) {
          // The stride is played at the pace the ground is being covered.
          run.stride = (run.stride + (clamp(speed / JOG.speed, 0.6, 1.5) / jogTime) * dt) % 1;
          jog.sample(run.stride + jog.strike, made);
          made.x = run.x;
          made.turn.premultiply(spin.setFromAxisAngle(up, body.yaw));
        } else gait.step(dt, body, made);
        if (handed) {
          // What is on screen, less what is about to be: kept, and let go of over HANDOVER.
          for (let i = 0; i < carry.angle.length; i++) carry.angle[i] = shown.angle[i] - made.angle[i];
          carry.x = shown.x + run.v * dt - made.x; carry.y = shown.y - made.y; carry.z = shown.z - made.z;
          carry.turn.copy(made.turn).invert().multiply(shown.turn);
          run.since = 0;
        }
        const kept = run.since < HANDOVER ? 1 - ease(run.since / HANDOVER) : 0;
        run.since += dt;
        for (let i = 0; i < shown.angle.length; i++) shown.angle[i] = made.angle[i] + carry.angle[i] * kept;
        shown.x = made.x + carry.x * kept; shown.y = made.y + carry.y * kept; shown.z = made.z + carry.z * kept;
        shown.turn.copy(made.turn);
        if (kept) shown.turn.multiply(spin.copy(none).slerp(carry.turn, kept));
        g1.apply(shown);

        // The dots: amber ahead of the runner, where it has yet to go, and gray behind it.
        let n = 0;
        for (let x = edge[0] + DOT_GAP; x < edge[3] - DOT_GAP / 2 && n < DOTS; x += DOT_GAP) {
          if (edge.some(e => Math.abs(e - x) < MARK + 0.05)) continue; // not inside a ring
          m4.compose(v3.copy(at(x, 0, 0.003)), q0, one);
          dots.setMatrixAt(n, m4);
          dots.setColorAt(n, x < run.x ? rail : amber);
          n++;
        }
        dots.count = n;
        dots.instanceMatrix.needsUpdate = true;
        if (dots.instanceColor) dots.instanceColor.needsUpdate = true;

        // The Go2s stay where they stand and turn to keep the runner in view.
        company.forEach(c => {
          const b = c.walker.body, off = wrapAngle(Math.atan2(-b.y, run.x - b.x) - b.yaw);
          c.walker.drive(0, 0, Math.abs(off) > 0.18 ? clamp(off * 3.5, -2.4, 2.4) : 0);
          c.walker.step(dt);
          c.reacher?.reach(chest.copy(at(shown.x, shown.y, shown.z + 0.2)), dt);
        });
        studio.render();
      },
      resize: measure,
      dispose() {
        dots.dispose();
        room.dispose();
        studio.dispose();
      },
    };
  };

  liveStage(host, build);
}
