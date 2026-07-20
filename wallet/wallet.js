/* WallyWeb Wallet — client-side encrypted barcode store.
   Master password → PBKDF2-SHA256 → AES-GCM key (memory only).
   Vault ciphertext lives in localStorage; key is wiped on lock/close. */

(() => {
  'use strict';

  // ---------- Constants ----------
  const STORAGE_KEY = 'wallyweb:wallet:v1';
  const PBKDF2_ITERS = 310000;
  const SALT_LEN = 16;
  const IV_LEN = 12;

  // Maps ZXing format name (string) → bwip-js bcid.
  const ZXING_TO_BWIP = {
    AZTEC: 'azteccode',
    CODABAR: 'rationalizedCodabar',
    CODE_39: 'code39',
    CODE_93: 'code93',
    CODE_128: 'code128',
    DATA_MATRIX: 'datamatrix',
    EAN_8: 'ean8',
    EAN_13: 'ean13',
    ITF: 'interleaved2of5',
    PDF_417: 'pdf417',
    QR_CODE: 'qrcode',
    UPC_A: 'upca',
    UPC_E: 'upce',
  };
  const BWIP_LABEL = {
    azteccode: 'Aztec', rationalizedCodabar: 'Codabar',
    code39: 'Code 39', code93: 'Code 93', code128: 'Code 128',
    datamatrix: 'Data Matrix', ean8: 'EAN-8', ean13: 'EAN-13',
    interleaved2of5: 'ITF', pdf417: 'PDF417', qrcode: 'QR',
    upca: 'UPC-A', upce: 'UPC-E',
  };

  const COLORS = [
    { name: 'indigo', bg: 'linear-gradient(135deg, #6366f1, #4f46e5)' },
    { name: 'violet', bg: 'linear-gradient(135deg, #8b5cf6, #6d28d9)' },
    { name: 'pink',   bg: 'linear-gradient(135deg, #ec4899, #be185d)' },
    { name: 'rose',   bg: 'linear-gradient(135deg, #f43f5e, #be123c)' },
    { name: 'amber',  bg: 'linear-gradient(135deg, #f59e0b, #b45309)' },
    { name: 'emerald',bg: 'linear-gradient(135deg, #10b981, #047857)' },
    { name: 'teal',   bg: 'linear-gradient(135deg, #14b8a6, #0f766e)' },
    { name: 'sky',    bg: 'linear-gradient(135deg, #0ea5e9, #0369a1)' },
    { name: 'slate',  bg: 'linear-gradient(135deg, #475569, #1e293b)' },
  ];

  // ---------- Tiny helpers ----------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  const buf2b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const b642buf = (b64) => Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
  const uid = () => 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  function toast(msg, ms = 2200) {
    const t = $('#toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { t.hidden = true; }, ms);
  }

  // ---------- Crypto ----------
  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const baseKey = await crypto.subtle.importKey(
      'raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']
    );
    return crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: PBKDF2_ITERS, hash: 'SHA-256' },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async function encryptVault(key, plaintextObj) {
    const iv = crypto.getRandomValues(new Uint8Array(IV_LEN));
    const data = new TextEncoder().encode(JSON.stringify(plaintextObj));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, data);
    return { iv, ct };
  }

  async function decryptVault(key, ivBuf, ctBuf) {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: ivBuf }, key, ctBuf);
    return JSON.parse(new TextDecoder().decode(pt));
  }

  // ---------- Persistence ----------
  function readBlob() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }
  function writeBlob(blob) { localStorage.setItem(STORAGE_KEY, JSON.stringify(blob)); }
  function wipeBlob() { localStorage.removeItem(STORAGE_KEY); }

  // ---------- App state ----------
  const state = {
    key: null,         // CryptoKey, in memory only
    salt: null,        // Uint8Array
    cards: [],         // [{ id, label, color, value, format, createdAt }]
    draft: null,       // pending card being added
  };

  async function persist() {
    const { iv, ct } = await encryptVault(state.key, { cards: state.cards });
    writeBlob({
      v: 1,
      salt: buf2b64(state.salt),
      iv: buf2b64(iv),
      ct: buf2b64(ct),
    });
  }

  function lockNow() {
    state.key = null;
    state.salt = null;
    state.cards = [];
    stopScanner();
    closeModal($('#addModal'));
    closeModal($('#viewModal'));
    showLockScreen();
  }

  // ---------- Lock screen ----------
  function showLockScreen() {
    $('#app').hidden = true;
    $('#lockScreen').hidden = false;
    const blob = readBlob();
    const hasVault = !!blob;
    $('#setupForm').hidden = hasVault;
    $('#unlockForm').hidden = !hasVault;
    $('#setupErr').textContent = '';
    $('#unlockErr').textContent = '';
    if (hasVault) setTimeout(() => $('#unlockPw').focus(), 50);
    else setTimeout(() => $('#setupPw').focus(), 50);
  }

  $('#setupForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#setupPw').value;
    const pw2 = $('#setupPw2').value;
    const err = $('#setupErr');
    if (pw.length < 8) { err.textContent = 'Password must be at least 8 characters.'; return; }
    if (pw !== pw2)    { err.textContent = 'Passwords don\'t match.'; return; }
    err.textContent = 'Setting up encryption…';
    try {
      const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
      const key = await deriveKey(pw, salt);
      state.key = key;
      state.salt = salt;
      state.cards = [];
      await persist();
      enterApp();
    } catch (e) {
      console.error(e);
      err.textContent = 'Something went wrong. Try again.';
    }
  });

  $('#unlockForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const pw = $('#unlockPw').value;
    const err = $('#unlockErr');
    const blob = readBlob();
    if (!blob) { showLockScreen(); return; }
    err.textContent = 'Unlocking…';
    try {
      const salt = new Uint8Array(b642buf(blob.salt));
      const iv = new Uint8Array(b642buf(blob.iv));
      const ct = b642buf(blob.ct);
      const key = await deriveKey(pw, salt);
      const data = await decryptVault(key, iv, ct);
      state.key = key;
      state.salt = salt;
      state.cards = Array.isArray(data.cards) ? data.cards : [];
      $('#unlockPw').value = '';
      err.textContent = '';
      enterApp();
    } catch {
      err.textContent = 'Wrong password.';
      $('#unlockPw').select();
    }
  });

  $('#wipeBtn').addEventListener('click', () => {
    if (!confirm('Erase this wallet from this device? All saved cards will be lost. There is no undo.')) return;
    wipeBlob();
    showLockScreen();
    toast('Wallet erased.');
  });

  // ---------- Main app ----------
  function enterApp() {
    $('#lockScreen').hidden = true;
    $('#app').hidden = false;
    renderCards();
  }

  function renderCards() {
    const grid = $('#cardGrid');
    const empty = $('#emptyState');
    grid.innerHTML = '';
    if (state.cards.length === 0) {
      empty.hidden = false;
      grid.hidden = true;
      return;
    }
    empty.hidden = true;
    grid.hidden = false;
    for (const c of state.cards) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.className = 'card-item';
      btn.style.background = colorFor(c.color).bg;
      btn.dataset.id = c.id;
      btn.innerHTML = `
        <div class="card-label"></div>
        <div class="card-meta">
          <span class="card-value"></span>
          <span class="card-format"></span>
        </div>`;
      btn.querySelector('.card-label').textContent = c.label || '(untitled)';
      btn.querySelector('.card-value').textContent = previewValue(c.value, c.format);
      btn.querySelector('.card-format').textContent = BWIP_LABEL[c.format] || c.format;
      btn.addEventListener('click', () => openView(c.id));
      li.appendChild(btn);
      grid.appendChild(li);
    }
  }

  function previewValue(v, format) {
    if (format === 'qrcode' || format === 'pdf417' || format === 'datamatrix' || format === 'azteccode') {
      return v.length > 22 ? v.slice(0, 20) + '…' : v;
    }
    return v;
  }

  function colorFor(name) {
    return COLORS.find(c => c.name === name) || COLORS[0];
  }

  $('#addBtn').addEventListener('click', openAdd);
  $('#emptyAddBtn').addEventListener('click', openAdd);
  $('#lockBtn').addEventListener('click', lockNow);

  // ---------- Add modal ----------
  let activeTab = 'scan';

  function openAdd() {
    state.draft = null;
    $('#cardLabel').value = '';
    $('#capturedPreview').hidden = true;
    $('#saveBtn').disabled = true;
    $('#uploadStatus').hidden = true;
    $('#scanStatus').textContent = 'Point camera at a barcode…';
    renderColorPicker(COLORS[0].name);
    switchTab('scan');
    openModal($('#addModal'));
  }

  function renderColorPicker(selected) {
    const root = $('#colorPicker');
    root.innerHTML = '';
    for (const c of COLORS) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'color-chip' + (c.name === selected ? ' selected' : '');
      btn.style.background = c.bg;
      btn.setAttribute('aria-label', c.name);
      btn.dataset.color = c.name;
      btn.addEventListener('click', () => {
        $$('.color-chip').forEach(el => el.classList.remove('selected'));
        btn.classList.add('selected');
      });
      root.appendChild(btn);
    }
  }

  function selectedColor() {
    const chip = $('.color-chip.selected');
    return chip ? chip.dataset.color : COLORS[0].name;
  }

  function switchTab(tab) {
    activeTab = tab;
    $$('.tab').forEach(t => {
      const on = t.dataset.tab === tab;
      t.classList.toggle('active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    $$('.tab-panel').forEach(p => p.classList.toggle('active', p.dataset.tabPanel === tab));
    if (tab === 'scan') startScanner();
    else stopScanner();
  }

  $$('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));

  // ----- Scanner -----
  let zxingReader = null;
  let zxingControls = null;
  let zxingDevices = [];

  async function listCameras() {
    try {
      // Ask once for permission so device labels are available.
      const tmp = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      tmp.getTracks().forEach(t => t.stop());
    } catch { /* permission denied; continue, scanner will surface error */ }
    const devices = await navigator.mediaDevices.enumerateDevices();
    zxingDevices = devices.filter(d => d.kind === 'videoinput');
    const sel = $('#cameraSelect');
    sel.innerHTML = '';
    zxingDevices.forEach((d, i) => {
      const opt = document.createElement('option');
      opt.value = d.deviceId;
      opt.textContent = d.label || `Camera ${i + 1}`;
      sel.appendChild(opt);
    });
    // Prefer a back camera if labels hint at it.
    const back = zxingDevices.find(d => /back|rear|environment/i.test(d.label));
    if (back) sel.value = back.deviceId;
  }

  async function startScanner() {
    if (!('ZXingBrowser' in window)) {
      $('#scanStatus').textContent = 'Scanner failed to load.';
      return;
    }
    stopScanner();
    try {
      if (zxingDevices.length === 0) await listCameras();
      zxingReader = new ZXingBrowser.BrowserMultiFormatReader();
      const deviceId = $('#cameraSelect').value || (zxingDevices[0] && zxingDevices[0].deviceId);
      const video = $('#scanVideo');
      zxingControls = await zxingReader.decodeFromVideoDevice(deviceId || undefined, video, (result, err, controls) => {
        if (result) {
          const fmtName = ZXingBrowser.BarcodeFormat[result.getBarcodeFormat()];
          const bcid = ZXING_TO_BWIP[fmtName];
          if (!bcid) {
            $('#scanStatus').textContent = `Detected ${fmtName} (unsupported here).`;
            return;
          }
          handleDecoded(result.getText(), bcid);
        }
      });
      $('#scanStatus').textContent = 'Hold steady…';
    } catch (e) {
      console.error(e);
      $('#scanStatus').textContent = e && e.name === 'NotAllowedError'
        ? 'Camera permission denied. Use the “Photo” or “Type it” tab instead.'
        : 'Could not start camera. Try the “Photo” or “Type it” tab.';
    }
  }

  function stopScanner() {
    try { zxingControls && zxingControls.stop(); } catch {}
    try { zxingReader && zxingReader.reset && zxingReader.reset(); } catch {}
    zxingControls = null;
    zxingReader = null;
    const v = $('#scanVideo');
    if (v && v.srcObject) {
      v.srcObject.getTracks().forEach(t => t.stop());
      v.srcObject = null;
    }
  }

  $('#cameraSelect').addEventListener('change', () => { if (activeTab === 'scan') startScanner(); });

  // ----- Upload -----
  $('#uploadFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    const status = $('#uploadStatus');
    status.hidden = false;
    status.textContent = 'Decoding…';
    try {
      const reader = new ZXingBrowser.BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(url);
      const fmtName = ZXingBrowser.BarcodeFormat[result.getBarcodeFormat()];
      const bcid = ZXING_TO_BWIP[fmtName];
      if (!bcid) {
        status.textContent = `Detected ${fmtName} but it's not supported here.`;
        return;
      }
      status.textContent = '✓ Decoded.';
      handleDecoded(result.getText(), bcid);
    } catch (err) {
      console.error(err);
      status.textContent = 'Could not find a barcode in that image. Try a sharper photo or the Type it tab.';
    } finally {
      URL.revokeObjectURL(url);
    }
  });

  // ----- Manual -----
  function manualSync() {
    const val = $('#manualValue').value.trim();
    const fmt = $('#manualFormat').value;
    if (val.length === 0) {
      $('#capturedPreview').hidden = true;
      $('#saveBtn').disabled = true;
      state.draft = null;
      return;
    }
    handleDecoded(val, fmt, /*silent*/ true);
  }
  $('#manualValue').addEventListener('input', manualSync);
  $('#manualFormat').addEventListener('change', manualSync);

  // ----- Decoded handler (shared) -----
  function handleDecoded(value, bcid, silent) {
    state.draft = { value, format: bcid };
    if (!$('#cardLabel').value) {
      // light default label hint
      $('#cardLabel').focus({ preventScroll: true });
    }
    $('#capturedFormat').textContent = BWIP_LABEL[bcid] || bcid;
    $('#capturedValue').textContent = previewValue(value, bcid);
    $('#capturedPreview').hidden = false;
    renderBarcode($('#previewCanvas'), value, bcid, { scale: 2, height: 14 });
    $('#saveBtn').disabled = false;
    if (!silent) {
      stopScanner();
      $('#scanStatus').textContent = '✓ Captured. Add a label and save.';
      toast(`Captured ${BWIP_LABEL[bcid] || bcid}`);
    }
  }

  // ----- Save -----
  $('#saveBtn').addEventListener('click', async () => {
    if (!state.draft) return;
    const label = $('#cardLabel').value.trim() || 'Untitled';
    const card = {
      id: uid(),
      label,
      color: selectedColor(),
      value: state.draft.value,
      format: state.draft.format,
      createdAt: Date.now(),
    };
    state.cards.unshift(card);
    try {
      await persist();
      closeModal($('#addModal'));
      renderCards();
      toast(`Saved ${label}`);
    } catch (e) {
      console.error(e);
      toast('Could not save. Sorry.');
    }
  });

  // ---------- View / delete ----------
  function openView(id) {
    const card = state.cards.find(c => c.id === id);
    if (!card) return;
    $('#viewTitle').textContent = card.label;
    $('#viewValue').textContent = card.value;
    $('#viewFormat').textContent = BWIP_LABEL[card.format] || card.format;
    const isMatrix = ['qrcode', 'datamatrix', 'azteccode', 'pdf417'].includes(card.format);
    renderBarcode($('#viewCanvas'), card.value, card.format, {
      scale: isMatrix ? 8 : 4,
      height: 28,
    });
    $('#viewModal').dataset.cardId = id;
    openModal($('#viewModal'));
    // Try to bump screen brightness via display: nothing to do programmatically on web,
    // but a white card under a dark bar already maximizes scanner success.
  }

  $('#deleteBtn').addEventListener('click', async () => {
    const id = $('#viewModal').dataset.cardId;
    if (!id) return;
    const card = state.cards.find(c => c.id === id);
    if (!confirm(`Delete "${card.label}"? This cannot be undone.`)) return;
    state.cards = state.cards.filter(c => c.id !== id);
    await persist();
    closeModal($('#viewModal'));
    renderCards();
    toast('Card deleted.');
  });

  // ---------- Render barcode (bwip-js) ----------
  function renderBarcode(canvas, text, bcid, { scale = 4, height = 22 } = {}) {
    try {
      const isMatrix = ['qrcode', 'datamatrix', 'azteccode'].includes(bcid);
      bwipjs.toCanvas(canvas, {
        bcid,
        text,
        scale,
        height: isMatrix ? undefined : height,
        includetext: !isMatrix,
        textxalign: 'center',
        backgroundcolor: 'FFFFFF',
        paddingwidth: 4,
        paddingheight: 4,
      });
    } catch (e) {
      console.error('Render error:', e);
      const ctx = canvas.getContext('2d');
      canvas.width = 320; canvas.height = 80;
      ctx.fillStyle = '#fee2e2'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#991b1b'; ctx.font = '600 14px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Couldn\'t render this code', canvas.width / 2, 30);
      ctx.font = '12px Inter, sans-serif';
      ctx.fillText(String(e && e.message || e), canvas.width / 2, 50);
    }
  }

  // ---------- Modal helpers ----------
  function openModal(m) { m.hidden = false; document.body.style.overflow = 'hidden'; }
  function closeModal(m) {
    m.hidden = true;
    document.body.style.overflow = '';
    if (m === $('#addModal')) stopScanner();
  }
  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (!closer) return;
    const modal = closer.closest('.modal');
    if (modal) closeModal(modal);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const open = $$('.modal:not([hidden])');
      if (open.length) closeModal(open[open.length - 1]);
    }
  });

  // ---------- Boot ----------
  window.addEventListener('beforeunload', () => {
    // Best-effort cleanup. The key is in memory only, so closing the tab already locks us.
    stopScanner();
  });

  showLockScreen();
})();
