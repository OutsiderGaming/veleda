#!/usr/bin/env bash
# Turns the three Veleda hero clips into web assets for the home page (app/src/components/Seer.tsx).
#   idle.mp4  breeze loop, starts and ends on still S (facing the viewer)
#   turn.mp4  S -> E, she turns to look over the parapet; scrubbed by scroll
#   end.mp4   breeze loop, starts and ends on still E
# Usage: scripts/seer-frames.sh <dir with idle.mp4 turn.mp4 end.mp4> [frames=48]
# Writes app/public/seer/{idle.mp4,end.mp4,turn-NNN.jpg} and app/src/components/seer-frames.json.
set -euo pipefail
src=${1:?usage: scripts/seer-frames.sh <clip dir> [frames]}
frames=${2:-48}
root=$(cd "$(dirname "$0")/.." && pwd)
out="$root/app/public/seer"
width=720 # the app column is 480 CSS px; 720 covers 1.5x screens, and canvas scaling handles the rest

rm -rf "$out" && mkdir -p "$out"

# Evenly sample `frames` frames across the whole turn, first and last exactly included.
all=$(mktemp -d)
ffmpeg -v error -i "$src/turn.mp4" -vf "scale=$width:-2" -q:v 8 "$all/%05d.jpg" # q8 keeps the engraving texture at about half the size of q4
total=$(ls "$all" | wc -l | tr -d ' ')
n=$(( frames < total ? frames : total ))
for ((i = 0; i < n; i++)); do
  pick=$(( (i * (total - 1) * 2 + (n - 1)) / (2 * (n - 1)) + 1 )) # round(i * (total-1) / (n-1)) + 1
  cp "$all/$(printf %05d "$pick").jpg" "$out/turn-$(printf %03d $((i + 1))).jpg"
done
rm -rf "$all"

# Loops: H.264, no audio, faststart so they play while still downloading.
for clip in idle end; do
  ffmpeg -v error -i "$src/$clip.mp4" -an -vf "scale=$width:-2" -c:v libx264 -profile:v main -pix_fmt yuv420p \
    -crf 26 -preset slow -movflags +faststart "$out/$clip.mp4"
done

# Poster (first frame of the turn, i.e. still S) and dimensions for the component.
cp "$out/turn-001.jpg" "$out/poster.jpg"
read -r w h < <(ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "$out/turn-001.jpg" | tr x ' ')
printf '{ "frames": %d, "width": %d, "height": %d }\n' "$n" "$w" "$h" > "$root/app/src/components/seer-frames.json"
du -sh "$out"
echo "wrote $n frames (${w}x$h) to app/public/seer"
