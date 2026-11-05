/**************************************************************
 * PORTAL KUIS SISWA — FINAL REVISI
 * Website siswa: login, kerjakan kuis (dgn timer), lihat skor,
 * pembahasan, riwayat, leaderboard, DAN filter kelas 7/8/9.
 *
 * Deploy: Deploy > New deployment > Web app
 *   Execute as : Me
 *   Who has access : Anyone
 **************************************************************/

const SPREADSHEET_ID = '174lUwhhoq7vM5P_YOjhi7fbCTE5R88N74JINoTLwG5o';
const SH = {
  SISWA:'Users_Siswa', KUIS:'Kuis', SOAL:'Bank_Soal', HASIL:'Hasil_Kuis'
};
const HEADERS = {
  Users_Siswa:['Username','Password','Nama','NIS','Kelas','Aktif','UpdatedAt'],
  Kuis:['ID','Judul','Deskripsi','KKM','Durasi','Status','AcakSoal','AcakOpsi','CreatedAt','UpdatedAt','TingkatKelas'],
  Bank_Soal:['ID','KuisID','Pertanyaan','OpsiA','OpsiB','OpsiC','OpsiD','Kunci','Pembahasan','Status','UpdatedAt','GambarSoal','GambarA','GambarB','GambarC','GambarD'],
  Hasil_Kuis:['ID','Timestamp','UsernameSiswa','NamaSiswa','KuisID','JudulKuis','Nilai','KKM','StatusKKM','DetailJawaban','DurasiDetik']
};

function tingkatDariKelas_(kelas) {
  const m = String(kelas||'').match(/\d+/);
  return m ? m[0] : '';
}

const SESSION_TTL   = 21600;
const MAX_FAIL      = 5;
const LOCK_SECONDS  = 600;
const GRACE_SECONDS = 45;
const LB_LIMIT      = 20;

/* ============ WEB APP ============ */
function doGet(e) {
  // Mode API JSONP untuk frontend GitHub Pages (menghindari blokir CORS).
  if (e && e.parameter && e.parameter.api === '1') return apiJsonp_(e);

  // Halaman ini hanya fallback/tes; frontend utama berada di GitHub Pages.
  return HtmlService
    .createHtmlOutput('<h2>API Portal Kuis Siswa aktif.</h2><p>Buka alamat GitHub Pages untuk menggunakan aplikasi.</p>')
    .setTitle('Portal Kuis Siswa API')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover');
}

/** Daftar fungsi yang boleh dipanggil dari frontend publik. */
const API_ALLOWED = [
  'portalLogin', 'portalMe', 'portalLogout', 'portalListTingkat',
  'portalHome', 'portalStart', 'portalSubmit', 'portalPembahasan',
  'portalRiwayat', 'portalLeaderboard'
];

/** Endpoint JSONP: /exec?api=1&fn=portalHome&args=[...]&callback=... */
function apiJsonp_(e) {
  const p = e.parameter || {};
  const callback = String(p.callback || '');
  if (!/^[a-zA-Z_$][0-9a-zA-Z_$]*$/.test(callback)) {
    return ContentService.createTextOutput('/* invalid callback */')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  let result;
  try {
    const fn = String(p.fn || '');
    if (API_ALLOWED.indexOf(fn) < 0) {
      throw coded_('API', 'Fungsi API tidak diizinkan.');
    }
    let args = [];
    if (p.args) args = JSON.parse(p.args);
    if (!Array.isArray(args)) throw coded_('API', 'Format parameter API tidak valid.');
    const apiFunctions = {
      portalLogin:portalLogin, portalMe:portalMe, portalLogout:portalLogout,
      portalListTingkat:portalListTingkat, portalHome:portalHome,
      portalStart:portalStart, portalSubmit:portalSubmit,
      portalPembahasan:portalPembahasan, portalRiwayat:portalRiwayat,
      portalLeaderboard:portalLeaderboard
    };
    result = apiFunctions[fn].apply(null, args);
  } catch (err) {
    result = { ok:false, code:(err && err.code) || 'API', message:(err && err.message) || String(err) };
  }
  const body = callback + '(' + JSON.stringify(result) + ');';
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JAVASCRIPT);
}

/* ============ UTIL ============ */
let _ss = null;
function ss_() {
  if (!_ss) _ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return _ss;
}
function sheet_(name) {
  const ss = ss_();
  let sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    const h = HEADERS[name];
    sh.getRange(1,1,1,h.length).setValues([h]);
    sh.setFrozenRows(1);
  }
  return sh;
}
function rows_(name, ncols) {
  const sh = sheet_(name);
  const n = sh.getLastRow();
  return n < 2 ? [] : sh.getRange(2,1,n-1,ncols).getValues();
}
function clean_(v) { return String(v == null ? '' : v).trim(); }
function bool_(v) {
  const s = String(v).toLowerCase();
  return v === true || s === 'true' || s === '1' || s === 'ya';
}
function uuid_() { return Utilities.getUuid(); }
function parse_(raw) { if (!raw) return null; try { return JSON.parse(raw); } catch (e) { return null; } }
function shuffle_(arr) {
  for (let i = arr.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}
function coded_(code, message) { const e = new Error(message); e.code = code; return e; }
function guard_(fn) {
  try { return fn(); }
  catch (e) { return { ok:false, code:(e && e.code) || '', message:(e && e.message) ? e.message : String(e) }; }
}

/* ============ SESI ============ */
function newSession_(user) {
  const token = uuid_();
  CacheService.getScriptCache().put('sw_s_' + token, JSON.stringify(user), SESSION_TTL);
  return token;
}
function need_(token) {
  const raw = token ? CacheService.getScriptCache().get('sw_s_' + token) : null;
  const u = parse_(raw);
  if (!u) throw coded_('SESSION', 'Sesi login berakhir. Silakan masuk kembali.');
  return u;
}
function attemptKey_(username, kuisId) {
  const raw = String(username).toLowerCase() + '|' + String(kuisId);
  const d = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw, Utilities.Charset.UTF_8);
  return 'sw_a_' + d.map(b => ('0' + ((b < 0 ? b + 256 : b).toString(16))).slice(-2)).join('');
}

/* ============ LOGIN ============ */
function portalLogin(username, password) {
  return guard_(function () {
    username = clean_(username); password = String(password||'');
    if (!username || !password) throw new Error('Username dan password wajib diisi.');
    const cache = CacheService.getScriptCache();
    const failKey = 'sw_f_' + attemptKey_(username, 'login').slice(5);
    const fails = Number(cache.get(failKey) || 0);
    if (fails >= MAX_FAIL) throw new Error('Terlalu banyak percobaan gagal. Coba lagi dalam 10 menit.');
    const rows = rows_(SH.SISWA, 7);
    let found = null;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (clean_(r[0]).toLowerCase() === username.toLowerCase() && String(r[1]) === password) { found = r; break; }
    }
    if (!found) { cache.put(failKey, String(fails + 1), LOCK_SECONDS); throw new Error('Username atau password salah.'); }
    if (!bool_(found[5])) throw new Error('Akunmu sedang dinonaktifkan. Hubungi gurumu.');
    cache.remove(failKey);
    const user = { username:String(found[0]).trim(), nama:String(found[2]||found[0]).trim(), nis:String(found[3]||''), kelas:String(found[4]||'') };
    return { ok:true, token:newSession_(user), user };
  });
}
function portalMe(token) { return guard_(function () { return { ok:true, user:need_(token) }; }); }
function portalLogout(token) {
  return guard_(function () { if (token) CacheService.getScriptCache().remove('sw_s_' + token); return { ok:true }; });
}

/* ============ FILTER TINGKAT ============ */
function portalListTingkat(token) {
  return guard_(function () {
    need_(token);
    const set = {};
    rows_(SH.KUIS, 11).forEach(r => {
      const t = clean_(r[10]);
      if (String(r[5] || '') === 'Aktif' && t) set[t] = true;
    });
    return { ok:true, tingkat:Object.keys(set).sort() };
  });
}

/* ============ DATA KUIS ============ */
function kuisFromRow_(r) {
  return {
    id:clean_(r[0]), judul:String(r[1]||''), deskripsi:String(r[2]||''),
    kkm:Number(r[3])||75, durasi:Number(r[4])||30, status:String(r[5]||'Nonaktif'),
    acakSoal:bool_(r[6]), acakOpsi:bool_(r[7]),
    created:r[8] ? new Date(r[8]).getTime() : 0, tingkatKelas:clean_(r[10]||'')
  };
}
function findKuis_(kuisId) {
  const rows = rows_(SH.KUIS, 11);
  for (let i = 0; i < rows.length; i++) if (clean_(rows[i][0]) === kuisId) return kuisFromRow_(rows[i]);
  return null;
}
function soalFromRow_(r) {
  return {
    id:clean_(r[0]), kuisId:clean_(r[1]), pertanyaan:String(r[2]||''),
    opsi:{ A:String(r[3]||'').trim(), B:String(r[4]||'').trim(), C:String(r[5]||'').trim(), D:String(r[6]||'').trim() },
    kunci:clean_(r[7]).toUpperCase(), pembahasan:String(r[8]||''), status:String(r[9]||'Nonaktif'),
    gambarSoal:String(r[11]||''),
    opsiGambar:{ A:String(r[12]||''), B:String(r[13]||''), C:String(r[14]||''), D:String(r[15]||'') }
  };
}
function activeSoal_(kuisId) {
  return rows_(SH.SOAL, 16).map(soalFromRow_).filter(s => s.kuisId === kuisId && s.status === 'Aktif');
}
function soalMap_() {
  const map = {};
  rows_(SH.SOAL, 16).forEach(r => { const s = soalFromRow_(r); map[s.id] = s; });
  return map;
}
function orderOpts_(s, ord) {
  return String(ord||'ABCD').split('').map(k => ({ key:k, text:s.opsi[k], gambar:s.opsiGambar?(s.opsiGambar[k]||''):'' }))
    .filter(o => o.text || o.gambar);
}
function parseDetail_(raw) { const d = parse_(String(raw||'')); return Array.isArray(d) ? d : []; }

/* ============ BERANDA (filter tingkat) ============ */
function portalHome(token) {
  return guard_(function () {
    const u = need_(token);
    const uname = u.username.toLowerCase();
    const now = Date.now();
    const tingkatSiswa = tingkatDariKelas_(u.kelas);

    const kuisAktif = rows_(SH.KUIS, 11)
      .map(kuisFromRow_)
      .filter(function (k) {
        if (!k.id || k.status !== 'Aktif') return false;
        if (k.tingkatKelas && tingkatSiswa && k.tingkatKelas !== tingkatSiswa) return false;
        return true;
      })
      .sort(function (a, b) { return b.created - a.created; });

    const jumlahSoal = {};
    rows_(SH.SOAL, 16).forEach(function (r) {
      if (String(r[9] || '') === 'Aktif') {
        const id = clean_(r[1]);
        jumlahSoal[id] = (jumlahSoal[id] || 0) + 1;
      }
    });

    const best = {};
    rows_(SH.HASIL, 11).forEach(function (r) {
      if (clean_(r[2]).toLowerCase() !== uname) return;
      const id = clean_(r[4]);
      const nilai = Number(r[6]) || 0;
      const b = best[id] || (best[id] = { nilai: -1, percobaan: 0, lulus: false });
      b.percobaan++;
      if (nilai > b.nilai) { b.nilai = nilai; b.lulus = String(r[8]) === 'LULUS'; }
    });

    const cache = CacheService.getScriptCache();
    const keys = {};
    kuisAktif.forEach(function (k) { keys[attemptKey_(u.username, k.id)] = k.id; });
    const keyList = Object.keys(keys);
    const running = keyList.length ? cache.getAll(keyList) : {};

    const kuis = kuisAktif.map(function (k) {
      const b = best[k.id];
      const att = parse_(running[attemptKey_(u.username, k.id)]);
      let berjalan = null;
      if (att && !att.done) {
        const sisa = Math.round((att.startedAt + att.durasi * 1000 - now) / 1000);
        if (sisa > 0) berjalan = { sisaDetik: sisa };
      }
      return {
        id:k.id, judul:k.judul, deskripsi:k.deskripsi, kkm:k.kkm, durasi:k.durasi,
        tingkatKelas:k.tingkatKelas,
        jumlahSoal:jumlahSoal[k.id] || 0,
        percobaan:b ? b.percobaan : 0,
        terbaik:b ? b.nilai : null,
        lulus:b ? b.lulus : false,
        berjalan
      };
    });

    const skorTerbaik = Object.keys(best).map(function (id) { return best[id].nilai; });
    const rata = skorTerbaik.length ? Math.round(skorTerbaik.reduce(function (a, b) { return a + b; }, 0) / skorTerbaik.length * 10) / 10 : 0;

    return {
      ok:true, user:u,
      stats:{ selesai:skorTerbaik.length, rataRata:rata, terbaik:skorTerbaik.length ? Math.max.apply(null, skorTerbaik) : 0 },
      kuis,
      tingkatSiswa
    };
  });
}

/* ============ MULAI KUIS ============ */
function portalStart(token, kuisId) {
  return guard_(function () {
    const u = need_(token);
    kuisId = clean_(kuisId);
    const kuis = findKuis_(kuisId);
    if (!kuis) throw new Error('Kuis tidak ditemukan.');
    if (kuis.status !== 'Aktif') throw new Error('Kuis ini sedang tidak aktif.');
    const tingkatSiswa = tingkatDariKelas_(u.kelas);
    if (kuis.tingkatKelas && tingkatSiswa && kuis.tingkatKelas !== tingkatSiswa)
      throw new Error('Kuis ini untuk kelas ' + kuis.tingkatKelas + ', bukan untuk kelasmu.');
    const soalAktif = activeSoal_(kuisId);
    if (!soalAktif.length) throw new Error('Belum ada soal aktif pada kuis ini.');
    const cache = CacheService.getScriptCache();
    const key = attemptKey_(u.username, kuisId);
    const now = Date.now();
    let att = parse_(cache.get(key));
    let resumed = false;
    if (att && !att.done && att.startedAt + att.durasi * 1000 > now) {
      resumed = true;
    } else {
      const list = soalAktif.slice();
      if (kuis.acakSoal) shuffle_(list);
      const ord = {};
      list.forEach(function (s) {
        const keys = ['A','B','C','D'];
        if (kuis.acakOpsi) shuffle_(keys);
        ord[s.id] = keys.join('');
      });
      att = { id:uuid_(), kuisId, startedAt:now, durasi:kuis.durasi * 60,
              qids:list.map(s => s.id), ord, done:false };
      cache.put(key, JSON.stringify(att), Math.min(SESSION_TTL, att.durasi + GRACE_SECONDS + 600));
    }
    const byId = {};
    soalAktif.forEach(function (s) { byId[s.id] = s; });
    const soal = att.qids.map(function (id) { return byId[id]; }).filter(Boolean)
      .map(function (s) {
        return { id:s.id, pertanyaan:s.pertanyaan, gambarSoal:s.gambarSoal||'', opsi:orderOpts_(s, att.ord[s.id]) };
      });
    if (!soal.length) throw new Error('Soal kuis tidak tersedia.');
    return {
      ok:true, attemptId:att.id, resumed,
      kuis:{ id:kuis.id, judul:kuis.judul, deskripsi:kuis.deskripsi, kkm:kuis.kkm, durasi:kuis.durasi },
      sisaDetik:Math.max(0, Math.round((att.startedAt + att.durasi * 1000 - now) / 1000)),
      soal
    };
  });
}

/* ============ KIRIM JAWABAN ============ */
function portalSubmit(token, payload) {
  return guard_(function () {
    const u = need_(token);
    payload = payload || {};
    const kuisId = clean_(payload.kuisId);
    const attemptId = clean_(payload.attemptId);
    const answers = (payload.answers && typeof payload.answers === 'object') ? payload.answers : {};
    if (!kuisId || !attemptId) throw new Error('Data pengiriman tidak lengkap.');
    const cache = CacheService.getScriptCache();
    const key = attemptKey_(u.username, kuisId);
    const lock = LockService.getScriptLock();
    let att = null;
    let duplicateOf = '';
    lock.waitLock(15000);
    try {
      att = parse_(cache.get(key));
      if (!att || att.id !== attemptId) throw coded_('NOATTEMPT', 'Sesi pengerjaan tidak ditemukan. Mulai kuis lagi dari beranda.');
      if (att.done) {
        if (att.hasilId) duplicateOf = att.hasilId;
        else throw new Error('Jawabanmu sedang diproses. Tunggu sebentar lalu coba lagi.');
      } else {
        const elapsed = (Date.now() - att.startedAt) / 1000;
        if (elapsed > att.durasi + GRACE_SECONDS) {
          cache.remove(key);
          throw coded_('EXPIRED', 'Waktu pengerjaan sudah habis, jawaban tidak dapat dikirim.');
        }
        att.done = true;
        cache.put(key, JSON.stringify(att), 900);
      }
    } finally { lock.releaseLock(); }

    if (duplicateOf) return reviewById_(u, duplicateOf, true);

    try {
      const kuis = findKuis_(kuisId) || { id:kuisId, judul:'Kuis', kkm:75 };
      const map = soalMap_();
      const detail = [];
      let benar = 0;
      att.qids.forEach(function (qid) {
        const s = map[qid];
        if (!s) return;
        let j = clean_(answers[qid]).toUpperCase();
        if (['A','B','C','D'].indexOf(j) === -1) j = '';
        const ok = j !== '' && j === s.kunci;
        if (ok) benar++;
        detail.push({ soalId:qid, jawaban:j, benar:s.kunci, benarFlag:ok });
      });
      if (!detail.length) throw new Error('Soal kuis tidak ditemukan (mungkin sudah dihapus guru).');
      const total = detail.length;
      const kosong = detail.filter(function (d) { return !d.jawaban; }).length;
      const nilai = Math.round((benar / total) * 10000) / 100;
      const status = nilai >= kuis.kkm ? 'LULUS' : 'BELUM LULUS';
      const durasiDetik = Math.min(att.durasi, Math.max(0, Math.round((Date.now() - att.startedAt) / 1000)));
      const id = uuid_();
      sheet_(SH.HASIL).appendRow([
        id, new Date(), u.username, u.nama, kuis.id, kuis.judul,
        nilai, kuis.kkm, status, JSON.stringify(detail), durasiDetik
      ]);
      att.hasilId = id;
      cache.put(key, JSON.stringify(att), 900);
      const lb = leaderboardData_(kuisId);
      let rank = 0;
      lb.forEach(function (x) { if (x.username.toLowerCase() === u.username.toLowerCase()) rank = x.peringkat; });
      return {
        ok:true,
        hasil:{ id, kuisId:kuis.id, judulKuis:kuis.judul, nilai, kkm:kuis.kkm, status,
                benar, salah:total - benar - kosong, kosong, total, durasiDetik },
        pembahasan:reviewItems_(detail, map),
        peringkat:rank, dariPeserta:lb.length
      };
    } catch (e) {
      att.done = false;
      const sisa = Math.ceil(att.durasi - (Date.now() - att.startedAt) / 1000) + GRACE_SECONDS + 60;
      cache.put(key, JSON.stringify(att), Math.max(120, Math.min(SESSION_TTL, sisa)));
      throw e;
    }
  });
}

/* ============ PEMBAHASAN & RIWAYAT ============ */
function reviewItems_(detail, map) {
  return detail.map(function (d) {
    const s = map[d.soalId];
    if (!s) return null;
    return {
      soalId:s.id, pertanyaan:s.pertanyaan, gambarSoal:s.gambarSoal||'',
      opsi:s.opsi, opsiGambar:s.opsiGambar||{},
      jawaban:d.jawaban||'', benar:d.benar||s.kunci,
      benarFlag:!!d.benarFlag, pembahasan:s.pembahasan
    };
  }).filter(Boolean);
}
function reviewById_(u, hasilId, withRank) {
  const rows = rows_(SH.HASIL, 11);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (clean_(r[0]) !== hasilId) continue;
    if (clean_(r[2]).toLowerCase() !== u.username.toLowerCase())
      throw new Error('Kamu tidak dapat melihat hasil siswa lain.');
    const detail = parseDetail_(r[9]);
    const total = detail.length;
    const benar = detail.filter(function (d) { return d.benarFlag; }).length;
    const kosong = detail.filter(function (d) { return !d.jawaban; }).length;
    const out = {
      ok:true,
      hasil:{ id:clean_(r[0]), kuisId:clean_(r[4]), judulKuis:String(r[5]), nilai:Number(r[6])||0,
              kkm:Number(r[7])||0, status:String(r[8]), benar, salah:total - benar - kosong,
              kosong, total, durasiDetik:Number(r[10])||0 },
      pembahasan:reviewItems_(detail, soalMap_())
    };
    if (withRank) {
      const lb = leaderboardData_(clean_(r[4]));
      let rank = 0;
      lb.forEach(function (x) { if (x.username.toLowerCase() === u.username.toLowerCase()) rank = x.peringkat; });
      out.peringkat = rank;
      out.dariPeserta = lb.length;
    }
    return out;
  }
  throw new Error('Data hasil kuis tidak ditemukan.');
}
function portalPembahasan(token, hasilId) {
  return guard_(function () { return reviewById_(need_(token), clean_(hasilId), false); });
}
function portalRiwayat(token) {
  return guard_(function () {
    const u = need_(token);
    const uname = u.username.toLowerCase();
    const out = rows_(SH.HASIL, 11)
      .filter(r => clean_(r[2]).toLowerCase() === uname)
      .map(r => {
        const detail = parseDetail_(r[9]);
        return {
          id:clean_(r[0]), waktu:r[1] ? new Date(r[1]).toISOString() : '',
          kuisId:clean_(r[4]), judulKuis:String(r[5]), nilai:Number(r[6])||0,
          kkm:Number(r[7])||0, status:String(r[8]),
          benar:detail.filter(d => d.benarFlag).length, total:detail.length,
          durasiDetik:Number(r[10])||0
        };
      })
      .sort((a,b) => a.waktu < b.waktu ? 1 : -1)
      .slice(0, 100);
    return { ok:true, riwayat:out };
  });
}

/* ============ LEADERBOARD ============ */
function lbCompare_(a, b) {
  if (b.nilai !== a.nilai) return b.nilai - a.nilai;
  if (a.durasi !== b.durasi) return a.durasi - b.durasi;
  return a.ts - b.ts;
}
function leaderboardData_(kuisId) {
  const kelas = {};
  rows_(SH.SISWA, 7).forEach(r => { kelas[clean_(r[0]).toLowerCase()] = clean_(r[4]); });
  const best = {};
  rows_(SH.HASIL, 11).forEach(function (r) {
    if (clean_(r[4]) !== kuisId) return;
    const uname = clean_(r[2]).toLowerCase();
    const it = { username:String(r[2]).trim(), nama:String(r[3]), nilai:Number(r[6])||0, durasi:Number(r[10])||0, ts:r[1] ? new Date(r[1]).getTime() : 0 };
    if (!best[uname] || lbCompare_(it, best[uname]) < 0) best[uname] = it;
  });
  const arr = Object.keys(best).map(function (k) { const x = best[k]; x.kelas = kelas[k] || ''; return x; });
  arr.sort(lbCompare_);
  arr.forEach(function (x, i) { x.peringkat = i + 1; });
  return arr;
}
function portalLeaderboard(token, kuisId) {
  return guard_(function () {
    const u = need_(token);
    kuisId = clean_(kuisId);
    if (!kuisId) throw new Error('Pilih kuis terlebih dahulu.');
    const kuis = findKuis_(kuisId);
    const all = leaderboardData_(kuisId);
    const uname = u.username.toLowerCase();
    const shape = function (x) {
      return { peringkat:x.peringkat, nama:x.nama, kelas:x.kelas, nilai:x.nilai,
               durasiDetik:x.durasi, saya:x.username.toLowerCase() === uname };
    };
    const top = all.slice(0, LB_LIMIT).map(shape);
    const meAll = all.filter(function (x) { return x.username.toLowerCase() === uname; })[0];
    return {
      ok:true, kuisId, judul:kuis ? kuis.judul : '',
      total:all.length, top,
      saya:(meAll && meAll.peringkat > LB_LIMIT) ? shape(meAll) : null
    };
  });
}

/* ============ UJI KONEKSI ============ */
function cekKoneksi() {
  const info = {
    spreadsheet:ss_().getName(),
    siswa:rows_(SH.SISWA, 7).length,
    kuis:rows_(SH.KUIS, 10).length,
    soal:rows_(SH.SOAL, 11).length,
    hasil:rows_(SH.HASIL, 11).length
  };
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}