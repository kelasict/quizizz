/* ============================================================
   ClassRoom Lite — api.js
   Wrapper fetch ke Google Apps Script + helper UI bersama
   ============================================================ */



/* ---------------- Sesi ----------------
   Disimpan di localStorage; jika diblokir browser, jatuh ke memori (hilang saat halaman ditutup). */
const Mem = {};
const Session = {
  _get(k) { try { const v = localStorage.getItem(k); if (v !== null) return v; } catch (e) { /* diblokir */ } return Mem[k] === undefined ? null : Mem[k]; },
  _set(k, v) { Mem[k] = v; try { localStorage.setItem(k, v); } catch (e) { /* diblokir */ } },
  _del(k) { delete Mem[k]; try { localStorage.removeItem(k); } catch (e) { /* diblokir */ } },
  save(token, user) {
    Session._set('crl_token', token);
    Session._set('crl_user', JSON.stringify(user));
    Session._set('crl_exp', String(Date.now() + 24 * 60 * 60 * 1000)); // 24 jam
  },
  token() { return Session._get('crl_token'); },
  user() { try { return JSON.parse(Session._get('crl_user') || 'null'); } catch (e) { return null; } },
  expired() { return Date.now() > Number(Session._get('crl_exp') || 0); },
  clear() { ['crl_token', 'crl_user', 'crl_exp'].forEach(Session._del); }
};

/* ---------------- Panggilan API (fetch ke Web App Apps Script) ---------------- */
const API = {
  isConfigured() { return /^https:[/][/]script[.]google(usercontent)?[.]com[/]/.test(CONFIG.API_URL || ''); },

  /**
   * Memanggil Web App Apps Script. Memakai POST + Content-Type text/plain
   * agar termasuk "simple request" (tanpa preflight CORS, yang tidak didukung Apps Script).
   */
  async call(action, params) {
    if (!API.isConfigured()) {
      throw new Error('URL API belum diatur. Edit file config.js lalu isi API_URL dengan URL Web App Apps Script (berakhiran /exec).');
    }
    let res;
    try {
      res = await fetch(CONFIG.API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(Object.assign({}, params || {}, { action: action, token: Session.token() })),
        redirect: 'follow'
      });
    } catch (e) {
      throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet dan URL API di config.js.');
    }
    let json;
    try { json = await res.json(); } catch (e) {
      throw new Error('Respons server tidak valid. Pastikan Web App di-deploy dengan akses "Siapa saja (Anyone)" dan URL berakhiran /exec.');
    }
    if (!json.success) {
      const err = new Error(json.message || 'Terjadi kesalahan');
      err.code = json.code;
      if (json.code === 'AUTH') { Session.clear(); if (typeof App !== 'undefined') App.showLogin('expired'); }
      throw err;
    }
    return json.data;
  },

  /** Baca File → base64 lalu upload ke Google Drive via Apps Script. */
  async upload(file, onProgress) {
    const b64of = blob => new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result).split(',')[1] || '');
      fr.onerror = () => reject(new Error('Gagal membaca file'));
      fr.readAsDataURL(blob);
    });
    // File kecil: sekali kirim.
    if (file.size <= 3 * 1024 * 1024) {
      const res = await API.call('uploadFile', { name: file.name, mime: file.type, data: await b64of(file) });
      if (onProgress) onProgress(1);
      return res;
    }
    // File besar (video, dll): dipotong 2 MB per kiriman.
    const st = await API.call('uploadStart', { name: file.name, mime: file.type, size: file.size });
    const CH = st.chunk || 2 * 1024 * 1024;
    let off = 0, res = null;
    while (off < file.size) {
      const part = file.slice(off, Math.min(off + CH, file.size));
      const data = await b64of(part);
      for (let tries = 1; ; tries++) {
        try { res = await API.call('uploadChunk', { upload_id: st.upload_id, offset: off, data: data }); break; }
        catch (e) { if (tries >= 3) throw e; await new Promise(r => setTimeout(r, 1500 * tries)); }
      }
      off += part.size;
      if (onProgress) onProgress(off / file.size);
    }
    if (!res || !res.done) throw new Error('Unggahan belum selesai, silakan coba lagi');
    return res;
  }
};

/* ---------------- Ikon (SVG) ---------------- */
const ICON_PATHS = {
  home: '<path d="M3 11l9-8 9 8v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  dashboard: '<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>',
  classes: '<path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/>',
  tasks: '<rect x="5" y="4" width="14" height="18" rx="2"/><path d="M9 2h6v4H9z"/><path d="M9 12h6M9 16h4"/>',
  grade: '<circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/>',
  announce: '<path d="M3 11v2a1 1 0 0 0 1 1h3l7 4V6L7 10H4a1 1 0 0 0-1 1z"/><path d="M18 9a4 4 0 0 1 0 6"/>',
  folder: '<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M22 21a7 7 0 0 0-4-6.3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5M21 12H9"/>',
  menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  trash: '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14M10 11v6M14 11v6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M16 7l3 3"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  stream: '<path d="M4 5h16v11H9l-5 4z"/>',
  userx: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0M17 8l5 5M22 8l-5 5"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>',
  external: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 20h16"/>',
  camera: '<path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="4"/>',
  book: '<path d="M4 4h16v16H4zM4 10h16M10 4v16"/>'
};
function icon(name, cls) {
  return '<svg class="' + (cls || 'w-5 h-5') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICON_PATHS[name] || '') + '</svg>';
}

/* ---------------- Helper UI ---------------- */
const UI = {
  /** Escape HTML — WAJIB dipakai untuk semua data dari server sebelum masuk innerHTML. */
  esc(s) {
    return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  },
  /** Hanya izinkan URL http(s) (cegah javascript:). */
  url(u) {
    u = String(u || '').trim();
    return /^https?:\/\//i.test(u) ? u : '';
  },
  initials(name) {
    const p = String(name || '?').trim().split(/\s+/);
    return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase();
  },
  /** Avatar: foto profil jika ada (http/https), kalau tidak inisial nama. */
  avatar(name, cls, foto) {
    const f = UI.url(foto);
    if (f) return '<span class="avatar has-photo ' + (cls || '') + '"><img src="' + UI.esc(f) + '" alt="" referrerpolicy="no-referrer" onerror="this.parentNode.classList.remove(\'has-photo\');this.parentNode.textContent=\'' + UI.esc(UI.initials(name)) + '\'"></span>';
    return '<span class="avatar ' + (cls || '') + '">' + UI.esc(UI.initials(name)) + '</span>';
  },
  fmtDate(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  },
  fmtDateTime(iso) {
    if (!iso) return '-';
    return new Date(iso).toLocaleString('id-ID', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  },
  timeAgo(iso) {
    const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (isNaN(s)) return '';
    if (s < 60) return 'baru saja';
    if (s < 3600) return Math.floor(s / 60) + ' menit lalu';
    if (s < 86400) return Math.floor(s / 3600) + ' jam lalu';
    if (s < 86400 * 7) return Math.floor(s / 86400) + ' hari lalu';
    return UI.fmtDate(iso);
  },
  /** "Sisa 2 hari 3 jam" / "Terlambat 5 jam" */
  countdown(iso) {
    const diff = new Date(iso).getTime() - Date.now();
    const abs = Math.abs(diff);
    const d = Math.floor(abs / 86400000), h = Math.floor(abs % 86400000 / 3600000), m = Math.floor(abs % 3600000 / 60000), s = Math.floor(abs % 60000 / 1000);
    let t;
    if (d > 0) t = d + ' hari ' + h + ' jam';
    else if (h > 0) t = h + ' jam ' + m + ' menit';
    else t = m + ' menit ' + s + ' detik';
    return { late: diff < 0, text: (diff < 0 ? 'Terlambat ' : 'Sisa ') + t };
  },
  /** ISO → nilai untuk <input type="datetime-local"> */
  toLocalInput(iso) {
    if (!iso) return '';
    const d = new Date(iso), p = n => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes());
  },
  fromLocalInput(v) { return v ? new Date(v).toISOString() : ''; },

  /** Tema warna pastel kelas (konsisten per id): latar, teks, aksen. */
  classTheme(id) {
    const T = [
      { bg: '#fbddd3', fg: '#7a3b28', ac: '#e8795a' },
      { bg: '#d8ebe4', fg: '#2d5e52', ac: '#4f9484' },
      { bg: '#fcebc4', fg: '#6f5010', ac: '#d9a021' },
      { bg: '#d9e6f7', fg: '#2f4f7f', ac: '#5b8bd0' },
      { bg: '#e8def5', fg: '#5a3e80', ac: '#9468c9' },
      { bg: '#f8d9e6', fg: '#7e3556', ac: '#d6659a' }
    ];
    let h = 0;
    String(id).split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) >>> 0; });
    return T[h % T.length];
  },
  classColor(id) { return UI.classTheme(id).ac; },
  classStyle(id) { const t = UI.classTheme(id); return 'background:' + t.bg + ';color:' + t.fg; },

  /** Ilustrasi wajah sederhana (avatar profil). */
  face(skin) {
    skin = skin || '#f4b79a';
    return '<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true">' +
      '<circle cx="50" cy="50" r="48" fill="#fff4ec"/><path d="M22 92c4-18 16-26 28-26s24 8 28 26z" fill="#6aa595"/>' +
      '<circle cx="50" cy="42" r="19" fill="' + skin + '"/><path d="M31 40c0-14 8-20 19-20s19 6 19 20c-5-7-12-10-19-10s-14 3-19 10z" fill="#7a4a35"/>' +
      '<circle cx="43" cy="44" r="2.2" fill="#5a3426"/><circle cx="57" cy="44" r="2.2" fill="#5a3426"/>' +
      '<path d="M44 52c3 3 9 3 12 0" stroke="#c0654a" stroke-width="2.2" fill="none" stroke-linecap="round"/>' +
      '<circle cx="38" cy="50" r="3" fill="#f29c86" opacity=".5"/><circle cx="62" cy="50" r="3" fill="#f29c86" opacity=".5"/></svg>';
  },
  plant() {
    return '<svg width="86" height="120" viewBox="0 0 86 120" fill="none" aria-hidden="true">' +
      '<path d="M43 72C20 66 18 30 40 14c8 14 12 36 3 58z" fill="#6aa595"/><path d="M43 72c10-26 28-40 38-34-2 22-16 38-38 34z" fill="#8bbfae"/>' +
      '<path d="M22 78h42l-5 32a6 6 0 0 1-6 5H33a6 6 0 0 1-6-5z" fill="#f3dfc3"/><rect x="18" y="72" width="50" height="11" rx="5.5" fill="#ecd1ac"/></svg>';
  },

  /* ----- Toast ----- */
  toast(msg, type) {
    type = type || 'success';
    let root = document.getElementById('toast-root');
    if (!root) { root = document.createElement('div'); root.id = 'toast-root'; document.body.appendChild(root); }
    const el = document.createElement('div');
    el.className = 'toast ' + type;
    el.setAttribute('role', 'status');
    el.textContent = msg;
    root.appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, type === 'error' ? 5000 : 3000);
  },

  /* ----- Tombol loading ----- */
  busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-busy', !!on);
    btn.disabled = !!on;
  },

  /* ----- Skeleton & Empty state ----- */
  skeletonCards(n) {
    let h = '<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">';
    for (let i = 0; i < (n || 3); i++) {
      h += '<div class="card p-4"><div class="skeleton" style="height:5rem"></div><div class="skeleton mt-4" style="height:.9rem;width:70%"></div><div class="skeleton mt-2" style="height:.9rem;width:45%"></div></div>';
    }
    return h + '</div>';
  },
  skeletonList(n) {
    let h = '<div class="card">';
    for (let i = 0; i < (n || 4); i++) {
      h += '<div class="row-item"><div class="skeleton" style="width:2.2rem;height:2.2rem;border-radius:9999px"></div><div class="flex-1"><div class="skeleton" style="height:.9rem;width:60%"></div><div class="skeleton mt-2" style="height:.75rem;width:35%"></div></div></div>';
    }
    return h + '</div>';
  },
  empty(title, text, actionHtml) {
    return '<div class="empty"><svg class="illus" viewBox="0 0 200 140" fill="none" aria-hidden="true">' +
      '<ellipse cx="100" cy="124" rx="70" ry="8" fill="#e8eaed"/>' +
      '<rect x="48" y="22" width="104" height="92" rx="8" fill="#e8f0fe" stroke="#aecbfa" stroke-width="2"/>' +
      '<rect x="64" y="42" width="72" height="8" rx="4" fill="#aecbfa"/>' +
      '<rect x="64" y="60" width="52" height="8" rx="4" fill="#d2e3fc"/>' +
      '<rect x="64" y="78" width="62" height="8" rx="4" fill="#d2e3fc"/>' +
      '<circle cx="146" cy="98" r="20" fill="#fff" stroke="#1a73e8" stroke-width="3"/>' +
      '<path d="M138 98h16M146 90v16" stroke="#1a73e8" stroke-width="3" stroke-linecap="round"/></svg>' +
      '<h3>' + UI.esc(title) + '</h3><p class="text-sm">' + UI.esc(text || '') + '</p>' +
      (actionHtml ? '<div class="mt-4">' + actionHtml + '</div>' : '') + '</div>';
  },

  /* ----- Modal ----- */
  _modals: [],
  /**
   * opts: { title, body (HTML), size: 'sm'|'md'|'lg', onClose }
   * return: { el, body, close }
   */
  modal(opts) {
    const back = document.createElement('div');
    back.className = 'modal-backdrop';
    back.innerHTML = '<div class="modal ' + (opts.size || '') + '" role="dialog" aria-modal="true">' +
      '<div class="modal-head"><h2>' + UI.esc(opts.title || '') + '</h2><button type="button" class="btn-icon" data-close aria-label="Tutup">' + icon('close') + '</button></div>' +
      '<div class="modal-body">' + (opts.body || '') + '</div></div>';
    document.body.appendChild(back);
    document.body.classList.add('no-scroll');
    const api = {
      el: back,
      body: back.querySelector('.modal-body'),
      close() {
        if (!back.isConnected) return;
        back.remove();
        UI._modals = UI._modals.filter(m => m !== api);
        if (!UI._modals.length) document.body.classList.remove('no-scroll');
        if (opts.onClose) opts.onClose();
      }
    };
    UI._modals.push(api);
    back.addEventListener('mousedown', e => { if (e.target === back) api.close(); });
    back.addEventListener('click', e => { if (e.target.closest('[data-close]')) api.close(); });
    return api;
  },

  /** Konfirmasi (dipakai sebelum delete). Resolve true/false. */
  confirm(opts) {
    if (typeof opts === 'string') opts = { message: opts };
    return new Promise(resolve => {
      let done = false;
      const finish = v => { if (!done) { done = true; resolve(v); } };
      const m = UI.modal({
        title: opts.title || 'Konfirmasi', size: 'sm', onClose: () => finish(false),
        body: '<p class="text-sm text-gray-700 pre-wrap">' + UI.esc(opts.message || 'Yakin?') + '</p>' +
          '<div class="flex justify-end gap-2 mt-5"><button type="button" class="btn btn-ghost" data-close>Batal</button>' +
          '<button type="button" class="btn ' + (opts.danger === false ? 'btn-primary' : 'btn-danger') + '" id="cf-ok">' + UI.esc(opts.confirmText || 'Hapus') + '</button></div>'
      });
      m.el.querySelector('#cf-ok').addEventListener('click', () => { finish(true); m.close(); });
    });
  },

  /**
   * Modal berisi form otomatis.
   * fields: [{name,label,type,value,required,options:[{value,label}],placeholder,rows,hint,maxlength,min,max}]
   * onSubmit(values, modal) → Promise; modal otomatis tertutup jika sukses.
   */
  formModal(opts) {
    const fieldHtml = f => {
      const id = 'f_' + f.name;
      const req = f.required ? ' required' : '';
      const common = ' id="' + id + '" name="' + f.name + '" class="input"' + req + (f.placeholder ? ' placeholder="' + UI.esc(f.placeholder) + '"' : '') + (f.maxlength ? ' maxlength="' + f.maxlength + '"' : '');
      let input;
      if (f.type === 'textarea') {
        input = '<textarea' + common + ' rows="' + (f.rows || 4) + '">' + UI.esc(f.value || '') + '</textarea>';
      } else if (f.type === 'select') {
        input = '<select' + common + '>' + (f.options || []).map(o => '<option value="' + UI.esc(o.value) + '"' + (String(o.value) === String(f.value) ? ' selected' : '') + '>' + UI.esc(o.label) + '</option>').join('') + '</select>';
      } else {
        input = '<input type="' + (f.type || 'text') + '"' + common + ' value="' + UI.esc(f.value || '') + '"' +
          (f.min !== undefined ? ' min="' + f.min + '"' : '') + (f.max !== undefined ? ' max="' + f.max + '"' : '') + (f.step ? ' step="' + f.step + '"' : '') + ' autocomplete="off">';
      }
      return '<div><label class="label" for="' + id + '">' + UI.esc(f.label) + (f.required ? ' <span class="text-red-600">*</span>' : '') + '</label>' + input + (f.hint ? '<p class="hint">' + UI.esc(f.hint) + '</p>' : '') + '</div>';
    };
    const m = UI.modal({
      title: opts.title, size: opts.size,
      body: (opts.intro ? '<p class="text-sm text-gray-600 mb-4 pre-wrap">' + UI.esc(opts.intro) + '</p>' : '') +
        '<form class="space-y-4" novalidate>' + opts.fields.map(fieldHtml).join('') +
        '<div class="flex justify-end gap-2 pt-2"><button type="button" class="btn btn-ghost" data-close>Batal</button>' +
        '<button type="submit" class="btn btn-primary">' + UI.esc(opts.submitText || 'Simpan') + '</button></div></form>'
    });
    const form = m.el.querySelector('form');
    const submitBtn = form.querySelector('[type=submit]');
    const first = form.querySelector('input,textarea,select');
    if (first) setTimeout(() => first.focus(), 50);
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const values = {};
      opts.fields.forEach(f => { values[f.name] = form.elements[f.name].value.trim(); });
      UI.busy(submitBtn, true);
      try {
        await opts.onSubmit(values, m);
        m.close();
      } catch (err) {
        UI.toast(err.message || 'Gagal menyimpan', 'error');
        UI.busy(submitBtn, false);
      }
    });
    return m;
  },

  /** Salin teks ke clipboard. */
  async copy(text) {
    try { await navigator.clipboard.writeText(text); UI.toast('Disalin: ' + text, 'info'); }
    catch (e) { UI.toast('Gagal menyalin, salin manual: ' + text, 'error'); }
  }
};

// Tutup modal teratas dengan tombol Esc
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && UI._modals.length) UI._modals[UI._modals.length - 1].close();
});

const GuruApp = (function () {
/* ============================================================
   ClassRoom Lite — guru.js
   SPA dashboard Guru/Admin (routing berbasis hash: #/dashboard, #/kelas/ID/tugas, dst.)
   ============================================================ */

let ME;
const $ = (sel, root) => (root || document).querySelector(sel);
let $view;

// State aplikasi: seluruh data guru dimuat sekali (getGuruData) lalu di-refresh setelah setiap perubahan
const S = {
  data: null,
  filters: { tugas: '', pengumuman: '', materi: '', siswa: '', nilaiKelas: '', nilaiTugas: '', nilaiAll: false, q: '', bnKelas: '', bnMapel: '' }
};

const MENU = [
  { key: 'dashboard',  label: 'Dashboard',  icon: 'dashboard' },
  { key: 'kelas',      label: 'Kelas Saya', icon: 'classes' },
  { key: 'tugas',      label: 'Tugas',      icon: 'tasks' },
  { key: 'penilaian',  label: 'Penilaian',  icon: 'edit' },
  { key: 'bukunilai',  label: 'Buku Nilai', icon: 'grade' },
  { key: 'pengumuman', label: 'Pengumuman', icon: 'announce' },
  { key: 'materi',     label: 'Materi',     icon: 'folder' },
  { key: 'siswa',      label: 'Siswa',      icon: 'users' }
];

/* ---------------- Utilitas data ---------------- */
const D = () => S.data;
const classById = id => (D() ? D().classes.find(c => c.id === id) : null) || null;
const classOptionsHtml = sel => D().classes.map(c => '<option value="' + c.id + '"' + (c.id === sel ? ' selected' : '') + '>' + UI.esc(c.nama_kelas) + '</option>').join('');
const classOptions = () => D().classes.map(c => ({ value: c.id, label: c.nama_kelas }));
const isLate = s => s && s.deadline && new Date(s.submitted_at) > new Date(s.deadline);

/** Pasang satu listener klik yang menangani semua elemen [data-act] di dalam el. */
function bind(el, handlers) {
  el._handlers = handlers;          // handler terbaru selalu menggantikan yang lama
  if (el._bound) return;            // listener hanya dipasang sekali per elemen (hindari klik ganda)
  el._bound = true;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !el.contains(b)) return;
    const h = el._handlers[b.dataset.act];
    if (h) { e.preventDefault(); h(b.dataset.id, b, e); }
  });
}

function ensureClasses() {
  if (!D().classes.length) { UI.toast('Buat kelas terlebih dahulu di menu "Kelas Saya"', 'error'); return false; }
  return true;
}

async function loadData() { S.data = await API.call('getGuruData'); }

/** Muat ulang data dari server lalu gambar ulang halaman aktif. */
async function refresh() {
  try { await loadData(); } catch (e) { UI.toast(e.message, 'error'); }
  render();
}

/** Jalankan aksi API dengan toast sukses + refresh. */
async function act(action, params, okMsg) {
  await API.call(action, params);
  if (okMsg) UI.toast(okMsg);
  await refresh();
}

/* ---------------- Boot & routing ---------------- */
const SHELL = `<div id="drawer-overlay" class="drawer-overlay"></div>
  <aside id="sidebar" class="sidebar" aria-label="Menu utama">
    <div class="profile">
      <div class="ring"><div id="pf-face" style="width:4.7rem;height:4.7rem;border-radius:9999px;overflow:hidden"></div><span class="dot"></span></div>
      <h2 id="pf-name"></h2><p>Guru / Admin</p>
    </div>
    <nav id="nav" class="flex-1 py-2 overflow-y-auto"></nav>
    <div class="promo"><div class="crown" id="pf-promo-ico"></div><h3>Nilai hari ini</h3><p>Tinjau pengumpulan tugas siswa dengan cepat.</p><a class="btn btn-primary btn-sm w-full" href="#/penilaian">Buka Penilaian</a></div>
  </aside>
  <div class="main-area">
    <header class="sticky-header">
      <button id="btn-menu" class="btn-icon md:hidden" aria-label="Buka menu"></button>
      <h1 id="page-title" class="flex-1 truncate">Dashboard</h1>
      <div class="user-pill"><span id="hdr-avatar"></span><span id="hdr-name" class="hidden sm:block"></span></div>
    </header>
    <main id="view" class="px-4 pb-8 md:px-6 max-w-6xl mx-auto"></main>
  </div>`;

let hashHandler = null;
function stop() {
  if (hashHandler) window.removeEventListener('hashchange', hashHandler);
  hashHandler = null;
  S.data = null;
}

function start() {
  ME = Session.user();
  document.getElementById('app').innerHTML = SHELL;
  $view = document.getElementById('view');
  boot();
}

function boot() {
  $('#hdr-name').textContent = ME.nama.split(' ').slice(0, 2).join(' ');
  $('#hdr-avatar').innerHTML = UI.avatar(ME.nama);
  $('#pf-face').innerHTML = UI.face();
  $('#pf-name').textContent = 'Hi, ' + ME.nama + '!';
  $('#pf-promo-ico').innerHTML = icon('crown', 'w-6 h-6');
  $('#btn-menu').innerHTML = icon('menu');
  $('#nav').innerHTML = MENU.map(m =>
    '<a class="nav-item" href="#/' + m.key + '" data-key="' + m.key + '"><span class="ib">' + icon(m.icon, 'w-5 h-5') + '</span><span>' + m.label + '</span></a>'
  ).join('') + '<a class="nav-item" href="#" id="btn-logout"><span class="ib">' + icon('logout', 'w-5 h-5') + '</span><span>Logout</span></a>';

  $('#btn-logout').addEventListener('click', async e => {
    e.preventDefault();
    if (await UI.confirm({ title: 'Logout', message: 'Keluar dari akun ini?', confirmText: 'Logout', danger: false })) Auth.logout();
  });

  const sidebar = $('#sidebar'), overlay = $('#drawer-overlay');
  const toggle = open => { sidebar.classList.toggle('open', open); overlay.classList.toggle('show', open); };
  $('#btn-menu').addEventListener('click', () => toggle(true));
  overlay.addEventListener('click', () => toggle(false));
  if (hashHandler) window.removeEventListener('hashchange', hashHandler);
  hashHandler = () => { toggle(false); render(); window.scrollTo(0, 0); };
  window.addEventListener('hashchange', hashHandler);

  const muat = () => {
    $view.innerHTML = UI.skeletonCards(3);
    loadData().then(render).catch(err => {
      if (err && err.code === 'AUTH') return; // sudah dikembalikan ke layar login
      $view.innerHTML = UI.empty('Gagal memuat data', err.message, '<button class="btn btn-primary" id="retry">Coba lagi</button>');
      const rb = document.getElementById('retry');
      if (rb) rb.addEventListener('click', muat);
    });
  };
  muat();
}

function render() {
  if (!D()) return;
  const parts = (location.hash || '#/dashboard').replace(/^#\/?/, '').split('/');
  const page = parts[0] || 'dashboard';
  document.querySelectorAll('#nav .nav-item[data-key]').forEach(a => a.classList.toggle('active', a.dataset.key === page));
  document.body.classList.toggle('has-bottom-nav', page === 'kelas' && !!parts[1]);

  const titles = { dashboard: 'Dashboard', kelas: 'Kelas Saya', tugas: 'Tugas', penilaian: 'Penilaian', bukunilai: 'Buku Nilai', pengumuman: 'Pengumuman', materi: 'Materi', siswa: 'Siswa' };
  $('#page-title').textContent = titles[page] || 'ClassRoom Lite';

  switch (page) {
    case 'dashboard': return pageDashboard();
    case 'kelas': return parts[1] ? pageKelasDetail(parts[1], parts[2]) : pageKelas();
    case 'tugas': case 'pengumuman': case 'materi': case 'siswa': return pageList(page);
    case 'penilaian': return pagePenilaian();
    case 'bukunilai': return pageBukuNilai();
    default: location.hash = '#/dashboard';
  }
}

/* ============================================================
   DASHBOARD
   ============================================================ */
function pageDashboard() {
  const d = D();
  const ungraded = d.submissions.filter(s => s.nilai === null).length;
  const graded = d.submissions.length - ungraded;
  const totalSiswa = new Set(d.students.map(s => s.siswa_id)).size;
  const stats = [
    { label: 'Total Kelas', value: d.classes.length, icon: 'classes', t: 'mint', cap: 'Kelas aktif', href: '#/kelas' },
    { label: 'Total Siswa', value: totalSiswa, icon: 'users', t: 'peach', cap: 'Siswa terdaftar', href: '#/siswa' },
    { label: 'Total Tugas', value: d.assignments.length, icon: 'tasks', t: 'butter', cap: 'Tugas dibuat', href: '#/tugas' },
    { label: 'Belum Dinilai', value: ungraded, icon: 'grade', t: 'sky', cap: ungraded ? 'Menunggu penilaianmu' : 'Semua sudah dinilai', href: '#/penilaian' }
  ];
  const recent = d.submissions.filter(s => s.submitted_at).slice(0, 5);
  const first = ME.nama.replace(/^(Bu|Pak|Ibu|Bapak)\s+/i, '').split(' ')[0];

  // Grafik batang: jumlah pengumpulan per kelas
  const perClass = d.classes.slice(0, 7).map(c => ({
    c, n: d.submissions.filter(s => s.class_id === c.id).length
  }));
  const max = Math.max(1, ...perClass.map(x => x.n));
  const barsHtml = perClass.length
    ? '<div class="bars">' + perClass.map(x => '<div class="col"><span class="val">' + x.n + '</span><div class="bar" style="height:' + Math.max(6, Math.round(x.n / max * 82)) + '%;background:' + UI.classTheme(x.c.id).ac + '"></div></div>').join('') + '</div>' +
      '<div class="bars-x">' + perClass.map(x => '<span title="' + UI.esc(x.c.nama_kelas) + '">' + UI.esc(x.c.nama_kelas) + '</span>').join('') + '</div>'
    : UI.empty('Belum ada kelas', 'Grafik muncul setelah ada pengumpulan tugas.');
  const pct = d.submissions.length ? Math.round(graded / d.submissions.length * 100) : 0;

  $view.innerHTML = '<div id="pg">' +
    '<section class="hero mb-5"><div class="art">' + '<div style="width:5.6rem;height:5.6rem">' + UI.face() + '</div></div>' +
    '<div class="relative" style="z-index:1"><span class="chip">' + icon('clock', 'w-3.5 h-3.5') + ' ' + new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }) + '</span>' +
    '<h2>Selamat mengajar, ' + UI.esc(first) + '!</h2>' +
    '<p>' + (ungraded ? 'Ada <b>' + ungraded + ' pengumpulan</b> yang menunggu nilaimu. ' : 'Semua tugas sudah dinilai. ') + 'Kelola kelas, tugas, dan pengumuman dalam satu tempat.</p>' +
    '<div class="flex flex-wrap gap-2 mt-4"><button class="btn btn-primary" data-act="newtask">' + icon('plus', 'w-4 h-4') + ' Buat Tugas</button>' +
    '<a class="btn btn-outline" href="#/penilaian">' + icon('grade', 'w-4 h-4') + ' Beri Nilai</a></div></div>' +
    '<div class="plant">' + UI.plant() + '</div></section>' +

    '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5 mb-5">' + stats.map(s =>
      '<a href="' + s.href + '" class="stat t-' + s.t + '"><div class="ico">' + icon(s.icon, 'w-6 h-6') + '</div>' +
      '<div class="lbl">' + s.label + '</div><div class="num">' + s.value + '</div><div class="cap">' + s.cap + '</div></a>').join('') + '</div>' +

    '<div class="grid gap-5 lg:grid-cols-[1.4fr_1fr] mb-5">' +
    '<section class="card p-5"><h2 class="panel-title">Pengumpulan per kelas</h2><p class="text-sm text-gray-500 mb-4">Jumlah tugas yang sudah dikumpulkan siswa</p>' + barsHtml + '</section>' +
    '<section class="card p-5"><h2 class="panel-title">Status penilaian</h2><p class="text-sm text-gray-500 mb-4">Dari semua pengumpulan tugas</p>' +
    '<div class="flex flex-wrap items-center gap-5"><div class="donut" style="--p:' + pct + '"><div class="mid"><b>' + pct + '%</b><small>Dinilai</small></div></div>' +
    '<div class="legend"><div><i style="background:var(--teal)"></i>Sudah dinilai<span>' + graded + '</span></div>' +
    '<div><i style="background:var(--butter);box-shadow:inset 0 0 0 2px #e6c36a"></i>Belum dinilai<span>' + ungraded + '</span></div></div></div></section></div>' +

    '<section class="card"><div class="px-5 py-4 flex items-center justify-between"><h2 class="panel-title">Pengumpulan terbaru</h2><a href="#/penilaian" class="text-sm font-bold">Lihat semua</a></div>' +
    '<div id="recent">' + (recent.length ? recent.map(s =>
      '<div class="row-item">' + UI.avatar(s.siswa_nama) +
      '<div class="flex-1 min-w-0"><p class="text-sm truncate"><b>' + UI.esc(s.siswa_nama) + '</b> mengumpulkan <b>' + UI.esc(s.assignment_judul) + '</b></p>' +
      '<p class="text-xs text-gray-500">' + UI.esc(s.nama_kelas) + ' · ' + UI.timeAgo(s.submitted_at) + (isLate(s) ? ' · <span style="color:var(--danger)">terlambat</span>' : '') + '</p></div>' +
      (s.nilai === null ? '<span class="badge badge-yellow hidden sm:inline-flex">Belum dinilai</span>' : '<span class="badge badge-green">Nilai ' + s.nilai + '</span>') +
      '<button class="btn btn-outline btn-sm" data-act="grade" data-id="' + s.id + '">' + (s.nilai === null ? 'Nilai' : 'Lihat') + '</button></div>').join('')
      : UI.empty('Belum ada pengumpulan', 'Pengumpulan tugas dari siswa akan muncul di sini.')) + '</div></section></div>';

  bind($('#pg'), {
    grade: id => { const s = D().submissions.find(x => x.id === id); if (s) openGradeModal(s); },
    newtask: () => assignmentForm(null, '')
  });
}

/* ============================================================
   KELAS SAYA
   ============================================================ */
function pageKelas() {
  const d = D();
  $view.innerHTML = '<div id="pg">' +
    '<div class="flex items-center justify-between mb-4"><p class="text-sm text-gray-600">' + d.classes.length + ' kelas</p>' +
    '<button class="btn btn-primary" data-act="new">' + icon('plus', 'w-4 h-4') + ' Buat Kelas Baru</button></div><div id="cls"></div></div>';
  const box = $('#cls');
  box.innerHTML = d.classes.length
    ? '<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">' + d.classes.map(classCard).join('') + '</div>'
    : UI.empty('Belum ada kelas', 'Buat kelas pertamamu, lalu bagikan kode kelas kepada siswa.', '<button class="btn btn-primary" data-act="new">Buat Kelas Baru</button>');

  const handlers = {
    new: () => classForm(null),
    open: id => { location.hash = '#/kelas/' + id; },
    edit: id => classForm(classById(id)),
    copy: (id, b) => UI.copy(b.dataset.kode),
    del: async id => {
      const c = classById(id);
      if (await UI.confirm({ title: 'Hapus kelas', message: 'Hapus kelas "' + c.nama_kelas + '" beserta seluruh tugas, pengumuman, materi, dan nilai di dalamnya?\nTindakan ini tidak dapat dibatalkan.' })) {
        try { await act('deleteClass', { id }, 'Kelas dihapus'); } catch (e) { UI.toast(e.message, 'error'); }
      }
    }
  };
  bind($('#pg'), handlers);
}

function classCard(c) {
  return '<article class="card class-card card-hover" data-act="open" data-id="' + c.id + '">' +
    '<div class="banner" style="' + UI.classStyle(c.id) + '"><h3 class="truncate">' + UI.esc(c.nama_kelas) + '</h3>' +
    '<p class="line-clamp-2">' + (c.mapel ? '<b>' + UI.esc(c.mapel) + '</b> · ' : '') + UI.esc(c.deskripsi || 'Tanpa deskripsi') + '</p></div>' +
    '<div class="px-4 pt-3 pb-2 flex items-center justify-between text-sm">' +
    '<button class="inline-flex items-center gap-1.5 font-mono tracking-widest px-3 py-1 rounded-full" style="background:#f3ead9;box-shadow:var(--inset)" data-act="copy" data-id="' + c.id + '" data-kode="' + UI.esc(c.kode_kelas) + '" title="Salin kode kelas">' + UI.esc(c.kode_kelas) + icon('copy', 'w-3.5 h-3.5') + '</button>' +
    '<span class="text-gray-500">' + c.siswa_count + ' siswa · ' + c.tugas_count + ' tugas</span></div>' +
    '<div class="flex justify-end gap-1 px-2 pb-2 mt-auto">' +
    '<button class="btn-icon" data-act="edit" data-id="' + c.id + '" aria-label="Edit kelas">' + icon('edit', 'w-4 h-4') + '</button>' +
    '<button class="btn-icon danger" data-act="del" data-id="' + c.id + '" aria-label="Hapus kelas">' + icon('trash', 'w-4 h-4') + '</button></div></article>';
}

function classForm(c) {
  UI.formModal({
    title: c ? 'Edit Kelas' : 'Buat Kelas Baru',
    intro: c ? '' : 'Kode kelas 6 karakter akan dibuat otomatis untuk dibagikan ke siswa.',
    submitText: c ? 'Simpan' : 'Buat Kelas',
    fields: [
      { name: 'nama_kelas', label: 'Nama kelas', required: true, value: c ? c.nama_kelas : '', maxlength: 80, placeholder: 'mis. Matematika 7A' },
      { name: 'mapel', label: 'Mata pelajaran', value: c ? (c.mapel || '') : '', maxlength: 60, placeholder: 'mis. Matematika', hint: 'Dipakai untuk filter Buku Nilai & Excel.' },
      { name: 'deskripsi', label: 'Deskripsi', type: 'textarea', rows: 3, value: c ? c.deskripsi : '', maxlength: 300 }
    ],
    onSubmit: async v => {
      if (c) await act('updateClass', { id: c.id, nama_kelas: v.nama_kelas, mapel: v.mapel, deskripsi: v.deskripsi }, 'Kelas diperbarui');
      else {
        const nc = await API.call('createClass', v);
        UI.toast('Kelas dibuat. Kode kelas: ' + nc.kode_kelas);
        await refresh();
      }
    }
  });
}

/* ---------- Detail kelas (tab: Stream, Tugas, Materi, Siswa) ---------- */
function pageKelasDetail(id, tab) {
  const c = classById(id);
  if (!c) {
    $view.innerHTML = UI.empty('Kelas tidak ditemukan', 'Kelas mungkin sudah dihapus.', '<a class="btn btn-primary" href="#/kelas">Kembali ke Kelas Saya</a>');
    return;
  }
  const tabs = [
    { key: 'stream', label: 'Stream', icon: 'stream', kind: 'pengumuman' },
    { key: 'tugas', label: 'Tugas', icon: 'tasks', kind: 'tugas' },
    { key: 'materi', label: 'Materi', icon: 'folder', kind: 'materi' },
    { key: 'siswa', label: 'Siswa', icon: 'users', kind: 'siswa' }
  ];
  const cur = tabs.find(t => t.key === tab) || tabs[0];
  $('#page-title').textContent = c.nama_kelas;

  $view.innerHTML =
    '<a href="#/kelas" class="text-sm inline-block mb-3">← Semua kelas</a>' +
    '<div class="card class-head mb-5"><div class="p-6" style="' + UI.classStyle(c.id) + '">' +
    '<h2 class="text-2xl font-extrabold">' + UI.esc(c.nama_kelas) + '</h2><p class="text-sm opacity-90">' + UI.esc(c.deskripsi || '') + '</p>' +
    '<div class="mt-3 flex flex-wrap items-center gap-3 text-sm"><span>Kode kelas:</span>' +
    '<button class="font-mono tracking-widest px-3 py-0.5 rounded-full bg-white/70 hover:bg-white" id="cp" title="Salin">' + UI.esc(c.kode_kelas) + '</button>' +
    '<span>' + c.siswa_count + ' siswa</span></div></div>' +
    '<div class="tabs-wrap"><nav class="tabbar bottom-nav" aria-label="Tab kelas">' + tabs.map(t =>
      '<a class="tab' + (t.key === cur.key ? ' active' : '') + '" href="#/kelas/' + c.id + '/' + t.key + '">' + icon(t.icon, 'w-5 h-5') + '<span>' + t.label + '</span></a>').join('') + '</nav></div></div>' +
    '<div id="tab-content"></div>';
  $('#cp').addEventListener('click', () => UI.copy(c.kode_kelas));
  renderSection(cur.kind, $('#tab-content'), c.id, true);
}

/* ============================================================
   HALAMAN LIST (Tugas / Pengumuman / Materi / Siswa) + filter kelas
   ============================================================ */
function pageList(kind) {
  if (!classById(S.filters[kind])) S.filters[kind] = '';
  $view.innerHTML =
    '<div class="flex flex-wrap items-center gap-3 mb-4"><label class="text-sm text-gray-600" for="flt">Kelas:</label>' +
    '<select id="flt" class="input" style="width:auto;min-width:12rem"><option value="">Semua kelas</option>' + classOptionsHtml(S.filters[kind]) + '</select></div><div id="sec"></div>';
  const draw = () => renderSection(kind, $('#sec'), S.filters[kind], false);
  $('#flt').addEventListener('change', e => { S.filters[kind] = e.target.value; draw(); });
  draw();
}

function renderSection(kind, el, classId, fixed) {
  ({ pengumuman: secPengumuman, tugas: secTugas, materi: secMateri, siswa: secSiswa })[kind](el, classId, fixed);
}

const kelasBadge = (item, fixed) => fixed ? '' : '<span class="badge badge-blue">' + UI.esc(item.nama_kelas) + '</span>';
const editDelBtns = id =>
  '<button class="btn-icon" data-act="edit" data-id="' + id + '" aria-label="Edit">' + icon('edit', 'w-4 h-4') + '</button>' +
  '<button class="btn-icon danger" data-act="del" data-id="' + id + '" aria-label="Hapus">' + icon('trash', 'w-4 h-4') + '</button>';

async function confirmDelete(message, action, id, okMsg) {
  if (await UI.confirm({ title: 'Konfirmasi hapus', message })) {
    try { await act(action, { id }, okMsg); } catch (e) { UI.toast(e.message, 'error'); }
  }
}

/* ---------------- Pengumuman (Stream) ---------------- */
function secPengumuman(el, classId, fixed) {
  const items = D().announcements.filter(a => !classId || a.class_id === classId);
  el.innerHTML =
    '<div class="flex items-center justify-between mb-3"><h2 class="font-medium">Pengumuman <span class="text-gray-400 font-normal">(' + items.length + ')</span></h2>' +
    '<button class="btn btn-primary" data-act="new">' + icon('plus', 'w-4 h-4') + ' Buat Pengumuman</button></div>' +
    (items.length ? '<div class="space-y-3">' + items.map(a =>
      '<article class="card p-4"><div class="flex gap-3">' + UI.avatar(a.guru_nama) +
      '<div class="flex-1 min-w-0"><div class="flex items-start justify-between gap-2"><div class="min-w-0">' +
      '<h3 class="font-medium">' + UI.esc(a.judul) + '</h3>' +
      '<p class="text-xs text-gray-500 flex flex-wrap items-center gap-2">' + UI.esc(a.guru_nama) + ' · ' + UI.fmtDateTime(a.created_at) + ' ' + kelasBadge(a, fixed) + '</p></div>' +
      '<div class="flex flex-none">' + editDelBtns(a.id) + '</div></div>' +
      '<p class="mt-2 text-sm pre-wrap">' + UI.esc(a.isi) + '</p></div></div></article>').join('') + '</div>'
      : UI.empty('Belum ada pengumuman', 'Pengumuman akan tampil di stream kelas siswa.'));

  bind(el, {
    new: () => announcementForm(null, classId),
    edit: id => announcementForm(items.find(x => x.id === id)),
    del: id => confirmDelete('Hapus pengumuman ini?', 'deleteAnnouncement', id, 'Pengumuman dihapus')
  });
}

function announcementForm(item, classId) {
  if (!item && !ensureClasses()) return;
  const fields = [];
  if (!item) fields.push({ name: 'class_id', label: 'Kelas', type: 'select', required: true, options: classOptions(), value: classId || D().classes[0].id });
  fields.push(
    { name: 'judul', label: 'Judul', required: true, value: item ? item.judul : '', maxlength: 150 },
    { name: 'isi', label: 'Isi pengumuman', type: 'textarea', rows: 5, required: true, value: item ? item.isi : '' }
  );
  UI.formModal({
    title: item ? 'Edit Pengumuman' : 'Buat Pengumuman', fields, submitText: item ? 'Simpan' : 'Terbitkan',
    onSubmit: v => item
      ? act('updateAnnouncement', { id: item.id, judul: v.judul, isi: v.isi }, 'Pengumuman diperbarui')
      : act('createAnnouncement', v, 'Pengumuman diterbitkan')
  });
}

/* ---------------- Tugas ---------------- */
function secTugas(el, classId, fixed) {
  const items = D().assignments.filter(a => !classId || a.class_id === classId);
  el.innerHTML =
    '<div class="flex items-center justify-between mb-3"><h2 class="font-medium">Tugas <span class="text-gray-400 font-normal">(' + items.length + ')</span></h2>' +
    '<button class="btn btn-primary" data-act="new">' + icon('plus', 'w-4 h-4') + ' Buat Tugas</button></div>' +
    (items.length ? '<div class="card">' + items.map(a => {
      const late = new Date(a.deadline) < new Date();
      const ungraded = a.submitted_count - a.graded_count;
      return '<div class="row-item card-hover" data-act="detail" data-id="' + a.id + '" style="cursor:pointer">' +
        '<span class="task-ico">' + icon('tasks', 'w-5 h-5') + '</span>' +
        '<div class="flex-1 min-w-0"><p class="font-medium truncate">' + UI.esc(a.judul) + '</p>' +
        '<p class="text-xs text-gray-500 flex flex-wrap items-center gap-x-2 gap-y-1">' + kelasBadge(a, fixed) +
        '<span class="' + (late ? 'text-red-600' : '') + '">Deadline ' + UI.fmtDateTime(a.deadline) + '</span>' +
        '<span>' + a.submitted_count + '/' + a.siswa_count + ' mengumpulkan</span>' +
        (ungraded > 0 ? '<span class="badge badge-yellow">' + ungraded + ' belum dinilai</span>' : '') + '</p></div>' +
        '<div class="flex flex-none">' + editDelBtns(a.id) + '</div></div>';
    }).join('') + '</div>' : UI.empty('Belum ada tugas', 'Buat tugas untuk dikerjakan siswa.'));

  bind(el, {
    new: () => assignmentForm(null, classId),
    edit: id => assignmentForm(items.find(x => x.id === id)),
    del: id => confirmDelete('Hapus tugas ini beserta semua pengumpulan & nilainya?', 'deleteAssignment', id, 'Tugas dihapus'),
    detail: id => openAssignmentDetail(id)
  });
}

function assignmentForm(item, classId) {
  if (!item && !ensureClasses()) return;
  const fields = [];
  if (!item) fields.push({ name: 'class_id', label: 'Kelas', type: 'select', required: true, options: classOptions(), value: classId || D().classes[0].id });
  fields.push(
    { name: 'judul', label: 'Judul tugas', required: true, value: item ? item.judul : '', maxlength: 150 },
    { name: 'deskripsi', label: 'Deskripsi / instruksi', type: 'textarea', rows: 5, value: item ? item.deskripsi : '' },
    { name: 'deadline', label: 'Deadline', type: 'datetime-local', required: true, value: item ? UI.toLocalInput(item.deadline) : '' },
    { name: 'file_url', label: 'Lampiran URL (opsional)', type: 'url', value: item ? item.file_url : '', placeholder: 'https://drive.google.com/...', hint: 'Link Google Drive / dokumen pendukung.' }
  );
  UI.formModal({
    title: item ? 'Edit Tugas' : 'Buat Tugas', fields, submitText: item ? 'Simpan' : 'Buat Tugas',
    onSubmit: v => {
      v.deadline = UI.fromLocalInput(v.deadline);
      return item ? act('updateAssignment', Object.assign({ id: item.id }, { judul: v.judul, deskripsi: v.deskripsi, deadline: v.deadline, file_url: v.file_url }), 'Tugas diperbarui')
                  : act('createAssignment', v, 'Tugas dibuat');
    }
  });
}

/** Detail tugas: daftar siswa sudah/belum mengumpulkan + tombol beri nilai. */
async function openAssignmentDetail(id) {
  const a = D().assignments.find(x => x.id === id);
  if (!a) return;
  const m = UI.modal({ title: a.judul, size: 'lg', body: UI.skeletonList(4) });

  async function load() {
    try {
      const res = await API.call('getAssignmentStatus', { assignment_id: id });
      const done = res.students.filter(s => s.submission && s.submission.submitted_at).length;
      m.body.innerHTML =
        '<div class="mb-4 text-sm"><p class="text-gray-500 mb-1">' + UI.esc(a.nama_kelas) + ' · Deadline ' + UI.fmtDateTime(a.deadline) + '</p>' +
        (a.deskripsi ? '<p class="pre-wrap mb-2">' + UI.esc(a.deskripsi) + '</p>' : '') +
        (UI.url(a.file_url) ? '<a href="' + UI.esc(UI.url(a.file_url)) + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1">' + icon('link', 'w-4 h-4') + ' Lampiran</a>' : '') + '</div>' +
        '<div class="flex gap-2 mb-3"><span class="badge badge-green">' + done + ' sudah mengumpulkan</span><span class="badge badge-gray">' + (res.students.length - done) + ' belum</span></div>' +
        (res.students.length ? '<div class="card table-wrap"><table class="tbl"><thead><tr><th>Siswa</th><th>Status</th><th>Dikumpulkan</th><th>Nilai</th><th></th></tr></thead><tbody>' +
          res.students.map(s => {
            const sub = s.submission;
            let badge = '<span class="badge badge-gray">Belum mengumpulkan</span>';
            if (sub) {
              const late = sub.submitted_at && new Date(sub.submitted_at) > new Date(a.deadline);
              badge = sub.nilai !== null ? '<span class="badge badge-green">Dinilai</span>' : '<span class="badge badge-blue">Sudah mengumpulkan</span>';
              if (!sub.submitted_at) badge = sub.nilai !== null ? '<span class="badge badge-green">Dinilai guru</span> <span class="badge badge-gray">Belum mengumpulkan</span>' : badge;
              if (late) badge += ' <span class="badge badge-yellow">Terlambat</span>';
            }
            return '<tr><td><div class="flex items-center gap-2">' + UI.avatar(s.nama, '', s.foto_url) + '<div><div>' + UI.esc(s.nama) + '</div><div class="text-xs text-gray-500">' + UI.esc(s.email) + '</div></div></div></td>' +
              '<td>' + badge + '</td><td>' + (sub ? UI.fmtDateTime(sub.submitted_at) : '-') + '</td><td>' + (sub && sub.nilai !== null ? '<b>' + sub.nilai + '</b>' : '-') + '</td>' +
              '<td><button class="btn btn-outline btn-sm" data-act="grade" data-id="' + s.siswa_id + '">' + (sub && sub.nilai !== null ? 'Ubah' : 'Nilai') + '</button></td></tr>';
          }).join('') + '</tbody></table></div>' : UI.empty('Belum ada siswa', 'Belum ada siswa yang bergabung di kelas ini.'));

      bind(m.body, {
        grade: sid => {
          const st = res.students.find(x => x.siswa_id === sid);
          openGradeModal(Object.assign({ assignment_id: a.id, siswa_id: st.siswa_id }, st.submission, { siswa_nama: st.nama, assignment_judul: a.judul, deadline: a.deadline, nama_kelas: a.nama_kelas }), async () => { await refresh(); load(); });
        }
      });
    } catch (e) {
      m.body.innerHTML = UI.empty('Gagal memuat', e.message);
    }
  }
  load();
}

/** Modal penilaian satu pengumpulan. sub: submission + siswa_nama, assignment_judul, deadline, nama_kelas */
function openGradeModal(sub, onDone) {
  const late = isLate(sub);
  const m = UI.modal({
    title: 'Penilaian — ' + sub.siswa_nama, size: 'lg',
    body: '<div class="text-sm mb-3"><p><b>' + UI.esc(sub.assignment_judul) + '</b> · ' + UI.esc(sub.nama_kelas) + '</p>' +
      (sub.submitted_at ? '<p class="text-gray-500">Dikumpulkan ' + UI.fmtDateTime(sub.submitted_at) + (late ? ' <span class="badge badge-yellow">Terlambat</span>' : '') + '</p>' : '<p class="text-gray-500"><span class="badge badge-gray">Belum mengumpulkan</span> Nilai diberikan langsung oleh guru (mis. tugas kelompok atau dikumpulkan di luar aplikasi).</p>') + '</div>' +
      '<div class="answer-box p-3 mb-3 text-sm"><p class="label">Jawaban siswa</p>' +
      (sub.jawaban ? '<p class="pre-wrap">' + UI.esc(sub.jawaban) + '</p>' : '<p class="text-gray-400">(tidak ada jawaban teks)</p>') +
      (UI.url(sub.file_url) ? '<p class="mt-2"><a href="' + UI.esc(UI.url(sub.file_url)) + '" target="_blank" rel="noopener noreferrer" class="inline-flex items-center gap-1">' + icon('external', 'w-4 h-4') + ' Buka file / link jawaban</a></p>' : '') + '</div>' +
      '<form class="space-y-3" novalidate><div><label class="label" for="g-nilai">Nilai (0–100)</label>' +
      '<input id="g-nilai" class="input" type="number" min="0" max="100" step="0.1" required value="' + (sub.nilai === null || sub.nilai === undefined ? '' : sub.nilai) + '" style="max-width:10rem"></div>' +
      '<div><label class="label" for="g-fb">Feedback</label><textarea id="g-fb" class="input" rows="3" maxlength="1000" placeholder="Komentar untuk siswa...">' + UI.esc(sub.feedback || '') + '</textarea></div>' +
      '<div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-close>Batal</button><button type="submit" class="btn btn-primary">Simpan Nilai</button></div></form>'
  });
  const form = m.el.querySelector('form');
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    if (!form.reportValidity()) return;
    UI.busy(btn, true);
    try {
      await API.call('gradeSubmission', { submission_id: sub.id || '', assignment_id: sub.assignment_id, siswa_id: sub.siswa_id, nilai: m.el.querySelector('#g-nilai').value, feedback: m.el.querySelector('#g-fb').value });
      UI.toast('Nilai tersimpan');
      m.close();
      if (onDone) await onDone(); else await refresh();
    } catch (err) {
      UI.toast(err.message, 'error');
      UI.busy(btn, false);
    }
  });
}


/* ============================================================
   BUKU NILAI (matriks siswa x tugas) + EXPORT EXCEL
   ============================================================ */

/** Penulis .xlsx minimal (tanpa library): ZIP mode "store" + SpreadsheetML. */
const Xlsx = (() => {
  const enc = new TextEncoder();
  const XH = String.fromCharCode(60) + '?xml version="1.0" encoding="UTF-8" standalone="yes"?>'; // dipecah agar bukan scriptlet Apps Script
  let T = null;
  function crc32(b) {
    if (!T) { T = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; T[n] = c >>> 0; } }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < b.length; i++) c = T[(c ^ b[i]) & 255] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    const parts = [], central = [];
    let off = 0;
    files.forEach(f => {
      const name = enc.encode(f.name), data = enc.encode(f.data), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, off, true);
      central.push(new Uint8Array(ch.buffer), name);
      off += 30 + name.length + data.length;
    });
    let csize = 0; central.forEach(c => { csize += c.length; });
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
    end.setUint32(12, csize, true); end.setUint32(16, off, true);
    return new Blob(parts.concat(central, [new Uint8Array(end.buffer)]), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const X = s => String(s === null || s === undefined ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const col = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  /* Gaya: 0 biasa, 1 header, 2 teks bertepi, 3 angka bertepi (tengah), 4 judul, 5 keterangan, 6 rata-rata */
  const STYLES = XH + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="16"/><color rgb="FF2F5D50"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF3F7F6E"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3EAD9"/></patternFill></fill></fills>' +
    '<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFD9CDB6"/></left><right style="thin"><color rgb="FFD9CDB6"/></right><top style="thin"><color rgb="FFD9CDB6"/></top><bottom style="thin"><color rgb="FFD9CDB6"/></bottom><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="2" fontId="3" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';

  /** sheets: [{name, widths:[..], freeze:{col,row}, rows:[[{v, s}|null,...],...]}] → Blob .xlsx */
  function build(sheets) {
    const used = {};
    sheets.forEach((sh, i) => {
      let n = String(sh.name || 'Sheet' + (i + 1)).replace(/[\\\/?*\[\]:]/g, ' ').trim().slice(0, 31) || 'Sheet' + (i + 1);
      let base = n, k = 2;
      while (used[n.toLowerCase()]) { n = base.slice(0, 28) + ' ' + k++; }
      used[n.toLowerCase()] = true; sh._n = n;
    });
    const files = [
      { name: '[Content_Types].xml', data: XH + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>' },
      { name: '_rels/.rels', data: XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', data: XH + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + sheets.map((s, i) => '<sheet name="' + X(s._n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: XH + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', data: STYLES }
    ];
    sheets.forEach((sh, i) => {
      const fz = sh.freeze;
      let x = XH + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"' + (i === 0 ? ' tabSelected="1"' : '') + '>' +
        (fz ? '<pane xSplit="' + fz.col + '" ySplit="' + fz.row + '" topLeftCell="' + col(fz.col) + (fz.row + 1) + '" activePane="bottomRight" state="frozen"/>' : '') + '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
      if (sh.widths) x += '<cols>' + sh.widths.map((w, c) => '<col min="' + (c + 1) + '" max="' + (c + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>';
      x += '<sheetData>';
      sh.rows.forEach((r, ri) => {
        x += '<row r="' + (ri + 1) + '"' + (r.h ? ' ht="' + r.h + '" customHeight="1"' : '') + '>';
        r.forEach((c, ci) => {
          if (!c) return;
          const ref = col(ci) + (ri + 1);
          if (typeof c.v === 'number' && isFinite(c.v)) x += '<c r="' + ref + '" s="' + (c.s || 0) + '"><v>' + c.v + '</v></c>';
          else if (c.v === '' || c.v === null || c.v === undefined) x += '<c r="' + ref + '" s="' + (c.s || 0) + '"/>';
          else x += '<c r="' + ref + '" s="' + (c.s || 0) + '" t="inlineStr"><is><t xml:space="preserve">' + X(c.v) + '</t></is></c>';
        });
        x += '</row>';
      });
      x += '</sheetData></worksheet>';
      files.push({ name: 'xl/worksheets/sheet' + (i + 1) + '.xml', data: x });
    });
    return zip(files);
  }
  return { build, crc32 };
})();

/** Susun data matriks untuk satu kelas. */
function gradebookOf(c) {
  const tasks = D().assignments.filter(a => a.class_id === c.id).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || String(a.deadline).localeCompare(String(b.deadline)));
  const subs = {};
  D().submissions.forEach(s => { subs[s.assignment_id + '|' + s.siswa_id] = s; });
  const students = D().students.filter(s => s.class_id === c.id).sort((a, b) => a.nama.localeCompare(b.nama));
  const rows = students.map(st => {
    const cells = tasks.map(t => subs[t.id + '|' + st.siswa_id] || null);
    const graded = cells.filter(x => x && x.nilai !== null && x.nilai !== undefined);
    const avg = graded.length ? graded.reduce((t, x) => t + Number(x.nilai), 0) / graded.length : null;
    return { st, cells, avg };
  });
  return { c, tasks, rows };
}

const fmtNum = n => (Math.round(Number(n) * 10) / 10).toString().replace('.', ',');

function pageBukuNilai() {
  const F = S.filters;
  const mapels = Array.from(new Set(D().classes.map(c => (c.mapel || '').trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  if (F.bnMapel && mapels.indexOf(F.bnMapel) < 0) F.bnMapel = '';
  const kelasOpts = D().classes.filter(c => !F.bnMapel || (c.mapel || '') === F.bnMapel);
  if (F.bnKelas && !kelasOpts.some(c => c.id === F.bnKelas)) F.bnKelas = '';
  const shown = kelasOpts.filter(c => !F.bnKelas || c.id === F.bnKelas);
  const books = shown.map(gradebookOf);

  const tableOf = b => {
    const head = '<tr><th class="c-no">No</th><th class="c-nm">Nama Siswa</th>' + b.tasks.map(t =>
      '<th class="c-as" title="' + UI.esc(t.judul) + '"><span class="t">' + UI.esc(t.judul) + '</span><span class="d">' + UI.fmtDate(t.deadline) + '</span></th>').join('') + '<th class="c-avg">Rata-rata</th></tr>';
    const body = b.rows.map((r, i) => '<tr><td class="c-no">' + (i + 1) + '</td><td class="c-nm"><div class="flex items-center gap-2">' + UI.avatar(r.st.nama, '', r.st.foto_url) + '<span>' + UI.esc(r.st.nama) + '</span></div></td>' +
      r.cells.map((x, ci) => {
        if (!x) return '<td class="cell none" data-act="cell" data-id="NEW|' + b.tasks[ci].id + '|' + r.st.siswa_id + '" title="Belum mengumpulkan - klik untuk memberi nilai">&mdash;</td>';
        if (x.nilai === null || x.nilai === undefined) return '<td class="cell wait" data-act="cell" data-id="' + x.id + '" title="Klik untuk menilai">Belum dinilai</td>';
        const n = Number(x.nilai);
        return '<td class="cell ' + (n < 60 ? 'lo' : n >= 85 ? 'hi' : '') + '" data-act="cell" data-id="' + x.id + '" title="Klik untuk mengubah nilai">' + fmtNum(n) + '</td>';
      }).join('') + '<td class="c-avg">' + (r.avg === null ? '&mdash;' : fmtNum(r.avg)) + '</td></tr>').join('');
    return '<section class="card mb-5"><div class="p-4 flex flex-wrap items-center gap-2 justify-between"><div><h3 class="font-extrabold">' + UI.esc(b.c.nama_kelas) + '</h3>' +
      '<p class="text-xs text-gray-500">' + (b.c.mapel ? 'Mata pelajaran: ' + UI.esc(b.c.mapel) + ' · ' : '') + b.rows.length + ' siswa · ' + b.tasks.length + ' tugas</p></div></div>' +
      (!b.rows.length ? UI.empty('Belum ada siswa', 'Tambahkan siswa lewat menu Siswa.') : !b.tasks.length ? UI.empty('Belum ada tugas', 'Buat tugas agar kolom nilai muncul di sini.') :
        '<div class="gb-wrap"><table class="gb">' + '<thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>') + '</section>';
  };

  $view.innerHTML =
    '<div class="card p-4 mb-4 flex flex-wrap items-end gap-3">' +
    '<div><label class="label" for="bn-m">Mata pelajaran</label><select id="bn-m" class="input" style="min-width:11rem"><option value="">Semua mata pelajaran</option>' +
    mapels.map(m => '<option value="' + UI.esc(m) + '"' + (m === F.bnMapel ? ' selected' : '') + '>' + UI.esc(m) + '</option>').join('') + '</select></div>' +
    '<div><label class="label" for="bn-k">Kelas</label><select id="bn-k" class="input" style="min-width:12rem"><option value="">Semua kelas</option>' +
    kelasOpts.map(c => '<option value="' + c.id + '"' + (c.id === F.bnKelas ? ' selected' : '') + '>' + UI.esc(c.nama_kelas) + '</option>').join('') + '</select></div>' +
    '<div class="ml-auto"><button class="btn btn-primary" id="bn-xls"' + (books.length ? '' : ' disabled') + '>' + icon('download', 'w-4 h-4') + ' Download Excel</button></div></div>' +
    '<p class="text-xs text-gray-500 mb-3">Tugas diurutkan dari yang paling awal dibuat. Klik sebuah nilai untuk mengubahnya. Excel mengikuti filter di atas.</p>' +
    '<div id="bn-body">' + (books.length ? books.map(tableOf).join('') : UI.empty('Belum ada kelas', 'Buat kelas terlebih dulu di menu Kelas Saya.')) + '</div>';

  $('#bn-m').addEventListener('change', e => { F.bnMapel = e.target.value; F.bnKelas = ''; pageBukuNilai(); });
  $('#bn-k').addEventListener('change', e => { F.bnKelas = e.target.value; pageBukuNilai(); });
  $('#bn-xls').addEventListener('click', () => exportExcel(books));
  bind($('#bn-body'), {
    cell: id => {
      if (id.indexOf('NEW|') === 0) {            // siswa belum mengumpulkan: nilai langsung
        const p = id.split('|'), a = D().assignments.find(x => x.id === p[1]);
        const st = a && D().students.find(x => x.siswa_id === p[2] && x.class_id === a.class_id);
        const c = a && D().classes.find(x => x.id === a.class_id);
        if (a && st) openGradeModal({ assignment_id: a.id, siswa_id: st.siswa_id, siswa_nama: st.nama, assignment_judul: a.judul, deadline: a.deadline, nama_kelas: c ? c.nama_kelas : '' });
        return;
      }
      const sub = D().submissions.find(s => s.id === id);
      if (sub) openGradeModal(sub);
    }
  });
}

function exportExcel(books) {
  if (!books.length) { UI.toast('Tidak ada data untuk diunduh', 'error'); return; }
  const H = t => ({ v: t, s: 1 }), T = t => ({ v: t, s: 2 }), N = t => ({ v: t, s: 3 });
  const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
  const sheets = books.map(b => {
    const fixed = 5; // No, Nama, Email, Kelas, Mata Pelajaran
    const rows = [];
    rows.push([{ v: 'Buku Nilai - ' + b.c.nama_kelas, s: 4 }]); rows[0].h = 24;
    rows.push([{ v: 'Mata pelajaran: ' + (b.c.mapel || '-'), s: 5 }]);
    rows.push([{ v: 'Guru: ' + ME.nama + '   |   Diunduh: ' + today, s: 5 }]);
    rows.push([]);
    const head = [H('No'), H('Nama Siswa'), H('Email'), H('Kelas'), H('Mata Pelajaran')].concat(b.tasks.map(t => H(t.judul)), [H('Rata-rata')]);
    head.h = 34; rows.push(head);
    b.rows.forEach((r, i) => {
      rows.push([N(i + 1), T(r.st.nama), T(r.st.email || ''), T(b.c.nama_kelas), T(b.c.mapel || '')]
        .concat(r.cells.map(x => (x && x.nilai !== null && x.nilai !== undefined) ? N(Number(x.nilai)) : N('')), [{ v: r.avg === null ? '' : Math.round(r.avg * 100) / 100, s: 6 }]));
    });
    return { name: (b.c.mapel && b.c.nama_kelas.toLowerCase().indexOf(b.c.mapel.toLowerCase()) < 0 ? b.c.mapel + ' - ' : '') + b.c.nama_kelas, rows, freeze: { col: 2, row: 5 },
      widths: [5, 28, 28, 20, 20].concat(b.tasks.map(() => 16), [12]) };
  });
  const slug = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const F = S.filters;
  const kelasPart = F.bnKelas && books.length === 1 ? slug(books[0].c.nama_kelas) : 'Semua-Kelas';
  const fname = 'Buku-Nilai_' + kelasPart + '_' + (F.bnMapel ? slug(F.bnMapel) : 'Semua-Mapel') + '_' + (d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'))(new Date()) + '.xlsx';
  try {
    const blob = Xlsx.build(sheets);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = fname;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    UI.toast('Excel diunduh: ' + fname);
  } catch (e) { UI.toast('Gagal membuat Excel: ' + e.message, 'error'); }
}

/* ---------------- Materi ---------------- */
function secMateri(el, classId, fixed) {
  const items = D().materials.filter(a => !classId || a.class_id === classId);
  el.innerHTML =
    '<div class="flex items-center justify-between mb-3"><h2 class="font-medium">Materi <span class="text-gray-400 font-normal">(' + items.length + ')</span></h2>' +
    '<button class="btn btn-primary" data-act="new">' + icon('plus', 'w-4 h-4') + ' Tambah Materi</button></div>' +
    (items.length ? '<div class="card">' + items.map(m => {
      const href = UI.url(m.url);
      return '<div class="row-item"><span class="task-ico blue">' + icon(m.tipe === 'file' ? 'file' : 'link', 'w-5 h-5') + '</span>' +
        '<div class="flex-1 min-w-0">' + (href ? '<a class="font-medium truncate block" href="' + UI.esc(href) + '" target="_blank" rel="noopener noreferrer">' + UI.esc(m.judul) + '</a>' : '<span class="font-medium">' + UI.esc(m.judul) + '</span>') +
        '<p class="text-xs text-gray-500 flex flex-wrap items-center gap-2"><span class="badge badge-gray">' + (m.tipe === 'file' ? 'File Drive' : 'Link') + '</span>' + kelasBadge(m, fixed) + '<span>' + UI.fmtDate(m.created_at) + '</span></p></div>' +
        '<div class="flex flex-none">' + editDelBtns(m.id) + '</div></div>';
    }).join('') + '</div>' : UI.empty('Belum ada materi', 'Bagikan link Google Drive, YouTube, atau halaman web ke siswa.'));

  bind(el, {
    new: () => materialForm(null, classId),
    edit: id => materialForm(items.find(x => x.id === id)),
    del: id => confirmDelete('Hapus materi ini?', 'deleteMaterial', id, 'Materi dihapus')
  });
}

function materialForm(item, classId) {
  if (!item && !ensureClasses()) return;
  const fields = [];
  if (!item) fields.push({ name: 'class_id', label: 'Kelas', type: 'select', required: true, options: classOptions(), value: classId || D().classes[0].id });
  fields.push(
    { name: 'judul', label: 'Judul materi', required: true, value: item ? item.judul : '', maxlength: 150 },
    { name: 'tipe', label: 'Tipe', type: 'select', value: item ? item.tipe : 'link', options: [{ value: 'link', label: 'Link / embed URL' }, { value: 'file', label: 'File (link Google Drive)' }] },
    { name: 'url', label: 'URL', type: 'url', required: true, value: item ? item.url : '', placeholder: 'https://...', hint: 'Pastikan akses berbagi di Drive diatur "Siapa saja yang memiliki link".' }
  );
  UI.formModal({
    title: item ? 'Edit Materi' : 'Tambah Materi', fields, submitText: item ? 'Simpan' : 'Tambah',
    onSubmit: v => item
      ? act('updateMaterial', { id: item.id, judul: v.judul, tipe: v.tipe, url: v.url }, 'Materi diperbarui')
      : act('createMaterial', v, 'Materi ditambahkan')
  });
}

/* ---------------- Siswa ---------------- */
function secSiswa(el, classId, fixed) {
  el.innerHTML =
    '<div class="flex flex-wrap items-center justify-between gap-3 mb-4"><h2 class="panel-title">Daftar Siswa</h2>' +
    '<div class="flex flex-wrap items-center gap-2"><input id="q" class="input" style="max-width:15rem" type="search" placeholder="Cari nama / email..." value="' + UI.esc(S.filters.q) + '">' +
    '<button class="btn btn-primary" data-act="addstu">' + icon('plus', 'w-4 h-4') + ' Tambah Siswa</button></div></div><div id="stu"></div>';
  const draw = () => {
    const q = S.filters.q.toLowerCase();
    const list = D().students.filter(s => (!classId || s.class_id === classId) && (!q || (s.nama + ' ' + s.email).toLowerCase().includes(q)));
    $('#stu', el).innerHTML = list.length
      ? '<div class="card table-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Email</th>' + (fixed ? '' : '<th>Kelas</th>') + '<th>Bergabung</th><th class="text-right">Aksi</th></tr></thead><tbody>' +
        list.map(s => '<tr><td><div class="flex items-center gap-2">' + UI.avatar(s.nama, '', s.foto_url) + UI.esc(s.nama) + '</div></td><td>' + UI.esc(s.email) + '</td>' +
          (fixed ? '' : '<td><span class="badge badge-blue">' + UI.esc(s.nama_kelas) + '</span></td>') + '<td>' + UI.fmtDate(s.joined_at) + '</td>' +
          '<td><div class="flex justify-end gap-1"><button class="btn btn-outline btn-sm" data-act="reset" data-id="' + s.siswa_id + '">' + icon('key', 'w-4 h-4') + ' Reset Password</button>' +
          '<button class="btn-icon danger" data-act="remove" data-id="' + s.siswa_id + '" data-cls="' + s.class_id + '" title="Hapus dari kelas" aria-label="Hapus dari kelas">' + icon('userx', 'w-4 h-4') + '</button></div></td></tr>').join('') +
        '</tbody></table></div>'
      : UI.empty('Belum ada siswa', q ? 'Tidak ada siswa yang cocok dengan pencarian.' : 'Bagikan kode kelas agar siswa dapat bergabung.');
  };
  draw();
  $('#q', el).addEventListener('input', e => { S.filters.q = e.target.value; draw(); });

  bind(el, {
    addstu: () => studentForm(classId),
    reset: id => {
      const s = D().students.find(x => x.siswa_id === id);
      UI.formModal({
        title: 'Reset Password', submitText: 'Reset Password',
        intro: 'Atur password baru untuk ' + s.nama + ' (' + s.email + '). Kosongkan untuk membuat password acak otomatis.',
        fields: [{ name: 'new_password', label: 'Password baru (opsional)', value: '', hint: 'Minimal 6 karakter.' }],
        onSubmit: async v => {
          const r = await API.call('resetPassword', { siswa_id: id, new_password: v.new_password });
          const res = UI.modal({
            title: 'Password berhasil direset', size: 'sm',
            body: '<p class="text-sm mb-2">Password baru untuk <b>' + UI.esc(r.nama) + '</b>:</p>' +
              '<div class="flex items-center gap-2"><code class="flex-1 text-lg tracking-wider bg-[#f1f3f4] rounded px-3 py-2">' + UI.esc(r.password) + '</code>' +
              '<button class="btn btn-outline" id="cpw">' + icon('copy', 'w-4 h-4') + ' Salin</button></div>' +
              '<p class="hint mt-2">Sampaikan ke siswa. Password ini tidak akan ditampilkan lagi.</p>' +
              '<div class="flex justify-end mt-4"><button class="btn btn-primary" data-close>Selesai</button></div>'
          });
          res.el.querySelector('#cpw').addEventListener('click', () => UI.copy(r.password));
        }
      });
    },
    remove: async (id, b) => {
      const s = D().students.find(x => x.siswa_id === id && x.class_id === b.dataset.cls);
      if (await UI.confirm({ title: 'Hapus siswa dari kelas', message: 'Keluarkan ' + s.nama + ' dari kelas "' + s.nama_kelas + '"?\nPengumpulan tugas & nilainya di kelas ini juga akan dihapus.', confirmText: 'Keluarkan' })) {
        try { await act('removeStudent', { class_id: b.dataset.cls, siswa_id: id }, 'Siswa dikeluarkan dari kelas'); } catch (e) { UI.toast(e.message, 'error'); }
      }
    }
  });
}

/* ---------- Tambah siswa (satu atau banyak sekaligus) ---------- */
function studentForm(classId) {
  if (!ensureClasses()) return;
  UI.formModal({
    title: 'Tambah Siswa', size: 'lg', submitText: 'Tambah Siswa',
    intro: 'Tulis satu siswa per baris dengan format: Nama, email, password. Password boleh dikosongkan, nanti dibuat otomatis. Jika diisi, minimal 6 karakter.',
    fields: [
      { name: 'class_id', label: 'Masukkan ke kelas', type: 'select', required: true, options: classOptions(), value: classId || D().classes[0].id },
      { name: 'daftar', label: 'Daftar siswa', type: 'textarea', rows: 7, required: true, placeholder: 'Andi Pratama, andi@siswa.id, rahasia1', hint: 'Bisa ditempel dari Excel/Sheets (kolom dipisah tab). Maksimal 100 siswa sekali tambah.' }
    ],
    onSubmit: async v => {
      const rows = String(v.daftar).split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
        const p = l.split(/\t|,|;/).map(x => x.trim());
        return { nama: p[0] || '', email: p[1] || '', password: p[2] || '' };
      });
      if (!rows.length) throw new Error('Isi minimal satu baris siswa');
      const res = await API.call('createStudents', { class_id: v.class_id, rows: rows });
      await refresh();
      showStudentResult(res);
    }
  });
}

function showStudentResult(res) {
  const ok = res.hasil.filter(h => h.status === 'dibuat' || h.status === 'ditambahkan').length;
  const badge = { dibuat: 'badge-green', ditambahkan: 'badge-blue', dilewati: 'badge-gray', gagal: 'badge-red' };
  const newOnes = res.hasil.filter(h => h.status === 'dibuat');
  const m = UI.modal({
    title: 'Hasil tambah siswa', size: 'lg',
    body: '<p class="text-sm mb-3">' + ok + ' dari ' + res.hasil.length + ' siswa berhasil dimasukkan ke <b>' + UI.esc(res.nama_kelas) + '</b>.</p>' +
      '<div class="card table-wrap"><table class="tbl"><thead><tr><th>Nama</th><th>Email</th><th>Password</th><th>Status</th></tr></thead><tbody>' +
      res.hasil.map(h => '<tr><td>' + UI.esc(h.nama || '-') + '</td><td>' + UI.esc(h.email || '-') + '</td><td>' + (h.password ? '<code>' + UI.esc(h.password) + '</code>' : '-') + '</td>' +
        '<td><span class="badge ' + (badge[h.status] || 'badge-gray') + '">' + UI.esc(h.status) + '</span><div class="text-xs text-gray-500">' + UI.esc(h.pesan) + '</div></td></tr>').join('') +
      '</tbody></table></div>' +
      (newOnes.length ? '<p class="hint mt-2">Catat password di atas dan sampaikan ke siswa. Password juga bisa dilihat di sheet Users.</p>' : '') +
      '<div class="flex justify-end gap-2 mt-4">' + (newOnes.length ? '<button class="btn btn-outline" id="cp-all">' + icon('copy', 'w-4 h-4') + ' Salin daftar akun</button>' : '') +
      '<button class="btn btn-primary" data-close>Selesai</button></div>'
  });
  const cp = m.el.querySelector('#cp-all');
  if (cp) cp.addEventListener('click', () => UI.copy(newOnes.map(h => h.nama + ' | ' + h.email + ' | ' + h.password).join(String.fromCharCode(10))));
}

/* ============================================================
   PENILAIAN
   ============================================================ */
function pagePenilaian() {
  const F = S.filters;
  if (!classById(F.nilaiKelas)) F.nilaiKelas = '';
  const tugasOpts = D().assignments.filter(a => !F.nilaiKelas || a.class_id === F.nilaiKelas);
  if (!tugasOpts.some(a => a.id === F.nilaiTugas)) F.nilaiTugas = '';

  const list = D().submissions.filter(s =>
    (F.nilaiAll || s.nilai === null) && (!F.nilaiKelas || s.class_id === F.nilaiKelas) && (!F.nilaiTugas || s.assignment_id === F.nilaiTugas));

  $view.innerHTML =
    '<div class="card p-4 mb-4 flex flex-wrap items-end gap-3">' +
    '<div><label class="label" for="f-k">Kelas</label><select id="f-k" class="input" style="min-width:11rem"><option value="">Semua kelas</option>' + classOptionsHtml(F.nilaiKelas) + '</select></div>' +
    '<div><label class="label" for="f-t">Tugas</label><select id="f-t" class="input" style="min-width:13rem"><option value="">Semua tugas</option>' +
    tugasOpts.map(a => '<option value="' + a.id + '"' + (a.id === F.nilaiTugas ? ' selected' : '') + '>' + UI.esc(a.judul) + '</option>').join('') + '</select></div>' +
    '<label class="flex items-center gap-2 text-sm pb-2"><input type="checkbox" id="f-all"' + (F.nilaiAll ? ' checked' : '') + '> Tampilkan yang sudah dinilai</label>' +
    '<span class="ml-auto text-sm text-gray-500 pb-2">' + list.length + ' pengumpulan</span></div>' +
    '<div class="card" id="grade-list">' + (list.length ? list.map(s =>
      '<div class="grade-row" data-sid="' + s.id + '">' +
      '<div class="flex gap-3 min-w-0">' + UI.avatar(s.siswa_nama) + '<div class="min-w-0"><p class="font-medium truncate">' + UI.esc(s.siswa_nama) + '</p>' +
      '<p class="text-sm truncate">' + UI.esc(s.assignment_judul) + '</p><p class="text-xs text-gray-500">' + UI.esc(s.nama_kelas) + ' · ' + UI.fmtDateTime(s.submitted_at) + '</p>' +
      (isLate(s) ? '<span class="badge badge-yellow mt-1">Terlambat</span>' : '') + '</div></div>' +
      '<div class="text-sm min-w-0">' + (s.jawaban ? '<p class="pre-wrap" style="max-height:7rem;overflow:auto">' + UI.esc(s.jawaban) + '</p>' : '<p class="text-gray-400">(tanpa jawaban teks)</p>') +
      (UI.url(s.file_url) ? '<a class="inline-flex items-center gap-1 mt-1" href="' + UI.esc(UI.url(s.file_url)) + '" target="_blank" rel="noopener noreferrer">' + icon('external', 'w-4 h-4') + ' Buka file / link</a>' : '') + '</div>' +
      '<div class="space-y-2"><input type="number" class="input g-nilai" min="0" max="100" step="0.1" placeholder="Nilai 0–100" aria-label="Nilai" value="' + (s.nilai === null ? '' : s.nilai) + '">' +
      '<textarea class="input g-fb" rows="2" maxlength="1000" placeholder="Feedback..." aria-label="Feedback">' + UI.esc(s.feedback || '') + '</textarea>' +
      '<button class="btn btn-primary btn-sm w-full" data-act="save" data-id="' + s.id + '">Simpan</button></div></div>').join('')
      : UI.empty(F.nilaiAll ? 'Tidak ada pengumpulan' : 'Semua tugas sudah dinilai 🎉', 'Pengumpulan baru dari siswa akan muncul di sini.')) + '</div>';

  $('#f-k').addEventListener('change', e => { F.nilaiKelas = e.target.value; pagePenilaian(); });
  $('#f-t').addEventListener('change', e => { F.nilaiTugas = e.target.value; pagePenilaian(); });
  $('#f-all').addEventListener('change', e => { F.nilaiAll = e.target.checked; pagePenilaian(); });
  bind($('#grade-list'), {
    save: async (id, btn) => {
      const row = btn.closest('.grade-row');
      const nilai = row.querySelector('.g-nilai').value;
      if (nilai === '' || Number(nilai) < 0 || Number(nilai) > 100) { UI.toast('Nilai harus 0–100', 'error'); return; }
      UI.busy(btn, true);
      try { await act('gradeSubmission', { submission_id: id, nilai, feedback: row.querySelector('.g-fb').value }, 'Nilai tersimpan'); }
      catch (e) { UI.toast(e.message, 'error'); UI.busy(btn, false); }
    }
  });
}

return { start: start, stop: stop };
})();

const SiswaApp = (function () {
/* ============================================================
   ClassRoom Lite — siswa.js
   SPA dashboard Siswa (routing hash: #/ , #/kelas/ID/stream|tugas|materi|teman)
   ============================================================ */

let ME;
const $ = (sel, root) => (root || document).querySelector(sel);
let $view;

const S = { data: null };
const D = () => S.data;
const classById = id => (D() ? D().classes.find(c => c.id === id) : null) || null;

/** Satu listener klik per elemen; handler terbaru menggantikan yang lama (hindari klik ganda). */
function bind(el, handlers) {
  el._handlers = handlers;
  if (el._bound) return;
  el._bound = true;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !el.contains(b)) return;
    const h = el._handlers[b.dataset.act];
    if (h) { e.preventDefault(); h(b.dataset.id, b, e); }
  });
}

async function loadData() { S.data = await API.call('getSiswaData'); }
async function refresh() {
  try { await loadData(); } catch (e) { UI.toast(e.message, 'error'); }
  render();
}

/** Status tugas: Belum Dikerjakan / Terlambat / Sudah Dikumpulkan / Dinilai */
function statusOf(a) {
  const s = a.submission;
  if (s) {
    if (s.nilai !== null) return { key: 'graded', label: 'Dinilai', cls: 'badge-green' };
    const late = new Date(s.submitted_at) > new Date(a.deadline);
    return { key: 'submitted', label: 'Sudah Dikumpulkan' + (late ? ' (terlambat)' : ''), cls: 'badge-blue' };
  }
  if (new Date(a.deadline) < new Date()) return { key: 'late', label: 'Terlambat', cls: 'badge-red' };
  return { key: 'todo', label: 'Belum Dikerjakan', cls: 'badge-gray' };
}

/* ---------------- Boot ---------------- */
const SHELL = `<header class="sticky-header" style="padding:.4rem 1rem 0">
    <a href="#/" class="flex items-center gap-2.5 no-underline" style="color:inherit">
      <span class="logo-tile" style="width:2.7rem;height:2.7rem;border-radius:1rem">
        <svg class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 4h7a3 3 0 0 1 3 3v14a2 2 0 0 0-2-2H2z"/><path d="M22 4h-7a3 3 0 0 0-3 3v14a2 2 0 0 1 2-2h8z"/></svg>
      </span>
      <span class="text-lg font-extrabold hidden sm:inline">ClassRoom Lite</span>
    </a>
    <h1 id="page-title" class="flex-1 truncate" style="font-size:1.1rem;color:var(--muted)"></h1>
    <button id="btn-join" class="btn btn-outline btn-sm"></button>
    <div class="relative">
      <button id="btn-user" class="user-pill" aria-haspopup="true" aria-expanded="false">
        <span id="hdr-avatar"></span><span id="hdr-name" class="hidden sm:block"></span>
      </button>
      <div id="user-menu" class="hidden absolute right-0 mt-2 w-64 card p-2" style="z-index:50">
        <div class="px-3 py-2 mb-1"><p id="um-name" class="font-extrabold truncate"></p><p id="um-email" class="text-xs text-gray-500 truncate"></p></div>
        <button id="btn-akun" class="nav-item w-full text-left" style="margin:0"></button>
        <button id="btn-logout" class="nav-item w-full text-left" style="margin:0"></button>
      </div>
    </div>
  </header>
  <main id="view" class="px-4 pb-8 md:px-6 max-w-5xl mx-auto"></main>`;

let hashHandler = null;
let docClick = null;
function stop() {
  if (docClick) document.removeEventListener('click', docClick);
  docClick = null;
  if (hashHandler) window.removeEventListener('hashchange', hashHandler);
  hashHandler = null;
  S.data = null;
}

function start() {
  ME = Session.user();
  document.getElementById('app').innerHTML = SHELL;
  $view = document.getElementById('view');
  boot();
}

function boot() {
  $('#hdr-avatar').innerHTML = UI.avatar(ME.nama, '', ME.foto_url);
  $('#hdr-name').textContent = ME.nama.split(' ').slice(0, 2).join(' ');
  $('#um-name').textContent = ME.nama;
  $('#um-email').textContent = ME.email;
  $('#btn-join').innerHTML = icon('plus', 'w-4 h-4') + '<span class="hidden sm:inline">Gabung Kelas</span>';
  $('#btn-akun').innerHTML = '<span class="ib">' + icon('camera') + '</span><span>Akun Saya</span>';
  $('#btn-akun').addEventListener('click', () => { menu.classList.add('hidden'); location.hash = '#/akun'; });
  $('#btn-logout').innerHTML = '<span class="ib">' + icon('logout') + '</span><span>Keluar</span>';

  const menu = $('#user-menu');
  $('#btn-user').addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  if (docClick) document.removeEventListener('click', docClick);
  docClick = e => { if (!menu.contains(e.target)) menu.classList.add('hidden'); };
  document.addEventListener('click', docClick);
  $('#btn-logout').addEventListener('click', async () => {
    menu.classList.add('hidden');
    if (await UI.confirm({ title: 'Keluar', message: 'Keluar dari akun ini?', confirmText: 'Keluar', danger: false })) Auth.logout();
  });
  $('#btn-join').addEventListener('click', joinClassForm);
  if (hashHandler) window.removeEventListener('hashchange', hashHandler);
  hashHandler = () => { render(); window.scrollTo(0, 0); };
  window.addEventListener('hashchange', hashHandler);

  const muat = () => {
    $view.innerHTML = UI.skeletonCards(3);
    loadData().then(render).catch(err => {
      if (err && err.code === 'AUTH') return; // sudah dikembalikan ke layar login
      $view.innerHTML = UI.empty('Gagal memuat data', err.message, '<button class="btn btn-primary" id="retry">Coba lagi</button>');
      const rb = document.getElementById('retry');
      if (rb) rb.addEventListener('click', muat);
    });
  };
  muat();
}

function render() {
  if (!D()) return;
  const parts = (location.hash || '#/').replace(/^#\/?/, '').split('/');
  document.body.classList.toggle('has-bottom-nav', parts[0] === 'kelas' && !!parts[1]);
  if (parts[0] === 'akun') return pageAkun();
  if (parts[0] === 'kelas' && parts[1]) return pageKelas(parts[1], parts[2]);
  $('#page-title').textContent = '';
  pageHome();
}

/* ============================================================
   AKUN SAYA — ganti foto profil (JPG/PNG, maks 2 MB, ada pratinjau)
   ============================================================ */
const FOTO_MAX = 2 * 1024 * 1024;

function syncMe(u) {
  Object.assign(ME, u);
  Session.save(Session.token(), Object.assign({}, Session.user() || {}, u));
  $('#hdr-avatar').innerHTML = UI.avatar(ME.nama, '', ME.foto_url);
}

function pageAkun() {
  $('#page-title').textContent = 'Akun Saya';
  $view.innerHTML = '<div id="pg" class="max-w-2xl">' +
    '<a href="#/" class="text-sm font-semibold inline-flex items-center gap-1 mb-3">&larr; Kembali</a>' +
    '<section class="card p-5 mb-5"><h2 class="panel-title mb-4">Foto Profil</h2>' +
    '<div class="photo-box"><div id="ak-prev">' + UI.avatar(ME.nama, 'avatar-xl', ME.foto_url) + '</div>' +
    '<div class="flex-1" style="min-width:14rem"><div class="photo-drop mb-3"><label class="label" for="ak-file">Pilih foto baru</label>' +
    '<input id="ak-file" class="input" type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg">' +
    '<p class="hint">Format JPG atau PNG, ukuran maksimal 2 MB.</p></div>' +
    '<p id="ak-msg" class="text-sm mb-3 hidden" role="alert"></p>' +
    '<div class="flex flex-wrap gap-2"><button class="btn btn-primary" id="ak-save" disabled>' + icon('camera', 'w-4 h-4') + ' Simpan Foto</button>' +
    '<button class="btn btn-ghost" id="ak-cancel" disabled>Batal</button>' +
    (UI.url(ME.foto_url) ? '<button class="btn btn-ghost danger" id="ak-del">Hapus Foto</button>' : '') + '</div></div></div></section>' +
    '<section class="card p-5"><h2 class="panel-title mb-3">Data Akun</h2>' +
    '<dl class="text-sm grid gap-2"><div><dt class="text-gray-500">Nama</dt><dd class="font-semibold">' + UI.esc(ME.nama) + '</dd></div>' +
    '<div><dt class="text-gray-500">Email</dt><dd class="font-semibold">' + UI.esc(ME.email) + '</dd></div>' +
    '<div><dt class="text-gray-500">Kelas diikuti</dt><dd class="font-semibold">' + (D().classes.length ? D().classes.map(c => UI.esc(c.nama_kelas)).join(', ') : '-') + '</dd></div></dl>' +
    '<p class="hint mt-3">Nama, email, dan password diubah oleh guru. Hubungi gurumu bila perlu perubahan.</p></section></div>';

  const file = $('#ak-file'), msg = $('#ak-msg'), save = $('#ak-save'), cancel = $('#ak-cancel');
  let chosen = null, objUrl = null;
  const say = (t, bad) => { msg.textContent = t || ''; msg.classList.toggle('hidden', !t); msg.style.color = bad ? 'var(--danger)' : 'inherit'; };
  const reset = () => {
    if (objUrl) { URL.revokeObjectURL(objUrl); objUrl = null; }
    chosen = null; file.value = ''; save.disabled = true; cancel.disabled = true;
    $('#ak-prev').innerHTML = UI.avatar(ME.nama, 'avatar-xl', ME.foto_url); say('');
  };
  file.addEventListener('change', () => {
    const f = file.files && file.files[0];
    if (!f) { reset(); return; }
    const ext = (f.name.split('.').pop() || '').toLowerCase();
    if (['jpg', 'jpeg', 'png'].indexOf(ext) < 0 || ['image/jpeg', 'image/png'].indexOf(f.type) < 0) { reset(); say('Format tidak didukung. Gunakan file JPG atau PNG.', true); return; }
    if (f.size > FOTO_MAX) { reset(); say('Ukuran file ' + (f.size / 1048576).toFixed(1).replace('.', ',') + ' MB melebihi batas 2 MB.', true); return; }
    if (objUrl) URL.revokeObjectURL(objUrl);
    objUrl = URL.createObjectURL(f); chosen = f;
    $('#ak-prev').innerHTML = '<span class="avatar avatar-xl has-photo"><img src="' + objUrl + '" alt="Pratinjau foto"></span>';
    save.disabled = false; cancel.disabled = false; say('Pratinjau: ' + f.name + ' (' + Math.max(1, Math.round(f.size / 1024)) + ' KB)');
  });
  cancel.addEventListener('click', reset);
  save.addEventListener('click', async () => {
    if (!chosen) return;
    UI.busy(save, true);
    try {
      const b64 = await new Promise((ok, no) => {
        const r = new FileReader();
        r.onload = () => ok(String(r.result).split(',')[1] || '');
        r.onerror = () => no(new Error('Gagal membaca file'));
        r.readAsDataURL(chosen);
      });
      const res = await API.call('setProfilePhoto', { name: chosen.name, mime: chosen.type, data: b64 });
      syncMe({ foto_url: res.foto_url });
      S.data.user = Object.assign({}, S.data.user, { foto_url: res.foto_url });
      UI.toast('Foto profil diperbarui');
      pageAkun();
    } catch (e) { UI.toast(e.message, 'error'); UI.busy(save, false); }
  });
  const del = $('#ak-del');
  if (del) del.addEventListener('click', async () => {
    if (!(await UI.confirm({ title: 'Hapus foto', message: 'Hapus foto profil dan kembali ke inisial nama?', confirmText: 'Hapus' }))) return;
    try { await API.call('removeProfilePhoto'); syncMe({ foto_url: '' }); UI.toast('Foto dihapus'); pageAkun(); }
    catch (e) { UI.toast(e.message, 'error'); }
  });
}

/* ============================================================
   HOME — daftar kelas
   ============================================================ */
function pageHome() {
  const d = D();
  const upcoming = d.assignments.filter(a => !a.submission).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 6);
  const first = ME.nama.split(' ')[0];
  const done = d.assignments.filter(a => a.submission).length;
  const graded = d.assignments.filter(a => a.submission && a.submission.nilai !== null);
  const avg = graded.length ? Math.round(graded.reduce((t, a) => t + a.submission.nilai, 0) / graded.length) : null;
  const stats = [
    { label: 'Kelas diikuti', value: d.classes.length, t: 'mint', icon: 'classes', cap: 'Kelas aktif' },
    { label: 'Perlu dikerjakan', value: upcoming.length, t: 'peach', icon: 'tasks', cap: upcoming.length ? 'Cek deadline-nya' : 'Semua beres' },
    { label: 'Sudah dikumpulkan', value: done, t: 'butter', icon: 'file', cap: 'Tugas terkirim' },
    { label: 'Rata-rata nilai', value: avg === null ? '-' : avg, t: 'sky', icon: 'grade', cap: graded.length ? graded.length + ' tugas dinilai' : 'Belum ada nilai' }
  ];

  $view.innerHTML = '<div id="pg">' +
    '<section class="hero mb-5"><div class="art"><div style="width:5.6rem;height:5.6rem">' + UI.face('#f1b08f') + '</div></div>' +
    '<div class="relative" style="z-index:1"><span class="chip">' + icon('clock', 'w-3.5 h-3.5') + ' ' + new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long' }) + '</span>' +
    '<h2>Semangat belajar, ' + UI.esc(first) + '!</h2>' +
    '<p>' + (upcoming.length ? 'Ada <b>' + upcoming.length + ' tugas</b> yang menunggumu. Kerjakan sebelum deadline ya.' : 'Semua tugasmu sudah terkumpul. Hebat!') + '</p>' +
    '<div class="flex flex-wrap gap-2 mt-4"><button class="btn btn-primary" data-act="join">' + icon('plus', 'w-4 h-4') + ' Gabung Kelas</button></div></div>' +
    '<div class="plant">' + UI.plant() + '</div></section>' +
    '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-5 mb-6">' + stats.map(x =>
      '<div class="stat t-' + x.t + '"><div class="ico">' + icon(x.icon, 'w-6 h-6') + '</div><div class="lbl">' + x.label + '</div><div class="num">' + x.value + '</div><div class="cap">' + x.cap + '</div></div>').join('') + '</div>' +
    '<h2 class="panel-title mb-3">Kelasmu</h2>' +
    (d.classes.length ? '<div class="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 mb-8">' + d.classes.map(c => {
      const todo = d.assignments.filter(a => a.class_id === c.id && !a.submission).length;
      const th = UI.classTheme(c.id);
      return '<article class="card class-card card-hover" data-act="open" data-id="' + c.id + '">' +
        '<div class="banner" style="' + UI.classStyle(c.id) + '"><h3 class="truncate">' + UI.esc(c.nama_kelas) + '</h3><p>' + UI.esc(c.guru_nama) + '</p>' +
        '<span class="avatar avatar-lg" style="background:#fff;color:' + th.ac + '">' + UI.esc(UI.initials(c.guru_nama)) + '</span></div>' +
        '<div class="px-5 pt-7 pb-4 mt-auto text-sm text-gray-600 flex items-center justify-between"><span>' + c.siswa_count + ' siswa</span>' +
        (todo ? '<span class="badge badge-yellow">' + todo + ' tugas belum selesai</span>' : '<span class="badge badge-green">Semua tugas beres</span>') + '</div></article>';
    }).join('') + '</div>'
      : '<div class="card mb-8">' + UI.empty('Kamu belum bergabung di kelas manapun', 'Masukkan kode kelas dari gurumu untuk bergabung.', '<button class="btn btn-primary" data-act="join">Gabung Kelas</button>') + '</div>') +
    (upcoming.length ? '<section><h2 class="panel-title mb-3">Tugas yang perlu dikerjakan</h2><div class="card">' + upcoming.map(a => taskRow(a, true)).join('') + '</div></section>' : '') + '</div>';

  bind($('#pg'), {
    open: id => { location.hash = '#/kelas/' + id; },
    join: joinClassForm,
    task: id => openAssignment(id)
  });
}

/** Baris tugas (dipakai di home & tab tugas). */
function taskRow(a, showClass) {
  const st = statusOf(a);
  const cd = UI.countdown(a.deadline);
  return '<div class="row-item card-hover" data-act="task" data-id="' + a.id + '" style="cursor:pointer">' +
    '<span class="task-ico">' + icon('tasks', 'w-5 h-5') + '</span>' +
    '<div class="flex-1 min-w-0"><p class="font-medium truncate">' + UI.esc(a.judul) + '</p>' +
    '<p class="text-xs text-gray-500">' + (showClass ? UI.esc(a.nama_kelas) + ' · ' : '') + 'Deadline ' + UI.fmtDateTime(a.deadline) +
    (!a.submission ? ' · <span class="' + (cd.late ? 'text-red-600' : '') + '">' + cd.text + '</span>' : '') + '</p></div>' +
    (a.submission && a.submission.nilai !== null ? '<b class="">' + a.submission.nilai + '</b>' : '') +
    '<span class="badge ' + st.cls + ' hidden sm:inline-flex">' + st.label + '</span></div>';
}

function joinClassForm() {
  UI.formModal({
    title: 'Gabung Kelas', size: 'sm', submitText: 'Gabung',
    intro: 'Minta kode kelas (6 karakter) dari gurumu, lalu masukkan di sini.',
    fields: [{ name: 'kode_kelas', label: 'Kode kelas', required: true, maxlength: 6, placeholder: 'mis. MTK7A1' }],
    onSubmit: async v => {
      const r = await API.call('joinClass', { kode_kelas: v.kode_kelas.toUpperCase() });
      UI.toast('Berhasil bergabung di ' + r.nama_kelas);
      await refresh();
      location.hash = '#/kelas/' + r.id;
    }
  });
}

/* ============================================================
   DETAIL KELAS — Stream / Tugas / Materi / Teman
   ============================================================ */
function pageKelas(id, tab) {
  const c = classById(id);
  if (!c) {
    $('#page-title').textContent = '';
    $view.innerHTML = '<div class="card">' + UI.empty('Kelas tidak ditemukan', 'Kamu mungkin sudah keluar dari kelas ini.', '<a class="btn btn-primary" href="#/">Kembali</a>') + '</div>';
    return;
  }
  $('#page-title').textContent = c.nama_kelas;
  const tabs = [
    { key: 'stream', label: 'Stream', icon: 'stream' },
    { key: 'tugas', label: 'Tugas', icon: 'tasks' },
    { key: 'materi', label: 'Materi', icon: 'folder' },
    { key: 'teman', label: 'Teman', icon: 'users' }
  ];
  const cur = tabs.find(t => t.key === tab) || tabs[0];

  $view.innerHTML = '<div id="pg"><a href="#/" class="text-sm inline-block mb-3">← Semua kelas</a>' +
    '<div class="card class-head mb-5"><div class="p-6" style="' + UI.classStyle(c.id) + '">' +
    '<h2 class="text-2xl font-extrabold">' + UI.esc(c.nama_kelas) + '</h2><p class="text-sm opacity-90">' + UI.esc(c.guru_nama) + (c.deskripsi ? ' · ' + UI.esc(c.deskripsi) : '') + '</p></div>' +
    '<div class="tabs-wrap"><nav class="tabbar bottom-nav" aria-label="Tab kelas">' + tabs.map(t =>
      '<a class="tab' + (t.key === cur.key ? ' active' : '') + '" href="#/kelas/' + c.id + '/' + t.key + '">' + icon(t.icon, 'w-5 h-5') + '<span>' + t.label + '</span></a>').join('') + '</nav></div></div>' +
    '<div id="tab-content"></div></div>';

  const el = $('#tab-content');
  ({ stream: tabStream, tugas: tabTugas, materi: tabMateri, teman: tabTeman })[cur.key](el, c);
  bind($('#pg'), {
    task: aid => openAssignment(aid),
    leave: async () => {
      if (await UI.confirm({ title: 'Keluar dari kelas', message: 'Keluar dari kelas "' + c.nama_kelas + '"?\nPengumpulan tugasmu di kelas ini tidak akan tersimpan lagi.', confirmText: 'Keluar' })) {
        try { await API.call('leaveClass', { class_id: c.id }); UI.toast('Kamu telah keluar dari kelas'); location.hash = '#/'; await refresh(); }
        catch (e) { UI.toast(e.message, 'error'); }
      }
    }
  });
}

/* ---------- Stream ---------- */
function tabStream(el, c) {
  const items = D().announcements.filter(a => a.class_id === c.id);
  const upcoming = D().assignments.filter(a => a.class_id === c.id && !a.submission).sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 4);
  el.innerHTML = '<div class="grid gap-4 lg:grid-cols-[15rem_1fr]">' +
    '<aside class="space-y-4"><div class="card p-4"><p class="text-xs text-gray-500">Kode kelas</p><p class="font-mono text-lg tracking-widest">' + UI.esc(c.kode_kelas) + '</p>' +
    '<button class="btn btn-ghost btn-sm mt-2 -ml-2" data-act="leave">Keluar dari kelas</button></div>' +
    '<div class="card p-4"><p class="font-medium text-sm mb-2">Tugas mendatang</p>' + (upcoming.length ? upcoming.map(a => {
      const cd = UI.countdown(a.deadline);
      return '<div class="py-1.5 cursor-pointer" data-act="task" data-id="' + a.id + '"><p class="text-sm truncate hover:underline">' + UI.esc(a.judul) + '</p><p class="text-xs ' + (cd.late ? 'text-red-600' : 'text-gray-500') + '">' + cd.text + '</p></div>';
    }).join('') : '<p class="text-xs text-gray-500">Tidak ada tugas yang menunggu 🎉</p>') + '</div></aside>' +
    '<div class="space-y-3">' + (items.length ? items.map(a =>
      '<article class="card p-4"><div class="flex gap-3">' + UI.avatar(a.guru_nama) + '<div class="flex-1 min-w-0">' +
      '<p class="text-sm"><b>' + UI.esc(a.guru_nama) + '</b> <span class="text-gray-500">· ' + UI.timeAgo(a.created_at) + '</span></p>' +
      '<h3 class="font-medium mt-1">' + UI.esc(a.judul) + '</h3><p class="mt-1 text-sm pre-wrap">' + UI.esc(a.isi) + '</p></div></div></article>').join('')
      : '<div class="card">' + UI.empty('Belum ada pengumuman', 'Pengumuman dari gurumu akan muncul di sini.') + '</div>') + '</div></div>';
}

/* ---------- Tugas ---------- */
function tabTugas(el, c) {
  const order = { todo: 0, late: 1, submitted: 2, graded: 3 };
  const items = D().assignments.filter(a => a.class_id === c.id)
    .sort((a, b) => (order[statusOf(a).key] - order[statusOf(b).key]) || a.deadline.localeCompare(b.deadline));
  el.innerHTML = items.length
    ? '<div class="card">' + items.map(a => taskRow(a, false)).join('') + '</div>'
    : '<div class="card">' + UI.empty('Belum ada tugas', 'Tugas dari gurumu akan muncul di sini.') + '</div>';
}

/* ---------- Materi ---------- */
function tabMateri(el, c) {
  const items = D().materials.filter(m => m.class_id === c.id);
  el.innerHTML = items.length ? '<div class="card">' + items.map(m => {
    const href = UI.url(m.url);
    return '<div class="row-item"><span class="task-ico blue">' + icon(m.tipe === 'file' ? 'file' : 'link', 'w-5 h-5') + '</span>' +
      '<div class="flex-1 min-w-0"><p class="font-medium truncate">' + UI.esc(m.judul) + '</p><p class="text-xs text-gray-500">' + (m.tipe === 'file' ? 'File' : 'Link') + ' · ' + UI.fmtDate(m.created_at) + '</p></div>' +
      (href ? '<a class="btn btn-outline btn-sm" href="' + UI.esc(href) + '" target="_blank" rel="noopener noreferrer">Buka ' + icon('external', 'w-4 h-4') + '</a>' : '') + '</div>';
  }).join('') + '</div>' : '<div class="card">' + UI.empty('Belum ada materi', 'Materi yang dibagikan guru akan muncul di sini.') + '</div>';
}

/* ---------- Teman ---------- */
function tabTeman(el, c) {
  const mates = D().students.filter(s => s.class_id === c.id);
  el.innerHTML = '<div class="card"><div class="px-5 py-4 text-lg font-extrabold" style="color:' + UI.classColor(c.id) + '">Guru</div>' +
    '<div class="row-item">' + UI.avatar(c.guru_nama) + '<span>' + UI.esc(c.guru_nama) + '</span></div></div>' +
    '<div class="card mt-4"><div class="px-5 py-4 flex items-center justify-between"><span class="text-lg font-extrabold" style="color:' + UI.classColor(c.id) + '">Teman sekelas</span><span class="text-sm text-gray-500">' + mates.length + ' siswa</span></div>' +
    (mates.length ? mates.map(s => '<div class="row-item">' + UI.avatar(s.nama, '', s.foto_url) + '<span>' + UI.esc(s.nama) + '</span>' + (s.siswa_id === ME.id ? '<span class="badge badge-blue">Kamu</span>' : '') + '</div>').join('')
      : UI.empty('Belum ada teman sekelas', '')) + '</div>';
}

/* ============================================================
   MODAL TUGAS — detail, kumpulkan, lihat nilai
   ============================================================ */
function openAssignment(id) {
  const a = D().assignments.find(x => x.id === id);
  if (!a) return;
  const sub = a.submission;
  const st = statusOf(a);
  const graded = sub && sub.nilai !== null;
  let timer = null;

  const header =
    '<div class="flex flex-wrap items-center gap-2 mb-2"><span class="badge badge-blue">' + UI.esc(a.nama_kelas) + '</span><span class="badge ' + st.cls + '">' + st.label + '</span></div>' +
    '<div class="answer-box px-4 py-3 mb-3 text-sm flex flex-wrap items-center justify-between gap-2">' +
    '<span>' + icon('clock', 'w-4 h-4 inline -mt-0.5') + ' Deadline: <b>' + UI.fmtDateTime(a.deadline) + '</b></span><b id="cd"></b></div>' +
    (a.deskripsi ? '<p class="text-sm pre-wrap mb-3">' + UI.esc(a.deskripsi) + '</p>' : '') +
    (UI.url(a.file_url) ? '<p class="mb-3"><a class="inline-flex items-center gap-1 text-sm" href="' + UI.esc(UI.url(a.file_url)) + '" target="_blank" rel="noopener noreferrer">' + icon('link', 'w-4 h-4') + ' Lampiran dari guru</a></p>' : '');

  let body;
  if (graded) {
    // Sudah dinilai → tampilkan nilai & feedback
    body = header + '<div class="notice-grade mb-3"><p class="text-sm ">Nilai kamu</p>' +
      '<p class="text-4xl font-medium ">' + sub.nilai + '<span class="text-lg text-gray-500">/100</span></p></div>' +
      '<div class="mb-3"><p class="label">Feedback guru</p><p class="text-sm pre-wrap">' + (sub.feedback ? UI.esc(sub.feedback) : '<span class="text-gray-400">Tidak ada feedback.</span>') + '</p></div>' +
      (sub.submitted_at ? '<div class="answer-box p-4 text-sm"><p class="label">Jawabanmu (dikumpulkan ' + UI.fmtDateTime(sub.submitted_at) + ')</p>' :
        '<div class="answer-box p-4 text-sm"><p class="label">Nilai diberikan langsung oleh guru</p>') +
      (sub.jawaban ? '<p class="pre-wrap">' + UI.esc(sub.jawaban) + '</p>' : '') +
      (UI.url(sub.file_url) ? '<p class="mt-1"><a href="' + UI.esc(UI.url(sub.file_url)) + '" target="_blank" rel="noopener noreferrer">Buka file / link jawaban</a></p>' : '') + '</div>' +
      '<div class="flex justify-end mt-4"><button class="btn btn-primary" data-close>Tutup</button></div>';
  } else {
    body = header +
      (sub ? '<div class="notice notice-blue mb-3">Kamu sudah mengumpulkan pada ' + UI.fmtDateTime(sub.submitted_at) + '. Kamu masih bisa memperbarui sampai guru memberi nilai.</div>' : '') +
      (new Date(a.deadline) < new Date() ? '<div class="notice notice-yellow mb-3">Batas waktu sudah lewat — pengumpulanmu akan ditandai terlambat.</div>' : '') +
      '<form class="space-y-3" novalidate>' +
      '<div><label class="label" for="s-link">Link jawaban (Google Drive / Docs / dll)</label><input id="s-link" class="input" type="url" placeholder="https://..." value="' + UI.esc(sub ? sub.file_url : '') + '"></div>' +
      '<div><label class="label" for="s-file">atau unggah file (maks 200 MB)</label><input id="s-file" class="input" type="file">' +
      '<p class="hint">Semua jenis file diterima (dokumen, foto, video MP4, dll). File diunggah ke Google Drive milik guru/admin. <span id="s-prog" class="font-bold"></span> Jika memilih file, link di atas diabaikan.</p></div>' +
      '<div><label class="label" for="s-jwb">Jawaban / catatan</label><textarea id="s-jwb" class="input" rows="4" maxlength="5000" placeholder="Tulis jawabanmu di sini...">' + UI.esc(sub ? sub.jawaban : '') + '</textarea></div>' +
      '<div class="flex justify-end gap-2"><button type="button" class="btn btn-ghost" data-close>Batal</button><button type="submit" class="btn btn-primary">' + (sub ? 'Perbarui Pengumpulan' : 'Kumpulkan') + '</button></div></form>';
  }

  const m = UI.modal({ title: a.judul, size: 'lg', body, onClose: () => clearInterval(timer) });

  // Countdown real-time
  const cdEl = m.el.querySelector('#cd');
  const tick = () => {
    const c = UI.countdown(a.deadline);
    cdEl.textContent = c.text;
    cdEl.style.color = c.late ? '#d4503f' : '#3f8f6b';
  };
  tick();
  timer = setInterval(() => { if (!cdEl.isConnected) clearInterval(timer); else tick(); }, 1000);

  const form = m.el.querySelector('form');
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('[type=submit]');
    const link = m.el.querySelector('#s-link').value.trim();
    const file = m.el.querySelector('#s-file').files[0];
    const jawaban = m.el.querySelector('#s-jwb').value.trim();
    if (!link && !file && !jawaban) { UI.toast('Isi jawaban, link, atau pilih file terlebih dahulu', 'error'); return; }
    if (link && !UI.url(link)) { UI.toast('Link harus diawali http:// atau https://', 'error'); return; }
    UI.busy(btn, true);
    try {
      let fileUrl = link;
      if (file) {
        const prog = m.el.querySelector('#s-prog');
        const up = await API.upload(file, p => { if (prog) prog.textContent = p < 1 ? 'Mengunggah ' + Math.round(p * 100) + '% - jangan tutup halaman' : 'Selesai'; });
        fileUrl = up.url;
        if (!up.shared) UI.toast('File terunggah, tetapi pengaturan berbagi dibatasi domain sekolah. Pastikan guru dapat membukanya.', 'info');
      }
      await API.call('submitAssignment', { assignment_id: a.id, file_url: fileUrl, jawaban });
      UI.toast(sub ? 'Pengumpulan diperbarui' : 'Tugas berhasil dikumpulkan');
      m.close();
      await refresh();
    } catch (err) {
      UI.toast(err.message, 'error');
      UI.busy(btn, false);
    }
  });
}

return { start: start, stop: stop };
})();

/* ============================================================
   ClassRoom Lite — auth.js
   Login/daftar + pengarah ke dashboard guru / siswa (SATU halaman).
   Tidak memakai location.reload() (di Apps Script bisa jadi halaman putih).
   ============================================================ */

/* showFatal() didefinisikan di <head> (Index.html) agar aktif walau Script gagal dimuat. */

const Auth = {
  logout() { App.reset(); }
};

const App = {
  started: false,
  alert: function () { /* diisi oleh initLogin */ },

  /** Tampilkan dashboard sesuai role (guru → GuruApp, siswa → SiswaApp). */
  open(user) {
    if (App.started) return;
    App.started = true;
    document.getElementById('screen-login').classList.add('hidden');
    const app = document.getElementById('app');
    app.classList.remove('hidden');
    document.body.classList.remove('login-bg');
    try {
      if (user.role === 'guru') GuruApp.start(); else SiswaApp.start();
    } catch (err) {
      showFatal(err.message || err);
      throw err;
    }
  },

  /** Kembali ke layar login di tempat (tanpa reload). */
  reset(reason) {
    Session.clear();
    if (GuruApp.stop) GuruApp.stop();
    if (SiswaApp.stop) SiswaApp.stop();
    UI._modals.slice().forEach(m => m.close());
    document.body.classList.remove('no-scroll', 'has-bottom-nav');
    document.body.classList.add('login-bg');
    const app = document.getElementById('app');
    app.innerHTML = '';
    app.classList.add('hidden');
    document.getElementById('screen-login').classList.remove('hidden');
    document.querySelectorAll('#screen-login form').forEach(f => f.reset());
    document.querySelectorAll('#screen-login [type=submit]').forEach(b => UI.busy(b, false));
    try { location.hash = ''; } catch (e) { /* abaikan */ }
    App.started = false;
    if (reason === 'expired') App.alert('Sesi Anda berakhir. Silakan login kembali.', 'info');
    window.scrollTo(0, 0);
  },

  showLogin(reason) { App.reset(reason); }
};

/* Link menu (#/kelas, #/tugas, ...) hanya mengubah hash di dalam aplikasi. */
document.addEventListener('click', e => {
  const a = e.target.closest ? e.target.closest('a[href^="#"]') : null;
  if (!a) return;
  e.preventDefault();
  const h = a.getAttribute('href');
  location.hash = h.length > 1 ? h : '#/';
});

(function initLogin() {
  const loginForm = document.getElementById('login-form');
  const alertBox = document.getElementById('alert-box');

  function showAlert(msg, type) {
    alertBox.className = 'text-sm rounded-lg px-3 py-2 mb-4 ' + (type === 'error' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-800');
    alertBox.textContent = msg;
  }
  function hideAlert() { alertBox.className = 'hidden'; }
  App.alert = showAlert;

  // Pasang penangan form DULU (selalu), baru cek sesi lama
  loginForm.addEventListener('submit', async e => {
    e.preventDefault();
    hideAlert();
    const btn = loginForm.querySelector('[type=submit]');
    UI.busy(btn, true);
    try {
      const data = await API.call('login', { email: loginForm.email.value.trim(), password: loginForm.password.value });
      Session.save(data.token, data.user);
      App.open(data.user); // role terdeteksi otomatis dari data Users
    } catch (err) {
      showAlert(err.message, 'error');
    } finally {
      UI.busy(btn, false);
    }
  });

  // Sesi lama masih berlaku? langsung buka dashboard
  const existing = Session.user();
  if (Session.token() && existing && !Session.expired()) { App.open(existing); return; }
  Session.clear();
})();

window.__crlReady = true;
