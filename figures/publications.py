"""Studio renders for the home page: the four publication cards and the GPU of the 131-hours project card
(Blender's Python, Cycles).

  blender -b -P figures/publications.py -- GO2_DIR G1_DIR HDRI OUTDIR [SCENE,SCENE..] [W H SPP]

  GO2_DIR  folder holding go2.xml and assets/*.obj (the Unitree Go2 MJCF)
  G1_DIR   folder holding g1_23dof.xml and meshes/*.STL (the Unitree G1 MJCF)
  HDRI     a studio environment map (.hdr)
  OUTDIR   where <scene>.png is written; scenes are nmpc, admm, hier, thesis, gpu
           (and go2glb, which is not a picture: it writes OUTDIR/go2.glb, the Go2 the section titles of the home
           page pose live)

The gpu scene also uses the G1 of the hero, public/g1-hero.glb, for the motions baked into it.

The look follows the other rendered figures on the site: a soft three-light studio, robots in a light finish, and
translucent orange ghosts for where a robot is going (the same ghosts as the hero). There is no backdrop: the
pictures are transparent apart from the objects and the shadows they cast on the floor, so they sit directly on
the page.
Each scene comes out as layers, which figures/composite.py puts together: <scene>.png is the objects alone,
<scene>_shadow.png the same with the shadows they cast on the floor (so the shadows can be softened and faded out
before the picture's edge), and <scene>_ghost<k>.png each rank of ghost (shading in the color, coverage in the
alpha), which is laid over the picture as flat orange, the way the hero does. `npm run figures` runs both and writes public/pub-*.webp.
"""
import math
import os
import sys
import xml.etree.ElementTree as ET

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

a = sys.argv[sys.argv.index("--") + 1:]
GO2_DIR, G1_DIR, HDRI, OUT = a[0], a[1], a[2], a[3]
SCENES = a[4].split(",") if len(a) > 4 else ["nmpc", "admm", "hier", "thesis", "gpu"]
W, H, SPP = (int(a[5]), int(a[6]), int(a[7])) if len(a) > 7 else (1600, 700, 128)
ASPECT = {"gpu": 1.5625}  # scenes that are not the cards' wide strip: width / height
HERO_GLB = os.path.join(os.path.dirname(os.path.abspath(sys.argv[sys.argv.index("-P") + 1])), "..", "public", "g1-hero.glb")
os.makedirs(OUT, exist_ok=True)


# ── Studio: renderer, materials, sweep, lights, camera ──────────────────────────────────────────────────────────
def setup():
  bpy.ops.wm.read_factory_settings(use_empty=True)
  sc = bpy.context.scene
  sc.render.engine = "CYCLES"
  pr = bpy.context.preferences.addons["cycles"].preferences
  for t in ("METAL", "OPTIX", "CUDA"):
    try:
      pr.compute_device_type = t; pr.refresh_devices()
      if any(d.type == t for d in pr.devices):
        break
    except TypeError:
      pass
  for d in pr.devices:
    d.use = True
  cy = sc.cycles; cy.device = "GPU"; cy.samples = SPP; cy.use_denoising = True
  for k, v in (("max_bounces", 8), ("transparent_max_bounces", 24), ("glossy_bounces", 4)):
    setattr(cy, k, v)
  sc.render.resolution_x, sc.render.resolution_y, sc.render.resolution_percentage = W, H, 100
  sc.render.image_settings.file_format = "PNG"; sc.render.image_settings.color_mode = "RGBA"
  sc.render.film_transparent = True  # no backdrop: the floor below only catches shadows
  sc.view_settings.view_transform = "AgX"; sc.view_settings.look = "AgX - Medium High Contrast"
  sc.view_settings.exposure = -1.25  # white robots on a light sweep: well under the lights' nominal level
  w = bpy.data.worlds.new("w"); sc.world = w; w.use_nodes = True
  nt = w.node_tree; bg = nt.nodes["Background"]; bg.inputs[1].default_value = 0.7
  env = nt.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(HDRI)
  nt.links.new(env.outputs["Color"], bg.inputs["Color"])
  return sc


def mat(name, base, rough, metal=0.0, coat=0.0, emit=None):
  m = bpy.data.materials.new(name); m.use_nodes = True
  b = m.node_tree.nodes["Principled BSDF"]
  b.inputs["Base Color"].default_value = (*base, 1); b.inputs["Roughness"].default_value = rough
  b.inputs["Metallic"].default_value = metal; b.inputs["Coat Weight"].default_value = coat
  if emit:
    b.inputs["Emission Color"].default_value = (*emit[0], 1); b.inputs["Emission Strength"].default_value = emit[1]
  return m


def materials():
  return {
    # the Go2's own materials, by their MJCF names
    "white": mat("white", (0.86, 0.86, 0.87), 0.38, coat=0.4),
    "gray": mat("gray", (0.62, 0.64, 0.68), 0.36, metal=0.35),
    "metal": mat("metal", (0.78, 0.8, 0.82), 0.3, metal=0.85),
    "black": mat("black", (0.035, 0.035, 0.04), 0.4, coat=0.3),
    # the arm and the props
    "shell": mat("shell", (0.88, 0.88, 0.89), 0.36, coat=0.4),
    "arm": mat("arm", (0.012, 0.012, 0.014), 0.22, coat=0.7),             # the Kinova's glossy black links
    "band": mat("band", (0.5, 0.51, 0.53), 0.35, metal=0.7),              # and the gray rings at its joints
    "paper": mat("paper", (0.9, 0.89, 0.86), 0.75),
    "cover": mat("cover", (0.03, 0.032, 0.04), 0.72),
    "glow": mat("glow", (1.0, 0.45, 0.08), 0.4, emit=((1.0, 0.33, 0.03), 7.0)),
    # the graphics card
    "shroud": mat("shroud", (0.03, 0.032, 0.037), 0.42, metal=0.4),
    "fan": mat("fan", (0.014, 0.014, 0.016), 0.3, coat=0.5),
    "steel": mat("steel", (0.72, 0.73, 0.75), 0.32, metal=0.9),
    "gold": mat("gold", (0.9, 0.6, 0.16), 0.3, metal=1.0),
    "pcb": mat("pcb", (0.012, 0.03, 0.02), 0.5),
    "clay": mat("clay", (0.8, 0.8, 0.8), 0.8),                             # what a ghost is shaded as, in its layer
  }


SWEEPS = []


def sweep(color=(0.46, 0.48, 0.52)):
  """The studio's floor and back wall. It still bounces light onto the subject, but in the picture it shows only
  as the shadows that fall on it."""
  prof = [(y, 0.0) for y in np.linspace(-30, 4, 18)] + [(4 + 3 * math.sin(t), 3 - 3 * math.cos(t)) for t in np.linspace(0.1, math.pi / 2, 12)] + [(7, 14)]
  bm = bmesh.new()
  rows = [[bm.verts.new((x, y, z)) for (y, z) in prof] for x in (-40, 40)]
  for k in range(len(prof) - 1):
    bm.faces.new((rows[0][k], rows[1][k], rows[1][k + 1], rows[0][k + 1]))
  me = bpy.data.meshes.new("sweep"); bm.to_mesh(me); bm.free(); me.shade_smooth()
  m = bpy.data.materials.new("sweep"); m.use_nodes = True
  b = m.node_tree.nodes["Principled BSDF"]; b.inputs["Roughness"].default_value = 0.8
  b.inputs["Base Color"].default_value = (*color, 1)
  me.materials.append(m)
  o = bpy.data.objects.new("sweep", me); bpy.context.scene.collection.objects.link(o)
  o.is_shadow_catcher = True
  SWEEPS.append(o)


def lights(ctr, az, scale=1.0):
  sc = bpy.context.scene

  def L(name, a_, e, r, energy, size, col=(1, 1, 1)):
    a_, e = math.radians(a_), math.radians(e)
    p = ctr + Vector((r * math.cos(e) * math.cos(a_), r * math.cos(e) * math.sin(a_), r * math.sin(e)))
    d = bpy.data.lights.new(name, "AREA"); d.energy = energy * scale; d.size = size * scale ** 0.5; d.color = col
    o = bpy.data.objects.new(name, d); sc.collection.objects.link(o); o.location = p
    o.rotation_euler = (ctr - p).to_track_quat("-Z", "Y").to_euler()
  L("key", az + 45, 42, 5, 520, 3.0, (1.0, 0.97, 0.92))
  L("fill", az - 70, 18, 6, 160, 5.0, (0.9, 0.95, 1.0))
  L("rim", az + 175, 40, 5, 800, 2.0, (0.85, 0.92, 1.0))
  L("rim2", az - 160, 30, 5, 450, 2.0, (1.0, 0.95, 0.9))


def camera(tgt, az, el, dist, lens=60, fit=0.8):
  """Looks at `tgt` from azimuth/elevation (degrees), then moves so everything but the sweep fills `fit` of the frame."""
  from bpy_extras.object_utils import world_to_camera_view
  sc = bpy.context.scene
  pts = [o.matrix_world @ Vector(c) for o in sc.objects if o.type == "MESH" and o.name != "sweep" for c in o.bound_box]
  cd = bpy.data.cameras.new("cam"); cd.lens = lens
  c = bpy.data.objects.new("cam", cd); sc.collection.objects.link(c); sc.camera = c
  ar, er = math.radians(az), math.radians(el)
  c.location = tgt + Vector((dist * math.cos(er) * math.cos(ar), dist * math.cos(er) * math.sin(ar), dist * math.sin(er)))
  for sw in SWEEPS:  # the backdrop always faces the camera
    sw.matrix_world = Matrix.Translation(Vector((tgt.x, tgt.y, 0))) @ Matrix.Rotation(ar + math.pi / 2, 4, "Z")
  c.rotation_euler = (tgt - c.location).to_track_quat("-Z", "Y").to_euler()
  aspect = W / H
  for _ in range(8):
    bpy.context.view_layer.update()
    uv = [world_to_camera_view(sc, c, p) for p in pts]
    us, vs = [u.x for u in uv], [u.y for u in uv]
    cu, cv = (min(us) + max(us)) / 2 - 0.5, (min(vs) + max(vs)) / 2 - 0.5
    fwd = (tgt - c.location).normalized(); right = fwd.cross(Vector((0, 0, 1))).normalized(); up = right.cross(fwd)
    d = (tgt - c.location).length
    span_w = 36.0 / lens * d  # width of the view at the target, in meters (36 mm sensor)
    tgt = tgt + right * cu * span_w + up * cv * span_w / aspect
    d *= max(max(us) - min(us), max(vs) - min(vs)) / fit
    c.location = tgt - fwd * d
    c.rotation_euler = (tgt - c.location).to_track_quat("-Z", "Y").to_euler()


def render(name):
  """The layers of a picture: the objects alone; the objects with their shadows on the floor; then one layer per
  rank of ghost, with everything else cut out of it so a robot standing in front of a ghost still hides it."""
  sc = bpy.context.scene

  def shot(suffix, samples=SPP):
    sc.cycles.samples = samples
    sc.render.filepath = f"{OUT}/{name}{suffix}.png"
    bpy.ops.render.render(write_still=True)

  ghosts = [o for o in sc.objects if "ghost" in o]
  for o in ghosts:
    o.hide_render = True
  for sw in SWEEPS:  # the floor lights the scene but is not in the picture
    sw.visible_camera = False
  shot("")
  for sw in SWEEPS:
    sw.visible_camera = True
  shot("_shadow", max(SPP // 2, 16))
  if ghosts:
    for o in sc.objects:
      if o.type == "MESH" and "ghost" not in o:
        o.is_holdout = True
    for k in sorted({o["ghost"] for o in ghosts}):
      for o in ghosts:
        o.hide_render = o["ghost"] != k
      shot(f"_ghost{k}")
  print("RENDERED", name, flush=True)


# ── Robots, read from their MJCF and posed by forward kinematics ───────────────────────────────────────────────
def vec(s, default):
  return [float(x) for x in s.split()] if s else list(default)


def xform(el):
  return Matrix.Translation(Vector(vec(el.get("pos"), (0, 0, 0)))) @ Quaternion(vec(el.get("quat"), (1, 0, 0, 0))).to_matrix().to_4x4()


class Robot:
  def __init__(self, xml, rest):
    self.root = ET.parse(xml).getroot(); self.rest = rest
    meshdir = os.path.join(os.path.dirname(xml), self.root.find("compiler").get("meshdir", ""))
    self.files = {m.get("name") or os.path.splitext(m.get("file"))[0]: os.path.join(meshdir, m.get("file")) for m in self.root.iter("mesh")}
    self.meshes = {}

  def mesh(self, name):
    """(mesh data, its vertices as an array). The file's own axes are kept: MJCF meshes are already z-up."""
    if name not in self.meshes:
      f = self.files[name]
      load = bpy.ops.wm.stl_import if f.lower().endswith(".stl") else bpy.ops.wm.obj_import
      load(filepath=f, forward_axis="Y", up_axis="Z")
      obs = list(bpy.context.selected_objects)
      me = obs[0].data; me.materials.clear()
      for o in obs:
        bpy.data.objects.remove(o)
      me.shade_smooth()
      try:
        me.set_sharp_from_angle(angle=math.radians(40))
      except AttributeError:
        pass
      v = np.empty(len(me.vertices) * 3, dtype=np.float32); me.vertices.foreach_get("co", v)
      self.meshes[name] = (me, v.reshape(-1, 3))
    return self.meshes[name]

  def parts(self, pose):
    """[(mesh name, material name, transform in the base frame)] for joint angles `pose` (by joint name, no _joint)."""
    out = []

    def walk(body, T):
      for j in body.findall("joint"):
        if j.get("type") == "free":
          continue
        name = j.get("name").replace("_joint", "")
        T = T @ Matrix.Rotation(pose.get(name, self.rest(name)), 4, Vector(vec(j.get("axis"), (0, 0, 1))))
      for g in body.findall("geom"):
        if g.get("mesh") and (g.get("class") == "visual" or g.get("contype") == "0"):
          # the Go2 names its materials; the G1 only gives a gray level, which becomes shell or dark
          material = g.get("material") or ("black" if vec(g.get("rgba"), (1, 1, 1, 1))[0] < 0.5 else "shell")
          out.append((g.get("mesh"), material, T @ xform(g)))
      for b in body.findall("body"):
        walk(b, T @ xform(b))

    walk(self.root.find("worldbody/body"), Matrix.Identity(4))
    return out


ROBOTS = {}


def robot(kind):
  if kind not in ROBOTS:
    if kind == "go2":
      ROBOTS[kind] = Robot(f"{GO2_DIR}/go2.xml", lambda j: {"hip": 0.0, "thigh": 0.8, "calf": -1.5}[j.split("_")[1]])
    else:
      ROBOTS[kind] = Robot(f"{G1_DIR}/g1_23dof.xml", lambda j: G1_STAND.get(j, 0.0))
  return ROBOTS[kind]


# A Go2 trot caught mid-stride: one diagonal pair planted, the other lifted and reaching forward. TROT_B is the
# other half of the stride.
TROT = {"FL_thigh": 0.55, "FL_calf": -1.75, "RR_thigh": 0.62, "RR_calf": -1.75,
        "FR_thigh": 1.0, "FR_calf": -1.45, "RL_thigh": 1.0, "RL_calf": -1.45}
TROT_B = {"FR_thigh": 0.55, "FR_calf": -1.75, "RL_thigh": 0.62, "RL_calf": -1.75,
          "FL_thigh": 1.0, "FL_calf": -1.45, "RR_thigh": 1.0, "RR_calf": -1.45}
# The G1 standing with soft knees, and mid-step with the left leg leading.
G1_STAND = {"left_hip_pitch": -0.1, "left_knee": 0.3, "left_ankle_pitch": -0.2,
            "right_hip_pitch": -0.1, "right_knee": 0.3, "right_ankle_pitch": -0.2,
            "left_shoulder_pitch": 0.25, "right_shoulder_pitch": 0.25, "left_shoulder_roll": 0.2, "right_shoulder_roll": -0.2,
            "left_elbow": 0.9, "right_elbow": 0.9}
G1_WALK = {"left_hip_pitch": -0.55, "left_knee": 0.5, "left_ankle_pitch": 0.0,
           "right_hip_pitch": 0.2, "right_knee": 0.55, "right_ankle_pitch": -0.5,
           "left_shoulder_pitch": 0.5, "right_shoulder_pitch": -0.25, "left_shoulder_roll": 0.2, "right_shoulder_roll": -0.2,
           "left_elbow": 0.7, "right_elbow": 0.9, "waist_yaw": -0.12}


def add_robot(M, kind, at=(0, 0), yaw=0.0, pose=None, ground=0.0, ghost=None):
  """A robot with its lowest point on z = `ground`. `ghost` (0, 1, 2: how far ahead) makes it a ghost instead,
  which goes to that rank's layer rather than into the picture. Returns its base transform, for mounting things."""
  sc = bpy.context.scene
  r = robot(kind); parts = r.parts(pose or {})
  low = min(float((np.c_[r.mesh(mesh)[1], np.ones(len(r.mesh(mesh)[1]))] @ np.array(local).T)[:, 2].min()) for mesh, _, local in parts)
  T = Matrix.Translation(Vector((at[0], at[1], ground - low))) @ Matrix.Rotation(yaw, 4, "Z")
  for mesh, material, local in parts:
    me = r.mesh(mesh)[0].copy(); me.materials.append(M[material if ghost is None else "clay"])
    ob = bpy.data.objects.new(f"{kind}_{mesh}", me); sc.collection.objects.link(ob)
    ob.matrix_world = T @ local
    if ghost is not None:
      ob["ghost"] = ghost
  return T


class Hero:
  """The G1 of the home page's hero, with the motions baked into it: a pose is one frame of one of them."""

  def __init__(self, M):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=HERO_GLB)
    obs = [o for o in bpy.data.objects if o not in before]
    self.meshes = [o for o in obs if o.type == "MESH"]
    self.animated = [o for o in obs if o.animation_data]
    self.pelvis = next(o for o in obs if o.name.endswith("pelvis"))
    for o in self.animated:
      for t in o.animation_data.nla_tracks:
        t.mute = True
    for o in obs:  # the imported robot is only a source of poses
      o.hide_render = True
    look, done = {"shell": "shell", "dark": "black", "glow": "black"}, set()
    for o in self.meshes:
      if o.data.name not in done:
        done.add(o.data.name)
        key = look.get(o.data.materials[0].name.split(".")[0], "shell") if o.data.materials else "shell"
        o.data.materials.clear(); o.data.materials.append(M[key])

  def add(self, clip, frame, at=(0, 0), facing=0.0, ground=0.0):
    """A copy of the robot as it is at `frame` of `clip`, standing on z = `ground` and turned to face `facing`."""
    sc = bpy.context.scene; act = bpy.data.actions[clip]
    for o in self.animated:
      o.animation_data.action = act
      o.animation_data.action_slot = next(sl for sl in act.slots if sl.name_display == o.name)
    sc.frame_set(frame); dg = bpy.context.evaluated_depsgraph_get()
    world = [(o, o.evaluated_get(dg).matrix_world.copy()) for o in self.meshes]
    pel = self.pelvis.evaluated_get(dg).matrix_world.copy()
    fwd = pel.to_3x3() @ Vector((1, 0, 0))  # the pelvis looks along its own x
    low = min((mw @ Vector(c)).z for o, mw in world for c in o.bound_box)
    T = (Matrix.Translation(Vector((at[0], at[1], ground - low))) @ Matrix.Rotation(facing - math.atan2(fwd.y, fwd.x), 4, "Z")
         @ Matrix.Translation(Vector((-pel.translation.x, -pel.translation.y, 0))))
    for o, mw in world:
      ob = bpy.data.objects.new(f"g1_{clip}{frame}", o.data); sc.collection.objects.link(ob)
      ob.matrix_world = T @ mw


# ── Props ───────────────────────────────────────────────────────────────────────────────────────────────────────
def rod(M, key, p0, p1, r):
  p0, p1 = Vector(p0), Vector(p1)
  bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=(p1 - p0).length, location=(p0 + p1) / 2, vertices=40)
  o = bpy.context.object; o.rotation_euler = (p1 - p0).to_track_quat("Z", "Y").to_euler()
  o.data.materials.append(M[key]); o.data.shade_smooth()
  try:
    o.data.set_sharp_from_angle(angle=math.radians(40))
  except AttributeError:
    pass
  return o


def ball(M, key, p, r, shadow=True):
  bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=p, segments=32, ring_count=16)
  o = bpy.context.object; o.data.materials.append(M[key]); o.data.shade_smooth(); o.visible_shadow = shadow
  return o


def box(M, key, loc, dims, bevel=0.02):
  bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
  o = bpy.context.object; o.scale = dims
  bpy.ops.object.transform_apply(scale=True)
  b = o.modifiers.new("b", "BEVEL"); b.width = bevel; b.segments = 6
  o.data.materials.append(M[key]); o.data.shade_smooth()
  return o


def floor_ring(M, at, r, t=0.011):
  bpy.ops.mesh.primitive_torus_add(location=(at[0], at[1], t), major_radius=r, minor_radius=t, major_segments=96, minor_segments=12)
  o = bpy.context.object; o.data.materials.append(M["glow"]); o.data.shade_smooth(); o.visible_shadow = False
  return o


def add_arm(M, T):
  """The arm on the Go2's back, after the Kinova in the paper: glossy black links with gray bands at the joints,
  a tall upper arm leaning back and a forearm reaching forward. Points are in the robot's base frame."""
  P = lambda x, y, z: T @ Vector((x, y, z))

  def link(p0, p1, r, bands=(0.12, 0.88)):
    rod(M, "arm", p0, p1, r)
    for t in bands:  # a short gray ring, a little proud of the link
      c = p0.lerp(p1, t); h = (p1 - p0).normalized() * 0.016
      rod(M, "band", c - h, c + h, r + 0.003)

  mount, shoulder = P(-0.03, 0, 0.055), P(-0.03, 0, 0.21)
  elbow, wrist, hand = P(-0.13, 0, 0.62), P(0.24, 0, 0.67), P(0.35, 0, 0.665)
  rod(M, "band", mount, P(-0.03, 0, 0.075), 0.055)                       # base plate
  link(P(-0.03, 0, 0.075), shoulder, 0.046, bands=(0.5,))
  link(shoulder, elbow, 0.04)
  link(elbow, wrist, 0.036)
  link(wrist, hand, 0.032, bands=(0.5,))
  for p, r in ((shoulder, 0.05), (elbow, 0.046), (wrist, 0.04)):
    ball(M, "arm", p, r)
  rod(M, "arm", hand, P(0.385, 0, 0.663), 0.036)                         # gripper body
  for side in (1, -1):  # two fingers
    rod(M, "band", P(0.385, 0.024 * side, 0.663), P(0.46, 0.034 * side, 0.655), 0.009)


def along(path, dist):
  """The point `dist` meters along the polyline `path`, and the heading there."""
  for (x0, y0), (x1, y1) in zip(path, path[1:]):
    seg = math.hypot(x1 - x0, y1 - y0)
    if dist <= seg:
      break
    dist -= seg
  t = min(dist / seg, 1.0)
  return (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t), math.atan2(y1 - y0, x1 - x0)


def go2_on_path(M, path, start=0.0, gap=0.97):
  """A Go2 on `path`, and three ghosts of it further along: where it is going."""
  at, yaw = along(path, start)
  add_robot(M, "go2", at=at, yaw=yaw, pose=TROT)
  for k in range(3):
    at, yaw = along(path, start + gap * (k + 1))
    add_robot(M, "go2", at=at, yaw=yaw, pose=TROT_B if k % 2 == 0 else TROT, ghost=k)


def bezier(p0, c, p1, n=40):
  return [((1 - t) ** 2 * p0[0] + 2 * (1 - t) * t * c[0] + t * t * p1[0], (1 - t) ** 2 * p0[1] + 2 * (1 - t) * t * c[1] + t * t * p1[1]) for t in np.linspace(0, 1, n)]


# ── Scenes: one simple element per publication ──────────────────────────────────────────────────────────────────
def scene_nmpc(M):
  """Loco-manipulation: a quadruped carrying an arm."""
  T = add_robot(M, "go2", pose=TROT)
  add_arm(M, T)
  sweep(); lights(Vector((0, 0, 0.4)), -60)
  camera(Vector((0.05, 0, 0.35)), -62, 7, 3.2, fit=0.74)


def scene_admm(M):
  """Distributed MPC with barrier functions: a team, each robot inside its own safety ring."""
  spots = [((-0.95, 0.5), 0.15), ((0.2, -0.45), -0.1), ((1.3, 0.55), 0.2)]
  for k, (at, yaw) in enumerate(spots):
    add_robot(M, "go2", at=at, yaw=yaw, pose=TROT if k != 1 else None)
    floor_ring(M, (at[0] + 0.02, at[1]), 0.56)
  sweep(); lights(Vector((0.2, 0, 0.4)), -70, 1.6)
  camera(Vector((0.2, 0.1, 0.2)), -80, 24, 6.0, lens=55, fit=0.84)


def scene_hier(M):
  """Multi-agent navigation: two robots trading places, their planned motion bowing around each other."""
  go2_on_path(M, bezier((-1.9, -0.45), (0.0, -1.5), (1.9, -0.4)))   # left to right, bowing toward the camera
  go2_on_path(M, bezier((1.9, 0.45), (0.0, 1.5), (-1.9, 0.4)))      # right to left, bowing away
  sweep(); lights(Vector((0, 0, 0.4)), -70, 1.8)
  camera(Vector((0, 0, 0.15)), -86, 24, 7.0, lens=55, fit=0.88)


def scene_thesis(M):
  """The thesis: a book, with quadrupeds and humanoids walking across its cover (the method does not care which)."""
  w, d, h = 3.0, 2.1, 0.36
  box(M, "paper", (0.02, 0, h / 2), (w - 0.1, d - 0.08, h - 0.07), bevel=0.01)       # the pages
  box(M, "cover", (0, 0, h - 0.0175), (w, d, 0.035), bevel=0.012)                      # front cover
  box(M, "cover", (0, 0, 0.0175), (w, d, 0.035), bevel=0.012)                          # back cover
  box(M, "cover", (-w / 2 + 0.02, 0, h / 2), (0.04, d, h), bevel=0.015)                # spine
  add_robot(M, "g1", at=(-0.85, 0.4), yaw=0.1, pose=G1_WALK, ground=h)
  add_robot(M, "go2", at=(-0.2, -0.45), yaw=-0.05, pose=TROT, ground=h)
  add_robot(M, "g1", at=(0.45, 0.45), yaw=-0.15, ground=h)
  add_robot(M, "go2", at=(1.0, -0.3), yaw=0.12, pose=TROT_B, ground=h)
  sweep(); lights(Vector((0, 0, 0.7)), -60, 1.6)
  camera(Vector((0, 0, 0.6)), -58, 22, 6.5, lens=55, fit=0.86)


def scene_gpu(M):
  """131 hours of motion on a mid-range GPU: a graphics card lying fans up, a crowd of G1s moving across it."""
  u = 2.3  # the card is this many times a real one's proportions in meters, so the robots are small on it
  L, D, T = 3.3 * u, 1.5 * u, 0.42 * u  # the card: length, depth, thickness
  shroud = box(M, "shroud", (0, 0, T / 2 + 0.02 * u), (L, D, T - 0.04 * u), bevel=0.035 * u)
  box(M, "steel", (0, 0, 0.02 * u), (L, D, 0.04 * u), bevel=0.008 * u)                  # backplate
  for cx in (-0.82 * u, 0.82 * u):  # two fans, each in a shallow well cut into the shroud
    bpy.ops.mesh.primitive_cylinder_add(radius=0.6 * u, depth=0.12 * u, location=(cx, 0, T), vertices=128)
    cut = bpy.context.object; cut.hide_render = True; cut.display_type = "WIRE"
    m = shroud.modifiers.new("well", "BOOLEAN"); m.operation = "DIFFERENCE"; m.object = cut
    z = T - 0.045 * u
    bpy.ops.mesh.primitive_cylinder_add(radius=0.17 * u, depth=0.05 * u, location=(cx, 0, z), vertices=64)
    bpy.context.object.data.materials.append(M["fan"]); bpy.context.object.data.shade_smooth()
    for k in range(13):
      ang = k * 2 * math.pi / 13
      bpy.ops.mesh.primitive_cube_add(size=1, location=(cx + 0.37 * u * math.cos(ang), 0.37 * u * math.sin(ang), z))
      blade = bpy.context.object; blade.scale = (0.42 * u, 0.17 * u, 0.012 * u)
      blade.rotation_euler = (math.radians(9), 0, ang + 0.45)  # swept back and pitched
      blade.data.materials.append(M["fan"])
    bpy.ops.mesh.primitive_torus_add(location=(cx, 0, T - 0.004 * u), major_radius=0.6 * u, minor_radius=0.014 * u, major_segments=128, minor_segments=12)
    bpy.context.object.data.materials.append(M["steel"]); bpy.context.object.data.shade_smooth()
  # the end bracket with its ports, and the edge connector along the side facing the camera
  box(M, "steel", (L / 2 + 0.015 * u, -0.07 * u, T / 2), (0.03 * u, D + 0.26 * u, T), bevel=0.004 * u)
  for k in range(4):
    box(M, "fan", (L / 2 + 0.028 * u, (-0.5 + 0.3 * k) * u, 0.27 * u), (0.02 * u, 0.2 * u, 0.075 * u), bevel=0.004 * u)
  box(M, "pcb", (-0.15 * u, -D / 2 - 0.03 * u, 0.075 * u), (L - 0.5 * u, 0.08 * u, 0.025 * u), bevel=0.003 * u)
  box(M, "gold", (-0.55 * u, -D / 2 - 0.1 * u, 0.075 * u), (1.5 * u, 0.1 * u, 0.018 * u), bevel=0.002 * u)
  for x in np.arange(-1.27, 0.2, 0.06):  # the gaps between the connector's fingers
    box(M, "pcb", (x * u, -D / 2 - 0.1 * u, 0.085 * u), (0.012 * u, 0.1 * u, 0.004 * u), bevel=0.0)

  hero = Hero(M)
  rng = np.random.default_rng(7)
  spots = [(x, y) for x in np.linspace(-L / 2 + 0.6, L / 2 - 0.6, 6) for y in np.linspace(-D / 2 + 0.5, D / 2 - 0.5, 4)]
  for i, (x, y) in enumerate(spots):
    if i in (2, 9, 13, 20):  # leave a few gaps, so it is a crowd and not a grid
      continue
    clip = ("dance", "fight", "run")[i % 3]
    hero.add(clip, int(rng.integers(12, 250)), at=(x + rng.uniform(-0.25, 0.25), y + rng.uniform(-0.18, 0.18)),
             facing=-math.pi / 2 + rng.uniform(-0.9, 0.9), ground=T)
  sweep(); lights(Vector((0, 0, 1.0)), -60, 3.2)
  camera(Vector((0, 0, 1.0)), -60, 24, 14, lens=55, fit=0.86)


def export_go2(path):
  """The Go2 as a model the page can pose (src/scripts/titles.ts): a tree of its bodies and joints, each joint node
  carrying its axis, with the meshes thinned to a size a browser can load."""
  setup(); ROBOTS.clear(); M = materials(); r = robot("go2"); sc = bpy.context.scene; thin = {}

  def node(name, parent, local):
    e = bpy.data.objects.new(name, None); sc.collection.objects.link(e); e.parent = parent; e.matrix_local = local
    return e

  def mesh(name, material):
    if (name, material) not in thin:
      me = r.mesh(name)[0].copy()
      ob = bpy.data.objects.new("tmp", me); sc.collection.objects.link(ob)
      d = ob.modifiers.new("d", "DECIMATE"); d.ratio = min(1.0, 1800 / max(len(me.polygons), 1))
      out = bpy.data.meshes.new_from_object(ob.evaluated_get(bpy.context.evaluated_depsgraph_get()))
      bpy.data.objects.remove(ob); out.shade_smooth(); out.materials.clear(); out.materials.append(M[material])
      while out.uv_layers:  # nothing is textured
        out.uv_layers.remove(out.uv_layers[0])
      thin[(name, material)] = out
    return thin[(name, material)]

  def walk(body, parent, local):
    at = node("body_" + body.get("name"), parent, local)
    for j in body.findall("joint"):
      if j.get("type") == "free":
        continue
      at = node("joint_" + j.get("name").replace("_joint", ""), at, Matrix.Identity(4))
      at["axis"] = vec(j.get("axis"), (0, 0, 1))
    for g in body.findall("geom"):
      if g.get("mesh") and (g.get("class") == "visual" or g.get("contype") == "0"):
        ob = bpy.data.objects.new(g.get("mesh"), mesh(g.get("mesh"), g.get("material") or "white"))
        sc.collection.objects.link(ob); ob.parent = at; ob.matrix_local = xform(g)
    for b in body.findall("body"):
      walk(b, at, xform(b))

  walk(r.root.find("worldbody/body"), None, Matrix.Identity(4))
  bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_extras=True, export_animations=False)
  print("RENDERED", path, flush=True)


H_WIDE = H
for name in SCENES:
  if name == "go2glb":
    export_go2(f"{OUT}/go2.glb"); continue
  H = round(W / ASPECT[name]) if name in ASPECT else H_WIDE
  setup(); ROBOTS.clear(); SWEEPS.clear()
  globals()[f"scene_{name}"](materials())
  render(name)
