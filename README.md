# AirType VR — Spatial Air Drawing

Draw in a virtual 4-walled room using only your hand gestures and your webcam. No headset, no stylus — just point, swipe, and erase in mid-air.

Built with [MediaPipe Hands](https://google.github.io/mediapipe/solutions/hands.html) for real-time hand tracking, and a custom canvas pipeline for per-wall stroke rendering with smoothing, glow, and a top-down minimap.

## Features

- **4-wall virtual room** — Front, Right, Back, and Left walls each maintain their own independent set of strokes.
- **Gesture controls** — point to draw, peace sign to navigate, fist to erase, open palm to pause.
- **Swipe navigation** — sweep a peace sign horizontally to rotate to the adjacent wall.
- **Smoothed cursor** — exponential smoothing on the index fingertip for stable lines.
- **Glow + thickness** — adjustable brush size and neon glow per stroke.
- **Per-wall undo & clear** — operate only on the wall you're facing.
- **Live minimap** — top-down view of the room showing which walls have content and where you're looking.
- **Save** — export the current wall (video frame + strokes) as a PNG.

## Gestures

| Gesture | Mode |
|---|---|
| ☝️ Point (index only) | Draw |
| ✌️ Peace (index + middle) | Navigate — swipe left/right to change wall |
| ✊ Fist | Erase under the fingertip |
| ✋ Open hand | Idle / pause |

You can also use the on-screen arrows or the **←/→** arrow keys to switch walls.

## Run it locally

This is a static site — no build step. Because `getUserMedia` requires a secure context, you need to serve it over HTTP rather than opening `index.html` directly.

```bash
# Python
python3 -m http.server 8000

# or Node
npx serve .
```

Then open <http://localhost:8000> and allow camera access.

## Stack

- **HTML / CSS / vanilla JS** — no framework.
- **MediaPipe Hands** (loaded from jsDelivr CDN) for 21-landmark hand tracking.
- **Canvas 2D** for the drawing layer, the overlay (skeleton, cursor, swipe indicator), and the minimap.

## Project structure

```
.
├── index.html   # markup, loading screen, toolbar, prompts
├── style.css    # layout + neon/glassmorphism styling
└── app.js       # state, gesture detection, drawing, navigation, minimap
```

## Tips

- Good lighting on your hand makes detection much more reliable.
- The fingertip is mirrored (`1 - landmark.x`) so the cursor matches the on-screen video.
- Default smoothing is `0.35` — lower it in `state.smoothFactor` for snappier tracking, raise it for steadier lines.
