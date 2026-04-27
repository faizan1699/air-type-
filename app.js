(function () {
  'use strict';

  const FINGER_TIPS = [4, 8, 12, 16, 20];
  const FINGER_PIPS = [3, 6, 10, 14, 18];

  const HAND_CONNECTIONS = [
    [0,1],[1,2],[2,3],[3,4],
    [0,5],[5,6],[6,7],[7,8],
    [5,9],[9,10],[10,11],[11,12],
    [9,13],[13,14],[14,15],[15,16],
    [13,17],[17,18],[18,19],[19,20],
    [0,17]
  ];

  const state = {
    isRunning: false,

    strokes: [],

    mode: 'idle',
    color: '#00e5ff',
    thickness: 5,
    glow: 15,
    currentStroke: [],
    isDrawing: false,

    smoothX: 0,
    smoothY: 0,
    smoothFactor: 0.35,

    fps: 0,
    frameCount: 0,
    lastFpsTime: performance.now(),

    eraserRadius: 30,

    playMode: false,
    playParticles: [],
    playPulse: 0,
    playValidStreak: 0,

    lastHandSeenTime: performance.now(),
    autoResetDone: false,
  };

  const AUTO_RESET_MS = 2000;

  const PLAY_RAINBOW = ['#ff1744', '#ff9100', '#ffea00', '#76ff03', '#00e5ff', '#2979ff', '#d500f9'];

  const els = {
    loadingScreen: document.getElementById('loading-screen'),
    app: document.getElementById('app'),
    video: document.getElementById('video'),
    drawCanvas: document.getElementById('draw-canvas'),
    overlayCanvas: document.getElementById('overlay-canvas'),
    canvasArea: document.getElementById('canvas-area'),
    cameraPrompt: document.getElementById('camera-prompt'),
    btnStartCamera: document.getElementById('btn-start-camera'),
    fpsVal: document.getElementById('fps-val'),
    handsVal: document.getElementById('hands-val'),
    statsGroup: document.getElementById('stats-group'),
    modeIndicator: document.getElementById('mode-indicator'),
    modeIcon: document.getElementById('mode-icon'),
    modeLabel: document.getElementById('mode-label'),
    toolbar: document.getElementById('toolbar'),
    thicknessSlider: document.getElementById('thickness-slider'),
    thicknessDot: document.getElementById('thickness-dot'),
    glowSlider: document.getElementById('glow-slider'),
    btnUndo: document.getElementById('btn-undo'),
    btnClearWall: document.getElementById('btn-clear-wall'),
    btnSave: document.getElementById('btn-save'),
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toast-message'),
  };

  const drawCtx = els.drawCanvas.getContext('2d');
  const overlayCtx = els.overlayCanvas.getContext('2d');

  function init() {
    setTimeout(() => {
      els.loadingScreen.classList.add('fade-out');
      setTimeout(() => {
        els.loadingScreen.style.display = 'none';
        els.app.classList.remove('hidden');
      }, 500);
    }, 2000);

    bindEvents();
    resizeCanvases();

    const ro = new ResizeObserver(() => resizeCanvases());
    ro.observe(els.canvasArea);
    updateThicknessPreview();
  }

  function resizeCanvases() {
    const w = els.canvasArea.clientWidth || 1280;
    const h = els.canvasArea.clientHeight || 720;

    if (els.drawCanvas.width !== w || els.drawCanvas.height !== h) {
      els.drawCanvas.width = w;
      els.drawCanvas.height = h;
      els.overlayCanvas.width = w;
      els.overlayCanvas.height = h;
      redrawAll();
    }
  }

  function bindEvents() {
    els.btnStartCamera.addEventListener('click', startCamera);

    document.querySelectorAll('.color-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.color-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.color = btn.dataset.color;
        updateThicknessPreview();
      });
    });

    els.thicknessSlider.addEventListener('input', (e) => {
      state.thickness = parseInt(e.target.value);
      updateThicknessPreview();
    });

    els.glowSlider.addEventListener('input', (e) => {
      state.glow = parseInt(e.target.value);
    });

    els.btnUndo.addEventListener('click', () => {
      if (state.strokes.length > 0) {
        state.strokes.pop();
        redrawAll();
        showToast('Undo');
      }
    });

    els.btnClearWall.addEventListener('click', () => {
      state.strokes = [];
      state.currentStroke = [];
      redrawAll();
      showToast('Canvas cleared');
    });

    els.btnSave.addEventListener('click', saveCanvas);
  }

  function updateThicknessPreview() {
    const size = Math.max(4, state.thickness);
    els.thicknessDot.style.width = size + 'px';
    els.thicknessDot.style.height = size + 'px';
    els.thicknessDot.style.background = state.color;
    els.thicknessDot.style.boxShadow = `0 0 ${state.glow}px ${state.color}`;
  }

  function finishCurrentStroke() {
    if (state.isDrawing && state.currentStroke.length > 1) {
      state.strokes.push({
        points: [...state.currentStroke],
        color: state.color,
        thickness: state.thickness,
        glow: state.glow
      });
    }
    state.currentStroke = [];
    state.isDrawing = false;
  }

  function saveCanvas() {
    const c = document.createElement('canvas');
    c.width = els.drawCanvas.width;
    c.height = els.drawCanvas.height;
    const ctx = c.getContext('2d');

    ctx.save();
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(els.video, 0, 0, c.width, c.height);
    ctx.restore();

    ctx.drawImage(els.drawCanvas, 0, 0);

    const link = document.createElement('a');
    link.download = `airtype-${Date.now()}.png`;
    link.href = c.toDataURL('image/png');
    link.click();
    showToast('Image saved!');
  }

  async function startCamera() {
    try {
      showToast('Starting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' }
      });
      els.video.srcObject = stream;
      await els.video.play();
      els.cameraPrompt.classList.add('hidden');
      showToast('Loading model...');
      initHands();
    } catch (err) {
      console.error('Camera error:', err);
      showToast('Camera access denied');
    }
  }

  function initHands() {
    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });
    hands.setOptions({
      maxNumHands: 2,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.5
    });
    hands.onResults(onResults);

    const camera = new Camera(els.video, {
      onFrame: async () => { await hands.send({ image: els.video }); },
      width: 1280, height: 720
    });

    camera.start().then(() => {
      state.isRunning = true;
      els.statsGroup.classList.add('visible');
      els.modeIndicator.classList.add('visible');
      els.toolbar.classList.add('visible');
      resizeCanvases();
      showToast('Welcome! ☝️ Point to draw, ✊ Fist to erase, 🙌 Both hands to play');
    });
  }

  function onResults(results) {
    const w = els.overlayCanvas.width;
    const h = els.overlayCanvas.height;
    overlayCtx.clearRect(0, 0, w, h);

    state.frameCount++;
    const now = performance.now();
    if (now - state.lastFpsTime >= 1000) {
      state.fps = state.frameCount;
      state.frameCount = 0;
      state.lastFpsTime = now;
    }
    els.fpsVal.textContent = state.fps;

    const realHandCount = countRealHands(results.multiHandLandmarks, results.multiHandedness);
    els.handsVal.textContent = String(realHandCount);

    if (realHandCount > 0) {
      state.lastHandSeenTime = now;
      state.autoResetDone = false;
    } else if (
      !state.autoResetDone &&
      now - state.lastHandSeenTime >= AUTO_RESET_MS &&
      (state.strokes.length > 0 || state.currentStroke.length > 0)
    ) {
      state.strokes = [];
      state.currentStroke = [];
      state.isDrawing = false;
      redrawAll();
      state.autoResetDone = true;
      showToast('Canvas reset (no hands detected)');
    }

    const realHandsList = [];
    const realHandedness = [];
    if (results.multiHandLandmarks) {
      for (let i = 0; i < results.multiHandLandmarks.length; i++) {
        const lm = results.multiHandLandmarks[i];
        const hd = results.multiHandedness && results.multiHandedness[i];
        const conf = hd ? hd.score : 0.5;
        if (conf >= 0.7 && isRealHand(lm)) {
          realHandsList.push(lm);
          realHandedness.push(hd);
        }
      }
    }

    const candidatePlay = realHandsList.length >= 2 && bothHandsInFrame(
      realHandsList[0],
      realHandsList[1],
      realHandedness
    );

    if (candidatePlay) {
      state.playValidStreak = Math.min(state.playValidStreak + 1, 10);
    } else {
      state.playValidStreak = 0;
    }

    const validPlay = state.playMode ? candidatePlay : state.playValidStreak >= 2;

    if (validPlay) {
      if (!state.playMode) {
        finishCurrentStroke();
        state.playMode = true;
      }
      updateMode('play');
      drawSkeleton(overlayCtx, realHandsList[0], w, h);
      drawSkeleton(overlayCtx, realHandsList[1], w, h);
      drawHandLink(overlayCtx, realHandsList[0], realHandsList[1], w, h);
      return;
    }

    if (state.playMode) {
      state.playMode = false;
      state.playParticles = [];
      state.smoothX = 0;
      state.smoothY = 0;
    }

    if (realHandsList.length >= 2 && !validPlay) {
      drawPlayHint(overlayCtx, w);
    }

    const landmarks = realHandsList.length >= 1
      ? pickPrimaryHand(realHandsList, realHandedness)
      : null;

    if (landmarks) {
      const gesture = detectGesture(landmarks);
      const tipX = (1 - landmarks[8].x) * w;
      const tipY = landmarks[8].y * h;

      if (state.smoothX === 0 && state.smoothY === 0) {
        state.smoothX = tipX;
        state.smoothY = tipY;
      } else {
        state.smoothX += (tipX - state.smoothX) * state.smoothFactor;
        state.smoothY += (tipY - state.smoothY) * state.smoothFactor;
      }
      const sx = state.smoothX;
      const sy = state.smoothY;

      drawSkeleton(overlayCtx, landmarks, w, h);
      drawCursor(overlayCtx, sx, sy, gesture);

      if (gesture === 'point') {
        updateMode('drawing');
        if (!state.isDrawing) {
          state.isDrawing = true;
          state.currentStroke = [{ x: sx, y: sy }];
        } else {
          state.currentStroke.push({ x: sx, y: sy });
          drawCurrentStrokeOnCanvas();
        }
      } else if (gesture === 'fist') {
        updateMode('erasing');
        finishCurrentStroke();
        eraseAt(sx, sy);
      } else {
        updateMode('idle');
        finishCurrentStroke();
      }
    } else {
      finishCurrentStroke();
      updateMode('idle');
    }
  }

  function detectGesture(landmarks) {
    const fingers = [];

    const isRightHand = landmarks[17].x < landmarks[5].x;
    if (isRightHand) {
      fingers.push(landmarks[4].x < landmarks[3].x ? 1 : 0);
    } else {
      fingers.push(landmarks[4].x > landmarks[3].x ? 1 : 0);
    }

    for (let i = 1; i < 5; i++) {
      fingers.push(landmarks[FINGER_TIPS[i]].y < landmarks[FINGER_PIPS[i]].y ? 1 : 0);
    }

    const extended = fingers.reduce((a, b) => a + b, 0);

    if (fingers[1] === 1 && fingers[2] === 0 && fingers[3] === 0 && fingers[4] === 0) {
      return 'point';
    }

    if (extended <= 1) {
      return 'fist';
    }

    return 'open';
  }

  function updateMode(mode) {
    state.mode = mode;
    const config = {
      drawing: { icon: '✏️', label: 'DRAWING' },
      erasing: { icon: '🧹', label: 'ERASING' },
      idle:    { icon: '✋', label: 'PAUSED' },
      play:    { icon: '🎉', label: 'PLAY MODE' },
    };
    const c = config[mode] || config.idle;
    els.modeIcon.textContent = c.icon;
    els.modeLabel.textContent = c.label;
    els.modeIndicator.classList.remove('drawing', 'erasing', 'play');
    if (mode !== 'idle') els.modeIndicator.classList.add(mode);
  }

  function drawCurrentStrokeOnCanvas() {
    redrawAll();
    drawStroke(drawCtx, state.currentStroke, state.color, state.thickness, state.glow);
  }

  function drawStroke(ctx, points, color, thickness, glow) {
    if (points.length < 2) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = thickness;
    ctx.strokeStyle = color;
    if (glow > 0) { ctx.shadowColor = color; ctx.shadowBlur = glow; }

    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);

    if (points.length === 2) {
      ctx.lineTo(points[1].x, points[1].y);
    } else {
      for (let i = 1; i < points.length - 1; i++) {
        const mx = (points[i].x + points[i + 1].x) / 2;
        const my = (points[i].y + points[i + 1].y) / 2;
        ctx.quadraticCurveTo(points[i].x, points[i].y, mx, my);
      }
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function redrawAll() {
    drawCtx.clearRect(0, 0, els.drawCanvas.width, els.drawCanvas.height);
    state.strokes.forEach(s => drawStroke(drawCtx, s.points, s.color, s.thickness, s.glow));
  }

  function eraseAt(x, y) {
    const r = state.eraserRadius;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, r, 0, Math.PI * 2);
    overlayCtx.strokeStyle = 'rgba(255,23,68,0.4)';
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([4, 4]);
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);

    state.strokes = state.strokes.filter(stroke =>
      !stroke.points.some(p => Math.hypot(p.x - x, p.y - y) < r)
    );
    redrawAll();
  }

  function pickPrimaryHand(landmarksList, handedness) {
    if (!landmarksList || landmarksList.length === 0) return null;
    if (landmarksList.length === 1) return landmarksList[0];

    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < landmarksList.length; i++) {
      const lm = landmarksList[i];
      const conf = handedness && handedness[i] ? handedness[i].score : 0.5;
      const span = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
      const wristIn =
        lm[0].x > 0.02 && lm[0].x < 0.98 &&
        lm[0].y > 0.02 && lm[0].y < 0.98 ? 1 : 0;
      const score = conf * 2 + span * 5 + wristIn;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return landmarksList[bestIdx];
  }

  function isRealHand(lm) {
    if (lm[0].x < 0 || lm[0].x > 1 || lm[0].y < 0 || lm[0].y > 1) return false;

    const span = Math.hypot(lm[9].x - lm[0].x, lm[9].y - lm[0].y);
    if (span < 0.04) return false;

    const wristToMcp = [5, 9, 13, 17].map(i =>
      Math.hypot(lm[i].x - lm[0].x, lm[i].y - lm[0].y)
    );
    const maxMcp = Math.max.apply(null, wristToMcp);
    const minMcp = Math.min.apply(null, wristToMcp);
    if (minMcp < 0.001 || maxMcp / minMcp > 2.2) return false;

    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (let i = 0; i < lm.length; i++) {
      if (lm[i].x < minX) minX = lm[i].x;
      if (lm[i].x > maxX) maxX = lm[i].x;
      if (lm[i].y < minY) minY = lm[i].y;
      if (lm[i].y > maxY) maxY = lm[i].y;
    }
    const bw = maxX - minX;
    const bh = maxY - minY;
    if (bw > 0.65 || bh > 0.65) return false;

    return true;
  }

  function countRealHands(landmarksList, handedness) {
    if (!landmarksList) return 0;
    let count = 0;
    for (let i = 0; i < landmarksList.length; i++) {
      const conf = handedness && handedness[i] ? handedness[i].score : 0.5;
      if (conf < 0.7) continue;
      if (isRealHand(landmarksList[i])) count++;
    }
    return count;
  }

  function bothHandsInFrame(lm1, lm2, handedness) {
    if (handedness && handedness.length >= 2) {
      if (handedness[0].score < 0.7 || handedness[1].score < 0.7) return false;
    }
    if (!isRealHand(lm1) || !isRealHand(lm2)) return false;

    const dx = lm1[0].x - lm2[0].x;
    const dy = lm1[0].y - lm2[0].y;
    if (Math.hypot(dx, dy) < 0.1) return false;

    return true;
  }

  function drawPlayHint(ctx, w) {
    ctx.save();
    ctx.font = '600 16px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,234,0,0.85)';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 8;
    ctx.fillText('🙌  Show both palms with fingers spread, fully in frame', w / 2, 60);
    ctx.restore();
  }

  function drawHandLink(ctx, lm1, lm2, w, h) {
    state.playPulse += 0.08;
    const pulse = (Math.sin(state.playPulse) + 1) / 2;

    const pairs = [
      { a: 4,  b: 4  },
      { a: 8,  b: 8  },
      { a: 12, b: 12 },
      { a: 16, b: 16 },
      { a: 20, b: 20 },
      { a: 0,  b: 0  },
    ];

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    pairs.forEach((p, idx) => {
      const a = lm1[p.a];
      const b = lm2[p.b];
      if (a.x < -0.02 || a.x > 1.02 || a.y < -0.02 || a.y > 1.02) return;
      if (b.x < -0.02 || b.x > 1.02 || b.y < -0.02 || b.y > 1.02) return;

      const x1 = (1 - a.x) * w;
      const y1 = a.y * h;
      const x2 = (1 - b.x) * w;
      const y2 = b.y * h;

      const colorA = PLAY_RAINBOW[(idx + Math.floor(state.playPulse)) % PLAY_RAINBOW.length];
      const colorB = PLAY_RAINBOW[(idx + Math.floor(state.playPulse) + 3) % PLAY_RAINBOW.length];

      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0, colorA);
      grad.addColorStop(1, colorB);

      ctx.strokeStyle = grad;
      ctx.lineWidth = 3 + pulse * 3;
      ctx.shadowColor = colorA;
      ctx.shadowBlur = 18 + pulse * 12;

      ctx.beginPath();
      ctx.moveTo(x1, y1);
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2 - 30 - idx * 4;
      ctx.quadraticCurveTo(midX, midY, x2, y2);
      ctx.stroke();

      const dotR = 5 + pulse * 3;
      ctx.shadowBlur = 22;
      ctx.fillStyle = colorA;
      ctx.beginPath();
      ctx.arc(x1, y1, dotR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = colorB;
      ctx.beginPath();
      ctx.arc(x2, y2, dotR, 0, Math.PI * 2);
      ctx.fill();

      if (Math.random() < 0.4) {
        state.playParticles.push({
          x: midX + (Math.random() - 0.5) * 40,
          y: midY + (Math.random() - 0.5) * 40,
          vx: (Math.random() - 0.5) * 1.5,
          vy: -1 - Math.random() * 1.5,
          life: 1,
          color: colorA,
          size: 2 + Math.random() * 3,
        });
      }
    });

    ctx.shadowBlur = 0;
    state.playParticles = state.playParticles.filter(pt => pt.life > 0);
    state.playParticles.forEach(pt => {
      pt.x += pt.vx;
      pt.y += pt.vy;
      pt.life -= 0.02;
      ctx.globalAlpha = Math.max(pt.life, 0);
      ctx.fillStyle = pt.color;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, pt.size * pt.life, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = 1;

    ctx.font = '700 28px Inter, sans-serif';
    ctx.fillStyle = `rgba(255,255,255,${0.7 + pulse * 0.3})`;
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ff80ab';
    ctx.shadowBlur = 20;
    ctx.fillText('🎉  Hands Linked!  🎉', w / 2, 60);

    ctx.restore();
  }

  function drawSkeleton(ctx, landmarks, w, h) {
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = state.playMode ? 'rgba(255,255,255,0.55)' : 'rgba(0,229,255,0.35)';
    HAND_CONNECTIONS.forEach(([s, e]) => {
      ctx.beginPath();
      ctx.moveTo((1 - landmarks[s].x) * w, landmarks[s].y * h);
      ctx.lineTo((1 - landmarks[e].x) * w, landmarks[e].y * h);
      ctx.stroke();
    });
    landmarks.forEach((lm, i) => {
      const x = (1 - lm.x) * w;
      const y = lm.y * h;
      const isTip = FINGER_TIPS.includes(i);
      ctx.beginPath();
      ctx.arc(x, y, isTip ? 4 : 2, 0, Math.PI * 2);
      ctx.fillStyle = isTip ? 'rgba(255,255,255,0.95)' : 'rgba(0,229,255,0.7)';
      ctx.fill();
    });
  }

  function drawCursor(ctx, x, y, gesture) {
    if (gesture === 'point') {
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fillStyle = state.color + '18';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = state.color;
      ctx.lineWidth = 2;
      ctx.shadowColor = state.color;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x, y, 3, 0, Math.PI * 2);
      ctx.fillStyle = state.color;
      ctx.fill();
    } else if (gesture === 'fist') {
      ctx.beginPath();
      ctx.arc(x, y, state.eraserRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,23,68,0.35)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#ff1744';
      ctx.fill();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  function showToast(msg) {
    els.toastMessage.textContent = msg;
    els.toast.classList.remove('hidden');
    els.toast.classList.add('visible');
    setTimeout(() => {
      els.toast.classList.remove('visible');
      setTimeout(() => els.toast.classList.add('hidden'), 300);
    }, 2000);
  }

  init();
})();
