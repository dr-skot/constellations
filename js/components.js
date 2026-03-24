// ═══════════════════════════════════════════════════════════
// SHARED UI COMPONENTS
// ═══════════════════════════════════════════════════════════

// ── Toggle Button Group ──────────────────────────────────
// options:
//   exclusive: boolean — only one can be on at a time (default false)
//   allowNone: boolean — in exclusive mode, clicking active button deselects it (default false)
//   caption: string — optional caption above buttons
//   buttons: [{ label, value, on }] — button definitions
//   onChange: (value, on, allValues) => void

function createToggleGroup(container, options = {}) {
  const { exclusive = false, allowNone = false, caption, buttons = [], onChange } = options;

  container.innerHTML = '';
  if (caption) {
    const cap = document.createElement('span');
    cap.className = 'toggle-group-caption';
    cap.textContent = caption;
    container.appendChild(cap);
  }

  const btnWrap = document.createElement('div');
  btnWrap.className = 'toggle-group-buttons';
  container.appendChild(btnWrap);

  const btnEls = [];

  function getValues() {
    return btnEls
      .filter(b => b.getAttribute('aria-pressed') === 'true')
      .map(b => b.dataset.value);
  }

  for (const def of buttons) {
    const btn = document.createElement('button');
    btn.className = 'toggle-btn';
    btn.textContent = def.label;
    btn.dataset.value = def.value ?? def.label;
    btn.setAttribute('aria-pressed', def.on ? 'true' : 'false');

    btn.addEventListener('click', () => {
      const wasOn = btn.getAttribute('aria-pressed') === 'true';

      if (exclusive) {
        if (wasOn && allowNone) {
          btn.setAttribute('aria-pressed', 'false');
        } else if (!wasOn) {
          btnEls.forEach(b => b.setAttribute('aria-pressed', 'false'));
          btn.setAttribute('aria-pressed', 'true');
        }
      } else {
        btn.setAttribute('aria-pressed', wasOn ? 'false' : 'true');
      }

      if (onChange) {
        const isOn = btn.getAttribute('aria-pressed') === 'true';
        onChange(btn.dataset.value, isOn, getValues());
      }
    });

    btnEls.push(btn);
    btnWrap.appendChild(btn);
  }

  return {
    getValues,
    setValue(value, on) {
      const btn = btnEls.find(b => b.dataset.value === value);
      if (!btn) return;
      if (exclusive && on) {
        btnEls.forEach(b => b.setAttribute('aria-pressed', 'false'));
      }
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    },
    getButtons() { return btnEls; },
  };
}

// ── Rotate Dial (barrel) ─────────────────────────────────
// options:
//   onAngle: (angleDeg) => void — called during drag with cumulative angle
//   onDragStart: () => void
//   onDragEnd: () => void

function createRotateDial(container, options = {}) {
  const { onAngle, onDragStart, onDragEnd } = options;

  const canvas = container.querySelector('.dial-track');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let angle = 0;
  let dragging = false;
  let dragStartX = 0;
  let dragStartAngle = 0;

  function resize() {
    const rect = container.getBoundingClientRect();
    if (rect.width === 0) return;
    canvas.width = rect.width * devicePixelRatio;
    canvas.height = rect.height * devicePixelRatio;
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    drawDial();
  }

  function drawDial() {
    const W = canvas.width;
    const H = canvas.height;
    if (W === 0 || H === 0) return;
    ctx.clearRect(0, 0, W, H);

    const cx = W / 2;
    const cy = H / 2;
    const R = W / 2;

    // Barrel outline
    const steps = 64;
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const theta = (t - 0.5) * Math.PI;
      const facing = Math.cos(theta);
      const halfH = H * 0.15 + H * 0.225 * facing;
      const x = cx + R * Math.sin(theta);
      if (i === 0) ctx.moveTo(x, cy - halfH);
      else ctx.lineTo(x, cy - halfH);
    }
    for (let i = steps; i >= 0; i--) {
      const t = i / steps;
      const theta = (t - 0.5) * Math.PI;
      const facing = Math.cos(theta);
      const halfH = H * 0.15 + H * 0.225 * facing;
      const x = cx + R * Math.sin(theta);
      ctx.lineTo(x, cy + halfH);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(12, 15, 30, 0.8)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(200, 216, 255, 0.12)';
    ctx.lineWidth = 1 * devicePixelRatio;
    ctx.stroke();

    // Ticks
    const tickSpacing = 6;
    const offsetDeg = -(angle % tickSpacing);
    const visibleArc = 180;
    const startDeg = -visibleArc / 2;
    const endDeg = visibleArc / 2;

    for (let deg = startDeg - tickSpacing; deg <= endDeg + tickSpacing; deg += tickSpacing) {
      const adjDeg = deg - offsetDeg;
      const rad = adjDeg * Math.PI / 180;
      const x = cx + R * Math.sin(rad);
      const facing = Math.cos(rad);
      if (facing <= 0) continue;

      const tickH = H * 0.09 + H * 0.16 * facing;
      const alpha = 0.06 + 0.15 * facing;
      const tickW = 1 * devicePixelRatio;

      ctx.fillStyle = `rgba(200, 216, 255, ${alpha})`;
      ctx.fillRect(x - tickW / 2, cy - tickH, tickW, tickH * 2);
    }
  }

  function setAngle(deg) {
    angle = deg;
    drawDial();
  }

  container.addEventListener('pointerdown', e => {
    dragging = true;
    dragStartX = e.clientX;
    dragStartAngle = angle;
    container.setPointerCapture(e.pointerId);
    if (onDragStart) onDragStart();
  });

  window.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dx = e.clientX - dragStartX;
    const sensitivity = 0.5;
    angle = dragStartAngle + dx * sensitivity;
    drawDial();
    if (onAngle) onAngle(angle);
  });

  window.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    if (onDragEnd) onDragEnd();
  });

  resize();
  window.addEventListener('resize', resize);

  return {
    setAngle,
    getAngle() { return angle; },
    isDragging() { return dragging; },
    resize,
  };
}
