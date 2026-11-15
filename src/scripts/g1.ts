// The G1 as a walking machine, for the career walk on the resume page (career.ts).
// The hero's model (/g1-hero.glb) comes with motions baked from recordings: a dance, a run, a fight, a fall. None of
// them is a walk, and a stride of the run played slowly is a slow jog. So the walk is made here, the way a walking
// robot makes one. A gait clock lifts the feet in turn. Each is set down where its hip is about to be (Raibert's
// rule, as for the Go2 in go2.ts) and then stays exactly where it was put, rolling from its heel onto its toe as
// the body passes over it. The pelvis rides as high as the legs let it, lowest when both feet are down and highest
// over the standing leg, and leans over that leg. The six joints of each leg come from inverse kinematics.
// Standing is the same machine with nothing to do, and turning on the spot is the same machine stepping round.
// For going faster than a walk there is a jog: one stride of the model's baked run, closed into a loop (`stride`).
// The walker hands over to it in step, and takes over from it with the feet wherever the jog has left them.
//
// Positions are those of go2.ts: x to the right, y away from the viewer, z up, in meters. They are also the model's
// own axes, so a pose is written straight onto it: the pelvis's place and turn, and one angle for each of the 29
// joints. A joint's link is turned about the axis its name says, after the fixed tilt the G1's description gives a
// few links.

import { clamp, ease, wrapAngle } from './kit';

type Three = typeof import('three');
type V3 = import('three').Vector3;
type Quat = import('three').Quaternion;
type Obj = import('three').Object3D;

const LEG = ['hip_pitch', 'hip_roll', 'hip_yaw', 'knee', 'ankle_pitch', 'ankle_roll'];
const ARM = ['shoulder_pitch', 'shoulder_roll', 'shoulder_yaw', 'elbow', 'wrist_roll', 'wrist_pitch', 'wrist_yaw'];
/** The joints, in the order a pose lists their angles. */
export const JOINTS = [
  ...LEG.map(j => `left_${j}`), ...LEG.map(j => `right_${j}`),
  'waist_yaw', 'waist_roll', 'torso',
  ...ARM.map(j => `left_${j}`), ...ARM.map(j => `right_${j}`),
];
const at = (joint: string) => JOINTS.indexOf(joint);
const L_LEG = at('left_hip_pitch'), R_LEG = at('right_hip_pitch'), WAIST = at('waist_yaw'), L_ARM = at('left_shoulder_pitch'), R_ARM = at('right_shoulder_pitch');

// The fixed tilts of the links that have one, as the G1's description gives them: x, y, z, w.
const TILTS: [RegExp, number[]][] = [
  [/hip_roll$/, [0, -0.0873386, 0, 0.996179]],
  [/knee$/, [0, 0.0873386, 0, 0.996179]],
  [/^left_shoulder_pitch$/, [0.139201, 0, 0, 0.990264]],
  [/^right_shoulder_pitch$/, [-0.139201, 0, 0, 0.990264]],
  [/^left_shoulder_roll$/, [-0.139172, 0, 0, 0.990268]],
  [/^right_shoulder_roll$/, [0.139172, 0, 0, 0.990268]],
];

// The foot, from the mesh of the ankle's link: a flat plate. How far its sole is under the ankle, and the two lines
// it can be rolled about, its back edge and its front one, as meters ahead of the ankle.
const SOLE = 0.0354, HEEL = -0.064, TOE = 0.14;

// ── The gait ──
const STAND_DROP = 0.007, TOP_DROP = 0.007; // how far under straight-legged it stands, and walks at its highest, meters
const LOW_DROP = 0.002; // and how far under what the reaching leg allows it is as that leg's foot lands
const CREST = 0.265; // where in a stride the pelvis is highest over the right foot (and half a stride on, over the left)
const REACH = 0.9955; // a leg is never asked to be straighter than this share of its length
const WIDTH = [0.105, 0.085]; // half the distance between the feet: standing or stepping round, and walking ahead
const BACK = 0.02; // the ankles rest this far behind the pelvis
const TOE_OUT = 0.07; // radians each foot points outward by
const BIAS = 0.42; // of the ground a stance covers, the share that is ahead of the hip when the foot lands
const STRIKE = 0.17, PUSH = 0.6; // radians: toes up as the heel lands far ahead, heel up as the foot is left far behind
const TRAIL = 0.345; // how far behind where it rests a foot may be left before it is lifted, meters
const UNBEND = 9; // a leg in the air straightens no faster than this, radians a second at the knee
const APART = 0.13; // the feet are never set down closer side by side than this, meters between their ankles
const PIVOT = 0.45, BALL = 0.07; // a planted foot lets the body turn this far over it (radians), then turns on its ball, this far ahead of the ankle
const START = { far: 0.055, turned: 0.22 }, SETTLE = { far: 0.012, turned: 0.04 }; // a foot this far out of place (meters, radians) starts it stepping; under these it may rest

/** A pose of the whole robot. */
export type Pose = { x: number; y: number; z: number; turn: Quat; angle: Float32Array };
/** What the walker is told about the body it carries: where it is and how it moves, and what is being asked of it. */
export type Body = {
  x: number; y: number; yaw: number; // the pelvis over the floor, and its heading
  vx: number; vy: number; w: number; // how fast it moves, and turns
  wantVx: number; wantVy: number; accel: number; // the velocity it is being brought to, and how hard
  togo: number; // how far it still has to go, meters
  yawGoal: number; // the heading it is turning to
};

const smoothMin = (a: number, b: number, k: number) => -k * Math.log(Math.exp(-a / k) + Math.exp(-b / k));

/** Solves a·x = b in place for a 6 by 6 system (a is row-major, both are overwritten); x is left in b. */
function solve6(a: Float64Array, b: Float64Array) {
  for (let c = 0; c < 6; c++) {
    let pivot = c;
    for (let r = c + 1; r < 6; r++) if (Math.abs(a[r * 6 + c]) > Math.abs(a[pivot * 6 + c])) pivot = r;
    if (pivot !== c) {
      for (let k = 0; k < 6; k++) { const t = a[c * 6 + k]; a[c * 6 + k] = a[pivot * 6 + k]; a[pivot * 6 + k] = t; }
      const t = b[c]; b[c] = b[pivot]; b[pivot] = t;
    }
    const d = a[c * 6 + c] || 1e-12;
    for (let r = c + 1; r < 6; r++) {
      const f = a[r * 6 + c] / d;
      if (!f) continue;
      for (let k = c; k < 6; k++) a[r * 6 + k] -= f * a[c * 6 + k];
      b[r] -= f * b[c];
    }
  }
  for (let r = 5; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < 6; k++) s -= a[r * 6 + k] * b[k];
    b[r] = s / (a[r * 6 + r] || 1e-12);
  }
}

/**
 * The G1's kinematics and its walker. `offset` gives where a joint's link sits in its parent link (the model's own
 * numbers, so that the legs worked out here are the legs that are drawn).
 */
export function makeG1(THREE: Three, offset: (joint: string) => number[]) {
  const vec = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const AXES = { x: vec(1, 0, 0), y: vec(0, 1, 0), z: vec(0, 0, 1) };
  const axes = JOINTS.map(j => (/roll$/.test(j) ? AXES.x : /yaw$/.test(j) ? AXES.z : AXES.y)); // knee, elbow, torso: pitch
  const tilts = JOINTS.map(j => { const t = TILTS.find(([re]) => re.test(j)); return t ? new THREE.Quaternion().fromArray(t[1]) : null; });
  const newPose = (): Pose => ({ x: 0, y: 0, z: 0, turn: new THREE.Quaternion(), angle: new Float32Array(JOINTS.length) });
  const qa = new THREE.Quaternion(), qb = new THREE.Quaternion(), qc = new THREE.Quaternion(), qd = new THREE.Quaternion(), va = vec(), vb = vec(), vc = vec();

  // ── A leg: where its ankle is and how its foot is turned for six angles, and the six angles for an ankle and a foot ──
  const makeLeg = (first: number) => {
    const t = LEG.map((_, i) => vec(...offset(JOINTS[first + i])));
    const o = LEG.map(() => vec()), a = LEG.map(() => vec()); // each joint's place and axis, seen from the pelvis
    const p = vec(), R = new THREE.Quaternion();
    const forward = (q: ArrayLike<number>, from = 0) => {
      p.set(0, 0, 0);
      R.identity();
      for (let i = 0; i < 6; i++) {
        p.add(va.copy(t[i]).applyQuaternion(R));
        const tilt = tilts[first + i];
        if (tilt) R.multiply(tilt);
        o[i].copy(p);
        a[i].copy(axes[first + i]).applyQuaternion(R);
        R.multiply(qa.setFromAxisAngle(axes[first + i], q[from + i]));
      }
    };
    const J = new Float64Array(36), A = new Float64Array(36), e = new Float64Array(6), g = new Float64Array(6);
    const TURN = 0.2; // a radian of the foot's turn weighs as this many meters of its place
    /** Turns the six angles at q[from...] until the ankle is at `goal` and the foot is turned as `turn`. */
    const reach = (q: Float32Array, from: number, goal: V3, turn: Quat) => {
      let miss = 0;
      for (let pass = 0; pass < 12; pass++) {
        forward(q, from);
        // What is still to be made up: a move, and a turn written as a vector along its axis.
        qb.copy(R).invert().premultiply(turn);
        if (qb.w < 0) qb.set(-qb.x, -qb.y, -qb.z, -qb.w);
        const s = Math.hypot(qb.x, qb.y, qb.z), k = s < 1e-9 ? 0 : (2 * Math.atan2(s, qb.w) / s) * TURN;
        e[0] = goal.x - p.x; e[1] = goal.y - p.y; e[2] = goal.z - p.z;
        e[3] = qb.x * k; e[4] = qb.y * k; e[5] = qb.z * k;
        miss = Math.hypot(e[0], e[1], e[2], e[3], e[4], e[5]);
        if (miss < 2e-5) break;
        for (let i = 0; i < 6; i++) {
          va.copy(p).sub(o[i]);
          vb.crossVectors(a[i], va);
          J[i] = vb.x; J[6 + i] = vb.y; J[12 + i] = vb.z;
          J[18 + i] = a[i].x * TURN; J[24 + i] = a[i].y * TURN; J[30 + i] = a[i].z * TURN;
        }
        // Damped least squares: near a straight knee a plain solve would throw the leg about.
        for (let r = 0; r < 6; r++) {
          let sum = 0;
          for (let k2 = 0; k2 < 6; k2++) sum += J[k2 * 6 + r] * e[k2];
          g[r] = sum;
          for (let c = 0; c < 6; c++) {
            let m = 0;
            for (let k2 = 0; k2 < 6; k2++) m += J[k2 * 6 + r] * J[k2 * 6 + c];
            A[r * 6 + c] = m + (r === c ? 4e-5 : 0);
          }
        }
        solve6(A, g);
        let most = 0;
        for (let i = 0; i < 6; i++) most = Math.max(most, Math.abs(g[i]));
        const scale = most > 0.5 ? 0.5 / most : 1;
        for (let i = 0; i < 6; i++) q[from + i] += g[i] * scale;
        q[from + 3] = clamp(q[from + 3], 0.04, 2.6); // the knee bends one way only
      }
      return miss;
    };
    return { forward, reach, p, R, knee: o[3] };
  };
  const legs = [makeLeg(L_LEG), makeLeg(R_LEG)];

  // The hip seen from the pelvis: the line the thigh swings about, out at the leg's side. And the length of a
  // straight leg from it to the ankle.
  const HIP_Y = offset('left_hip_pitch')[1] + offset('left_hip_roll')[1], HIP_Z = -offset('left_hip_pitch')[2];
  legs[0].forward([0, 0, 0, 0, 0, 0]);
  const LENGTH = legs[0].p.distanceTo(vec(0, HIP_Y, -HIP_Z)), FAR = REACH * LENGTH;
  const SHIN = legs[0].p.distanceTo(legs[0].knee), THIGH = LENGTH - SHIN;
  // How far a leg is bent (radians at the knee) when its ankle is `far` from its hip, and the other way round.
  const bendFor = (far: number) => Math.acos(clamp((far * far - THIGH * THIGH - SHIN * SHIN) / (2 * THIGH * SHIN), -1, 1));
  const farFor = (bend: number) => Math.sqrt(THIGH * THIGH + SHIN * SHIN + 2 * THIGH * SHIN * Math.cos(bend));
  const FULL = SOLE + LENGTH + HIP_Z; // the pelvis over the floor with the legs straight
  const STAND = FULL - STAND_DROP, TOP = FULL - TOP_DROP;

  // How far the toes of a foot are up (radians; under zero, the heel is) for how far ahead of its hip it stands.
  const roll = (ahead: number) => (ahead > 0 ? STRIKE * ease((ahead - 0.09) / 0.12) : -PUSH * ease((-ahead - 0.08) / 0.22));
  // A foot is rolled about its heel when its toes are up and about its toe when its heel is: where that leaves the
  // point of the sole under the ankle, ahead of and above where it rests when the foot is flat.
  const rolled = (pitch: number) => { const pivot = pitch > 0 ? HEEL : TOE; return { ahead: pivot * (1 - Math.cos(pitch)), up: -pivot * Math.sin(pitch) }; };

  /** The walker: give it the body each frame and it gives back the pose. */
  const walker = () => {
    const feet = [1, -1].map((side, i) => ({
      side, leg: legs[i], first: i ? R_LEG : L_LEG,
      x: 0, y: 0, yaw: 0, // where it is planted, sole flat on the floor, and which way it points
      air: false, passed: false, s0: 0, swung: 0, // in the air; let this turn to step go by; how far through a swing it was taken over, and is now
      sx: 0, sy: 0, sz: 0, syaw: 0, spitch: 0, e0: 0, g0: 0, // a swing as far as it has got: its place (less the lift), its turn and its roll, and how far along each is
      px: 0, py: 0, pz: 0, heading: 0, pitch: 0, // the point of its sole under the ankle now, which way it points, and how far its toes are up
      ankle: vec(), turn: new THREE.Quaternion(), hip: vec(), // its ankle, how it is turned, and its hip seen from the pelvis, all in the floor's axes
      bend: 0.3, // how far its leg is bent
    }));
    type Foot = (typeof feet)[number];
    const q = new Float32Array(JOINTS.length); // the angles, kept from frame to frame: each solve starts from the last
    let phase = 0, stepping = false, lively = 0, pace = 0, spin = 0, sag = 0;
    let taken: number | null = null; // the height of the pelvis in a pose just taken over
    const stance = () => { for (const f of feet) { q[f.first] = -0.14; q[f.first + 1] = q[f.first + 2] = 0; q[f.first + 3] = 0.3; q[f.first + 4] = -0.16; q[f.first + 5] = 0; } };
    stance();

    // The clock: one turn of `phase` is a stride. The right foot lands as it starts; the left is in the air from
    // `both` to a half, lands, and the right is in the air from a half and `both` to the end. `both` is the share
    // of a stride that both feet are down for, each time: less of it the faster the walk.
    const period = (v: number, turning: number) => Math.min(1.12 - 0.24 * Math.min(v, 1.25), 1 - 0.09 * turning);
    const both = (v: number) => 0.13 - 0.04 * Math.min(v, 1.2);
    const width = (v: number) => WIDTH[0] + (WIDTH[1] - WIDTH[0]) * ease(v / 0.5);
    const progress = (f: Foot, d: number) => (f.side > 0 ? (phase - d) / (0.5 - d) : (phase - 0.5 - d) / (0.5 - d));

    /** Where a foot rests when the pelvis is over (x, y) heading `yaw`. */
    const home = (f: Foot, x: number, y: number, yaw: number, w: number) => {
      const c = Math.cos(yaw), s = Math.sin(yaw), hy = f.side * w;
      return { x: x - c * BACK - s * hy, y: y - s * BACK + c * hy };
    };
    /** How far the body will have gone `t` seconds from now, and how fast it will then be going. */
    const glide = (b: Body, t: number) => {
      let dvx = b.wantVx - b.vx, dvy = b.wantVy - b.vy;
      const n = Math.hypot(dvx, dvy), k = n > b.accel * t ? (b.accel * t) / n : 1;
      dvx *= k; dvy *= k;
      const t1 = b.accel > 0 ? (n * k) / b.accel : 0;
      let dx = b.vx * t + dvx * (t - t1 / 2), dy = b.vy * t + dvy * (t - t1 / 2);
      const far = Math.hypot(dx, dy);
      if (far > b.togo) { dx *= b.togo / far; dy *= b.togo / far; }
      return { dx, dy, vx: b.vx + dvx, vy: b.vy + dvy };
    };
    /** Its heading `t` seconds from now. It does not turn past where it is turning to, and once it is nearly
     *  there it is as good as there: a foot put down now is put down for the heading it will be left standing in. */
    const veer = (b: Body, t: number) => {
      const left = wrapAngle(b.yawGoal - b.yaw), turn = b.w * t;
      return b.yaw + (Math.abs(left) < 0.35 || (turn * left > 0 && Math.abs(turn) > Math.abs(left)) ? left : turn);
    };
    /** How far out of place a planted foot is for a body at (x, y) heading `yaw`: meters, and radians. */
    const astray = (f: Foot, x: number, y: number, yaw: number, w: number) => {
      const h = home(f, x, y, yaw, w);
      return { far: Math.hypot(f.x - h.x, f.y - h.y), turned: Math.abs(wrapAngle(f.yaw - yaw - f.side * TOE_OUT)) };
    };

    /** Stands it at rest over (x, y), heading `yaw`. */
    const reset = (x: number, y: number, yaw: number) => {
      for (const f of feet) {
        const h = home(f, x, y, yaw, WIDTH[0]);
        Object.assign(f, { x: h.x, y: h.y, yaw: yaw + f.side * TOE_OUT, air: false, passed: false, px: h.x, py: h.y, pz: 0, heading: yaw + f.side * TOE_OUT, pitch: 0 });
      }
      phase = 0; stepping = false; lively = 0; pace = 0; spin = 0; sag = 0;
      stance();
    };

    const lift = (f: Foot, s: number) => {
      Object.assign(f, { sx: f.px, sy: f.py, sz: f.pz, syaw: f.heading, spitch: f.pitch, e0: 0, g0: 0 });
      f.air = true;
      f.s0 = f.swung = clamp(s, 0, 0.9);
    };

    /** One step of the walk: `out` is the pose for the body as it now is. */
    const step = (dt: number, b: Body, out: Pose) => {
      const speed = Math.hypot(b.vx, b.vy);
      pace += (speed - pace) * (1 - Math.exp(-8 * dt));
      spin += (Math.abs(b.w) - spin) * (1 - Math.exp(-8 * dt));
      const T = period(pace, spin), d = both(pace), w = width(pace), hold = (0.5 + d) * T; // `hold`: how long a foot is down for
      // A foot is wanted elsewhere if it will be out of place half a stride from now. One that is already where
      // the body is coming to rest stays put, though the body has not finished arriving.
      const soon = glide(b, 0.5 * T), heading = veer(b, 0.5 * T);
      const wanted = (f: Foot) => { const off = astray(f, b.x + soon.dx, b.y + soon.dy, heading, w); return off.far > SETTLE.far || off.turned > SETTLE.turned; };

      if (!stepping) {
        // At rest. It steps when its feet are about to be left behind: where the body will be in a moment is far
        // from where they stand, or turned away from them. A small shift of the body is taken up by the legs alone.
        const g = glide(b, 0.3), yaw = veer(b, 0.3);
        const offs = feet.map(f => astray(f, b.x + g.dx, b.y + g.dy, yaw, w));
        if (offs.some(o => o.far > START.far || o.turned > START.turned)) {
          // The foot on the side it is going or turning to goes first; straight ahead, the one further back.
          const c = Math.cos(b.yaw), s = Math.sin(b.yaw);
          const sideways = -s * b.wantVx + c * b.wantVy, turning = wrapAngle(b.yawGoal - b.yaw);
          const lead = sideways * 2 + turning * 0.4;
          const along = (f: Foot) => c * (f.x - b.x) + s * (f.y - b.y);
          const first = Math.abs(lead) > 0.02 ? (lead > 0 ? feet[0] : feet[1]) : along(feet[0]) <= along(feet[1]) ? feet[0] : feet[1];
          stepping = true;
          phase = first.side > 0 ? d : 0.5 + d;
          feet.forEach(f => { f.passed = f !== first; });
          lift(first, 0);
        }
      } else {
        // The clock runs at the walk's pace, and faster when the ground is being covered faster than the feet were
        // placed for, as when it is speeding up: a planted foot that would be left further behind than a leg
        // reaches before its turn to lift hurries the clock, so the steps come sooner and not longer.
        let hurry = 0;
        if (speed > 0.1) {
          for (const f of feet) {
            const since = ((phase - (f.side > 0 ? 0.5 : 0)) % 1 + 1) % 1; // of a stride, since it landed
            if (f.air || since >= 0.5 + d) continue;
            const h = home(f, b.x, b.y, b.yaw, w);
            const ahead = ((f.x - h.x) * b.vx + (f.y - h.y) * b.vy) / speed; // of where it rests, along the way it is going
            hurry = Math.max(hurry, (0.5 + d - since) / Math.max((ahead + TRAIL) / speed, 0.02) - 1 / T);
          }
        }
        phase += dt * (1 / T + clamp(hurry, 0, 2.5 / T));
        for (const f of feet) {
          const s = progress(f, d);
          if (f.air && s >= 1) { // it lands where it has got to, which is where it was going
            const set = rolled(f.pitch);
            f.air = false; f.yaw = f.heading;
            f.x = f.px - Math.cos(f.yaw) * set.ahead; f.y = f.py - Math.sin(f.yaw) * set.ahead;
          }
          if (s < 0 || s >= 1) f.passed = false;
        }
        if (phase >= 1) phase -= 1;
        for (const f of feet) {
          const s = progress(f, d);
          if (f.air || f.passed || s < 0 || s >= 1) continue;
          if (s < 0.5 && wanted(f)) lift(f, s); else f.passed = true;
        }
        if (!feet.some(f => f.air || wanted(f))) stepping = false;
      }
      lively += ((stepping ? 1 : 0) - lively) * (1 - Math.exp(-(stepping ? 10 : 5) * dt));

      // ── The pelvis over the floor: over the standing leg, and turned with the stride ──
      const turn = 2 * Math.PI * phase, stride = Math.min(1, pace / 0.9);
      const sway = (0.03 - 0.008 * Math.min(1, pace / 0.6)) * Math.cos(turn - 1.6 * Math.PI) * lively; // to the left over the left foot
      const twist = 0.075 * stride * Math.cos(turn) * lively; // the hip of the leg that is ahead leads
      const list = 0.035 * Math.cos(turn - 1.6 * Math.PI) * lively; // the side of the leg in the air drops
      const lean = (0.035 + 0.05 * stride) * lively;
      const yaw = b.yaw + twist, px = b.x - Math.sin(b.yaw) * sway, py = b.y + Math.cos(b.yaw) * sway;
      out.turn.setFromAxisAngle(AXES.z, yaw).multiply(qa.setFromAxisAngle(AXES.y, lean)).multiply(qa.setFromAxisAngle(AXES.x, list));

      // ── The feet ──
      for (const f of feet) {
        f.hip.set(0, f.side * HIP_Y, -HIP_Z).applyQuaternion(out.turn);
        if (f.air) {
          // In the air: toward where its hip will be when it lands, and on by its share of the stance to come.
          const s = clamp(progress(f, d), 0, 1), left = (1 - s) * (0.5 - d) * T;
          // It is pointed where the body will be heading halfway through its stance, but never so far round
          // that it would have to turn on its ball the moment it lands.
          const g = glide(b, left), landed = veer(b, left);
          const heading = landed + clamp(wrapAngle(veer(b, left + 0.5 * hold) - landed), -PIVOT + 0.1, PIVOT - 0.1);
          const h = home(f, b.x + g.dx, b.y + g.dy, heading, w);
          let tx = h.x + g.vx * hold * BIAS, ty = h.y + g.vy * hold * BIAS;
          const tyaw = heading + f.side * TOE_OUT;
          // Never onto the other foot, nor across it: seen from where the body will be, it lands at least APART
          // to its own side of the foot that is down, unless one is well ahead of the other.
          const other = feet[f.side > 0 ? 1 : 0], cl = Math.cos(landed), sl = Math.sin(landed);
          const fore = cl * (tx - other.x) + sl * (ty - other.y), aside = f.side * (-sl * (tx - other.x) + cl * (ty - other.y));
          const more = Math.max(APART - aside, 0) * (1 - ease((Math.abs(fore) - 0.2) / 0.08));
          tx -= sl * f.side * more;
          ty += cl * f.side * more;
          // How it will land: toes up if it lands far ahead of its hip.
          const ahead = Math.cos(tyaw) * (tx - (b.x + g.dx)) + Math.sin(tyaw) * (ty - (b.y + g.dy)) + BACK;
          const landing = roll(ahead), set = rolled(landing);
          // Each frame it covers its share of what is left of the way, so that when the place it is going to
          // moves (the body is sent somewhere else in mid-step) it bends its path there and does not jump.
          const u = clamp((s - f.s0) / (1 - f.s0), 0, 1), e = ease(u), g2 = ease((u - 0.12) / 0.8); // the toes stay down as it leaves
          const k = e >= 1 ? 1 : clamp((e - f.e0) / (1 - f.e0), 0, 1), kg = g2 >= 1 ? 1 : clamp((g2 - f.g0) / (1 - f.g0), 0, 1);
          f.e0 = e; f.g0 = g2; f.swung = s;
          f.sx += (tx + Math.cos(tyaw) * set.ahead - f.sx) * k;
          f.sy += (ty + Math.sin(tyaw) * set.ahead - f.sy) * k;
          f.sz += (set.up - f.sz) * k;
          f.syaw += wrapAngle(tyaw - f.syaw) * k;
          f.spitch += (landing - f.spitch) * kg;
          f.px = f.sx; f.py = f.sy; f.heading = f.syaw; f.pitch = f.spitch;
          f.pz = f.sz + (0.022 + 0.02 * stride) * (1 - f.s0) * Math.sin(Math.PI * u) ** 2;
        } else {
          // Down: where it was put. If the body turns further over it than a hip comfortably twists, it turns on
          // its ball, as a foot does in a sharp turn.
          const twisted = wrapAngle(f.yaw - b.yaw - f.side * TOE_OUT);
          if (Math.abs(twisted) > PIVOT) {
            const to = f.yaw - twisted + Math.sign(twisted) * PIVOT;
            f.x += BALL * (Math.cos(f.yaw) - Math.cos(to));
            f.y += BALL * (Math.sin(f.yaw) - Math.sin(to));
            f.yaw = to;
          }
          // It is rolled by how far its hip has gone past it.
          const ahead = Math.cos(f.yaw) * (f.x - px - f.hip.x) + Math.sin(f.yaw) * (f.y - py - f.hip.y);
          f.pitch = roll(ahead) * lively;
          const set = rolled(f.pitch);
          f.heading = f.yaw;
          f.px = f.x + Math.cos(f.yaw) * set.ahead;
          f.py = f.y + Math.sin(f.yaw) * set.ahead;
          f.pz = set.up;
        }
        f.turn.setFromAxisAngle(AXES.z, f.heading).multiply(qa.setFromAxisAngle(AXES.y, -f.pitch));
        f.ankle.set(0, 0, SOLE).applyQuaternion(f.turn);
        f.ankle.x += f.px; f.ankle.y += f.py; f.ankle.z += f.pz;
      }

      // ── How high the pelvis rides ──
      // Twice a stride it is at its highest, as a hip passes over its standing foot, and in between, as a foot
      // lands, it is as much lower as the leg reaching ahead needs. Whatever the feet are doing, it is never so
      // high that a leg would have to be straighter than it can be.
      const strikeAhead = Math.max(0, BIAS * pace * hold - BACK + HIP_Z * Math.sin(lean));
      const low = SOLE + rolled(roll(strikeAhead)).up + Math.sqrt(FAR * FAR - strikeAhead * strikeAhead) + HIP_Z - LOW_DROP;
      const bob = Math.max(TOP - low, 0.01 + 0.012 * Math.min(1, pace / 0.6));
      const ride = STAND + (TOP - bob * (1 - Math.cos(2 * turn - 4 * Math.PI * CREST)) / 2 - STAND) * lively;
      // Taken over from a pose that rode lower (a jog does): it starts from that height, and comes up from it.
      if (taken !== null) { sag = Math.max(ride - taken, 0); taken = null; }
      let pz = ride;
      for (const f of feet) {
        const out2 = Math.min(Math.hypot(f.ankle.x - px - f.hip.x, f.ankle.y - py - f.hip.y), 0.97 * FAR);
        // A foot in the air asks for this only as it comes down to land, so the pelvis is where the foot needs it
        // by the time it is on the floor and never has to drop to it.
        const room = f.air ? 0.06 * (1 - ease((f.swung - 0.35) / 0.65)) : 0;
        pz = smoothMin(pz, f.ankle.z + Math.sqrt(FAR * FAR - out2 * out2) - f.hip.z + room, 0.002);
      }
      // What a leg holds the pelvis down by is given back gradually once the leg lets go, as weight comes off it.
      sag = Math.max(ride - pz, sag * Math.exp(-dt / 0.12));
      pz = ride - sag;
      // A leg swinging forward does not snap straight: its foot is held back along the floor for as long as
      // reaching where it is going would straighten the leg faster than UNBEND (or further than it goes). If that
      // leaves it short when it lands, it lands short.
      for (const f of feet) {
        va.set(f.ankle.x - px - f.hip.x, f.ankle.y - py - f.hip.y, f.ankle.z - pz - f.hip.z);
        const far = va.length();
        if (!f.air) { f.bend = bendFor(far); continue; }
        f.bend = Math.max(bendFor(Math.min(far, FAR)), f.bend - UNBEND * dt);
        const flat = Math.hypot(va.x, va.y), held = Math.sqrt(Math.max(farFor(f.bend) ** 2 - va.z * va.z, 0));
        if (held < flat) {
          const back = 1 - held / flat;
          f.px -= va.x * back; f.py -= va.y * back;
          f.ankle.x -= va.x * back; f.ankle.y -= va.y * back;
        }
      }

      // ── The pose ──
      out.x = px; out.y = py; out.z = pz;
      const turnBack = qc.copy(out.turn).invert(); // the pelvis's turn undone: from the floor's axes to the pelvis's
      for (const f of feet) {
        vb.set(f.ankle.x - px, f.ankle.y - py, f.ankle.z - pz).applyQuaternion(turnBack);
        f.leg.reach(q, f.first, vc.copy(vb), qd.copy(turnBack).multiply(f.turn));
      }
      // The trunk turns against the pelvis, and the arms swing against the legs: an arm is ahead when the leg on
      // its side is behind. They swing from the shoulder and bend a little more at the elbow as they come forward.
      const swing = 0.42 * stride * Math.cos(turn) * lively;
      q[WAIST] = -1.5 * twist;
      q[WAIST + 1] = -0.6 * list;
      q[WAIST + 2] = 0.02 * lively;
      for (const [first, side] of [[L_ARM, 1], [R_ARM, -1]]) {
        q[first] = 0.2 + 0.08 * lively - side * swing;
        q[first + 1] = side * 0.17;
        q[first + 2] = 0;
        q[first + 3] = 0.95 + 0.1 * lively - 0.45 * side * swing;
        q[first + 4] = q[first + 5] = q[first + 6] = 0;
      }
      out.angle.set(q);
      return out;
    };

    /**
     * Takes over from a pose made elsewhere (the jog): the feet go on from where that pose has them, the pelvis
     * from the height it has there, and the clock from `phaseNow` (of a stride; the right foot lands at zero).
     */
    const adopt = (pose: Pose, b: Body, phaseNow: number) => {
      phase = ((phaseNow % 1) + 1) % 1;
      stepping = true; lively = 1; taken = pose.z;
      pace = Math.hypot(b.vx, b.vy); spin = Math.abs(b.w);
      q.set(pose.angle);
      const d = both(pace);
      // A foot taken over in the air is given time to come down: the clock is put back to under half its swing.
      for (const f of feet) { const s = progress(f, d); if (s > 0.45 && s < 1) phase -= (s - 0.45) * (0.5 - d); }
      for (const f of feet) {
        f.leg.forward(q, f.first);
        f.turn.copy(pose.turn).multiply(f.leg.R);
        const ahead = va.set(1, 0, 0).applyQuaternion(f.turn);
        f.heading = Math.atan2(ahead.y, ahead.x);
        f.pitch = Math.asin(clamp(ahead.z, -1, 1));
        f.ankle.copy(f.leg.p).applyQuaternion(pose.turn);
        f.ankle.x += pose.x; f.ankle.y += pose.y; f.ankle.z += pose.z;
        f.bend = bendFor(f.leg.p.distanceTo(va.set(0, f.side * HIP_Y, -HIP_Z)));
        const sole = vb.set(0, 0, -SOLE).applyQuaternion(f.turn).add(f.ankle);
        f.px = sole.x; f.py = sole.y; f.pz = Math.max(sole.z, 0);
        const s = progress(f, d);
        f.passed = false;
        if (s >= 0 && s < 1) lift(f, s);
        else { f.air = false; f.x = f.px; f.y = f.py; f.yaw = f.heading; }
      }
    };

    return { step, reset, adopt, feet, get phase() { return phase; }, get stepping() { return stepping; } };
  };

  return { JOINTS, axes, tilts, legs, newPose, walker, STAND, SOLE };
}

/** The model's own skeleton: its pelvis and the link each joint turns, and how a pose is put on them. */
export function bindG1(THREE: Three, model: Obj) {
  const bare = (o: Obj) => o.name.replace(/^robot\/?/, '');
  const find = (name: string) => {
    let found: Obj | undefined;
    model.traverse(o => { if (!found && bare(o) === name) found = o; });
    if (!found) throw new Error(`${name} not found in the model`);
    return found;
  };
  const pelvis = find('pelvis'), links = JOINTS.map(j => find(`${j}_link`));
  const g1 = makeG1(THREE, joint => links[JOINTS.indexOf(joint)].position.toArray());
  const q = new THREE.Quaternion();

  /** Puts a pose on the model. */
  const apply = (pose: Pose) => {
    pelvis.position.set(pose.x, pose.y, pose.z);
    pelvis.quaternion.copy(pose.turn);
    links.forEach((link, i) => {
      link.quaternion.setFromAxisAngle(g1.axes[i], pose.angle[i]);
      const tilt = g1.tilts[i];
      if (tilt) link.quaternion.premultiply(tilt);
    });
  };

  /**
   * A stride cut from one of the model's baked motions (frames `from` to `to`) and closed into a loop: what little
   * the last frame differs from the first by is taken out evenly along the way, so the loop has no seam. The path
   * the motion traveled is dropped, the pelvis keeps its height and its sway of heading, and every link's turn is
   * read back as its joint's angle. `strike` is where in the loop the right foot lands.
   */
  const stride = (clip: import('three').AnimationClip, from: number, to: number) => {
    const n = to - from;
    const values = (node: Obj, what: string) => {
      const track = clip.tracks.find(t => t.name === `${node.name}.${what}`);
      if (!track) throw new Error(`${clip.name} has no ${what} for ${node.name}`);
      return track.values;
    };
    const angles = JOINTS.map((_, i) => {
      const v = values(links[i], 'quaternion'), tilt = g1.tilts[i], axis = g1.axes[i], out = new Float32Array(n + 1);
      for (let k = 0; k <= n; k++) {
        q.fromArray(v, (from + k) * 4);
        if (tilt) q.premultiply(new THREE.Quaternion().copy(tilt).invert());
        out[k] = wrapAngle(2 * Math.atan2(q.x * axis.x + q.y * axis.y + q.z * axis.z, q.w));
      }
      const gap = wrapAngle(out[n] - out[0]);
      for (let k = 0; k <= n; k++) out[k] -= (gap * k) / n;
      return out;
    });
    const place = values(pelvis, 'position'), turn = values(pelvis, 'quaternion');
    const height = new Float32Array(n + 1), heading = new Float32Array(n + 1), tip: Quat[] = [];
    const Z = new THREE.Vector3(0, 0, 1);
    for (let k = 0; k <= n; k++) {
      height[k] = place[(from + k) * 3 + 2];
      q.fromArray(turn, (from + k) * 4);
      const yaw = Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z));
      heading[k] = k ? heading[k - 1] + wrapAngle(yaw - heading[k - 1]) : yaw;
      tip.push(new THREE.Quaternion().setFromAxisAngle(Z, -yaw).multiply(q)); // the pelvis's lean, without its heading
    }
    const rise = height[n] - height[0], veer = heading[n] - heading[0];
    const back = new THREE.Quaternion().copy(tip[n]).invert().multiply(tip[0]), none = new THREE.Quaternion();
    let mean = 0;
    for (let k = 0; k <= n; k++) {
      height[k] -= (rise * k) / n;
      heading[k] -= (veer * k) / n;
      tip[k].multiply(new THREE.Quaternion().copy(none).slerp(back, k / n));
      if (k < n) mean += heading[k] / n;
    }
    const turns = tip.map((t, k) => new THREE.Quaternion().setFromAxisAngle(Z, heading[k] - mean).multiply(t));

    /** The pose at `phase` of the loop (0 to 1), standing over the floor's origin and heading along x. */
    const sample = (phase: number, out: Pose) => {
      const f = (((phase % 1) + 1) % 1) * n, k = Math.min(Math.floor(f), n - 1), u = f - k;
      for (let i = 0; i < angles.length; i++) out.angle[i] = angles[i][k] + (angles[i][k + 1] - angles[i][k]) * u;
      out.x = out.y = 0;
      out.z = height[k] + (height[k + 1] - height[k]) * u;
      out.turn.copy(turns[k]).slerp(turns[k + 1], u);
      return out;
    };
    // Where the right foot lands: its ankle comes down to a foot's height over the floor.
    const pose = g1.newPose(), leg = g1.legs[1], first = JOINTS.indexOf('right_hip_pitch');
    const ankle = (k: number) => {
      sample(k / n, pose);
      leg.forward(pose.angle, first);
      return pose.z + new THREE.Vector3().copy(leg.p).applyQuaternion(pose.turn).z;
    };
    let strike = 0;
    for (let k = 0; k < n; k++) {
      const a = ankle(k), b = ankle(k + 1), level = g1.SOLE + 0.012;
      if (a >= level && b < level) { strike = (k + (a - level) / (a - b)) / n; break; }
    }
    return { sample, strike, frames: n };
  };

  return { ...g1, pelvis, links, apply, stride };
}
