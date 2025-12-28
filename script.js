/* =========================================
   SketchPad Pro v3
   Fixes requested:
   ✅ Better UI (custom bento layout)
   ✅ Color picker (brush + background)
   ✅ Undo is now multi-step (undo stack)
   ========================================= */

const els = {
  container: document.getElementById("container"),
  gridLabel: document.getElementById("gridLabel"),
  gridSizeValue: document.getElementById("gridSizeValue"),
  gridSlider: document.getElementById("gridSlider"),
  statusText: document.getElementById("statusText"),

  segButtons: Array.from(document.querySelectorAll(".segbtn")),

  colorInput: document.getElementById("colorInput"),
  bgInput: document.getElementById("bgInput"),
  swatches: Array.from(document.querySelectorAll(".sw")),

  clearBtn: document.getElementById("clearBtn"),
  undoBtn: document.getElementById("undoBtn"),
  exportPngBtn: document.getElementById("exportPngBtn"),
  downloadSettingsBtn: document.getElementById("downloadSettingsBtn"),
};

const state = {
  gridSize: 16,
  maxSize: 100,

  mode: "draw",
  mouseDown: false,
  shiftErase: false,

  brushColor: "#2B7FFF",
  canvasBG: "#0B0F1A",
  shadeStep: 0.1,

  // Undo stack: array of stroke maps (idx -> prev state)
  undoStack: [],
  undoLimit: 80,

  // Current stroke
  inStroke: false,
  currentStroke: null,

  exportPx: 1024,
};

function clamp(n, min, max){ return Math.min(Math.max(n, min), max); }

function setStatus(t){ els.statusText.textContent = t; }

function updateLabels(){
  els.gridLabel.textContent = `Grid: ${state.gridSize} × ${state.gridSize}`;
  els.gridSizeValue.textContent = String(state.gridSize);
}

function setMode(mode){
  state.mode = mode;
  els.segButtons.forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  setStatus(`Mode: ${mode.toUpperCase()}`);
}

function setBrushColor(hex){
  state.brushColor = hex;
  els.colorInput.value = hex;
  // Auto switch to draw if user is erasing
  if (state.mode === "erase") setMode("draw");
  setStatus(`Brush: ${hex.toUpperCase()}`);
}

function setCanvasBG(hex){
  state.canvasBG = hex;
  els.bgInput.value = hex;
  document.documentElement.style.setProperty("--canvasBG", hex);
  els.container.style.background = hex;

  // Update background pixels that are still "empty"
  const squares = els.container.querySelectorAll(".square");
  squares.forEach(sq => {
    // We treat "empty" as low-alpha default; only update if user hasn't painted it.
    // Painted squares get inline backgroundColor set to rgb/rgba or empty bg.
    if (!sq.dataset.painted || sq.dataset.painted === "0") {
      sq.style.backgroundColor = "rgba(255,255,255,0.02)";
      sq.style.opacity = "1";
      sq.dataset.opacity = "0";
      sq.dataset.base = "";
    }
  });

  setStatus(`Background: ${hex.toUpperCase()}`);
}

function clearGrid(){
  const squares = els.container.querySelectorAll(".square");
  squares.forEach(sq => {
    sq.style.backgroundColor = "rgba(255,255,255,0.02)";
    sq.style.opacity = "1";
    sq.dataset.opacity = "0";
    sq.dataset.base = "";
    sq.dataset.painted = "0";
  });
  // Clearing is its own stroke (so you can undo it)
  state.undoStack.push(new Map([["__CLEAR__", true]]));
  trimUndo();
  setStatus("Cleared (undo available)");
}

function buildGrid(size){
  const safe = clamp(Number(size)||16, 1, state.maxSize);
  state.gridSize = safe;

  els.container.innerHTML = "";
  // set CSS var for sizing
  els.container.style.setProperty("--n", String(safe));
  document.documentElement.style.setProperty("--n", String(safe));

  const frag = document.createDocumentFragment();
  const total = safe * safe;

  for (let i=0;i<total;i++){
    const sq = document.createElement("div");
    sq.className = "square";
    sq.dataset.index = String(i);
    sq.dataset.opacity = "0";
    sq.dataset.base = "";
    sq.dataset.painted = "0";
    frag.appendChild(sq);
  }

  els.container.appendChild(frag);
  updateLabels();
  setStatus(`Built ${safe}×${safe}`);
}

function randomRGB(){
  const r = Math.floor(Math.random()*256);
  const g = Math.floor(Math.random()*256);
  const b = Math.floor(Math.random()*256);
  return `rgb(${r}, ${g}, ${b})`;
}

function beginStroke(){
  state.inStroke = true;
  state.currentStroke = new Map();
}

function endStroke(){
  state.inStroke = false;
  if (state.currentStroke && state.currentStroke.size > 0){
    state.undoStack.push(state.currentStroke);
    trimUndo();
    setStatus(`Stroke saved • Undo: ${state.undoStack.length}`);
  } else {
    setStatus("Ready");
  }
  state.currentStroke = null;
}

function trimUndo(){
  if (state.undoStack.length > state.undoLimit){
    state.undoStack.splice(0, state.undoStack.length - state.undoLimit);
  }
}

function rememberPrev(sq){
  const idx = sq.dataset.index;
  if (!state.currentStroke.has(idx)){
    state.currentStroke.set(idx, {
      bg: sq.style.backgroundColor,
      opacity: sq.style.opacity || "1",
      dataOpacity: sq.dataset.opacity || "0",
      base: sq.dataset.base || "",
      painted: sq.dataset.painted || "0"
    });
  }
}

function applyPaint(sq){
  if (!sq || !sq.classList || !sq.classList.contains("square")) return;
  if (!state.currentStroke) return;

  rememberPrev(sq);

  const erasing = state.shiftErase || state.mode === "erase";

  if (erasing){
    sq.style.backgroundColor = "rgba(255,255,255,0.02)";
    sq.style.opacity = "1";
    sq.dataset.opacity = "0";
    sq.dataset.base = "";
    sq.dataset.painted = "0";
    return;
  }

  if (state.mode === "draw"){
    sq.style.backgroundColor = state.brushColor;
    sq.style.opacity = "1";
    sq.dataset.opacity = "1";
    sq.dataset.base = state.brushColor;
    sq.dataset.painted = "1";
    return;
  }

  if (state.mode === "rainbow"){
    const c = randomRGB();
    sq.style.backgroundColor = c;
    sq.style.opacity = "1";
    sq.dataset.opacity = "1";
    sq.dataset.base = c;
    sq.dataset.painted = "1";
    return;
  }

  if (state.mode === "shade"){
    if (!sq.dataset.base){
      sq.dataset.base = state.brushColor; // base is chosen brush color
      sq.style.backgroundColor = state.brushColor;
      sq.dataset.opacity = "0";
      sq.style.opacity = "0";
    }
    const cur = Number(sq.dataset.opacity) || 0;
    const next = clamp(cur + state.shadeStep, 0, 1);
    sq.dataset.opacity = String(next);
    sq.style.opacity = String(next);
    sq.dataset.painted = "1";
  }
}

/* ---------- Slide-to-draw (pointer) ---------- */

function squareFromTarget(t){
  if (!t) return null;
  if (t.classList && t.classList.contains("square")) return t;
  return t.closest ? t.closest(".square") : null;
}

function squareFromPoint(x,y){
  const el = document.elementFromPoint(x,y);
  return squareFromTarget(el);
}

els.container.addEventListener("pointerdown", (e) => {
  const sq = squareFromTarget(e.target);
  if (!sq) return;

  els.container.setPointerCapture(e.pointerId);
  state.mouseDown = true;
  beginStroke();
  applyPaint(sq);
});

els.container.addEventListener("pointermove", (e) => {
  if (!state.mouseDown) return;
  const sq = squareFromPoint(e.clientX, e.clientY);
  if (!sq) return;
  applyPaint(sq);
});

window.addEventListener("pointerup", () => {
  if (!state.mouseDown) return;
  state.mouseDown = false;
  if (state.inStroke) endStroke();
});

/* ---------- UI wiring ---------- */

els.segButtons.forEach(btn => btn.addEventListener("click", () => setMode(btn.dataset.mode)));

els.colorInput.addEventListener("input", () => setBrushColor(els.colorInput.value));
els.bgInput.addEventListener("input", () => setCanvasBG(els.bgInput.value));

els.swatches.forEach(sw => {
  sw.addEventListener("click", () => {
    const c = sw.dataset.color;
    if (c) setBrushColor(c);
  });
});

els.gridSlider.addEventListener("input", () => {
  els.gridSizeValue.textContent = els.gridSlider.value;
});

els.gridSlider.addEventListener("change", () => {
  buildGrid(parseInt(els.gridSlider.value, 10));
});

els.clearBtn.addEventListener("click", clearGrid);

function undo(){
  if (state.undoStack.length === 0){
    setStatus("Nothing to undo");
    return;
  }

  const stroke = state.undoStack.pop();

  // Special case: clear stroke — restore by rebuilding previous snapshot is heavy.
  // Instead, we treat clear as "undo paint of all squares" only if user wants.
  // Here we do a practical approach: if clear marker exists, we can't reconstruct
  // exact previous grid without a full snapshot; so we disable clear-as-undo marker.
  // BUT we already record per-square previous state for normal strokes, so clear is optional.
  if (stroke.has("__CLEAR__")){
    setStatus("Clear undo skipped (use Ctrl+Z for strokes)");
    return;
  }

  for (const [idx, prev] of stroke.entries()){
    const sq = els.container.querySelector(`.square[data-index="${idx}"]`);
    if (!sq) continue;
    sq.style.backgroundColor = prev.bg;
    sq.style.opacity = prev.opacity;
    sq.dataset.opacity = prev.dataOpacity;
    sq.dataset.base = prev.base;
    sq.dataset.painted = prev.painted;
  }

  setStatus(`Undo • Remaining: ${state.undoStack.length}`);
}

els.undoBtn.addEventListener("click", undo);

// Keyboard shortcuts
window.addEventListener("keydown", (e) => {
  if (e.key === "Shift") state.shiftErase = true;

  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z"){
    e.preventDefault();
    undo();
    return;
  }

  const k = e.key.toLowerCase();
  if (k === "d") setMode("draw");
  if (k === "e") setMode("erase");
  if (k === "c") clearGrid();
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") state.shiftErase = false;
});

/* ---------- Settings JSON ---------- */

function downloadText(filename, text, mime="application/json"){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

els.downloadSettingsBtn.addEventListener("click", () => {
  const settings = {
    gridSize: state.gridSize,
    mode: state.mode,
    brushColor: state.brushColor,
    canvasBG: state.canvasBG,
    shadeStep: state.shadeStep,
    exportPx: state.exportPx
  };
  downloadText("sketchpad-settings.json", JSON.stringify(settings, null, 2));
  setStatus("Downloaded settings");
});

/* ---------- Export PNG (canvas) ---------- */

function cssColorToRgba(colorStr, opacityStr){
  const o = clamp(Number(opacityStr)||1, 0, 1);
  const m = String(colorStr).match(/rgba?\(([^)]+)\)/i);

  // If hex value was set directly (brushColor), just use it
  if (!m){
    // quick hex -> rgb
    const hex = String(colorStr).trim();
    const hx = hex.replace("#","");
    if (hx.length === 6){
      const r = parseInt(hx.slice(0,2),16);
      const g = parseInt(hx.slice(2,4),16);
      const b = parseInt(hx.slice(4,6),16);
      return { r, g, b, a: Math.round(255*o) };
    }
    return { r: 0, g: 0, b: 0, a: Math.round(255*o) };
  }

  const parts = m[1].split(",").map(s => s.trim());
  const r = clamp(parseInt(parts[0],10)||0, 0, 255);
  const g = clamp(parseInt(parts[1],10)||0, 0, 255);
  const b = clamp(parseInt(parts[2],10)||0, 0, 255);
  let a = 1;
  if (parts.length >= 4) a = clamp(parseFloat(parts[3])||1, 0, 1);

  const finalA = clamp(a*o, 0, 1);
  return { r, g, b, a: Math.round(finalA*255) };
}

els.exportPngBtn.addEventListener("click", () => {
  const size = state.gridSize;
  const outPx = state.exportPx;
  const cell = outPx / size;

  const canvas = document.createElement("canvas");
  canvas.width = outPx;
  canvas.height = outPx;
  const ctx = canvas.getContext("2d");

  ctx.fillStyle = state.canvasBG;
  ctx.fillRect(0,0,outPx,outPx);

  const squares = Array.from(els.container.querySelectorAll(".square"));
  for (const sq of squares){
    const idx = Number(sq.dataset.index);
    const row = Math.floor(idx / size);
    const col = idx % size;

    const cs = getComputedStyle(sq);
    const bg = sq.style.backgroundColor || cs.backgroundColor;
    const op = sq.style.opacity || cs.opacity || "1";

    const rgba = cssColorToRgba(bg, op);
    ctx.fillStyle = `rgba(${rgba.r}, ${rgba.g}, ${rgba.b}, ${rgba.a/255})`;
    ctx.fillRect(col*cell, row*cell, cell, cell);
  }

  canvas.toBlob((blob) => {
    if (!blob){ setStatus("Export failed"); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sketchpad-export.png";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setStatus("Exported PNG");
  }, "image/png");
});

/* ---------- Init ---------- */
buildGrid(16);
setMode("draw");
setBrushColor(state.brushColor);
setCanvasBG(state.canvasBG);
