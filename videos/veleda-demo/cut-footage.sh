#!/bin/sh
# Cuts the continuous phone take into footage/f1.mp4 … f9.mp4 for build.mjs.
#   sh cut-footage.sh /path/to/take.mov
# Segment times (seconds into the take) are for the 6 Nov take; re-check them for a new one.
# f2 blurs the Google account chooser's names, photos and emails. f7 ends before the
# stale window-A card and f8 skips it, and the stale claim amount; f8 ends on the Settled list.
# Screen recordings have variable frame timing (a still screen can go seconds without a
# frame), so the take is made constant 60 fps first and trimmed by filter, not by seeking.
set -e
SRC="${1:?usage: sh cut-footage.sh take.mov}"
cd "$(dirname "$0")"; mkdir -p footage
ENC="-an -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p -movflags +faststart"

cut() { # id "s1 e1 [s2 e2 ...]" [filter applied to the joined clip]
  id=$1; post=${3:-null}; set -- $2; n=$(($# / 2)); f="[0:v]fps=60,split=$n"; l=""
  i=0; while [ $i -lt $n ]; do f="$f[c$i]"; i=$((i+1)); done; f="$f;"
  i=0; while [ $# -ge 2 ]; do
    f="$f[c$i]trim=start=$1:end=$2,setpts=PTS-STARTPTS[s$i];"; l="$l[s$i]"; i=$((i+1)); shift 2
  done
  ffmpeg -v error -y -i "$SRC" -filter_complex "${f}${l}concat=n=$n:v=1:a=0,$post[v]" -map "[v]" $ENC "footage/$id.mp4"
}

cut f1 "4.0 24.0"
# The chooser opens at 37.0 s in the take (13.0 s into this clip); 37.0-37.5 is skipped
# because Chrome shows its "414px x 844px" size badge there.
cut f2 "24.0 37.0 37.5 41.9" "split[a][b];[b]crop=440:240:40:535,boxblur=28:4[bl];[a][bl]overlay=40:535:enable='gte(t,12.95)'"
cut f3 "42.5 63.6"
cut f4 "63.6 69.5"
# f5 keeps the tap and drag for window B (85.0-86.5) unbroken; build.mjs plays f5 at most 1.2x.
cut f5 "83.8 92.5 96.8 100.5"
cut f6 "98.5 106.0"
cut f7 "112.0 121.0"
# f8 skips 142.5-148.9, where the resolved card still showed the pre-resolve value (fixed in the app since).
cut f8 "137.0 142.4 149.0 150.5 182.0 187.0"
cut f9 "153.5 163.0"
for f in footage/f*.mp4; do printf '%s %ss\n' "$f" "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$f")"; done
