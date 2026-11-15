// The Go2 as a walking machine, for live figures such as the career walk on the resume page (career.ts).
// Same model and look as in the section titles (/go2.glb, written by figures/publications.py), but here nobody
// poses it: it trots. A gait clock lifts the legs in diagonal pairs, each foot is set down where its hip will be
// half a stance later (Raibert's rule), and the three joints of each leg come from inverse kinematics, so a planted
// foot stays where it was planted, on whatever the ground is there.
//
// Positions are written as in the titles: x to the right, y away from the viewer and z up, in meters. The camera has
// no perspective and looks down on the floor at a fixed angle, so the stage that owns it can lay the floor out in
// pixels: fit() says which pixel the floor's origin is at and how many pixels a meter is.

import { libs, loadModel, clamp, ease, wrapAngle } from './kit';

type Obj = import('three').Object3D;

// The Go2's legs, from its MJCF: where each hip is on the body, the sideways offset of the thigh, and the two links.
const HIP_X = 0.1934, HIP_Y = 0.0465, THIGH_Y = 0.0955, L1 = 0.213, L2 = 0.213;
const FOOT_R = 0.022; // the foot is a ball; its center rides this far above the ground
const LEGS = [
  { name: 'FL', fore: 1, side: 1, offset: 0 },
  { name: 'FR', fore: 1, side: -1, offset: 0.5 },
  { name: 'RL', fore: -1, side: 1, offset: 0.5 },
  { name: 'RR', fore: -1, side: -1, offset: 0 },
];
const STANCE_Y = HIP_Y + THIGH_Y + 0.012; // feet a touch wider than the hips
const HEIGHT = 0.3; // of the hips over the feet
const SWING = 0.46; // the part of a stride a foot spends in the air
const STEP = 0.055; // how high it is lifted on flat ground

/**
 * Joint angles (hip, thigh, calf) that put a foot at (px, py, pz) from its hip joint, in the body's frame.
 * `side` is 1 for a left leg, -1 for a right one. A point out of reach gets the nearest pose that points at it.
 */
export function legIK(px: number, py: number, pz: number, side: number): [number, number, number] {
  const d = THIGH_Y * side;
  // Seen from the front, the leg below the hip is an L: `d` sideways, then straight down by -zp.
  const zp = -Math.sqrt(Math.max(py * py + pz * pz - d * d, 1e-6));
  const q0 = wrapAngle(Math.atan2(pz, py) - Math.atan2(zp, d));
  // Seen from the side, thigh and calf are two links reaching (px, zp).
  const r = clamp(Math.hypot(px, zp), 0.1, (L1 + L2) * 0.985);
  const knee = Math.acos(clamp((L1 * L1 + L2 * L2 - r * r) / (2 * L1 * L2), -1, 1));
  const q2 = -(Math.PI - knee);
  const q1 = Math.atan2(-px, -zp) + Math.acos(clamp((L1 * L1 + r * r - L2 * L2) / (2 * L1 * r), -1, 1));
  return [q0, q1, q2];
}

export type Ground = (x: number, y: number) => number;

export async function makeStudio(canvas: HTMLCanvasElement, elevationDeg: number) {
  // The camera of these figures looks down from well above, so a shadow that fell away from the viewer (as the
  // titles' do) would hide behind whatever cast it. Here the key light stands behind and to the left: shadows come
  // forward onto the floor, and the faces turned to the viewer are the shaded ones, which is what reads as depth.
  const KEY = [-4.5, 11, -3.2], FILL = [6, 5, 7];
  const [THREE, , { RoomEnvironment }] = await libs();
  const E = (elevationDeg * Math.PI) / 180, sinE = Math.sin(E), cosE = Math.cos(E);
  const at = (x: number, y: number, z = 0) => new THREE.Vector3(x, z, -y);

  // The renderer and the light are those of the hero and the titles: white shells on white paper, soft shadows.
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = pmrem.fromScene(new RoomEnvironment(), 0.04); // soft reflections, for the robots' shells only
  pmrem.dispose();

  const sky = new THREE.HemisphereLight(0xffffff, 0xc9ccd2, 1.1);
  scene.add(sky);
  const key = new THREE.DirectionalLight(0xfff4ea, 1.9); // casts the shadows
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.006;
  key.shadow.radius = 4;
  const fill = new THREE.DirectionalLight(0xdde8ff, 0.55); // from the viewer's side, so the near faces are not flat
  scene.add(key, key.target, fill);

  // The floor shows only the shadows that fall on it.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.17, depthWrite: false }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.002;
  floor.receiveShadow = true;
  floor.renderOrder = -2;
  scene.add(floor);

  const shell = new THREE.MeshPhysicalMaterial({ color: 0xf3f3f1, metalness: 0, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x33363b, metalness: 0.2, roughness: 0.45 });
  const gray = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, metalness: 0.3, roughness: 0.36 });
  const metal = new THREE.MeshStandardMaterial({ color: 0xc7ccd1, metalness: 0.85, roughness: 0.3 });
  // The room is given to the robots' materials and not to the scene: whatever else a figure puts on the floor is
  // then lit by the lamps alone, and its colors can be worked out (flatGain, below).
  for (const material of [shell, dark, gray, metal]) { material.envMap = room.texture; material.envMapIntensity = 0.7; }

  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 400);
  const view = { width: 1, height: 1, scale: 1, ox: 0, oy: 0 };
  /** The floor's origin sits at canvas pixel (ox, oy), measured from the top left; a meter is `scale` pixels. */
  const fit = (width: number, height: number, scale: number, ox: number, oy: number) => {
    if (!width || !height) return;
    Object.assign(view, { width, height, scale, ox, oy });
    renderer.setSize(width, height, false);
    Object.assign(camera, { left: -width / (2 * scale), right: width / (2 * scale), top: height / (2 * scale), bottom: -height / (2 * scale) });
    camera.updateProjectionMatrix();
    // The point of the floor that is at the middle of the canvas, and the floor the canvas can see around it.
    const cx = (width / 2 - ox) / scale, cy = (oy - height / 2) / (scale * sinE);
    const target = at(cx, cy);
    camera.position.copy(target).add(new THREE.Vector3(0, sinE, cosE).multiplyScalar(100));
    camera.lookAt(target);
    const halfW = width / (2 * scale) + 1.5, halfD = height / (2 * scale * sinE) + 1.5;
    floor.position.set(target.x, -0.002, target.z);
    floor.scale.set(2 * halfW, 2 * halfD, 1);
    key.position.set(target.x + KEY[0], KEY[1], target.z + KEY[2]);
    key.target.position.copy(target);
    const reach = Math.max(halfW, halfD) + 1;
    Object.assign(key.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 0.5, far: 40 });
    key.shadow.camera.updateProjectionMatrix();
    fill.position.set(target.x + FILL[0], FILL[1], target.z + FILL[2]);
    fill.target.position.copy(target);
    fill.target.updateMatrixWorld();
  };
  /** What a matte color lying flat on the floor must be multiplied by to come out as itself under these lights. */
  const flatGain = () => {
    const sum = sky.color.clone().multiplyScalar(sky.intensity);
    for (const light of [key, fill]) {
      const up = light.position.clone().sub(light.target.position).normalize().y;
      sum.add(light.color.clone().multiplyScalar(light.intensity * Math.max(up, 0)));
    }
    return new THREE.Color(Math.PI / sum.r, Math.PI / sum.g, Math.PI / sum.b);
  };
  /** Where a point is on the canvas, in pixels from its top left. */
  const project = (x: number, y: number, z = 0) => ({ x: view.ox + x * view.scale, y: view.oy - (y * sinE + z * cosE) * view.scale });
  /** The floor point under a canvas pixel. */
  const unproject = (px: number, py: number) => ({ x: (px - view.ox) / view.scale, y: (view.oy - py) / (view.scale * sinE) });

  const source = await loadModel('/go2.glb');

  /** A Go2 standing in the scene, with the walker that moves it. */
  const go2 = () => {
    const model = source.scene.clone(true) as Obj;
    model.traverse((o: any) => {
      if (!o.isMesh) return;
      const kind = o.material?.name ?? '';
      o.material = kind === 'black' ? dark : kind === 'gray' ? gray : kind === 'metal' ? metal : shell;
      o.castShadow = true;
      o.frustumCulled = false;
    });
    const root = new THREE.Group();
    root.add(model);
    scene.add(root);
    const joints = new Map<string, { node: Obj; axis: import('three').Vector3 }>();
    model.traverse((o: Obj) => {
      if (!o.name.startsWith('joint_')) return;
      const a = o.userData.axis as number[]; // in the model's own z-up axes
      joints.set(o.name.slice(6), { node: o, axis: new THREE.Vector3(a[0], a[2], -a[1]) });
    });
    const turn = (name: string, angle: number) => {
      const j = joints.get(name)!;
      j.node.quaternion.setFromAxisAngle(j.axis, angle);
    };

    // ── The walker ──
    const body = { x: 0, y: 0, z: HEIGHT, yaw: 0, pitch: 0, roll: 0, vx: 0, vy: 0, w: 0 };
    const cmd = { vx: 0, vy: 0, w: 0 };
    const feet = LEGS.map(() => ({ x: 0, y: 0, z: 0, swing: false, fx: 0, fy: 0, fz: 0, tx: 0, ty: 0, tz: 0, support: 0 }));
    let ground: Ground = () => 0;
    let phase = 0, walking = false;
    const qYaw = new THREE.Quaternion(), qPitch = new THREE.Quaternion(), qRoll = new THREE.Quaternion(), qInv = new THREE.Quaternion();
    const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1), X = new THREE.Vector3(1, 0, 0), v = new THREE.Vector3();

    /** Where a foot rests when the body stands at (x, y) heading `yaw`. */
    const home = (i: number, x: number, y: number, yaw: number) => {
      const hx = HIP_X * LEGS[i].fore, hy = STANCE_Y * LEGS[i].side, c = Math.cos(yaw), s = Math.sin(yaw);
      return { x: x + c * hx - s * hy, y: y + s * hx + c * hy };
    };

    const pose = () => {
      root.position.set(body.x, body.z, -body.y);
      qYaw.setFromAxisAngle(Y, body.yaw);
      qPitch.setFromAxisAngle(Z, body.pitch); // nose up
      qRoll.setFromAxisAngle(X, body.roll); // left side up
      root.quaternion.copy(qYaw).multiply(qPitch).multiply(qRoll);
      qInv.copy(root.quaternion).invert();
      LEGS.forEach((leg, i) => {
        const f = feet[i];
        v.set(f.x - body.x, f.z - body.z, -(f.y - body.y)).applyQuaternion(qInv); // the foot, seen from the body
        const [q0, q1, q2] = legIK(v.x - HIP_X * leg.fore, -v.z - HIP_Y * leg.side, v.y, leg.side);
        turn(`${leg.name}_hip`, q0);
        turn(`${leg.name}_thigh`, q1);
        turn(`${leg.name}_calf`, q2);
      });
    };

    const walker = {
      root,
      body,
      feet,
      /** The ground it walks on: a height for every point of the floor. */
      on(g: Ground) { ground = g; },
      /** Stands it at (x, y), heading `yaw`, feet under the hips. */
      place(x: number, y: number, yaw = 0) {
        Object.assign(body, { x, y, yaw, pitch: 0, roll: 0, vx: 0, vy: 0, w: 0 });
        Object.assign(cmd, { vx: 0, vy: 0, w: 0 });
        let sum = 0;
        feet.forEach((f, i) => {
          const h = home(i, x, y, yaw);
          f.x = h.x; f.y = h.y; f.z = ground(h.x, h.y) + FOOT_R; f.swing = false; f.support = f.z;
          sum += f.z;
        });
        body.z = sum / 4 + HEIGHT;
        phase = 0;
        walking = false;
        pose();
      },
      /** Ask for a velocity over the floor (m/s) and a turning rate (rad/s). */
      drive(vx: number, vy: number, w = 0) { cmd.vx = vx; cmd.vy = vy; cmd.w = w; },
      /** Ask for a velocity and let it turn to face the way it is going, holding back until it roughly does. */
      head(vx: number, vy: number) {
        const speed = Math.hypot(vx, vy);
        if (speed < 0.03) { walker.drive(0, 0, 0); return; }
        const off = wrapAngle(Math.atan2(vy, vx) - body.yaw);
        const k = clamp(Math.cos(off), 0.12, 1);
        walker.drive(vx * k, vy * k, clamp(off * 7, -3.4, 3.4));
      },
      get speed() { return Math.hypot(body.vx, body.vy); },
      step(dt: number) {
        if (dt <= 0) { pose(); return; }
        // The body follows what was asked of it, as fast as a small robot can change its mind.
        const ax = cmd.vx - body.vx, ay = cmd.vy - body.vy, am = Math.hypot(ax, ay), lim = 4.5 * dt;
        if (am > lim) { body.vx += (ax / am) * lim; body.vy += (ay / am) * lim; } else { body.vx = cmd.vx; body.vy = cmd.vy; }
        body.w += clamp(cmd.w - body.w, -22 * dt, 22 * dt);
        body.x += body.vx * dt;
        body.y += body.vy * dt;
        body.yaw += body.w * dt;

        // The gait clock runs while there is somewhere to go, a foot in the air, or a foot left out of place.
        const speed = Math.hypot(body.vx, body.vy);
        const asked = speed > 0.02 || Math.abs(body.w) > 0.06 || Math.hypot(cmd.vx, cmd.vy) > 0.02 || Math.abs(cmd.w) > 0.06;
        const astray = feet.some((f, i) => { const h = home(i, body.x, body.y, body.yaw); return Math.hypot(f.x - h.x, f.y - h.y) > 0.035; });
        const airborne = feet.some(f => f.swing);
        const period = 0.46 - 0.07 * Math.min(speed, 1.6); // quicker steps at speed
        if (asked || astray || airborne) { walking = true; phase = (phase + dt / period) % 1; }
        else if (walking) { walking = false; phase = 0; } // at rest, ready to lift the first pair

        feet.forEach((f, i) => {
          const leg = LEGS[i], at = (phase + leg.offset) % 1, up = walking && at < SWING;
          if (up && !f.swing) { f.swing = true; f.fx = f.x; f.fy = f.y; f.fz = f.z; } // lift-off
          if (up) {
            // Where its hip will be when it lands, plus half a stance of travel.
            const lead = (SWING - at) * period + 0.5 * (1 - SWING) * period;
            const h = home(i, body.x + body.vx * lead, body.y + body.vy * lead, body.yaw + body.w * lead);
            f.tx = h.x; f.ty = h.y; f.tz = ground(h.x, h.y) + FOOT_R;
            const s = at / SWING, e = ease(s);
            // High enough to clear whatever lies between where it left and where it lands.
            let over = Math.max(f.fz, f.tz);
            for (const u of [0.25, 0.5, 0.75]) over = Math.max(over, ground(f.fx + (f.tx - f.fx) * u, f.fy + (f.ty - f.fy) * u) + FOOT_R);
            const lift = STEP + (over - Math.max(f.fz, f.tz)) + 0.35 * Math.abs(f.tz - f.fz);
            f.x = f.fx + (f.tx - f.fx) * e;
            f.y = f.fy + (f.ty - f.fy) * e;
            f.support = f.fz + (f.tz - f.fz) * e;
            f.z = f.support + lift * Math.sin(Math.PI * s);
          } else {
            if (f.swing) { f.swing = false; f.x = f.tx; f.y = f.ty; } // touchdown
            f.z = f.support = ground(f.x, f.y) + FOOT_R; // planted; it follows the ground if the ground moves
          }
        });

        // The body rides over its feet: their mean height, and the slope between front and back, left and right.
        const s = feet.map(f => f.support);
        const k = 1 - Math.exp(-11 * dt);
        body.z += ((s[0] + s[1] + s[2] + s[3]) / 4 + HEIGHT - body.z) * k;
        body.pitch += (0.85 * Math.atan2((s[0] + s[1] - s[2] - s[3]) / 2, 2 * HIP_X) - body.pitch) * k;
        body.roll += (0.6 * Math.atan2((s[0] + s[2] - s[1] - s[3]) / 2, 2 * STANCE_Y) - body.roll) * k;
        pose();
      },
      remove() { scene.remove(root); },
    };
    walker.place(0, 0, 0);
    return walker;
  };

  const dispose = () => {
    scene.traverse((o: any) => {
      if (o.isMesh && o.geometry?.userData.own) o.geometry.dispose(); // the models' geometry is shared with other stages
    });
    room.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  };

  return { THREE, renderer, scene, camera, at, fit, project, unproject, flatGain, go2, sinE, cosE, view, dispose, render: () => renderer.render(scene, camera) };
}
export type Studio = Awaited<ReturnType<typeof makeStudio>>;
export type Walker = ReturnType<Studio['go2']>;
