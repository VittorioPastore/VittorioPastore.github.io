#!/bin/sh
# Renders the figures in this folder into public/. Run from the project root: npm run figures
#   - the GPU memory chart: headless Chrome, 4× PNG
#   - the four publication images and the GPU of the 131-hours card: Blender (Cycles), then figures/composite.py adds the orange ghosts and writes WebP
# The publication images need three things that live outside this repository: the Unitree Go2 model (go2.xml with
# its assets/ folder), the Unitree G1 model (g1_23dof.xml with its meshes/ folder) and a studio environment map.
# Point GO2_DIR, G1_DIR and HDRI at them.
#
# Not rendered here: public/mlx-humanoid-laptop.webp, the MacBook project card. It is the `laptop` scene of
# figures/mlx/src/illus_g1.py in the training repository, at 1600x1024 with the camera's fit set to 0.85 (the
# figure in the post uses 0.92), from poses baked by that folder's bake_g1.py out of runs/mlx_lafan1/rollouts and
# the sim_r curve of runs/mlx_lafan1_2h/train_log.csv.
set -e
CHROME="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
GO2_DIR="${GO2_DIR:-$HOME/Developer/Kinematic_DNMPC_RL/1_Train/resources/robots/go2}"
G1_DIR="${G1_DIR:-$HOME/Developer/Kinematic_DNMPC_RL/1_Train/resources/robots/g1_description}"
HDRI="${HDRI:-$HOME/.claude/skills/paper-figure/assets/studio_small_03_2k.hdr}"

"$CHROME" --headless=new --hide-scrollbars --allow-file-access-from-files --force-device-scale-factor=4 \
  --virtual-time-budget=3000 --window-size=496,316 --screenshot="$PWD/public/bones-seed-gpu-memory.png" \
  "file://$PWD/figures/gpu-memory.html" 2>/dev/null
echo "public/bones-seed-gpu-memory.png"

TILES="$(mktemp -d)"
blender -b -P figures/publications.py -- "$GO2_DIR" "$G1_DIR" "$HDRI" "$TILES" nmpc,admm,hier,thesis,gpu 1600 700 128 | grep RENDERED
python3 figures/composite.py "$TILES" public nmpc admm hier thesis gpu:bones-seed-gpu
rm -rf "$TILES"
