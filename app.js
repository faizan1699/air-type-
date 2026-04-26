/* =============================================
   AirType VR — Spatial Air Drawing Application
   4-Wall Virtual Room + Hand Gesture Drawing
   ============================================= */

(function () {
  'use strict';

  // ── Constants ──
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

  const WALLS = [
    { name: 'Front Wall',  color: '#00e5ff', icon: '🔵' },
    { name: 'Right Wall',  color: '#a855f7', icon: '🟣' },
    { name: 'Back Wall',   color: '#ff6d00', icon: '🟠' },
    { name: 'Left Wall',   color: '#76ff03', icon: '🟢' },
  ];

  // ── State ──
  const state = {
    isRunning: false,
    currentWall: 0,      // 0=Front, 1=Right, 2=Back, 3=Left
    transitioning: false,

    // Each wall has its own strokes
    walls: [
      { strokes: [] }, // Front
      { strokes: [] }, // Right
      { strokes: [] }, // Back
      { strokes: [] }, // Left
    ],

    mode: 'idle',
    color: '#00e5ff',
    thickness: 5,
    glow: 15,
    currentStroke: [],
    isDrawing: false,

    // Cursor smoothing
    smoothX: 0,
    smoothY: 0,
    smoothFactor: 0.35,

    // Navigation gesture tracking
    navStartX: null,
    navActive: false,
    navCooldown: false,

    // FPS
    fps: 0,
    frameCount: 0,
    lastFpsTime: performance.now(),

    eraserRadius: 30,
  };

  // ── DOM ──
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
    wallNameDisplay: document.getElementById('wall-name-display'),
    wallCurrentName: document.getElementById('wall-current-name'),
    wallArrowLeft: document.getElementById('wall-arrow-left'),
    wallArrowRight: document.getElementById('wall-arrow-right'),
    wallTransition: document.getElementById('wall-transition'),
    roomMinimap: document.getElementById('room-minimap'),
    minimapCanvas: document.getElementById('minimap-canvas'),
    navLeft: document.getElementById('nav-left'),
    navRight: document.getElementById('nav-right'),
    toast: document.getElementById('toast'),
    toastMessage: document.getElementById('toast-message'),
  };

  const drawCtx = els.drawCanvas.getContext('2d');
  const overlayCtx = els.overlayCanvas.getContext('2d');
  const minimapCtx = els.minimapCanvas.getContext('2d');

  // ── Init ──
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
    updateWallDisplay();

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
      redrawCurrentWall();
    }
  }

  // ── Events ──
  function bindEvents() {
    els.btnStartCamera.addEventListener('click', startCamera);

    // Colors
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

    // Undo on current wall
    els.btnUndo.addEventListener('click', () => {
      const wall = state.walls[state.currentWall];
      if (wall.strokes.length > 0) {
        wall.strokes.pop();
        redrawCurrentWall();
        showToast('Undo');
      }
    });

    // Clear current wall
    els.btnClearWall.addEventListener('click', () => {
      state.walls[state.currentWall].strokes = [];
      state.currentStroke = [];
      redrawCurrentWall();
      showToast(`${WALLS[state.currentWall].name} cleared`);
    });

    // Save
    els.btnSave.addEventListener('click', saveCanvas);

    // Wall navigation buttons
    els.navLeft.addEventListener('click', () => navigateWall(-1));
    els.navRight.addEventListener('click', () => navigateWall(1));
    els.wallArrowLeft.addEventListener('click', () => navigateWall(-1));
    els.wallArrowRight.addEventListener('click', () => navigateWall(1));

    // Keyboard navigation
    document.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') navigateWall(-1);
      if (e.key === 'ArrowRight') navigateWall(1);
    });
  }

  function updateThicknessPreview() {
    const size = Math.max(4, state.thickness);
    els.thicknessDot.style.width = size + 'px';
    els.thicknessDot.style.height = size + 'px';
    els.thicknessDot.style.background = state.color;
    els.thicknessDot.style.boxShadow = `0 0 ${state.glow}px ${state.color}`;
  }

  // ── Wall Navigation ──
  function navigateWall(direction) {
    if (state.transitioning) return;

    // Finish any current stroke first
    finishCurrentStroke();

    state.transitioning = true;
    const oldWall = state.currentWall;
    state.currentWall = (state.currentWall + direction + 4) % 4;

    // Transition animation
    els.wallTransition.className = 'wall-transition active ' + (direction > 0 ? 'slide-left' : 'slide-right');

    setTimeout(() => {
      redrawCurrentWall();
      updateWallDisplay();
      drawMinimap();

      setTimeout(() => {
        els.wallTransition.className = 'wall-transition';
        state.transitioning = false;
      }, 300);
    }, 150);

    showToast(`${WALLS[state.currentWall].icon} ${WALLS[state.currentWall].name}`);
  }

  function updateWallDisplay() {
    const wall = WALLS[state.currentWall];
    els.wallCurrentName.textContent = wall.name;
    els.wallCurrentName.style.color = wall.color;
  }

  function finishCurrentStroke() {
    if (state.isDrawing && state.currentStroke.length > 1) {
      state.walls[state.currentWall].strokes.push({
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

    // Draw video
    ctx.save();
    ctx.translate(c.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(els.video, 0, 0, c.width, c.height);
    ctx.restore();

    // Draw strokes
    ctx.drawImage(els.drawCanvas, 0, 0);

    // Wall label
    ctx.font = '600 14px Inter, sans-serif';
    ctx.fillStyle = WALLS[state.currentWall].color;
    ctx.textAlign = 'left';
    ctx.fillText(WALLS[state.currentWall].name, 16, c.height - 16);

    const link = document.createElement('a');
    link.download = `airtype-${WALLS[state.currentWall].name.replace(' ', '-')}-${Date.now()}.png`;
    link.href = c.toDataURL('image/png');
    link.click();
    showToast('Image saved!');
  }

  // ── Camera ──
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
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.6
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
      els.roomMinimap.classList.add('visible');
      els.navLeft.classList.add('visible');
      els.navRight.classList.add('visible');
      resizeCanvases();
      drawMinimap();
      showToast('Welcome! ☝️ Point to draw, ✌️ Swipe to change wall');
    });
  }

  // ── Results ──
  function onResults(results) {
    const w = els.overlayCanvas.width;
    const h = els.overlayCanvas.height;
    overlayCtx.clearRect(0, 0, w, h);

    // Draw wall edge indicators
    drawWallEdgeIndicators(overlayCtx, w, h);

    // FPS
    state.frameCount++;
    const now = performance.now();
    if (now - state.lastFpsTime >= 1000) {
      state.fps = state.frameCount;
      state.frameCount = 0;
      state.lastFpsTime = now;
    }
    els.fpsVal.textContent = state.fps;

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
      const landmarks = results.multiHandLandmarks[0];
      els.handsVal.textContent = '1';

      const gesture = detectGesture(landmarks);
      const tipX = (1 - landmarks[8].x) * w;
      const tipY = landmarks[8].y * h;

      // Smooth position
      state.smoothX += (tipX - state.smoothX) * state.smoothFactor;
      state.smoothY += (tipY - state.smoothY) * state.smoothFactor;
      const sx = state.smoothX;
      const sy = state.smoothY;

      // Draw skeleton (subtle)
      drawSkeleton(overlayCtx, landmarks, w, h);
      drawCursor(overlayCtx, sx, sy, gesture);

      // Handle gesture modes
      if (gesture === 'point') {
        updateMode('drawing');
        if (!state.isDrawing) {
          state.isDrawing = true;
          state.currentStroke = [{ x: sx, y: sy }];
        } else {
          state.currentStroke.push({ x: sx, y: sy });
          drawCurrentStrokeOnCanvas();
        }
        state.navActive = false;
        state.navStartX = null;
      } else if (gesture === 'peace') {
        // Peace sign = Navigation mode
        updateMode('navigating');
        finishCurrentStroke();

        // Track horizontal movement for swipe
        if (!state.navActive) {
          state.navStartX = sx;
          state.navActive = true;
        } else if (state.navStartX !== null && !state.navCooldown) {
          const dx = sx - state.navStartX;
          const swipeThreshold = w * 0.2; // 20% of screen width

          if (Math.abs(dx) > swipeThreshold) {
            // Swipe detected!
            const direction = dx > 0 ? -1 : 1; // Swipe right = prev wall, left = next
            navigateWall(direction);
            state.navStartX = null;
            state.navCooldown = true;
            setTimeout(() => { state.navCooldown = false; }, 800);
          }

          // Draw swipe progress indicator
          drawSwipeIndicator(overlayCtx, sx, sy, state.navStartX, w, h);
        }
      } else if (gesture === 'fist') {
        updateMode('erasing');
        finishCurrentStroke();
        eraseAt(sx, sy);
        state.navActive = false;
        state.navStartX = null;
      } else {
        updateMode('idle');
        finishCurrentStroke();
        state.navActive = false;
        state.navStartX = null;
      }
    } else {
      els.handsVal.textContent = '0';
      finishCurrentStroke();
      updateMode('idle');
      state.navActive = false;
      state.navStartX = null;
    }
  }

  // ── Gesture Detection ──
  function detectGesture(landmarks) {
    const fingers = [];

    // Thumb
    const isRightHand = landmarks[17].x < landmarks[5].x;
    if (isRightHand) {
      fingers.push(landmarks[4].x < landmarks[3].x ? 1 : 0);
    } else {
      fingers.push(landmarks[4].x > landmarks[3].x ? 1 : 0);
    }

    // Index, Middle, Ring, Pinky
    for (let i = 1; i < 5; i++) {
      fingers.push(landmarks[FINGER_TIPS[i]].y < landmarks[FINGER_PIPS[i]].y ? 1 : 0);
    }

    const extended = fingers.reduce((a, b) => a + b, 0);

    // Point: only index
    if (fingers[1] === 1 && fingers[2] === 0 && fingers[3] === 0 && fingers[4] === 0) {
      return 'point';
    }

    // Peace: index + middle only
    if (fingers[1] === 1 && fingers[2] === 1 && fingers[3] === 0 && fingers[4] === 0) {
      return 'peace';
    }

    // Fist: all down
    if (extended <= 1) {
      return 'fist';
    }

    // Open hand
    if (extended >= 4) {
      return 'open';
    }

    return 'open';
  }

  function updateMode(mode) {
    state.mode = mode;
    const config = {
      drawing:    { icon: '✏️', label: 'DRAWING' },
      navigating: { icon: '🧭', label: 'NAVIGATE' },
      erasing:    { icon: '🧹', label: 'ERASING' },
      idle:       { icon: '✋', label: 'PAUSED' },
    };
    const c = config[mode] || config.idle;
    els.modeIcon.textContent = c.icon;
    els.modeLabel.textContent = c.label;
    els.modeIndicator.classList.remove('drawing', 'erasing', 'navigating');
    if (mode !== 'idle') els.modeIndicator.classList.add(mode);
  }

  // ── Drawing ──
  function drawCurrentStrokeOnCanvas() {
    redrawCurrentWall();
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

  function redrawCurrentWall() {
    drawCtx.clearRect(0, 0, els.drawCanvas.width, els.drawCanvas.height);
    const wall = state.walls[state.currentWall];
    wall.strokes.forEach(s => drawStroke(drawCtx, s.points, s.color, s.thickness, s.glow));
  }

  // ── Eraser ──
  function eraseAt(x, y) {
    const r = state.eraserRadius;
    overlayCtx.beginPath();
    overlayCtx.arc(x, y, r, 0, Math.PI * 2);
    overlayCtx.strokeStyle = 'rgba(255,23,68,0.4)';
    overlayCtx.lineWidth = 2;
    overlayCtx.setLineDash([4, 4]);
    overlayCtx.stroke();
    overlayCtx.setLineDash([]);

    const wall = state.walls[state.currentWall];
    wall.strokes = wall.strokes.filter(stroke =>
      !stroke.points.some(p => Math.hypot(p.x - x, p.y - y) < r)
    );
    redrawCurrentWall();
  }

  // ── Visual Overlays ──
  function drawWallEdgeIndicators(ctx, w, h) {
    const wallInfo = WALLS[state.currentWall];

    // Subtle colored border glow for current wall
    ctx.save();
    const borderWidth = 3;

    // Top border
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, 'transparent');
    grad.addColorStop(0.3, wallInfo.color + '30');
    grad.addColorStop(0.7, wallInfo.color + '30');
    grad.addColorStop(1, 'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, borderWidth);

    // Side indicators showing adjacent walls
    const leftWall = WALLS[(state.currentWall + 3) % 4];
    const rightWall = WALLS[(state.currentWall + 1) % 4];

    // Left edge gradient
    const leftGrad = ctx.createLinearGradient(0, 0, 60, 0);
    leftGrad.addColorStop(0, leftWall.color + '25');
    leftGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = leftGrad;
    ctx.fillRect(0, 0, 60, h);

    // Right edge gradient
    const rightGrad = ctx.createLinearGradient(w, 0, w - 60, 0);
    rightGrad.addColorStop(0, rightWall.color + '25');
    rightGrad.addColorStop(1, 'transparent');
    ctx.fillStyle = rightGrad;
    ctx.fillRect(w - 60, 0, 60, h);

    // Left wall label
    ctx.save();
    ctx.translate(14, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.font = '600 10px Inter, sans-serif';
    ctx.fillStyle = leftWall.color + '60';
    ctx.textAlign = 'center';
    ctx.fillText(`← ${leftWall.name}`, 0, 0);
    ctx.restore();

    // Right wall label
    ctx.save();
    ctx.translate(w - 14, h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.font = '600 10px Inter, sans-serif';
    ctx.fillStyle = rightWall.color + '60';
    ctx.textAlign = 'center';
    ctx.fillText(`→ ${rightWall.name}`, 0, 0);
    ctx.restore();

    ctx.restore();
  }

  function drawSwipeIndicator(ctx, sx, sy, startX, w, h) {
    if (startX === null) return;
    const dx = sx - startX;
    const threshold = w * 0.2;
    const progress = Math.min(Math.abs(dx) / threshold, 1);

    // Draw swipe arc
    ctx.save();
    ctx.beginPath();
    ctx.arc(startX, sy, 40, 0, Math.PI * 2 * progress);
    ctx.strokeStyle = `rgba(168, 85, 247, ${0.3 + progress * 0.5})`;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Arrow direction
    if (progress > 0.3) {
      const arrowX = sx;
      const arrowY = sy;
      const dir = dx > 0 ? 1 : -1;

      ctx.beginPath();
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - dir * 15, arrowY - 10);
      ctx.moveTo(arrowX, arrowY);
      ctx.lineTo(arrowX - dir * 15, arrowY + 10);
      ctx.strokeStyle = `rgba(168, 85, 247, ${progress})`;
      ctx.lineWidth = 2;
      ctx.stroke();

      // Show target wall name
      const targetWall = WALLS[(state.currentWall + (dx > 0 ? -1 : 1) + 4) % 4];
      ctx.font = `600 ${12 + progress * 4}px Inter, sans-serif`;
      ctx.fillStyle = targetWall.color + (Math.round(progress * 200)).toString(16).padStart(2, '0');
      ctx.textAlign = 'center';
      ctx.fillText(targetWall.name, sx, sy - 50);
    }

    ctx.restore();
  }

  function drawSkeleton(ctx, landmarks, w, h) {
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = 'rgba(0,229,255,0.15)';
    HAND_CONNECTIONS.forEach(([s, e]) => {
      ctx.beginPath();
      ctx.moveTo((1 - landmarks[s].x) * w, landmarks[s].y * h);
      ctx.lineTo((1 - landmarks[e].x) * w, landmarks[e].y * h);
      ctx.stroke();
    });
    landmarks.forEach((lm, i) => {
      const x = (1 - lm.x) * w;
      const y = lm.y * h;
      ctx.beginPath();
      ctx.arc(x, y, FINGER_TIPS.includes(i) ? 3 : 1.5, 0, Math.PI * 2);
      ctx.fillStyle = FINGER_TIPS.includes(i) ? 'rgba(0,229,255,0.5)' : 'rgba(255,255,255,0.2)';
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
    } else if (gesture === 'peace') {
      // Navigation cursor
      ctx.beginPath();
      ctx.arc(x, y, 16, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(168,85,247,0.5)';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#a855f7';
      ctx.fill();
      // Directional arrows
      const arrowLen = 22;
      ctx.strokeStyle = 'rgba(168,85,247,0.3)';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - arrowLen, y); ctx.lineTo(x + arrowLen, y);
      ctx.moveTo(x - arrowLen + 6, y - 5); ctx.lineTo(x - arrowLen, y); ctx.lineTo(x - arrowLen + 6, y + 5);
      ctx.moveTo(x + arrowLen - 6, y - 5); ctx.lineTo(x + arrowLen, y); ctx.lineTo(x + arrowLen - 6, y + 5);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.15)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }

  // ── Minimap ──
  function drawMinimap() {
    const c = els.minimapCanvas;
    const ctx = minimapCtx;
    const w = c.width;
    const h = c.height;
    const cx = w / 2;
    const cy = h / 2;
    const roomSize = 36;

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(10,10,18,0.9)';
    ctx.fillRect(0, 0, w, h);

    // Room outline
    ctx.strokeStyle = 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - roomSize, cy - roomSize, roomSize * 2, roomSize * 2);

    // Draw each wall
    const wallPositions = [
      { x1: cx - roomSize, y1: cy - roomSize, x2: cx + roomSize, y2: cy - roomSize }, // Front (top)
      { x1: cx + roomSize, y1: cy - roomSize, x2: cx + roomSize, y2: cy + roomSize }, // Right
      { x1: cx + roomSize, y1: cy + roomSize, x2: cx - roomSize, y2: cy + roomSize }, // Back (bottom)
      { x1: cx - roomSize, y1: cy + roomSize, x2: cx - roomSize, y2: cy - roomSize }, // Left
    ];

    wallPositions.forEach((wp, i) => {
      const isActive = i === state.currentWall;
      const hasContent = state.walls[i].strokes.length > 0;

      ctx.beginPath();
      ctx.moveTo(wp.x1, wp.y1);
      ctx.lineTo(wp.x2, wp.y2);
      ctx.strokeStyle = isActive ? WALLS[i].color : (hasContent ? WALLS[i].color + '60' : 'rgba(255,255,255,0.15)');
      ctx.lineWidth = isActive ? 3 : (hasContent ? 2 : 1);
      ctx.stroke();

      // Stroke count indicator
      if (hasContent) {
        const mx = (wp.x1 + wp.x2) / 2;
        const my = (wp.y1 + wp.y2) / 2;
        const isHorizontal = wp.y1 === wp.y2;
        const offset = 8;
        const dx = isHorizontal ? 0 : (i === 1 ? offset : -offset);
        const dy = isHorizontal ? (i === 0 ? -offset : offset) : 0;

        ctx.beginPath();
        ctx.arc(mx + dx, my + dy, 4, 0, Math.PI * 2);
        ctx.fillStyle = WALLS[i].color + '80';
        ctx.fill();

        ctx.font = '500 6px Inter';
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(state.walls[i].strokes.length, mx + dx, my + dy);
      }
    });

    // Wall labels
    const labels = ['F', 'R', 'B', 'L'];
    const labelPos = [
      { x: cx, y: cy - roomSize - 10 },
      { x: cx + roomSize + 10, y: cy },
      { x: cx, y: cy + roomSize + 12 },
      { x: cx - roomSize - 10, y: cy },
    ];

    labels.forEach((l, i) => {
      ctx.font = `${i === state.currentWall ? '700' : '500'} 9px Inter`;
      ctx.fillStyle = i === state.currentWall ? WALLS[i].color : 'rgba(255,255,255,0.3)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(l, labelPos[i].x, labelPos[i].y);
    });

    // Center dot (user position)
    ctx.beginPath();
    ctx.arc(cx, cy, 3, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();

    // Direction indicator (cone/triangle pointing at current wall)
    const angle = [-Math.PI / 2, 0, Math.PI / 2, Math.PI][state.currentWall];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -8);
    ctx.lineTo(-4, 0);
    ctx.lineTo(4, 0);
    ctx.closePath();
    ctx.fillStyle = WALLS[state.currentWall].color + '80';
    ctx.fill();
    ctx.restore();
  }

  // ── Toast ──
  function showToast(msg) {
    els.toastMessage.textContent = msg;
    els.toast.classList.remove('hidden');
    els.toast.classList.add('visible');
    setTimeout(() => {
      els.toast.classList.remove('visible');
      setTimeout(() => els.toast.classList.add('hidden'), 300);
    }, 2000);
  }

  // ── Start ──
  init();
})();
