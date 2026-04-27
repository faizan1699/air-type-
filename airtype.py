"""
AirType - Python edition.

Single hand  -> drawing/typing mode (index finger draws, fist erases).
Two hands    -> play mode: rainbow links between corresponding fingertips.

Run:  python3 airtype.py
Quit: press 'q' or ESC.
Clear canvas: press 'c'.
Save: press 's'.
"""

import math
import os
import time
from collections import deque

import cv2
import mediapipe as mp
import numpy as np

mp_hands = mp.solutions.hands

FINGER_TIPS = [4, 8, 12, 16, 20]
FINGER_PIPS = [3, 6, 10, 14, 18]
HAND_CONNECTIONS = [
    (0, 1), (1, 2), (2, 3), (3, 4),
    (0, 5), (5, 6), (6, 7), (7, 8),
    (5, 9), (9, 10), (10, 11), (11, 12),
    (9, 13), (13, 14), (14, 15), (15, 16),
    (13, 17), (17, 18), (18, 19), (19, 20),
    (0, 17),
]

RAINBOW = [
    (68, 23, 255),    # red    BGR
    (0, 145, 255),    # orange
    (0, 234, 255),    # yellow
    (3, 255, 118),    # green
    (255, 229, 0),    # cyan
    (255, 121, 41),   # blue
    (249, 0, 213),    # magenta
]

DRAW_COLOR = (255, 229, 0)         # cyan in BGR
ERASER_RADIUS = 36
SMOOTH_FACTOR = 0.4
PLAY_DEBOUNCE_FRAMES = 2


def detect_gesture(landmarks):
    fingers = []
    is_right = landmarks[17].x < landmarks[5].x
    if is_right:
        fingers.append(1 if landmarks[4].x < landmarks[3].x else 0)
    else:
        fingers.append(1 if landmarks[4].x > landmarks[3].x else 0)
    for i in range(1, 5):
        fingers.append(1 if landmarks[FINGER_TIPS[i]].y < landmarks[FINGER_PIPS[i]].y else 0)

    extended = sum(fingers)
    if fingers[1] == 1 and fingers[2] == 0 and fingers[3] == 0 and fingers[4] == 0:
        return "point"
    if fingers[1] == 1 and fingers[2] == 1 and fingers[3] == 0 and fingers[4] == 0:
        return "peace"
    if extended <= 1:
        return "fist"
    if extended >= 4:
        return "open"
    return "open"


def has_3d_depth(wlm):
    if not wlm or len(wlm) < 21:
        return True
    zs = [p.z for p in wlm]
    xs = [p.x for p in wlm]
    ys = [p.y for p in wlm]
    z_range = max(zs) - min(zs)
    xy_diag = math.hypot(max(xs) - min(xs), max(ys) - min(ys))
    if z_range < 0.015:
        return False
    if xy_diag > 0 and z_range / xy_diag < 0.08:
        return False
    return True


def is_real_hand(lm):
    if not (0 < lm[0].x < 1 and 0 < lm[0].y < 1):
        return False

    span = math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y)
    if span < 0.04:
        return False

    wrist_to_mcp = [
        math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y) for i in (5, 9, 13, 17)
    ]
    if min(wrist_to_mcp) < 0.001 or max(wrist_to_mcp) / min(wrist_to_mcp) > 2.2:
        return False

    xs = [p.x for p in lm]
    ys = [p.y for p in lm]
    if (max(xs) - min(xs)) > 0.65 or (max(ys) - min(ys)) > 0.65:
        return False

    return True


def filter_real_hands(landmarks_data, handedness, world_landmarks_data):
    real_lms = []
    real_hd = []
    for i, lm in enumerate(landmarks_data):
        conf = (
            handedness[i].classification[0].score
            if handedness is not None and i < len(handedness)
            else 0.5
        )
        if conf < 0.85:
            continue
        if not is_real_hand(lm):
            continue
        wlm = world_landmarks_data[i] if i < len(world_landmarks_data) else None
        if not has_3d_depth(wlm):
            continue
        real_lms.append(lm)
        real_hd.append(handedness[i] if handedness is not None and i < len(handedness) else None)
    return real_lms, real_hd


def both_hands_valid(lm1, lm2, handedness):
    if handedness is None or len(handedness) < 2:
        return False
    s0 = handedness[0].classification[0].score
    s1 = handedness[1].classification[0].score
    if s0 < 0.7 or s1 < 0.7:
        return False

    if not is_real_hand(lm1) or not is_real_hand(lm2):
        return False

    if math.hypot(lm1[0].x - lm2[0].x, lm1[0].y - lm2[0].y) < 0.1:
        return False

    return True


def pick_primary(landmarks_list, handedness):
    if not landmarks_list:
        return None
    if len(landmarks_list) == 1:
        return landmarks_list[0]
    best, best_score = 0, -1.0
    for i, lm in enumerate(landmarks_list):
        conf = handedness[i].classification[0].score if handedness and i < len(handedness) else 0.5
        sp = math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y)
        in_frame = 1.0 if 0.02 < lm[0].x < 0.98 and 0.02 < lm[0].y < 0.98 else 0.0
        score = conf * 2 + sp * 5 + in_frame
        if score > best_score:
            best_score, best = score, i
    return landmarks_list[best]


def draw_skeleton(frame, lm, w, h):
    for s, e in HAND_CONNECTIONS:
        x1, y1 = int(lm[s].x * w), int(lm[s].y * h)
        x2, y2 = int(lm[e].x * w), int(lm[e].y * h)
        cv2.line(frame, (x1, y1), (x2, y2), (180, 180, 180), 1, cv2.LINE_AA)
    for i, p in enumerate(lm):
        x, y = int(p.x * w), int(p.y * h)
        r = 4 if i in FINGER_TIPS else 2
        cv2.circle(frame, (x, y), r, (255, 229, 0), -1, cv2.LINE_AA)


def draw_hand_link(frame, lm1, lm2, w, h, pulse_t, particles):
    pairs = [(4, 4), (8, 8), (12, 12), (16, 16), (20, 20), (0, 0)]
    pulse = (math.sin(pulse_t) + 1) / 2
    for idx, (a, b) in enumerate(pairs):
        pa, pb = lm1[a], lm2[b]
        if not (-0.02 < pa.x < 1.02 and -0.02 < pa.y < 1.02):
            continue
        if not (-0.02 < pb.x < 1.02 and -0.02 < pb.y < 1.02):
            continue
        x1, y1 = int(pa.x * w), int(pa.y * h)
        x2, y2 = int(pb.x * w), int(pb.y * h)
        color = RAINBOW[(idx + int(pulse_t)) % len(RAINBOW)]

        thickness = int(3 + pulse * 3)
        steps = 24
        mid_x = (x1 + x2) // 2
        mid_y = (y1 + y2) // 2 - 30 - idx * 4
        prev = (x1, y1)
        for s in range(1, steps + 1):
            t = s / steps
            bx = int((1 - t) * (1 - t) * x1 + 2 * (1 - t) * t * mid_x + t * t * x2)
            by = int((1 - t) * (1 - t) * y1 + 2 * (1 - t) * t * mid_y + t * t * y2)
            cv2.line(frame, prev, (bx, by), color, thickness, cv2.LINE_AA)
            prev = (bx, by)

        r = int(5 + pulse * 3)
        cv2.circle(frame, (x1, y1), r, color, -1, cv2.LINE_AA)
        cv2.circle(frame, (x2, y2), r, color, -1, cv2.LINE_AA)

        if np.random.rand() < 0.4:
            particles.append({
                "x": mid_x + (np.random.rand() - 0.5) * 40,
                "y": mid_y + (np.random.rand() - 0.5) * 40,
                "vx": (np.random.rand() - 0.5) * 1.5,
                "vy": -1 - np.random.rand() * 1.5,
                "life": 1.0,
                "color": color,
                "size": 2 + np.random.rand() * 3,
            })

    alive = []
    for p in particles:
        p["x"] += p["vx"]
        p["y"] += p["vy"]
        p["life"] -= 0.02
        if p["life"] <= 0:
            continue
        alpha = max(p["life"], 0)
        radius = max(int(p["size"] * p["life"]), 1)
        overlay = frame.copy()
        cv2.circle(overlay, (int(p["x"]), int(p["y"])), radius, p["color"], -1, cv2.LINE_AA)
        cv2.addWeighted(overlay, alpha, frame, 1 - alpha, 0, frame)
        alive.append(p)
    particles[:] = alive

    cv2.putText(
        frame, "Hands Linked! Play Mode",
        (w // 2 - 170, 50),
        cv2.FONT_HERSHEY_DUPLEX, 1.0, (200, 120, 255), 2, cv2.LINE_AA,
    )


def draw_stroke(canvas, points, color, thickness):
    if len(points) < 2:
        return
    for i in range(1, len(points)):
        cv2.line(canvas, points[i - 1], points[i], color, thickness, cv2.LINE_AA)


def main():
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        print("Camera kholne mein masla. Webcam check karen.")
        return

    cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1280)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 720)

    hands = mp_hands.Hands(
        max_num_hands=2,
        model_complexity=1,
        min_detection_confidence=0.8,
        min_tracking_confidence=0.6,
    )

    canvas = None
    current_stroke = []
    is_drawing = False

    smooth_x, smooth_y = 0.0, 0.0
    smooth_init = False

    play_mode = False
    play_streak = 0
    play_particles = []
    play_pulse = 0.0

    last_hand_seen = time.time()
    auto_reset_done = False
    AUTO_RESET_SEC = 2.0
    prev_wrists = []

    fps_buf = deque(maxlen=30)
    last_t = time.time()

    win = "AirType (Python)"
    cv2.namedWindow(win, cv2.WINDOW_NORMAL)

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        h, w = frame.shape[:2]

        if canvas is None or canvas.shape[:2] != (h, w):
            canvas = np.zeros((h, w, 3), dtype=np.uint8)

        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        rgb.flags.writeable = False
        results = hands.process(rgb)

        landmarks_list = results.multi_hand_landmarks or []
        landmarks_data = [lm.landmark for lm in landmarks_list]
        world_landmarks_list = results.multi_hand_world_landmarks or []
        world_landmarks_data = [wl.landmark for wl in world_landmarks_list]
        handedness = results.multi_handedness
        candidate_lms, candidate_hd = filter_real_hands(landmarks_data, handedness, world_landmarks_data)

        confirmed_lms = []
        confirmed_hd = []
        cur_wrists = []
        for i, lm in enumerate(candidate_lms):
            wx, wy = lm[0].x, lm[0].y
            cur_wrists.append((wx, wy))
            matched = any(math.hypot(px - wx, py - wy) < 0.15 for (px, py) in prev_wrists)
            if matched:
                confirmed_lms.append(lm)
                confirmed_hd.append(candidate_hd[i])
        prev_wrists = cur_wrists
        real_lms = confirmed_lms
        real_hd = confirmed_hd

        if real_lms:
            last_hand_seen = time.time()
            auto_reset_done = False
        elif (
            not auto_reset_done
            and time.time() - last_hand_seen >= AUTO_RESET_SEC
            and canvas is not None
            and canvas.any()
        ):
            canvas[:] = 0
            current_stroke = []
            is_drawing = False
            auto_reset_done = True
            print("Canvas reset (no hands detected)")

        candidate = (
            len(real_lms) >= 2
            and both_hands_valid(real_lms[0], real_lms[1], real_hd)
        )
        if candidate:
            play_streak = min(play_streak + 1, 10)
        else:
            play_streak = 0

        valid_play = candidate if play_mode else play_streak >= PLAY_DEBOUNCE_FRAMES

        # Compose: video + canvas
        composite = cv2.addWeighted(frame, 1.0, canvas, 1.0, 0)

        mode_label = "IDLE"

        if valid_play:
            if not play_mode:
                play_mode = True
                current_stroke = []
                is_drawing = False
            mode_label = "PLAY MODE"
            play_pulse += 0.08
            for lm in real_lms[:2]:
                draw_skeleton(composite, lm, w, h)
            draw_hand_link(composite, real_lms[0], real_lms[1], w, h, play_pulse, play_particles)
        else:
            if play_mode:
                play_mode = False
                play_particles.clear()
                smooth_init = False

            if len(real_lms) >= 2 and not valid_play:
                cv2.putText(
                    composite, "Show both hands fully in frame to play",
                    (w // 2 - 230, 50),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 234, 255), 2, cv2.LINE_AA,
                )

            primary = pick_primary(real_lms, real_hd)
            if primary is not None:
                gesture = detect_gesture(primary)
                tip_x = primary[8].x * w
                tip_y = primary[8].y * h
                if not smooth_init:
                    smooth_x, smooth_y = tip_x, tip_y
                    smooth_init = True
                else:
                    smooth_x += (tip_x - smooth_x) * SMOOTH_FACTOR
                    smooth_y += (tip_y - smooth_y) * SMOOTH_FACTOR
                sx, sy = int(smooth_x), int(smooth_y)

                draw_skeleton(composite, primary, w, h)

                if gesture == "point":
                    mode_label = "DRAWING"
                    if not is_drawing:
                        is_drawing = True
                        current_stroke = [(sx, sy)]
                    else:
                        current_stroke.append((sx, sy))
                        if len(current_stroke) >= 2:
                            cv2.line(canvas, current_stroke[-2], current_stroke[-1], DRAW_COLOR, 5, cv2.LINE_AA)
                    cv2.circle(composite, (sx, sy), 10, DRAW_COLOR, 2, cv2.LINE_AA)
                    cv2.circle(composite, (sx, sy), 3, DRAW_COLOR, -1, cv2.LINE_AA)
                elif gesture == "fist":
                    mode_label = "ERASING"
                    is_drawing = False
                    current_stroke = []
                    cv2.circle(canvas, (sx, sy), ERASER_RADIUS, (0, 0, 0), -1)
                    cv2.circle(composite, (sx, sy), ERASER_RADIUS, (60, 60, 220), 2, cv2.LINE_AA)
                else:
                    mode_label = "PAUSED"
                    is_drawing = False
                    current_stroke = []
                    cv2.circle(composite, (sx, sy), 8, (180, 180, 180), 1, cv2.LINE_AA)
            else:
                is_drawing = False
                current_stroke = []
                smooth_init = False

        # HUD
        now = time.time()
        fps_buf.append(1.0 / max(now - last_t, 1e-6))
        last_t = now
        fps = int(sum(fps_buf) / len(fps_buf))
        cv2.rectangle(composite, (10, 10), (260, 80), (20, 20, 30), -1)
        cv2.putText(composite, f"FPS: {fps}", (20, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1, cv2.LINE_AA)
        cv2.putText(composite, f"HANDS: {len(real_lms)}", (20, 55), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (200, 200, 200), 1, cv2.LINE_AA)
        cv2.putText(composite, f"MODE: {mode_label}", (20, 75), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 234, 255), 1, cv2.LINE_AA)

        cv2.imshow(win, composite)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27):
            break
        elif key == ord("c"):
            canvas[:] = 0
        elif key == ord("s"):
            fname = f"airtype-{int(time.time())}.png"
            cv2.imwrite(fname, composite)
            print(f"Saved {os.path.abspath(fname)}")

    hands.close()
    cap.release()
    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
