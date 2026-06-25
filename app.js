/* ================================================
   TIKUM POS — App Logic v3.0
   ================================================
   PERUBAHAN v3.0:
   1. Tanggal Operasional Warung (17:00–03:00)
   2. Laporan Penjualan: filter Tgl Awal & Akhir
   3. Stok produk: hanya informasi, tidak berkurang
   4. Report Produk Terjual (menu baru)
   5. Sistem Shift: Buka, Tutup, Laporan, Dashboard
   ================================================ */

'use strict';

// =============================================
// KONSTANTA OPERASIONAL WARUNG
// Warung buka pukul 17:00 dan tutup 03:00 esok
// Transaksi 00:00–02:59 → tanggal operasional H-1
// =============================================
const OP_START_HOUR  = 17; // jam buka (17:00)
const OP_CUTOFF_HOUR = 3;  // batas dini hari (03:00)

/**
 * getOperasionalDate(Date) → "YYYY-MM-DD"
 * Mengkonversi timestamp nyata ke tanggal operasional warung.
 *   Contoh: 25 Jun 01:30 → "2026-06-24" (masih shift 24 Jun)
 *           25 Jun 17:00 → "2026-06-25" (shift baru 25 Jun)
 */
function getOperasionalDate(d) {
  const dt = (d instanceof Date) ? d : (d && d.toDate ? d.toDate() : new Date(d));
  if (dt.getHours() < OP_CUTOFF_HOUR) {
    const prev = new Date(dt);
    prev.setDate(prev.getDate() - 1);
    return _dateStr(prev);
  }
  return _dateStr(dt);
}

function _dateStr(d) {
  return d.getFullYear() + '-'
    + String(d.getMonth() + 1).padStart(2, '0') + '-'
    + String(d.getDate()).padStart(2, '0');
}

/**
 * opRange(opDateStr) → { start, end } Firestore Timestamps
 * Hari operasional "2026-06-24" mencakup:
 *   24 Jun 17:00:00  →  25 Jun 02:59:59
 */
function opRange(opDateStr) {
  const [y, m, d] = opDateStr.split('-').map(Number);
  const start = new Date(y, m - 1, d, OP_START_HOUR, 0, 0, 0);
  const end   = new Date(y, m - 1, d + 1, OP_CUTOFF_HOUR - 1, 59, 59, 999);
  return {
    start: firebase.firestore.Timestamp.fromDate(start),
    end:   firebase.firestore.Timestamp.fromDate(end),
  };
}

/**
 * opRangeMulti(awal, akhir) → { start, end }
 * Untuk filter rentang: awal 17:00 s/d akhir+1 02:59:59
 */
function opRangeMulti(awal, akhir) {
  const [ya, ma, da] = awal.split('-').map(Number);
  const [yb, mb, db] = akhir.split('-').map(Number);
  const start = new Date(ya, ma - 1, da, OP_START_HOUR, 0, 0, 0);
  const end   = new Date(yb, mb - 1, db + 1, OP_CUTOFF_HOUR - 1, 59, 59, 999);
  return {
    start: firebase.firestore.Timestamp.fromDate(start),
    end:   firebase.firestore.Timestamp.fromDate(end),
  };
}

// =============================================
// STATE
// =============================================
let currentUser        = null;
let allProduk          = [];
let keranjang          = [];
let metode             = 'tunai';
let filterKat          = 'semua';
let searchQuery        = '';
let editProdukId       = null;
let hapusProdukId      = null;
let lastStruk          = null;
let diskonAktif        = false;
let diskonType         = 'nominal';
let hapusPengeluaranId = null;
let editPengeluaranId  = null;
let unsubscribeProduk = null;

// Shift state
let shiftData          = null;  // data shift aktif saat ini (null = tidak ada)
let shiftSaldoTeoritis = 0;     // dihitung ulang sebelum tutup

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  setTopbarDate();

  const today         = getTodayStr();
  const firstOfMonth  = today.substring(0, 7) + '-01';

  // Laporan penjualan — default range hari ini
  _setVal('laporan-awal',  today);
  _setVal('laporan-akhir', today);

  // Report produk — default hari ini
  _setVal('rp-awal',  today);
  _setVal('rp-akhir', today);

  // Pengeluaran form
  _setVal('p-tanggal', today);

  // Pengeluaran filter — bulan ini
  _setVal('filter-p-awal',  firstOfMonth);
  _setVal('filter-p-akhir', today);

  // Laporan shift — bulan ini
  _setVal('ls-awal',  firstOfMonth);
  _setVal('ls-akhir', today);

  auth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      _setTxt('sidebar-user-email', user.email);
      showApp();
      loadDashboard();
      loadProdukRealtme();
      checkShiftAktif();
    } else {

  if (unsubscribeProduk) {
    unsubscribeProduk();
    unsubscribeProduk = null;
  }

  currentUser = null;
  shiftData = null;

  showLogin();
}
  });
});

// =============================================
// UTIL: DOM helpers
// =============================================
function _setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function _setTxt(id, v) { const el = document.getElementById(id); if (el) el.textContent = v; }
function _el(id)        { return document.getElementById(id); }

// =============================================
// AUTH
// =============================================
async function doLogin() {

  alert('LOGIN DIKLIK');

  const email    = _el('login-email').value.trim();
  const password = _el('login-password').value;
  const errEl    = _el('login-error');
  errEl.classList.add('hidden');

  if (!email || !password) {
    showError(errEl, 'Email dan password wajib diisi.');
    return;
  }

  _el('btn-login-text').classList.add('hidden');
  _el('btn-login-spinner').classList.remove('hidden');

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    showError(errEl, mapAuthError(e.code));
  } finally {
    _el('btn-login-text').classList.remove('hidden');
    _el('btn-login-spinner').classList.add('hidden');
  }
}

async function doLogout() {
  try { await auth.signOut(); keranjang = []; shiftData = null; }
  catch (e) { showToast('Gagal logout: ' + e.message, 'error'); }
}

function mapAuthError(code) {
  const m = {
    'auth/user-not-found':       'Email tidak terdaftar.',
    'auth/wrong-password':       'Password salah.',
    'auth/invalid-email':        'Format email tidak valid.',
    'auth/too-many-requests':    'Terlalu banyak percobaan. Coba lagi nanti.',
    'auth/network-request-failed':'Koneksi gagal. Periksa internet Anda.',
  };
  return m[code] || 'Login gagal. Silakan coba lagi.';
}

function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function togglePassword() {
  const inp = _el('login-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// =============================================
// NAVIGASI
// =============================================
function showApp() {
  _el('page-login').classList.replace('active', 'hidden') || _el('page-login').classList.add('hidden');
  _el('page-app').classList.remove('hidden');
  _el('page-app').classList.add('active');
}

function showLogin() {
  _el('page-app').classList.replace('active', 'hidden') || _el('page-app').classList.add('hidden');
  _el('page-login').classList.remove('hidden');
  _el('page-login').classList.add('active');
}

function navigateTo(page, linkEl) {
  document.querySelectorAll('.content-section').forEach(s => {
    s.classList.remove('active'); s.classList.add('hidden');
  });
  const target = _el('section-' + page);
  if (target) { target.classList.remove('hidden'); target.classList.add('active'); }

  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (linkEl) linkEl.classList.add('active');

  const titles = {
    dashboard: 'Dashboard', kasir: 'Kasir', produk: 'Master Produk',
    laporan: 'Laporan Penjualan', 'report-produk': 'Report Produk Terjual',
    pengeluaran: 'Belanja & Pengeluaran', shift: 'Manajemen Shift',
    'laporan-shift': 'Laporan Shift',
  };
  _setTxt('topbar-title', titles[page] || page);

  if (page === 'dashboard')      loadDashboard();
  if (page === 'kasir')          renderProdukKasir();
  if (page === 'produk')         renderTabelProduk();
  if (page === 'laporan')        loadLaporan();
  if (page === 'report-produk')  loadReportProduk();
  if (page === 'pengeluaran')    loadPengeluaran();
  if (page === 'shift')          renderShiftPage();
  if (page === 'laporan-shift')  loadLaporanShift();

  closeSidebar();
}

function openSidebar()  { _el('sidebar').classList.add('open'); _el('sidebar-overlay').classList.remove('hidden'); }
function closeSidebar() { _el('sidebar').classList.remove('open'); _el('sidebar-overlay').classList.add('hidden'); }

// =============================================
// TOPBAR DATE — tampilkan tanggal operasional
// =============================================
function setTopbarDate() {
  const el = _el('topbar-date');
  if (!el) return;
  const now   = new Date();
  const opStr = getOperasionalDate(now);
  const [y, m, d] = opStr.split('-').map(Number);
  const display = new Date(y, m - 1, d)
    .toLocaleDateString('id-ID', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
  const suffix = now.getHours() < OP_CUTOFF_HOUR ? ' ✦ dini hari' : '';
  el.textContent = display + suffix;
}

// =============================================
// HELPERS
// =============================================
function getTodayStr() { return getOperasionalDate(new Date()); }

function formatRp(num) { return 'Rp ' + (num || 0).toLocaleString('id-ID'); }

function formatTime(ts) {
  if (!ts) return '–';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
}

function formatDateTime(ts) {
  if (!ts) return '–';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('id-ID', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

async function generateNoTransaksi() {
  const opDate  = getTodayStr();
  const range   = opRange(opDate);
  const snap    = await db.collection('transactions')
    .where('createdAt', '>=', range.start)
    .where('createdAt', '<=', range.end)
    .get();
  return 'TRX-' + opDate.replace(/-/g,'') + '-' + String(snap.size + 1).padStart(4,'0');
}

// =============================================
// PRODUCTS — REALTIME LISTENER
// Stok hanya sebagai informasi, TIDAK berkurang saat transaksi
// =============================================
function loadProdukRealtme() {

  if (unsubscribeProduk) {
    unsubscribeProduk();
  }

  unsubscribeProduk = db.collection('products')
    .orderBy('nama')
    .onSnapshot((snap) => {

      allProduk = snap.docs.map(d => ({
        id: d.id,
        ...d.data()
      }));

      renderProdukKasir();
      renderTabelProduk();
      updateKategoriTabs();
      updateKategoriDatalist();

      _setTxt(
        'stat-produk',
        allProduk.filter(p => p.status === 'aktif').length
      );

    }, (err) => {

      console.error('Produk error:', err);

      if (err.code !== 'permission-denied') {
        showToast(
          'Gagal memuat produk: ' + err.message,
          'error'
        );
      }

    });
}
    allProduk = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderProdukKasir();
    renderTabelProduk();
    updateKategoriTabs();
    updateKategoriDatalist();
    _setTxt('stat-produk', allProduk.filter(p => p.status === 'aktif').length);
  }, (err) => {
    console.error('Produk error:', err);
    if (err.code !== 'permission-denied') {
    showToast('Gagal memuat produk: ' + err.message, 'error');
}
  });
}

// =============================================
// DASHBOARD — semua menggunakan tanggal operasional
// =============================================
async function loadDashboard() {
  const opDate = getTodayStr();
  const range  = opRange(opDate);

  // Label LKH
  const [y, m, d] = opDate.split('-').map(Number);
  const dispDate = new Date(y, m-1, d)
    .toLocaleDateString('id-ID', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  _setTxt('lkh-date', dispDate);

  // Dashboard subtitle
  const dashSub = _el('dash-op-label');
  if (dashSub) dashSub.textContent = `Tanggal operasional: ${opDate}`;

  try {
    const snap = await db.collection('transactions')
      .where('createdAt', '>=', range.start)
      .where('createdAt', '<=', range.end)
      .orderBy('createdAt', 'desc')
      .get();

    const trxs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const omzetKotor  = trxs.reduce((s, t) => s + (t.subtotal || t.total || 0), 0);
    const totalDiskon = trxs.reduce((s, t) => s + (t.discountAmount || 0), 0);
    const omzetBersih = trxs.reduce((s, t) => s + (t.grandTotal || t.total || 0), 0);

    _setTxt('stat-omzet', formatRp(omzetBersih));
    _setTxt('stat-trx',   trxs.length);
    _setTxt('lkh-omzet-kotor',  formatRp(omzetKotor));
    _setTxt('lkh-total-diskon', formatRp(totalDiskon));
    _setTxt('lkh-omzet-bersih', formatRp(omzetBersih));

    // Tabel terbaru
    const tbody = _el('tabel-trx-terbaru');
    if (!trxs.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Belum ada transaksi hari ini</td></tr>';
    } else {
      tbody.innerHTML = trxs.slice(0, 5).map(t => `
        <tr>
          <td><code style="font-size:0.78rem;">${t.noTransaksi || '–'}</code></td>
          <td>${formatTime(t.createdAt)}</td>
          <td><span class="badge badge-${metodeBadge(t.metode)}">${capitalize(t.metode || '–')}</span></td>
          <td style="font-weight:700;color:var(--gold)">${formatRp(t.grandTotal || t.total)}</td>
        </tr>`).join('');
    }

    await loadTopProduk(range);
    await loadDashboardPengeluaran(opDate, omzetBersih);

    // Widget shift aktif
    if (shiftData) {
      updateWidgetShiftAktif(omzetBersih, trxs.length);
    }

  } catch (e) {
    console.error('Dashboard error:', e);
    showToast('Gagal memuat dashboard', 'error');
  }
}

async function loadDashboardPengeluaran(opDate, omzetBersih) {
  const range      = opRange(opDate);
  const firstMon   = opDate.substring(0, 7) + '-01';
  const rangeBulan = opRangeMulti(firstMon, opDate);

  try {
    const snapH = await db.collection('expenses')
      .where('createdAt', '>=', range.start)
      .where('createdAt', '<=', range.end).get();
    const totalH = snapH.docs.reduce((s, d) => s + (d.data().totalPrice || 0), 0);

    const snapB = await db.collection('expenses')
      .where('createdAt', '>=', rangeBulan.start)
      .where('createdAt', '<=', rangeBulan.end).get();
    const totalB = snapB.docs.reduce((s, d) => s + (d.data().totalPrice || 0), 0);

    _setTxt('stat-pengeluaran-hari',  formatRp(totalH));
    _setTxt('stat-pengeluaran-bulan', formatRp(totalB));
    _setTxt('lkh-total-pengeluaran',  formatRp(totalH));

    const saldo = omzetBersih - totalH;
    const elSaldo = _el('lkh-saldo-kas');
    if (elSaldo) {
      elSaldo.textContent = formatRp(saldo);
      elSaldo.style.color = saldo >= 0 ? 'var(--gold-light)' : '#ff8080';
    }

    // Pengeluaran per kategori
    const katMap = {};
    snapH.docs.forEach(d => {
      const kat = d.data().category || 'Lainnya';
      katMap[kat] = (katMap[kat] || 0) + (d.data().totalPrice || 0);
    });
    const sorted = Object.entries(katMap).sort((a, b) => b[1] - a[1]);
    const listEl = _el('pengeluaran-per-kategori');
    if (listEl) {
      if (!sorted.length) {
        listEl.innerHTML = '<div class="empty-state">Belum ada pengeluaran hari ini</div>';
      } else {
        const emo = {'Bahan Makanan':'🍚','Bahan Minuman':'🥤','Bahan Gorengan':'🍟','Alat & Operasional':'🔧','Asset':'📦'};
        listEl.innerHTML = sorted.map(([k, v]) => `
          <div class="top-produk-item">
            <div class="top-rank" style="font-size:1rem;width:1.8rem;height:1.8rem;">${emo[k]||'🛒'}</div>
            <div class="top-produk-name">${k}</div>
            <div class="top-produk-qty" style="background:var(--danger);color:#fff">${formatRp(v)}</div>
          </div>`).join('');
      }
    }
  } catch (e) { console.error('Pengeluaran dashboard error:', e); }
}

async function loadTopProduk(range) {
  try {
    const snap = await db.collection('transaction_details')
      .where('createdAt', '>=', range.start)
      .where('createdAt', '<=', range.end).get();

    const qtyMap = {};
    snap.docs.forEach(d => {
      const data = d.data();
      const key  = data.namaProduk || data.produkId;
      qtyMap[key] = (qtyMap[key] || 0) + (data.qty || 0);
    });
    const sorted = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]).slice(0, 5);
    _setTxt('stat-terlaris', sorted.length ? sorted[0][0] : '–');

    const listEl = _el('top-produk-list');
    if (!listEl) return;
    if (!sorted.length) { listEl.innerHTML = '<div class="empty-state">Belum ada data penjualan hari ini</div>'; return; }

    const rc = ['gold','silver','bronze','',''];
    listEl.innerHTML = sorted.map(([nama, qty], i) => `
      <div class="top-produk-item">
        <div class="top-rank ${rc[i]}">${i+1}</div>
        <div class="top-produk-name">${nama}</div>
        <div class="top-produk-qty">${qty}x</div>
      </div>`).join('');
  } catch (e) { console.error('Top produk error:', e); }
}

// =============================================
// KASIR
// PENTING: tidak ada pengurangan stok
// =============================================
function renderProdukKasir() {
  const grid = _el('kasir-produk-grid');
  if (!grid) return;
  let list = allProduk;
  if (filterKat !== 'semua') list = list.filter(p => (p.kategori||'').toLowerCase() === filterKat.toLowerCase());
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p => p.nama.toLowerCase().includes(q) || (p.kategori||'').toLowerCase().includes(q));
  }
  if (!list.length) {
    grid.innerHTML = '<div style="color:var(--text-muted);font-size:0.88rem;grid-column:1/-1;text-align:center;padding:2rem;">Tidak ada produk ditemukan</div>';
    return;
  }
  const em = { makanan:'🍚', minuman:'🥤', camilan:'🍡', rokok:'🚬', lainnya:'🛍️' };
  grid.innerHTML = list.map(p => {
    const emoji    = em[(p.kategori||'').toLowerCase()] || '🍽️';
    const nonaktif = p.status !== 'aktif' ? 'nonaktif' : '';
    return `
      <div class="produk-card ${nonaktif}" onclick="addToKeranjang('${p.id}')" title="${p.nama}">
        <div class="produk-card-emoji">${emoji}</div>
        <div class="produk-card-nama">${p.nama}</div>
        <div class="produk-card-harga">${formatRp(p.harga)}</div>
        <div class="produk-card-stok">Stok: ${p.stok ?? '∞'}</div>
      </div>`;
  }).join('');
}

function updateKategoriTabs() {
  const c = _el('kategori-tabs');
  if (!c) return;
  const set = new Set(allProduk.map(p => p.kategori).filter(Boolean));
  c.innerHTML = `<button class="tab-btn ${filterKat==='semua'?'active':''}" onclick="filterKategori('semua',this)">Semua</button>`;
  set.forEach(k => { c.innerHTML += `<button class="tab-btn ${filterKat===k?'active':''}" onclick="filterKategori('${k}',this)">${k}</button>`; });
}

function filterKategori(kat, btn) {
  filterKat = kat;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderProdukKasir();
}

function filterProdukKasir(val) { searchQuery = val; renderProdukKasir(); }

function addToKeranjang(produkId) {
  const p = allProduk.find(x => x.id === produkId);
  if (!p || p.status !== 'aktif') return;
  // TIDAK ada pengecekan atau pengurangan stok
  const idx = keranjang.findIndex(k => k.produkId === produkId);
  if (idx >= 0) { keranjang[idx].qty++; }
  else { keranjang.push({ produkId:p.id, namaProduk:p.nama, harga:p.harga, qty:1, kategori:p.kategori||'' }); }
  renderKeranjang();
  showToast(`${p.nama} ditambahkan`, 'success');
}

function changeQty(idx, delta) {
  keranjang[idx].qty += delta;
  if (keranjang[idx].qty <= 0) keranjang.splice(idx, 1);
  renderKeranjang();
}

function clearKeranjang() {
  if (!keranjang.length) return;
  keranjang = [];
  renderKeranjang();
  showToast('Keranjang dikosongkan', 'warning');
}

function renderKeranjang() {
  const container = _el('keranjang-items');
  const emptyEl   = _el('empty-keranjang');
  if (!keranjang.length) {
    container.innerHTML = '';
    const el = emptyEl || createEmptyKeranjangEl();
    container.appendChild(el); el.style.display = 'flex';
    hitungTotal(); return;
  }
  if (emptyEl) emptyEl.style.display = 'none';
  let html = '';
  keranjang.forEach((item, i) => {
    html += `
      <div class="keranjang-item">
        <div>
          <div class="ki-nama">${item.namaProduk}</div>
          <div class="ki-harga-satuan">${formatRp(item.harga)} / pcs</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem;">
          <div class="ki-controls">
            <button class="ki-qty-btn kurang" onclick="changeQty(${i},-1)">−</button>
            <span class="ki-qty">${item.qty}</span>
            <button class="ki-qty-btn tambah" onclick="changeQty(${i},1)">+</button>
          </div>
          <div class="ki-subtotal">${formatRp(item.harga*item.qty)}</div>
        </div>
      </div>`;
  });
  container.querySelectorAll('.keranjang-item').forEach(el => el.remove());
  container.insertAdjacentHTML('afterbegin', html);
  hitungTotal();
}

function createEmptyKeranjangEl() {
  const div = document.createElement('div');
  div.className = 'empty-keranjang'; div.id = 'empty-keranjang';
  div.innerHTML = '<div style="font-size:2.5rem">🛒</div><p>Keranjang masih kosong.<br/>Pilih produk untuk memulai.</p>';
  div.style.display = 'flex';
  return div;
}

function hitungTotal() {
  const subtotal = keranjang.reduce((s, k) => s + k.harga*k.qty, 0);
  const { discountAmount } = getDiskonData(subtotal);
  const grandTotal = Math.max(subtotal - discountAmount, 0);
  _setTxt('subtotal-text', formatRp(subtotal));
  const amountRow  = _el('diskon-amount-row');
  const amountText = _el('diskon-amount-text');
  const labelText  = _el('diskon-label-text');
  if (diskonAktif && discountAmount > 0) {
    amountRow?.classList.remove('hidden');
    if (amountText) amountText.textContent = '− ' + formatRp(discountAmount);
    if (labelText) {
      const al = _el('diskon-alasan')?.value;
      labelText.textContent = 'Diskon' + (al ? ` (${al})` : '');
    }
  } else { amountRow?.classList.add('hidden'); }
  _setTxt('total-text', formatRp(grandTotal));
  hitungKembalian();
}

function getDiskonData(subtotal) {
  if (!diskonAktif) return { discountType:'nominal', discountValue:0, discountAmount:0, discountReason:'' };
  const nilaiRaw = parseFloat(_el('diskon-nilai')?.value || 0) || 0;
  const alasan   = _el('diskon-alasan')?.value || '';
  let amt = 0;
  if (diskonType === 'persen') amt = Math.round(subtotal * Math.min(Math.max(nilaiRaw,0),100) / 100);
  else amt = Math.min(Math.max(Math.round(nilaiRaw), 0), subtotal);
  return { discountType:diskonType, discountValue:nilaiRaw, discountAmount:amt, discountReason:alasan };
}

function selectPayment(m, btn) {
  metode = m;
  document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const ts = _el('tunai-section');
  if (ts) ts.style.display = m === 'tunai' ? 'flex' : 'none';
}

function hitungKembalian() {
  if (metode !== 'tunai') return;
  const subtotal = keranjang.reduce((s, k) => s + k.harga*k.qty, 0);
  const { discountAmount } = getDiskonData(subtotal);
  const grand    = Math.max(subtotal - discountAmount, 0);
  const diterima = parseInt(_el('uang-diterima')?.value || 0);
  const kembalian = diterima - grand;
  const el = _el('kembalian-text');
  if (el) {
    el.textContent = formatRp(Math.max(kembalian, 0));
    el.style.color = kembalian < 0 ? 'var(--danger)' : 'var(--success)';
  }
}

function toggleDiskon(checked) {
  diskonAktif = checked;
  const fields = _el('diskon-fields');
  if (fields) {
    if (checked) { fields.classList.remove('hidden'); }
    else { fields.classList.add('hidden'); const n = _el('diskon-nilai'); if (n) n.value = ''; }
  }
  hitungTotal();
}

function setDiskonType(type, btn) {
  diskonType = type;
  document.querySelectorAll('.diskon-type-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  const pre = _el('diskon-prefix'), suf = _el('diskon-suffix'), n = _el('diskon-nilai');
  if (type === 'persen') { pre?.classList.add('hidden'); suf?.classList.remove('hidden'); }
  else { pre?.classList.remove('hidden'); suf?.classList.add('hidden'); }
  if (n) n.value = '';
  hitungTotal();
}

async function prosesTransaksi() {
  if (!keranjang.length) { showToast('Keranjang masih kosong!', 'warning'); return; }

  const subtotal   = keranjang.reduce((s, k) => s + k.harga*k.qty, 0);
  const diskon     = getDiskonData(subtotal);
  const grandTotal = Math.max(subtotal - diskon.discountAmount, 0);

  if (diskonAktif && diskon.discountAmount > 0 && !diskon.discountReason) {
    showToast('Pilih alasan diskon terlebih dahulu!', 'warning'); return;
  }
  if (metode === 'tunai') {
    const diterima = parseInt(_el('uang-diterima')?.value || 0);
    if (diterima < grandTotal) { showToast('Uang diterima kurang dari grand total!', 'error'); return; }
  }

  const btnText  = _el('btn-bayar-text');
  const btnSpin  = _el('btn-bayar-spinner');
  const btnBayar = _el('btn-bayar');
  btnText.classList.add('hidden'); btnSpin.classList.remove('hidden'); btnBayar.disabled = true;

  try {
    const noTransaksi  = await generateNoTransaksi();
    const now          = firebase.firestore.Timestamp.now();
    const opDate       = getTodayStr();          // tanggal OPERASIONAL (bukan kalender)
    const uangDiterima = metode === 'tunai'
      ? parseInt(_el('uang-diterima')?.value || 0)
      : grandTotal;

    const batch  = db.batch();
    const trxRef = db.collection('transactions').doc();

    batch.set(trxRef, {
      noTransaksi, subtotal,
      discountType:   diskon.discountType,
      discountValue:  diskon.discountValue,
      discountAmount: diskon.discountAmount,
      discountReason: diskon.discountReason,
      grandTotal,
      total:      grandTotal,   // backward compat
      metode, uangDiterima,
      kembalian:  metode === 'tunai' ? uangDiterima - grandTotal : 0,
      jumlahItem: keranjang.reduce((s, k) => s + k.qty, 0),
      kasir:      currentUser?.email || 'unknown',
      tanggal:    opDate,            // ← tanggal OPERASIONAL
      shiftId:    shiftData?.id || null,
      createdAt:  now,               // ← timestamp ASLI Firebase (untuk struk)
    });

    // Detail — TIDAK ada pengurangan stok
    keranjang.forEach(item => {
      const ref = db.collection('transaction_details').doc();
      batch.set(ref, {
        transactionId: trxRef.id, noTransaksi,
        produkId: item.produkId, namaProduk: item.namaProduk,
        kategori: item.kategori, harga: item.harga,
        qty: item.qty, subtotal: item.harga * item.qty,
        tanggal: opDate, createdAt: now,
      });
    });

    await batch.commit();

    lastStruk = {
      noTransaksi, items:[...keranjang], subtotal,
      discountAmount: diskon.discountAmount, discountReason: diskon.discountReason,
      grandTotal, metode, uangDiterima,
      kembalian: metode === 'tunai' ? uangDiterima - grandTotal : 0,
      waktuAsli: new Date(),  // waktu ASLI untuk struk
    };

    showStruk(lastStruk);
    showToast('Transaksi berhasil disimpan! ✅', 'success');

  } catch (e) {
    console.error('Transaksi error:', e);
    showToast('Transaksi gagal: ' + e.message, 'error');
  } finally {
    btnText.classList.remove('hidden'); btnSpin.classList.add('hidden'); btnBayar.disabled = false;
  }
}

function showStruk(data) {
  const ml  = { tunai:'💵 Tunai', qris:'📱 QRIS', transfer:'🏦 Transfer' };
  const items = data.items.map(i => `
    <div class="struk-row"><span>${i.namaProduk} x${i.qty}</span><span>${formatRp(i.harga*i.qty)}</span></div>`).join('');
  const diskonRow = data.discountAmount > 0 ? `
    <div class="struk-row"><span>Subtotal</span><span>${formatRp(data.subtotal)}</span></div>
    <div class="struk-row" style="color:#c0392b"><span>Diskon${data.discountReason?' ('+data.discountReason+')':''}</span><span>− ${formatRp(data.discountAmount)}</span></div>
  ` : '';
  const kembalianRow = data.metode === 'tunai' ? `
    <div class="struk-row"><span>Uang Diterima</span><span>${formatRp(data.uangDiterima)}</span></div>
    <div class="struk-row bold"><span>Kembalian</span><span>${formatRp(data.kembalian)}</span></div>
  ` : '';

  // Struk menggunakan waktu ASLI transaksi
  _el('struk-content').innerHTML = `
    <div class="struk-header">
      <div class="struk-title">☕ TIKUM</div>
      <div class="struk-sub" style="font-weight:600;">ANGKRINGAN &amp; COFFEE</div>
      <hr class="struk-divider"/>
      <div class="struk-sub">${data.waktuAsli.toLocaleString('id-ID')}</div>
    </div>
    <hr class="struk-divider"/>
    <div class="struk-row"><span>No. Transaksi</span><span>${data.noTransaksi}</span></div>
    <div class="struk-row"><span>Kasir</span><span>${currentUser?.email?.split('@')[0]||'–'}</span></div>
    <hr class="struk-divider"/>
    ${items}
    <hr class="struk-divider"/>
    ${diskonRow}
    <div class="struk-row big"><span>GRAND TOTAL</span><span>${formatRp(data.grandTotal)}</span></div>
    <div class="struk-row"><span>Pembayaran</span><span>${ml[data.metode]||data.metode}</span></div>
    ${kembalianRow}
    <hr class="struk-divider"/>
    <div class="struk-footer">✨ Matur nuwun ✨<br/>Selamat menikmati!</div>`;
  openModal('modal-struk');
}

function printStruk() {
  const content = _el('struk-content').innerHTML;
  const win = window.open('', '_blank', 'width=400,height=600');
  win.document.write(`<html><head><title>Struk</title>
    <style>body{font-family:'Courier New',monospace;font-size:12px;padding:16px;}
    .struk-row{display:flex;justify-content:space-between;margin:3px 0;}
    .struk-divider{border:none;border-top:1px dashed #ccc;margin:6px 0;}
    .struk-header,.struk-footer{text-align:center;}
    .struk-title{font-size:16px;font-weight:bold;}
    .bold{font-weight:bold;}.big{font-size:14px;font-weight:bold;}</style></head>
    <body>${content}</body></html>`);
  win.document.close(); win.print();
}

function resetKasir() {
  keranjang = []; metode = 'tunai'; diskonAktif = false; diskonType = 'nominal';
  _setVal('uang-diterima', '');
  const dc = _el('diskon-aktif'); if (dc) dc.checked = false;
  _el('diskon-fields')?.classList.add('hidden');
  _setVal('diskon-nilai', '');
  _setVal('diskon-alasan', '');
  setDiskonType('nominal', document.querySelector('.diskon-type-btn[data-type="nominal"]'));
  _el('diskon-amount-row')?.classList.add('hidden');
  selectPayment('tunai', document.querySelector('.pay-btn[data-method="tunai"]'));
  renderKeranjang();
}

// =============================================
// MASTER PRODUK
// Stok = informasi saja, TIDAK pernah berkurang
// =============================================
function renderTabelProduk(filter) {
  const tbody = _el('tabel-produk');
  if (!tbody) return;
  let list = allProduk;
  if (filter) {
    const q = filter.toLowerCase();
    list = list.filter(p => p.nama.toLowerCase().includes(q) || (p.kategori||'').toLowerCase().includes(q));
  }
  if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Tidak ada produk ditemukan</td></tr>'; return; }
  tbody.innerHTML = list.map((p, i) => `
    <tr>
      <td>${i+1}</td>
      <td style="font-weight:500">${p.nama}</td>
      <td><span class="badge badge-warning">${p.kategori||'–'}</span></td>
      <td style="font-weight:600;color:var(--gold)">${formatRp(p.harga)}</td>
      <td style="color:var(--text-muted)">${p.stok ?? 0}</td>
      <td><span class="badge ${p.status==='aktif'?'badge-success':'badge-danger'}">${p.status==='aktif'?'Aktif':'Nonaktif'}</span></td>
      <td>
        <div class="tbl-actions">
          <button class="btn-icon edit" onclick="openModalEditProduk('${p.id}')" title="Edit">✏️</button>
          <button class="btn-icon hapus" onclick="openModalHapus('${p.id}','${p.nama.replace(/'/g,"\\'")}')">🗑️</button>
        </div>
      </td>
    </tr>`).join('');
}

function filterTabelProduk(val) { renderTabelProduk(val); }

function openModalProduk() {
  editProdukId = null;
  _setTxt('modal-produk-title', 'Tambah Produk');
  ['produk-id','produk-nama','produk-kategori','produk-harga','produk-deskripsi'].forEach(id => _setVal(id, ''));
  _setVal('produk-stok', '0'); _setVal('produk-status', 'aktif');
  openModal('modal-produk');
}

function openModalEditProduk(id) {
  const p = allProduk.find(x => x.id === id);
  if (!p) return;
  editProdukId = id;
  _setTxt('modal-produk-title', 'Edit Produk');
  _setVal('produk-id', id); _setVal('produk-nama', p.nama||'');
  _setVal('produk-kategori', p.kategori||''); _setVal('produk-harga', p.harga||'');
  _setVal('produk-stok', p.stok ?? 0); _setVal('produk-deskripsi', p.deskripsi||'');
  _setVal('produk-status', p.status||'aktif');
  openModal('modal-produk');
}

async function simpanProduk() {
  const nama     = _el('produk-nama').value.trim();
  const kategori = _el('produk-kategori').value.trim();
  const harga    = parseInt(_el('produk-harga').value);
  const stok     = parseInt(_el('produk-stok').value) || 0; // hanya disimpan sebagai info
  const deskripsi = _el('produk-deskripsi').value.trim();
  const status   = _el('produk-status').value;

  if (!nama || !kategori || isNaN(harga)) { showToast('Nama, Kategori, dan Harga wajib diisi!', 'error'); return; }

  _el('btn-simpan-text').classList.add('hidden'); _el('btn-simpan-spinner').classList.remove('hidden');
  const data = { nama, kategori, harga, stok, deskripsi, status, updatedAt: firebase.firestore.Timestamp.now() };
  try {
    if (editProdukId) {
      await db.collection('products').doc(editProdukId).update(data);
      showToast('Produk berhasil diperbarui!', 'success');
    } else {
      data.createdAt = firebase.firestore.Timestamp.now();
      await db.collection('products').add(data);
      showToast('Produk berhasil ditambahkan!', 'success');
    }
    closeModal('modal-produk');
  } catch (e) { showToast('Gagal menyimpan produk: ' + e.message, 'error'); }
  finally { _el('btn-simpan-text').classList.remove('hidden'); _el('btn-simpan-spinner').classList.add('hidden'); }
}

function openModalHapus(id, nama) {
  hapusProdukId = id; _setTxt('hapus-produk-nama', nama); openModal('modal-hapus');
}

async function confirmHapusProduk() {
  if (!hapusProdukId) return;
  const btn = _el('btn-hapus-confirm');
  btn.disabled = true; btn.textContent = 'Menghapus...';
  try {
    await db.collection('products').doc(hapusProdukId).delete();
    showToast('Produk berhasil dihapus', 'success'); closeModal('modal-hapus');
  } catch (e) { showToast('Gagal menghapus: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Hapus'; hapusProdukId = null; }
}

function updateKategoriDatalist() {
  const dl = _el('kategori-list'); if (!dl) return;
  const set = new Set(allProduk.map(p => p.kategori).filter(Boolean));
  dl.innerHTML = [...set].map(k => `<option value="${k}">`).join('');
}

// =============================================
// LAPORAN PENJUALAN
// Filter: Tgl Awal – Tgl Akhir, tanggal OPERASIONAL
// =============================================
async function loadLaporan() {
  const awal  = _el('laporan-awal')?.value;
  const akhir = _el('laporan-akhir')?.value;
  if (!awal || !akhir) return;

  // Konversi ke rentang Firestore berdasarkan tanggal operasional
  const range = opRangeMulti(awal, akhir);
  const tbody = _el('tabel-laporan');
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Memuat data...</td></tr>';

  try {
    const snap = await db.collection('transactions')
      .where('createdAt', '>=', range.start)
      .where('createdAt', '<=', range.end)
      .orderBy('createdAt', 'desc')
      .get();

    const trxs = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const omzetKotor  = trxs.reduce((s, t) => s + (t.subtotal || t.total || 0), 0);
    const totalDiskon = trxs.reduce((s, t) => s + (t.discountAmount || 0), 0);
    const omzetBersih = trxs.reduce((s, t) => s + (t.grandTotal || t.total || 0), 0);

    _setTxt('laporan-jml-trx',      trxs.length);
    _setTxt('laporan-omzet-kotor',  formatRp(omzetKotor));
    _setTxt('laporan-total-diskon', formatRp(totalDiskon));
    _setTxt('laporan-omzet',        formatRp(omzetBersih));

    if (!trxs.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Tidak ada transaksi pada rentang tanggal ini</td></tr>'; return;
    }

    tbody.innerHTML = trxs.map(t => {
      const sub       = t.subtotal || t.total || 0;
      const diskonAmt = t.discountAmount || 0;
      const grand     = t.grandTotal || t.total || 0;
      // Tampilkan tanggal OPERASIONAL (field 'tanggal' yang disimpan saat transaksi)
      // Fallback: hitung dari createdAt jika data lama
      const opTgl = t.tanggal || (t.createdAt ? getOperasionalDate(t.createdAt) : '–');
      const dsBadge = diskonAmt > 0
        ? `<span style="color:var(--danger);font-weight:600;">− ${formatRp(diskonAmt)}</span>`
        : `<span style="color:var(--text-muted);font-size:0.78rem;">–</span>`;
      return `
        <tr>
          <td><code style="font-size:0.78rem">${t.noTransaksi||'–'}</code></td>
          <td style="font-size:0.82rem;white-space:nowrap">${opTgl}</td>
          <td>${formatTime(t.createdAt)}</td>
          <td>${t.jumlahItem||0} item</td>
          <td><span class="badge badge-${metodeBadge(t.metode)}">${capitalize(t.metode||'–')}</span></td>
          <td style="color:var(--text-secondary)">${formatRp(sub)}</td>
          <td>${dsBadge}</td>
          <td style="font-weight:700;color:var(--gold)">${formatRp(grand)}</td>
          <td><button class="btn-detail" onclick="lihatDetailTrx('${t.id}','${t.noTransaksi||''}')">Detail</button></td>
        </tr>`;
    }).join('');

  } catch (e) {
    console.error('Laporan error:', e);
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Gagal memuat data</td></tr>';
    showToast('Gagal memuat laporan: ' + e.message, 'error');
  }
}

async function lihatDetailTrx(trxId, noTransaksi) {
  const contentEl = _el('detail-trx-content');
  contentEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);">Memuat...</p>';
  openModal('modal-detail-trx');
  try {
    const snap    = await db.collection('transaction_details').where('transactionId','==',trxId).get();
    const items   = snap.docs.map(d => d.data());
    const trxDoc  = await db.collection('transactions').doc(trxId).get();
    const td      = trxDoc.data() || {};
    const subtotal     = td.subtotal || items.reduce((s,i) => s+i.subtotal, 0);
    const discountAmt  = td.discountAmount || 0;
    const grandTotal   = td.grandTotal || td.total || 0;
    const opDate       = td.tanggal || (td.createdAt ? getOperasionalDate(td.createdAt) : '–');

    const diskonBlock = discountAmt > 0 ? `
      <div class="detail-trx-item" style="color:var(--text-secondary)">
        <span>Subtotal</span><span>${formatRp(subtotal)}</span>
      </div>
      <div class="detail-trx-item" style="color:var(--danger)">
        <span>Diskon${td.discountReason?' ('+td.discountReason+')':''}
          <small style="display:block;opacity:0.7">${td.discountType==='persen'?td.discountValue+'%':'Nominal'}</small>
        </span>
        <span>− ${formatRp(discountAmt)}</span>
      </div>` : '';

    contentEl.innerHTML = `
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.3rem;">No: <strong>${noTransaksi}</strong></p>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.3rem;">Tgl Operasional: <strong>${opDate}</strong></p>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.3rem;">Waktu Asli: ${formatDateTime(td.createdAt)}</p>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1rem;">Kasir: ${td.kasir||'–'}</p>
      ${items.map(i => `
        <div class="detail-trx-item">
          <span>${i.namaProduk} <small style="color:var(--text-muted)">x${i.qty}</small></span>
          <span style="font-weight:600">${formatRp(i.subtotal)}</span>
        </div>`).join('')}
      ${diskonBlock}
      <div class="detail-trx-total">
        <span>Grand Total</span>
        <span style="color:var(--gold)">${formatRp(grandTotal)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:0.5rem;font-size:0.83rem;color:var(--text-muted);">
        <span>Metode: ${capitalize(td.metode||'–')}</span>
        ${td.metode==='tunai'?`<span>Kembalian: ${formatRp(td.kembalian)}</span>`:''}
      </div>`;
  } catch (e) {
    contentEl.innerHTML = `<p style="color:var(--danger)">Gagal memuat detail: ${e.message}</p>`;
  }
}

// =============================================
// REPORT PRODUK TERJUAL
// =============================================
async function loadReportProduk() {
  const awal  = _el('rp-awal')?.value;
  const akhir = _el('rp-akhir')?.value;
  if (!awal || !akhir) return;

  const range = opRangeMulti(awal, akhir);
  const tbody = _el('tabel-report-produk');
  tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Memuat data...</td></tr>';

  try {
    const snap = await db.collection('transaction_details')
      .where('createdAt', '>=', range.start)
      .where('createdAt', '<=', range.end)
      .get();

    // Agregasi per produk
    const pMap = {};
    snap.docs.forEach(d => {
      const data = d.data();
      const key  = data.namaProduk || data.produkId;
      if (!pMap[key]) pMap[key] = { nama:key, kategori:data.kategori||'–', qty:0, omzet:0 };
      pMap[key].qty   += (data.qty || 0);
      pMap[key].omzet += (data.subtotal || 0);
    });

    const list = Object.values(pMap).sort((a, b) => b.qty - a.qty);
    const totalQty   = list.reduce((s, p) => s + p.qty, 0);
    const totalOmzet = list.reduce((s, p) => s + p.omzet, 0);

    _setTxt('rp-total-qty',   totalQty);
    _setTxt('rp-total-omzet', formatRp(totalOmzet));

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Tidak ada data pada rentang tanggal ini</td></tr>'; return;
    }

    const rc = ['gold','silver','bronze'];
    tbody.innerHTML = list.map((p, i) => `
      <tr>
        <td><span class="rp-rank-badge ${rc[i]||''}">${i+1}</span></td>
        <td style="font-weight:500">${p.nama}</td>
        <td><span class="badge badge-warning">${p.kategori}</span></td>
        <td style="text-align:center"><span class="rp-qty-badge">${p.qty}x</span></td>
        <td style="font-weight:700;color:var(--gold)">${formatRp(p.omzet)}</td>
      </tr>`).join('');

  } catch (e) {
    console.error('Report produk error:', e);
    tbody.innerHTML = '<tr><td colspan="5" class="empty-state">Gagal memuat data</td></tr>';
    showToast('Gagal memuat report produk: ' + e.message, 'error');
  }
}

// =============================================
// BELANJA & PENGELUARAN
// =============================================
function hitungTotalPengeluaran() {
  const qty   = parseFloat(_el('p-qty')?.value || 0) || 0;
  const harga = parseFloat(_el('p-harga-satuan')?.value || 0) || 0;
  const total = Math.round(qty * harga);
  const el  = _el('p-total-display');
  const inp = _el('p-total-harga');
  if (el)  el.textContent = formatRp(total);
  if (inp) inp.value      = total;
}

async function simpanPengeluaran() {
  const tanggal    = _el('p-tanggal')?.value;
  const kategori   = _el('p-kategori')?.value;
  const item       = _el('p-item')?.value.trim();
  const qty        = parseFloat(_el('p-qty')?.value || 0);
  const satuan     = _el('p-satuan')?.value;
  const hargaSat   = parseFloat(_el('p-harga-satuan')?.value || 0);
  const totalHarga = Math.round(qty * hargaSat);
  const keterangan = _el('p-keterangan')?.value.trim();

  if (!tanggal || !kategori || !item || qty <= 0 || hargaSat <= 0) {
    showToast('Tanggal, Kategori, Item, Qty, dan Harga Satuan wajib diisi!', 'error'); return;
  }

  const btnT = _el('btn-sp-text'); const btnS = _el('btn-sp-spinner');
  btnT.classList.add('hidden'); btnS.classList.remove('hidden');

  const data = {
    transactionDate: tanggal, category: kategori, item, qty,
    unit: satuan, unitPrice: hargaSat, totalPrice: totalHarga,
    notes: keterangan, updatedAt: firebase.firestore.Timestamp.now(),
  };

  try {
    if (editPengeluaranId) {
      await db.collection('expenses').doc(editPengeluaranId).update(data);
      showToast('Pengeluaran berhasil diperbarui!', 'success');
      batalEditPengeluaran();
    } else {
      data.createdAt = firebase.firestore.Timestamp.now();
      await db.collection('expenses').add(data);
      showToast('Pengeluaran berhasil disimpan!', 'success');
      resetFormPengeluaran();
    }
    loadPengeluaran(); loadDashboard();
  } catch (e) { showToast('Gagal menyimpan: ' + e.message, 'error'); }
  finally { btnT.classList.remove('hidden'); btnS.classList.add('hidden'); }
}

function resetFormPengeluaran() {
  _setVal('pengeluaran-edit-id', ''); _setVal('p-tanggal', getTodayStr());
  _setVal('p-kategori', '');  _setVal('p-item', '');
  _setVal('p-qty', '');       _setVal('p-satuan', 'Kg');
  _setVal('p-harga-satuan',''); _setVal('p-total-harga', '0');
  _setVal('p-keterangan', '');
  const el = _el('p-total-display'); if (el) el.textContent = 'Rp 0';
}

function batalEditPengeluaran() {
  editPengeluaranId = null;
  _setTxt('form-pengeluaran-title', '➕ Tambah Pengeluaran');
  const t = _el('btn-sp-text'); if (t) t.textContent = '💾 Simpan Pengeluaran';
  _el('btn-batal-edit-pengeluaran')?.classList.add('hidden');
  resetFormPengeluaran();
}

async function loadPengeluaranById(id) {
  try {
    const doc = await db.collection('expenses').doc(id).get();
    if (!doc.exists) return;
    isiFormEditPengeluaran(id, doc.data());
  } catch (e) { showToast('Gagal memuat data: ' + e.message, 'error'); }
}

function isiFormEditPengeluaran(id, data) {
  editPengeluaranId = id;
  _setVal('pengeluaran-edit-id', id);
  _setVal('p-tanggal', data.transactionDate || getTodayStr());
  _setVal('p-kategori', data.category || '');
  _setVal('p-item', data.item || '');
  _setVal('p-qty', data.qty || '');
  _setVal('p-satuan', data.unit || 'Pcs');
  _setVal('p-harga-satuan', data.unitPrice || '');
  _setVal('p-keterangan', data.notes || '');
  hitungTotalPengeluaran();
  _setTxt('form-pengeluaran-title', '✏️ Edit Pengeluaran');
  const t = _el('btn-sp-text'); if (t) t.textContent = '💾 Update Pengeluaran';
  _el('btn-batal-edit-pengeluaran')?.classList.remove('hidden');
  _el('form-pengeluaran-title')?.scrollIntoView({ behavior:'smooth', block:'start' });
}

function openModalHapusPengeluaran(id, nama) {
  hapusPengeluaranId = id;
  _setTxt('hapus-pengeluaran-nama', nama);
  openModal('modal-hapus-pengeluaran');
}

async function confirmHapusPengeluaran() {
  if (!hapusPengeluaranId) return;
  const btn = _el('btn-hapus-pengeluaran-confirm');
  btn.disabled = true; btn.textContent = 'Menghapus...';
  try {
    await db.collection('expenses').doc(hapusPengeluaranId).delete();
    showToast('Pengeluaran berhasil dihapus', 'success');
    closeModal('modal-hapus-pengeluaran');
    loadPengeluaran(); loadDashboard();
  } catch (e) { showToast('Gagal menghapus: ' + e.message, 'error'); }
  finally { btn.disabled = false; btn.textContent = 'Hapus'; hapusPengeluaranId = null; }
}

async function loadPengeluaran() {
  const awal    = _el('filter-p-awal')?.value;
  const akhir   = _el('filter-p-akhir')?.value;
  const katP    = _el('filter-p-kategori')?.value;
  const tbody   = _el('tabel-pengeluaran');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Memuat data...</td></tr>';

  try {
    let q = db.collection('expenses').orderBy('transactionDate','desc').orderBy('createdAt','desc');
    if (awal)  q = q.where('transactionDate', '>=', awal);
    if (akhir) q = q.where('transactionDate', '<=', akhir);
    const snap = await q.get();
    let list = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    if (katP) list = list.filter(e => e.category === katP);

    const totalF = list.reduce((s, e) => s + (e.totalPrice||0), 0);
    _setTxt('p-total-terfilter', formatRp(totalF));

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Tidak ada data pengeluaran pada periode ini</td></tr>'; return;
    }

    const katC = { 'Bahan Makanan':'#e67e22','Bahan Minuman':'#2980b9','Bahan Gorengan':'#8e44ad','Alat & Operasional':'#16a085','Asset':'#c0392b' };
    tbody.innerHTML = list.map(e => {
      const c = katC[e.category] || '#7f8c8d';
      const safe = (e.item||'').replace(/'/g,"\\'");
      return `
        <tr data-pengeluaran-id="${e.id}">
          <td style="white-space:nowrap">${e.transactionDate||'–'}</td>
          <td><span class="badge" style="background:${c}20;color:${c};border:1px solid ${c}40">${e.category||'–'}</span></td>
          <td style="font-weight:500">${e.item||'–'}</td>
          <td>${e.qty??'–'}</td>
          <td>${e.unit||'–'}</td>
          <td>${formatRp(e.unitPrice)}</td>
          <td style="font-weight:700;color:var(--danger)">${formatRp(e.totalPrice)}</td>
          <td style="font-size:0.82rem;color:var(--text-muted)">${e.notes||'–'}</td>
          <td>
            <div class="tbl-actions">
              <button class="btn-icon edit" onclick="loadPengeluaranById('${e.id}')" title="Edit">✏️</button>
              <button class="btn-icon hapus" onclick="openModalHapusPengeluaran('${e.id}','${safe}')">🗑️</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  } catch (e) {
    console.error('Pengeluaran error:', e);
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Gagal memuat data</td></tr>';
    showToast('Gagal memuat pengeluaran: ' + e.message, 'error');
  }
}

// =============================================
// SISTEM SHIFT
// Struktur Firestore: shift_sessions
// { kasir, kasirEmail, openingCash, notes, status,
//   openTime(Ts), closeTime(Ts),
//   totalTrx, omzetShift, diskonShift, pengeluaranShift,
//   saldoTeoritis, kasAktual, selisih }
// =============================================
async function checkShiftAktif() {
  try {
    const snap = await db.collection('shift_sessions')
      .where('status','==','open')
      .orderBy('openTime','desc')
      .limit(1).get();

    if (!snap.empty) {
      shiftData = { id: snap.docs[0].id, ...snap.docs[0].data() };
      updateShiftBadge(true);
    } else {
      shiftData = null;
      updateShiftBadge(false);
    }
  } catch (e) { console.error('checkShiftAktif error:', e); }
}

function updateShiftBadge(aktif) {
  // Sidebar banner
  const banner = _el('shift-sidebar-banner');
  if (banner) {
    if (aktif && shiftData) {
      banner.classList.remove('hidden');
      _setTxt('shift-banner-kasir', shiftData.kasir || shiftData.kasirEmail || '–');
    } else { banner.classList.add('hidden'); }
  }

  // Topbar pill
  const pill = _el('shift-topbar-pill');
  if (pill) {
    if (aktif) {
      pill.textContent = '🟢 Shift Aktif';
      pill.className   = 'shift-status-pill';
      pill.classList.remove('hidden');
    } else {
      pill.classList.add('hidden');
    }
  }

  // Widget dashboard
  const widget = _el('widget-shift-aktif');
  if (widget) {
    if (aktif && shiftData) {
      widget.classList.remove('hidden');
      _setTxt('wsa-meta', `${shiftData.kasir||shiftData.kasirEmail||'–'} · Buka: ${formatDateTime(shiftData.openTime)}`);
      _setTxt('wsa-modal', formatRp(shiftData.openingCash || 0));
    } else { widget.classList.add('hidden'); }
  }
}

function updateWidgetShiftAktif(omzet, trx) {
  _setTxt('wsa-omzet', formatRp(omzet));
  _setTxt('wsa-trx',   trx);
}

// ---- Halaman Shift ----
function renderShiftPage() {
  const kosong = _el('shift-panel-kosong');
  const aktif  = _el('shift-panel-aktif');
  if (shiftData) {
    kosong?.classList.add('hidden');
    aktif?.classList.remove('hidden');
    renderShiftAktifInfo();
    loadShiftStats();
  } else {
    aktif?.classList.add('hidden');
    kosong?.classList.remove('hidden');
  }
}

function renderShiftAktifInfo() {
  const grid = _el('shift-aktif-info-grid');
  if (!grid || !shiftData) return;
  grid.innerHTML = `
    <div class="sai-item"><span>Kasir</span><strong>${shiftData.kasir||shiftData.kasirEmail||'–'}</strong></div>
    <div class="sai-item"><span>Jam Buka</span><strong>${formatDateTime(shiftData.openTime)}</strong></div>
    <div class="sai-item"><span>Modal Awal</span><strong>${formatRp(shiftData.openingCash||0)}</strong></div>
    ${shiftData.notes?`<div class="sai-item"><span>Catatan</span><strong>${shiftData.notes}</strong></div>`:''}`;
}

async function loadShiftStats() {
  if (!shiftData) return;
  const openTs = shiftData.openTime;
  const nowTs  = firebase.firestore.Timestamp.now();
  try {
    // Transaksi dalam shift
    const snapT = await db.collection('transactions')
      .where('createdAt', '>=', openTs)
      .where('createdAt', '<=', nowTs)
      .where('shiftId', '==', shiftData.id)
      .get();
    const trxs      = snapT.docs.map(d => d.data());
    const omzet     = trxs.reduce((s, t) => s + (t.grandTotal||t.total||0), 0);
    const diskon    = trxs.reduce((s, t) => s + (t.discountAmount||0), 0);
    const omzetTunai = trxs.filter(t => t.metode==='tunai')
                           .reduce((s, t) => s + (t.grandTotal||t.total||0), 0);

    // Pengeluaran dalam shift
    const snapE = await db.collection('expenses')
      .where('createdAt', '>=', openTs)
      .where('createdAt', '<=', nowTs).get();
    const pengeluaran = snapE.docs.reduce((s, d) => s + (d.data().totalPrice||0), 0);

    // Saldo teoritis = modal + penjualan tunai - pengeluaran
    shiftSaldoTeoritis = (shiftData.openingCash||0) + omzetTunai - pengeluaran;

    _setTxt('sas-trx',         trxs.length);
    _setTxt('sas-omzet',       formatRp(omzet));
    _setTxt('sas-diskon',      formatRp(diskon));
    _setTxt('sas-pengeluaran', formatRp(pengeluaran));
    _setTxt('sas-saldo',       formatRp(shiftSaldoTeoritis));

    // Update widget dashboard
    updateWidgetShiftAktif(omzet, trxs.length);
  } catch (e) { console.error('loadShiftStats error:', e); }
}

function openModalBukaShift() {
  _setVal('buka-kasir', currentUser?.email?.split('@')[0] || '');
  _setVal('buka-modal', '');
  _setVal('buka-catatan', '');
  openModal('modal-buka-shift');
}

async function konfirmasiBukaShift() {
  const kasir    = _el('buka-kasir')?.value.trim() || currentUser?.email || 'unknown';
  const modalAwal = parseInt(_el('buka-modal')?.value || 0);
  const catatan   = _el('buka-catatan')?.value.trim() || '';

  if (isNaN(modalAwal) || modalAwal < 0) { showToast('Modal awal tidak valid!', 'error'); return; }

  const btnT = _el('buka-shift-text'); const btnS = _el('buka-shift-spin');
  btnT.classList.add('hidden'); btnS.classList.remove('hidden');
  try {
    const now = firebase.firestore.Timestamp.now();
    const ref = await db.collection('shift_sessions').add({
      kasir, kasirEmail: currentUser?.email || '',
      openingCash: modalAwal, notes: catatan,
      status: 'open', openTime: now, createdAt: now,
    });
    shiftData = { id: ref.id, kasir, kasirEmail: currentUser?.email||'', openingCash: modalAwal, notes: catatan, openTime: now, status: 'open' };
    updateShiftBadge(true);
    closeModal('modal-buka-shift');
    renderShiftPage();
    showToast('Shift berhasil dibuka! 🔓', 'success');
  } catch (e) { showToast('Gagal membuka shift: ' + e.message, 'error'); }
  finally { btnT.classList.remove('hidden'); btnS.classList.add('hidden'); }
}

async function openModalTutupShift() {
  if (!shiftData) return;
  await loadShiftStats();

  // Isi summary
  const summary = _el('tutup-shift-summary');
  if (summary) {
    const sasOmzet = _el('sas-omzet')?.textContent || 'Rp 0';
    const sasDiskon = _el('sas-diskon')?.textContent || 'Rp 0';
    const sasPengeluaran = _el('sas-pengeluaran')?.textContent || 'Rp 0';
    const sasTrx = _el('sas-trx')?.textContent || '0';
    summary.innerHTML = `
      <div class="ssrow"><span>Kasir</span><span>${shiftData.kasir||'–'}</span></div>
      <div class="ssrow"><span>Jam Buka</span><span>${formatDateTime(shiftData.openTime)}</span></div>
      <div class="ssrow"><span>Modal Awal</span><span>${formatRp(shiftData.openingCash||0)}</span></div>
      <div class="ssrow"><span>Total Transaksi</span><span>${sasTrx} transaksi</span></div>
      <div class="ssrow"><span>Omzet</span><span>${sasOmzet}</span></div>
      <div class="ssrow"><span>Diskon</span><span>${sasDiskon}</span></div>
      <div class="ssrow"><span>Pengeluaran</span><span>${sasPengeluaran}</span></div>
      <div class="ssrow total"><span>Saldo Teoritis</span><span>${formatRp(shiftSaldoTeoritis)}</span></div>`;
  }
  _setTxt('tutup-saldo-teoritis', formatRp(shiftSaldoTeoritis));
  _setVal('tutup-kas-aktual', '');
  _setTxt('tutup-kas-display', 'Rp 0');
  _setTxt('tutup-selisih', 'Rp 0');
  openModal('modal-tutup-shift');
}

function hitungSelisihTutup() {
  const kasAktual = parseInt(_el('tutup-kas-aktual')?.value || 0);
  const selisih   = kasAktual - shiftSaldoTeoritis;
  _setTxt('tutup-kas-display', formatRp(kasAktual));
  const el = _el('tutup-selisih');
  if (el) {
    el.textContent = (selisih >= 0 ? '+' : '') + formatRp(selisih);
    el.style.color = selisih >= 0 ? 'var(--success)' : 'var(--danger)';
  }
}

async function konfirmasiTutupShift() {
  if (!shiftData) return;
  const kasAktual = parseInt(_el('tutup-kas-aktual')?.value || 0);

  const btnT = _el('tutup-shift-text'); const btnS = _el('tutup-shift-spin');
  btnT.classList.add('hidden'); btnS.classList.remove('hidden');

  try {
    const nowTs    = firebase.firestore.Timestamp.now();
    const sasT     = parseInt(_el('sas-trx')?.textContent || 0) || 0;
    const sasO     = shiftSaldoTeoritis;   // sudah dihitung di loadShiftStats
    const sasD     = parseInt((_el('sas-diskon')?.textContent||'0').replace(/\D/g,'')) || 0;
    const sasP     = parseInt((_el('sas-pengeluaran')?.textContent||'0').replace(/\D/g,'')) || 0;

    await db.collection('shift_sessions').doc(shiftData.id).update({
      status:          'closed',
      closeTime:       nowTs,
      totalTrx:        sasT,
      diskonShift:     sasD,
      pengeluaranShift: sasP,
      saldoTeoritis:   shiftSaldoTeoritis,
      kasAktual:       kasAktual,
      selisih:         kasAktual - shiftSaldoTeoritis,
      updatedAt:       nowTs,
    });

    shiftData = null; shiftSaldoTeoritis = 0;
    updateShiftBadge(false);
    closeModal('modal-tutup-shift');
    renderShiftPage();
    showToast('Shift berhasil ditutup! 🔒', 'success');
  } catch (e) { showToast('Gagal menutup shift: ' + e.message, 'error'); }
  finally { btnT.classList.remove('hidden'); btnS.classList.add('hidden'); }
}

// =============================================
// LAPORAN SHIFT
// =============================================
async function loadLaporanShift() {
  const awal  = _el('ls-awal')?.value;
  const akhir = _el('ls-akhir')?.value;
  const kasir = (_el('ls-kasir')?.value || '').toLowerCase().trim();
  const tbody = _el('tabel-laporan-shift');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="11" class="empty-state">Memuat data...</td></tr>';

  try {
    let q = db.collection('shift_sessions').orderBy('openTime', 'desc');
    if (awal)  q = q.where('openTime', '>=', firebase.firestore.Timestamp.fromDate(new Date(awal  + 'T00:00:00')));
    if (akhir) q = q.where('openTime', '<=', firebase.firestore.Timestamp.fromDate(new Date(akhir + 'T23:59:59')));

    const snap = await q.get();
    let list = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    if (kasir) list = list.filter(s => (s.kasir||'').toLowerCase().includes(kasir) || (s.kasirEmail||'').toLowerCase().includes(kasir));

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="11" class="empty-state">Tidak ada data shift pada periode ini</td></tr>'; return;
    }

    tbody.innerHTML = list.map(s => {
      const selisih   = s.selisih ?? null;
      const selClass  = selisih === null ? '' : (selisih >= 0 ? 'selisih-pos' : 'selisih-neg');
      const selLabel  = selisih === null ? '–' : ((selisih >= 0 ? '+' : '') + formatRp(selisih));
      const statusBdg = s.status === 'open'
        ? '<span class="badge badge-success">Aktif</span>'
        : '<span class="badge">Tutup</span>';
      return `
        <tr>
          <td style="font-weight:500">${s.kasir||s.kasirEmail||'–'}</td>
          <td style="white-space:nowrap;font-size:0.8rem">${formatDateTime(s.openTime)}</td>
          <td style="white-space:nowrap;font-size:0.8rem">${s.closeTime?formatDateTime(s.closeTime):'–'}</td>
          <td>${formatRp(s.openingCash||0)}</td>
          <td style="font-weight:600;color:var(--gold)">${formatRp(s.omzetShift||0)}</td>
          <td style="color:var(--danger)">${formatRp(s.diskonShift||0)}</td>
          <td>${formatRp(s.pengeluaranShift||0)}</td>
          <td>${formatRp(s.saldoTeoritis||0)}</td>
          <td>${s.kasAktual!=null?formatRp(s.kasAktual):'–'}</td>
          <td class="${selClass}">${selLabel}</td>
          <td>${statusBdg}</td>
        </tr>`;
    }).join('');
  } catch (e) {
    console.error('Laporan shift error:', e);
    tbody.innerHTML = '<tr><td colspan="11" class="empty-state">Gagal memuat data</td></tr>';
    showToast('Gagal memuat laporan shift: ' + e.message, 'error');
  }
}

// =============================================
// MODAL HELPERS
// =============================================
function openModal(id) {
  const el = _el(id); if (el) { el.classList.remove('hidden'); el.style.display = 'flex'; }
}
function closeModal(id) {
  const el = _el(id); if (el) { el.classList.add('hidden'); el.style.display = ''; }
}
function closeModalIfOutside(event, id) { if (event.target.id === id) closeModal(id); }

// =============================================
// TOAST
// =============================================
function showToast(msg, type = 'info') {
  const container = _el('toast-container');
  if (!container) return;
  const icons = { success:'✅', error:'❌', warning:'⚠️', info:'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type]||'ℹ️'}</span> ${msg}`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}

// =============================================
// UTILITY
// =============================================
function capitalize(str) { return str ? str.charAt(0).toUpperCase() + str.slice(1) : ''; }
function metodeBadge(m)  { return { tunai:'success', qris:'warning', transfer:'warning' }[m] || 'warning'; }

// Enter key on login
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const lp = _el('page-login');
    if (lp && lp.classList.contains('active')) doLogin();
  }
});
