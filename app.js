/* ================================================
   ANGKRINGAN POS — App Logic
   ================================================ */

'use strict';

// =============================================
// STATE
// =============================================
let currentUser   = null;
let allProduk     = [];        // cached products from Firestore
let keranjang     = [];        // active cart items
let metode        = 'tunai';   // active payment method
let filterKat     = 'semua';   // active category filter in kasir
let searchQuery   = '';        // kasir search string
let editProdukId  = null;      // product being edited (null = new)
let hapusProdukId = null;      // product id pending deletion
let lastStruk     = null;      // last receipt data for printing

// Diskon state
let diskonAktif   = false;     // apakah diskon diaktifkan
let diskonType    = 'nominal'; // 'nominal' | 'persen'

// Pengeluaran state
let hapusPengeluaranId = null; // id pengeluaran pending deletion
let editPengeluaranId  = null; // id pengeluaran being edited

// =============================================
// INIT
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  setTopbarDate();

  // Set default laporan date to today
  const inputDate = document.getElementById('laporan-tanggal');
  if (inputDate) inputDate.value = getTodayStr();

  // Set default pengeluaran form date to today
  const pTanggal = document.getElementById('p-tanggal');
  if (pTanggal) pTanggal.value = getTodayStr();

  // Set default pengeluaran filter to this month
  const today = getTodayStr();
  const firstOfMonth = today.substring(0, 7) + '-01';
  const filterAwal  = document.getElementById('filter-p-awal');
  const filterAkhir = document.getElementById('filter-p-akhir');
  if (filterAwal)  filterAwal.value  = firstOfMonth;
  if (filterAkhir) filterAkhir.value = today;

  // Auth state listener
  auth.onAuthStateChanged((user) => {
    if (user) {
      currentUser = user;
      document.getElementById('sidebar-user-email').textContent = user.email;
      showApp();
      loadDashboard();
      loadProdukRealtme();
    } else {
      currentUser = null;
      showLogin();
    }
  });
});

// =============================================
// AUTH
// =============================================
async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btnText  = document.getElementById('btn-login-text');
  const btnSpin  = document.getElementById('btn-login-spinner');

  errEl.classList.add('hidden');
  if (!email || !password) {
    showError(errEl, 'Email dan password wajib diisi.');
    return;
  }

  btnText.classList.add('hidden');
  btnSpin.classList.remove('hidden');

  try {
    await auth.signInWithEmailAndPassword(email, password);
  } catch (e) {
    showError(errEl, mapAuthError(e.code));
  } finally {
    btnText.classList.remove('hidden');
    btnSpin.classList.add('hidden');
  }
}

async function doLogout() {
  try {
    await auth.signOut();
    keranjang = [];
  } catch (e) {
    showToast('Gagal logout: ' + e.message, 'error');
  }
}

function mapAuthError(code) {
  const map = {
    'auth/user-not-found':  'Email tidak terdaftar.',
    'auth/wrong-password':  'Password salah.',
    'auth/invalid-email':   'Format email tidak valid.',
    'auth/too-many-requests':'Terlalu banyak percobaan. Coba lagi nanti.',
    'auth/network-request-failed': 'Koneksi gagal. Periksa internet Anda.',
  };
  return map[code] || 'Login gagal. Silakan coba lagi.';
}

function showError(el, msg) {
  el.textContent = msg;
  el.classList.remove('hidden');
}

function togglePassword() {
  const inp = document.getElementById('login-password');
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

// =============================================
// PAGE NAVIGATION
// =============================================
function showApp() {
  document.getElementById('page-login').classList.remove('active');
  document.getElementById('page-login').classList.add('hidden');
  document.getElementById('page-app').classList.remove('hidden');
  document.getElementById('page-app').classList.add('active');
}

function showLogin() {
  document.getElementById('page-app').classList.remove('active');
  document.getElementById('page-app').classList.add('hidden');
  document.getElementById('page-login').classList.remove('hidden');
  document.getElementById('page-login').classList.add('active');
}

function navigateTo(page, linkEl) {
  // Hide all sections
  document.querySelectorAll('.content-section').forEach(s => {
    s.classList.remove('active');
    s.classList.add('hidden');
  });

  // Show target
  const target = document.getElementById('section-' + page);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
  }

  // Update nav active
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  if (linkEl) linkEl.classList.add('active');

  // Update topbar title
  const titles = { dashboard: 'Dashboard', kasir: 'Kasir', produk: 'Master Produk', laporan: 'Laporan Harian', pengeluaran: 'Belanja & Pengeluaran' };
  document.getElementById('topbar-title').textContent = titles[page] || page;

  // Trigger page-specific load
  if (page === 'dashboard')   loadDashboard();
  if (page === 'kasir')       renderProdukKasir();
  if (page === 'produk')      renderTabelProduk();
  if (page === 'laporan')     loadLaporan();
  if (page === 'pengeluaran') loadPengeluaran();

  closeSidebar();
}

// =============================================
// SIDEBAR MOBILE
// =============================================
function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebar-overlay').classList.remove('hidden');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.add('hidden');
}

// =============================================
// TOPBAR DATE
// =============================================
function setTopbarDate() {
  const el = document.getElementById('topbar-date');
  if (!el) return;
  const now = new Date();
  const opts = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
  el.textContent = now.toLocaleDateString('id-ID', opts);
}

// =============================================
// FIRESTORE HELPERS
// =============================================
function getTodayStr() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function formatRp(num) {
  return 'Rp ' + (num || 0).toLocaleString('id-ID');
}

function formatTime(ts) {
  if (!ts) return '–';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(ts) {
  if (!ts) return '–';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function getStartOfDay(dateStr) {
  const [y, m, dd] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, dd, 0, 0, 0);
}

function getEndOfDay(dateStr) {
  const [y, m, dd] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, dd, 23, 59, 59);
}

// Generate transaction number: TRX-YYYYMMDD-XXXX
async function generateNoTransaksi() {
  const today    = getTodayStr().replace(/-/g, '');
  const prefix   = `TRX-${today}-`;
  const snap     = await db.collection('transactions')
    .where('tanggal', '==', getTodayStr())
    .get();
  const seq      = String(snap.size + 1).padStart(4, '0');
  return prefix + seq;
}

// =============================================
// PRODUCTS — REALTIME LISTENER
// =============================================
function loadProdukRealtme() {
  db.collection('products')
    .orderBy('nama')
    .onSnapshot((snap) => {
      allProduk = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      // Update UI if relevant sections are open
      renderProdukKasir();
      renderTabelProduk();
      updateKategoriTabs();
      updateKategoriDatalist();
      updateStatProduk();
    }, (err) => {
      console.error('Error loading products:', err);
      showToast('Gagal memuat produk: ' + err.message, 'error');
    });
}

function updateStatProduk() {
  const el = document.getElementById('stat-produk');
  if (el) el.textContent = allProduk.filter(p => p.status === 'aktif').length;
}

// =============================================
// DASHBOARD
// =============================================
async function loadDashboard() {
  const today     = getTodayStr();
  const startDay  = firebase.firestore.Timestamp.fromDate(getStartOfDay(today));
  const endDay    = firebase.firestore.Timestamp.fromDate(getEndOfDay(today));

  // Set LKH date label
  const lkhDate = document.getElementById('lkh-date');
  if (lkhDate) {
    lkhDate.textContent = new Date().toLocaleDateString('id-ID', { weekday:'long', day:'2-digit', month:'long', year:'numeric' });
  }

  try {
    const snap = await db.collection('transactions')
      .where('createdAt', '>=', startDay)
      .where('createdAt', '<=', endDay)
      .orderBy('createdAt', 'desc')
      .get();

    const transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Omzet (gunakan grandTotal agar konsisten dengan fitur diskon)
    const omzetKotor  = transactions.reduce((s, t) => s + (t.subtotal || t.total || 0), 0);
    const totalDiskon = transactions.reduce((s, t) => s + (t.discountAmount || 0), 0);
    const omzetBersih = transactions.reduce((s, t) => s + (t.grandTotal || t.total || 0), 0);

    document.getElementById('stat-omzet').textContent = formatRp(omzetBersih);
    document.getElementById('stat-trx').textContent   = transactions.length;

    // LKH — penjualan
    const lkhKotor  = document.getElementById('lkh-omzet-kotor');
    const lkhDiskon = document.getElementById('lkh-total-diskon');
    const lkhBersih = document.getElementById('lkh-omzet-bersih');
    if (lkhKotor)  lkhKotor.textContent  = formatRp(omzetKotor);
    if (lkhDiskon) lkhDiskon.textContent = formatRp(totalDiskon);
    if (lkhBersih) lkhBersih.textContent = formatRp(omzetBersih);

    // Tabel transaksi terbaru (5 terakhir)
    const tbody = document.getElementById('tabel-trx-terbaru');
    if (transactions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-state">Belum ada transaksi hari ini</td></tr>';
    } else {
      tbody.innerHTML = transactions.slice(0, 5).map(t => `
        <tr>
          <td><code style="font-size:0.78rem;">${t.noTransaksi || '–'}</code></td>
          <td>${formatTime(t.createdAt)}</td>
          <td><span class="badge badge-${metodeBadge(t.metode)}">${capitalize(t.metode || '–')}</span></td>
          <td style="font-weight:700;color:var(--gold)">${formatRp(t.grandTotal || t.total)}</td>
        </tr>
      `).join('');
    }

    // Top produk dari transaction_details
    await loadTopProduk(today);

    // Load pengeluaran hari ini & bulan ini untuk dashboard
    await loadDashboardPengeluaran(today, omzetBersih);

  } catch (e) {
    console.error('Dashboard error:', e);
    showToast('Gagal memuat dashboard', 'error');
  }
}

async function loadDashboardPengeluaran(today, omzetBersih) {
  // Pengeluaran hari ini
  const startDay = firebase.firestore.Timestamp.fromDate(getStartOfDay(today));
  const endDay   = firebase.firestore.Timestamp.fromDate(getEndOfDay(today));

  // Pengeluaran bulan ini
  const firstOfMonth = today.substring(0, 7) + '-01';
  const startBulan   = firebase.firestore.Timestamp.fromDate(getStartOfDay(firstOfMonth));

  try {
    // Hari ini
    const snapHari = await db.collection('expenses')
      .where('createdAt', '>=', startDay)
      .where('createdAt', '<=', endDay)
      .get();
    const totalHari = snapHari.docs.reduce((s, d) => s + (d.data().totalPrice || 0), 0);

    // Bulan ini
    const snapBulan = await db.collection('expenses')
      .where('createdAt', '>=', startBulan)
      .where('createdAt', '<=', endDay)
      .get();
    const totalBulan = snapBulan.docs.reduce((s, d) => s + (d.data().totalPrice || 0), 0);

    // Update stat cards
    const elHari  = document.getElementById('stat-pengeluaran-hari');
    const elBulan = document.getElementById('stat-pengeluaran-bulan');
    if (elHari)  elHari.textContent  = formatRp(totalHari);
    if (elBulan) elBulan.textContent = formatRp(totalBulan);

    // LKH — pengeluaran & saldo
    const lkhPengeluaran = document.getElementById('lkh-total-pengeluaran');
    const lkhSaldo       = document.getElementById('lkh-saldo-kas');
    if (lkhPengeluaran) lkhPengeluaran.textContent = formatRp(totalHari);
    if (lkhSaldo) {
      const saldo = omzetBersih - totalHari;
      lkhSaldo.textContent = formatRp(saldo);
      lkhSaldo.style.color = saldo >= 0 ? 'var(--success)' : 'var(--danger)';
    }

    // Pengeluaran per kategori hari ini
    const katMap = {};
    snapHari.docs.forEach(d => {
      const kat = d.data().category || 'Lainnya';
      katMap[kat] = (katMap[kat] || 0) + (d.data().totalPrice || 0);
    });
    const sortedKat = Object.entries(katMap).sort((a, b) => b[1] - a[1]);
    const listEl = document.getElementById('pengeluaran-per-kategori');
    if (listEl) {
      if (!sortedKat.length) {
        listEl.innerHTML = '<div class="empty-state">Belum ada pengeluaran hari ini</div>';
      } else {
        const katEmoji = {
          'Bahan Makanan': '🍚', 'Bahan Minuman': '🥤', 'Bahan Gorengan': '🍟',
          'Alat & Operasional': '🔧', 'Asset': '📦'
        };
        listEl.innerHTML = sortedKat.map(([kat, total]) => `
          <div class="top-produk-item">
            <div class="top-rank" style="font-size:1rem;width:1.8rem;height:1.8rem;">${katEmoji[kat] || '🛒'}</div>
            <div class="top-produk-name">${kat}</div>
            <div class="top-produk-qty" style="background:var(--danger);color:#fff">${formatRp(total)}</div>
          </div>
        `).join('');
      }
    }

  } catch (e) {
    console.error('Dashboard pengeluaran error:', e);
  }
}

async function loadTopProduk(dateStr) {
  const startDay = firebase.firestore.Timestamp.fromDate(getStartOfDay(dateStr));
  const endDay   = firebase.firestore.Timestamp.fromDate(getEndOfDay(dateStr));

  try {
    const snap = await db.collection('transaction_details')
      .where('createdAt', '>=', startDay)
      .where('createdAt', '<=', endDay)
      .get();

    const qtyMap = {};
    snap.docs.forEach(d => {
      const data = d.data();
      const key  = data.namaProduk || data.produkId;
      qtyMap[key] = (qtyMap[key] || 0) + (data.qty || 0);
    });

    const sorted = Object.entries(qtyMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

    const statEl = document.getElementById('stat-terlaris');
    if (statEl) statEl.textContent = sorted.length ? sorted[0][0] : '–';

    const listEl = document.getElementById('top-produk-list');
    if (!sorted.length) {
      listEl.innerHTML = '<div class="empty-state">Belum ada data penjualan hari ini</div>';
      return;
    }

    const rankClass = ['gold', 'silver', 'bronze', '', ''];
    listEl.innerHTML = sorted.map(([nama, qty], i) => `
      <div class="top-produk-item">
        <div class="top-rank ${rankClass[i]}">${i + 1}</div>
        <div class="top-produk-name">${nama}</div>
        <div class="top-produk-qty">${qty}x</div>
      </div>
    `).join('');
  } catch (e) {
    console.error('Top produk error:', e);
  }
}

// =============================================
// KASIR
// =============================================
function renderProdukKasir() {
  const grid = document.getElementById('kasir-produk-grid');
  if (!grid) return;

  let list = allProduk;

  // Filter kategori
  if (filterKat !== 'semua') {
    list = list.filter(p => (p.kategori || '').toLowerCase() === filterKat.toLowerCase());
  }

  // Filter search
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    list = list.filter(p => p.nama.toLowerCase().includes(q) || (p.kategori || '').toLowerCase().includes(q));
  }

  if (!list.length) {
    grid.innerHTML = '<div style="color:var(--text-muted);font-size:0.88rem;grid-column:1/-1;text-align:center;padding:2rem;">Tidak ada produk ditemukan</div>';
    return;
  }

  const emojiMap = { makanan: '🍚', minuman: '🥤', camilan: '🍡', rokok: '🚬', lainnya: '🛍️' };

  grid.innerHTML = list.map(p => {
    const emoji = emojiMap[(p.kategori || '').toLowerCase()] || '🍽️';
    const nonaktif = p.status !== 'aktif' ? 'nonaktif' : '';
    return `
      <div class="produk-card ${nonaktif}" onclick="addToKeranjang('${p.id}')" title="${p.nama}">
        <div class="produk-card-emoji">${emoji}</div>
        <div class="produk-card-nama">${p.nama}</div>
        <div class="produk-card-harga">${formatRp(p.harga)}</div>
        <div class="produk-card-stok">Stok: ${p.stok ?? '∞'}</div>
      </div>
    `;
  }).join('');
}

function updateKategoriTabs() {
  const container = document.getElementById('kategori-tabs');
  if (!container) return;

  const kategoriSet = new Set(allProduk.map(p => p.kategori).filter(Boolean));
  const aktif = filterKat;

  container.innerHTML = `<button class="tab-btn ${aktif === 'semua' ? 'active' : ''}" onclick="filterKategori('semua', this)">Semua</button>`;
  kategoriSet.forEach(k => {
    container.innerHTML += `<button class="tab-btn ${aktif === k ? 'active' : ''}" onclick="filterKategori('${k}', this)">${k}</button>`;
  });
}

function filterKategori(kat, btn) {
  filterKat = kat;
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
  renderProdukKasir();
}

function filterProdukKasir(val) {
  searchQuery = val;
  renderProdukKasir();
}

// Keranjang
function addToKeranjang(produkId) {
  const p = allProduk.find(x => x.id === produkId);
  if (!p) return;
  if (p.status !== 'aktif') return;

  const idx = keranjang.findIndex(k => k.produkId === produkId);
  if (idx >= 0) {
    keranjang[idx].qty++;
  } else {
    keranjang.push({
      produkId: p.id,
      namaProduk: p.nama,
      harga: p.harga,
      qty: 1,
      kategori: p.kategori || ''
    });
  }

  renderKeranjang();
  showToast(`${p.nama} ditambahkan ke keranjang`, 'success');
}

function changeQty(idx, delta) {
  keranjang[idx].qty += delta;
  if (keranjang[idx].qty <= 0) {
    keranjang.splice(idx, 1);
  }
  renderKeranjang();
}

function clearKeranjang() {
  if (!keranjang.length) return;
  keranjang = [];
  renderKeranjang();
  showToast('Keranjang dikosongkan', 'warning');
}

function renderKeranjang() {
  const container = document.getElementById('keranjang-items');
  const emptyEl   = document.getElementById('empty-keranjang');
  const footer    = document.getElementById('keranjang-footer');

  if (!keranjang.length) {
    container.innerHTML = '';
    container.appendChild(emptyEl || createEmptyKeranjangEl());
    document.getElementById('empty-keranjang').style.display = 'flex';
    hitungTotal();
    return;
  }

  const emptyNode = document.getElementById('empty-keranjang');
  if (emptyNode) emptyNode.style.display = 'none';

  let html = '';
  keranjang.forEach((item, i) => {
    const sub = item.harga * item.qty;
    html += `
      <div class="keranjang-item">
        <div>
          <div class="ki-nama">${item.namaProduk}</div>
          <div class="ki-harga-satuan">${formatRp(item.harga)} / pcs</div>
        </div>
        <div style="display:flex;flex-direction:column;align-items:flex-end;gap:0.3rem;">
          <div class="ki-controls">
            <button class="ki-qty-btn kurang" onclick="changeQty(${i}, -1)">−</button>
            <span class="ki-qty">${item.qty}</span>
            <button class="ki-qty-btn tambah" onclick="changeQty(${i}, 1)">+</button>
          </div>
          <div class="ki-subtotal">${formatRp(sub)}</div>
        </div>
      </div>
    `;
  });

  // Re-render items (preserve empty el at end for reuse)
  const oldItems = container.querySelectorAll('.keranjang-item');
  oldItems.forEach(el => el.remove());
  container.insertAdjacentHTML('afterbegin', html);

  hitungTotal();
}

function createEmptyKeranjangEl() {
  const div = document.createElement('div');
  div.className = 'empty-keranjang';
  div.id = 'empty-keranjang';
  div.innerHTML = '<div style="font-size:2.5rem">🛒</div><p>Keranjang masih kosong.<br/>Pilih produk untuk memulai.</p>';
  div.style.display = 'flex';
  return div;
}

function hitungTotal() {
  const subtotal = keranjang.reduce((s, k) => s + k.harga * k.qty, 0);

  // Hitung diskon
  const { discountAmount } = getDiskonData(subtotal);
  const grandTotal = Math.max(subtotal - discountAmount, 0);

  // Update UI subtotal
  const subEl = document.getElementById('subtotal-text');
  if (subEl) subEl.textContent = formatRp(subtotal);

  // Update baris diskon
  const amountRow = document.getElementById('diskon-amount-row');
  const amountText = document.getElementById('diskon-amount-text');
  const labelText  = document.getElementById('diskon-label-text');

  if (diskonAktif && discountAmount > 0) {
    if (amountRow)  amountRow.classList.remove('hidden');
    if (amountText) amountText.textContent = '− ' + formatRp(discountAmount);
    if (labelText) {
      const alasan = document.getElementById('diskon-alasan')?.value;
      labelText.textContent = 'Diskon' + (alasan ? ` (${alasan})` : '');
    }
  } else {
    if (amountRow) amountRow.classList.add('hidden');
  }

  // Update grand total
  const totEl = document.getElementById('total-text');
  if (totEl) totEl.textContent = formatRp(grandTotal);

  hitungKembalian();
}

function getDiskonData(subtotal) {
  if (!diskonAktif) return { discountType: 'nominal', discountValue: 0, discountAmount: 0, discountReason: '' };

  const nilaiRaw   = parseFloat(document.getElementById('diskon-nilai')?.value || 0) || 0;
  const alasan     = document.getElementById('diskon-alasan')?.value || '';
  let   discountAmount = 0;

  if (diskonType === 'persen') {
    const persen = Math.min(Math.max(nilaiRaw, 0), 100);
    discountAmount = Math.round(subtotal * persen / 100);
  } else {
    discountAmount = Math.min(Math.max(Math.round(nilaiRaw), 0), subtotal);
  }

  return {
    discountType: diskonType,
    discountValue: nilaiRaw,
    discountAmount,
    discountReason: alasan,
  };
}

function selectPayment(m, btn) {
  metode = m;
  document.querySelectorAll('.pay-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const tunaiSection = document.getElementById('tunai-section');
  if (m === 'tunai') {
    tunaiSection.style.display = 'flex';
  } else {
    tunaiSection.style.display = 'none';
  }
}

function hitungKembalian() {
  if (metode !== 'tunai') return;
  const subtotal       = keranjang.reduce((s, k) => s + k.harga * k.qty, 0);
  const { discountAmount } = getDiskonData(subtotal);
  const grandTotal     = Math.max(subtotal - discountAmount, 0);
  const diterima       = parseInt(document.getElementById('uang-diterima')?.value || 0);
  const kembalian      = diterima - grandTotal;
  const el             = document.getElementById('kembalian-text');
  if (el) {
    el.textContent = formatRp(Math.max(kembalian, 0));
    el.style.color = kembalian < 0 ? 'var(--danger)' : 'var(--success)';
  }
}

function toggleDiskon(checked) {
  diskonAktif = checked;
  const fields = document.getElementById('diskon-fields');
  if (fields) {
    if (checked) {
      fields.classList.remove('hidden');
    } else {
      fields.classList.add('hidden');
      // reset nilai diskon agar tidak ada sisa hitung
      const nilaiEl = document.getElementById('diskon-nilai');
      if (nilaiEl) nilaiEl.value = '';
    }
  }
  hitungTotal();
}

function setDiskonType(type, btn) {
  diskonType = type;
  document.querySelectorAll('.diskon-type-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');

  const prefix = document.getElementById('diskon-prefix');
  const suffix = document.getElementById('diskon-suffix');
  const nilaiEl = document.getElementById('diskon-nilai');

  if (type === 'persen') {
    if (prefix) prefix.classList.add('hidden');
    if (suffix) suffix.classList.remove('hidden');
    if (nilaiEl) nilaiEl.placeholder = '0';
  } else {
    if (prefix) prefix.classList.remove('hidden');
    if (suffix) suffix.classList.add('hidden');
    if (nilaiEl) nilaiEl.placeholder = '0';
  }

  // Reset nilai agar tidak salah hitung
  if (nilaiEl) nilaiEl.value = '';
  hitungTotal();
}


async function prosesTransaksi() {
  if (!keranjang.length) {
    showToast('Keranjang masih kosong!', 'warning');
    return;
  }

  const subtotal   = keranjang.reduce((s, k) => s + k.harga * k.qty, 0);
  const diskon     = getDiskonData(subtotal);
  const grandTotal = Math.max(subtotal - diskon.discountAmount, 0);

  // Validasi alasan diskon jika diskon aktif dan ada nilai diskon
  if (diskonAktif && diskon.discountAmount > 0 && !diskon.discountReason) {
    showToast('Pilih alasan diskon terlebih dahulu!', 'warning');
    return;
  }

  // Validate payment
  if (metode === 'tunai') {
    const diterima = parseInt(document.getElementById('uang-diterima')?.value || 0);
    if (diterima < grandTotal) {
      showToast('Uang diterima kurang dari grand total!', 'error');
      return;
    }
  }

  const btnText  = document.getElementById('btn-bayar-text');
  const btnSpin  = document.getElementById('btn-bayar-spinner');
  const btnBayar = document.getElementById('btn-bayar');

  btnText.classList.add('hidden');
  btnSpin.classList.remove('hidden');
  btnBayar.disabled = true;

  try {
    const noTransaksi  = await generateNoTransaksi();
    const now          = firebase.firestore.Timestamp.now();
    const today        = getTodayStr();
    const uangDiterima = metode === 'tunai'
      ? parseInt(document.getElementById('uang-diterima')?.value || 0)
      : grandTotal;

    const batch  = db.batch();
    const trxRef = db.collection('transactions').doc();

    batch.set(trxRef, {
      noTransaksi,
      subtotal,
      discountType:   diskon.discountType,
      discountValue:  diskon.discountValue,
      discountAmount: diskon.discountAmount,
      discountReason: diskon.discountReason,
      grandTotal,
      total: grandTotal,          // backward compat
      metode,
      uangDiterima,
      kembalian: metode === 'tunai' ? uangDiterima - grandTotal : 0,
      jumlahItem: keranjang.reduce((s, k) => s + k.qty, 0),
      kasir: currentUser?.email || 'unknown',
      tanggal: today,
      createdAt: now,
    });

    keranjang.forEach(item => {
      const detailRef = db.collection('transaction_details').doc();
      batch.set(detailRef, {
        transactionId: trxRef.id,
        noTransaksi,
        produkId: item.produkId,
        namaProduk: item.namaProduk,
        kategori: item.kategori,
        harga: item.harga,
        qty: item.qty,
        subtotal: item.harga * item.qty,
        tanggal: today,
        createdAt: now,
      });
    });

    await batch.commit();

    lastStruk = {
      noTransaksi,
      items: [...keranjang],
      subtotal,
      discountAmount: diskon.discountAmount,
      discountReason: diskon.discountReason,
      grandTotal,
      metode,
      uangDiterima,
      kembalian: metode === 'tunai' ? uangDiterima - grandTotal : 0,
      waktu: new Date(),
    };

    showStruk(lastStruk);
    showToast('Transaksi berhasil disimpan! ✅', 'success');

  } catch (e) {
    console.error('Transaksi error:', e);
    showToast('Transaksi gagal: ' + e.message, 'error');
  } finally {
    btnText.classList.remove('hidden');
    btnSpin.classList.add('hidden');
    btnBayar.disabled = false;
  }
}

function showStruk(data) {
  const metodeLabel = { tunai: '💵 Tunai', qris: '📱 QRIS', transfer: '🏦 Transfer' };
  const items = data.items.map(i => `
    <div class="struk-row">
      <span>${i.namaProduk} x${i.qty}</span>
      <span>${formatRp(i.harga * i.qty)}</span>
    </div>
  `).join('');

  const diskonRow = data.discountAmount > 0 ? `
    <div class="struk-row"><span>Subtotal</span><span>${formatRp(data.subtotal)}</span></div>
    <div class="struk-row" style="color:#c0392b"><span>Diskon${data.discountReason ? ' (' + data.discountReason + ')' : ''}</span><span>− ${formatRp(data.discountAmount)}</span></div>
  ` : '';

  const kembalianRow = data.metode === 'tunai' ? `
    <div class="struk-row"><span>Uang Diterima</span><span>${formatRp(data.uangDiterima)}</span></div>
    <div class="struk-row bold"><span>Kembalian</span><span>${formatRp(data.kembalian)}</span></div>
  ` : '';

  document.getElementById('struk-content').innerHTML = `
    <div class="struk-header">
      <div class="struk-title">☕ TIKUM</div>
      <div class="struk-subtitle">angkringan&coffe</div>
      <div class="struk-double-line"></div>
      <div class="struk-sub">Terima kasih atas kunjungan Anda!</div>
      <div class="struk-sub">${data.waktu.toLocaleString('id-ID')}</div>
    </div>
    <hr class="struk-divider"/>
    <div class="struk-row"><span>No. Transaksi</span><span>${data.noTransaksi}</span></div>
    <div class="struk-row"><span>Kasir</span><span>${currentUser?.email?.split('@')[0] || '–'}</span></div>
    <hr class="struk-divider"/>
    ${items}
    <hr class="struk-divider"/>
    ${diskonRow}
    <div class="struk-row big"><span>GRAND TOTAL</span><span>${formatRp(data.grandTotal)}</span></div>
    <div class="struk-row"><span>Pembayaran</span><span>${metodeLabel[data.metode] || data.metode}</span></div>
    ${kembalianRow}
    <hr class="struk-divider"/>
    <div class="struk-footer">✨ Matur nuwun ✨<br/>Selamat menikmati!</div>
  `;

  openModal('modal-struk');
}

function printStruk() {
  const content = document.getElementById('struk-content').innerHTML;
  const win = window.open('', '_blank', 'width=400,height=600');
  win.document.write(`
    <html><head><title>Struk</title>
    <style>
      body { font-family: 'Courier New', monospace; font-size: 12px; padding: 16px; }
      .struk-row { display: flex; justify-content: space-between; margin: 3px 0; }
      .struk-divider { border: none; border-top: 1px dashed #ccc; margin: 6px 0; }
      .struk-header, .struk-footer { text-align: center; }
      .struk-title { font-size: 16px; font-weight: bold; }
      .bold { font-weight: bold; }
      .big { font-size: 14px; font-weight: bold; }
    </style></head>
    <body>${content}</body></html>
  `);
  win.document.close();
  win.print();
}

function resetKasir() {
  keranjang    = [];
  metode       = 'tunai';
  diskonAktif  = false;
  diskonType   = 'nominal';

  const uangEl    = document.getElementById('uang-diterima');
  if (uangEl) uangEl.value = '';

  // Reset diskon UI
  const diskonCheck = document.getElementById('diskon-aktif');
  if (diskonCheck) diskonCheck.checked = false;
  const diskonFields = document.getElementById('diskon-fields');
  if (diskonFields) diskonFields.classList.add('hidden');
  const nilaiEl = document.getElementById('diskon-nilai');
  if (nilaiEl) nilaiEl.value = '';
  const alasanEl = document.getElementById('diskon-alasan');
  if (alasanEl) alasanEl.value = '';
  // Reset ke nominal mode
  setDiskonType('nominal', document.querySelector('.diskon-type-btn[data-type="nominal"]'));
  const amountRow = document.getElementById('diskon-amount-row');
  if (amountRow) amountRow.classList.add('hidden');

  selectPayment('tunai', document.querySelector('.pay-btn[data-method="tunai"]'));
  renderKeranjang();
}

// =============================================
// MASTER PRODUK
// =============================================
function renderTabelProduk(filter) {
  const tbody = document.getElementById('tabel-produk');
  if (!tbody) return;

  let list = allProduk;
  if (filter) {
    const q = filter.toLowerCase();
    list = list.filter(p => p.nama.toLowerCase().includes(q) || (p.kategori || '').toLowerCase().includes(q));
  }

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Tidak ada produk ditemukan</td></tr>';
    return;
  }

  tbody.innerHTML = list.map((p, i) => `
    <tr>
      <td>${i + 1}</td>
      <td style="font-weight:500">${p.nama}</td>
      <td><span class="badge badge-warning">${p.kategori || '–'}</span></td>
      <td style="font-weight:600;color:var(--gold)">${formatRp(p.harga)}</td>
      <td>${p.stok ?? 0}</td>
      <td><span class="badge ${p.status === 'aktif' ? 'badge-success' : 'badge-danger'}">${p.status === 'aktif' ? 'Aktif' : 'Nonaktif'}</span></td>
      <td>
        <div class="tbl-actions">
          <button class="btn-icon edit" onclick="openModalEditProduk('${p.id}')" title="Edit">✏️</button>
          <button class="btn-icon hapus" onclick="openModalHapus('${p.id}', '${p.nama.replace(/'/g, "\\'")}')" title="Hapus">🗑️</button>
        </div>
      </td>
    </tr>
  `).join('');
}

function filterTabelProduk(val) {
  renderTabelProduk(val);
}

function openModalProduk() {
  editProdukId = null;
  document.getElementById('modal-produk-title').textContent = 'Tambah Produk';
  document.getElementById('produk-id').value       = '';
  document.getElementById('produk-nama').value     = '';
  document.getElementById('produk-kategori').value = '';
  document.getElementById('produk-harga').value    = '';
  document.getElementById('produk-stok').value     = '0';
  document.getElementById('produk-deskripsi').value = '';
  document.getElementById('produk-status').value   = 'aktif';
  openModal('modal-produk');
}

function openModalEditProduk(id) {
  const p = allProduk.find(x => x.id === id);
  if (!p) return;
  editProdukId = id;
  document.getElementById('modal-produk-title').textContent = 'Edit Produk';
  document.getElementById('produk-id').value       = id;
  document.getElementById('produk-nama').value     = p.nama || '';
  document.getElementById('produk-kategori').value = p.kategori || '';
  document.getElementById('produk-harga').value    = p.harga || '';
  document.getElementById('produk-stok').value     = p.stok ?? 0;
  document.getElementById('produk-deskripsi').value = p.deskripsi || '';
  document.getElementById('produk-status').value   = p.status || 'aktif';
  openModal('modal-produk');
}

async function simpanProduk() {
  const nama      = document.getElementById('produk-nama').value.trim();
  const kategori  = document.getElementById('produk-kategori').value.trim();
  const harga     = parseInt(document.getElementById('produk-harga').value);
  const stok      = parseInt(document.getElementById('produk-stok').value) || 0;
  const deskripsi = document.getElementById('produk-deskripsi').value.trim();
  const status    = document.getElementById('produk-status').value;

  if (!nama || !kategori || isNaN(harga)) {
    showToast('Nama, Kategori, dan Harga wajib diisi!', 'error');
    return;
  }

  const btnText = document.getElementById('btn-simpan-text');
  const btnSpin = document.getElementById('btn-simpan-spinner');
  btnText.classList.add('hidden');
  btnSpin.classList.remove('hidden');

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
  } catch (e) {
    showToast('Gagal menyimpan produk: ' + e.message, 'error');
  } finally {
    btnText.classList.remove('hidden');
    btnSpin.classList.add('hidden');
  }
}

function openModalHapus(id, nama) {
  hapusProdukId = id;
  document.getElementById('hapus-produk-nama').textContent = nama;
  openModal('modal-hapus');
}

async function confirmHapusProduk() {
  if (!hapusProdukId) return;
  const btn = document.getElementById('btn-hapus-confirm');
  btn.disabled = true;
  btn.textContent = 'Menghapus...';

  try {
    await db.collection('products').doc(hapusProdukId).delete();
    showToast('Produk berhasil dihapus', 'success');
    closeModal('modal-hapus');
  } catch (e) {
    showToast('Gagal menghapus: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Hapus';
    hapusProdukId = null;
  }
}

function updateKategoriDatalist() {
  const dl = document.getElementById('kategori-list');
  if (!dl) return;
  const set = new Set(allProduk.map(p => p.kategori).filter(Boolean));
  dl.innerHTML = [...set].map(k => `<option value="${k}">`).join('');
}

// =============================================
// LAPORAN HARIAN
// =============================================
async function loadLaporan() {
  const dateStr = document.getElementById('laporan-tanggal')?.value;
  if (!dateStr) return;

  const startDay = firebase.firestore.Timestamp.fromDate(getStartOfDay(dateStr));
  const endDay   = firebase.firestore.Timestamp.fromDate(getEndOfDay(dateStr));
  const tbody    = document.getElementById('tabel-laporan');
  tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Memuat data...</td></tr>';

  try {
    const snap = await db.collection('transactions')
      .where('createdAt', '>=', startDay)
      .where('createdAt', '<=', endDay)
      .orderBy('createdAt', 'desc')
      .get();

    const transactions = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Summary — omzet kotor = subtotal sebelum diskon (fallback ke grandTotal jika tidak ada)
    const omzetKotor    = transactions.reduce((s, t) => s + (t.subtotal || t.total || 0), 0);
    const totalDiskon   = transactions.reduce((s, t) => s + (t.discountAmount || 0), 0);
    const omzetBersih   = transactions.reduce((s, t) => s + (t.grandTotal || t.total || 0), 0);

    document.getElementById('laporan-jml-trx').textContent      = transactions.length;
    document.getElementById('laporan-omzet-kotor').textContent  = formatRp(omzetKotor);
    document.getElementById('laporan-total-diskon').textContent  = formatRp(totalDiskon);
    document.getElementById('laporan-omzet').textContent        = formatRp(omzetBersih);

    if (!transactions.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Tidak ada transaksi pada tanggal ini</td></tr>';
      return;
    }

    tbody.innerHTML = transactions.map(t => {
      const sub        = t.subtotal || t.total || 0;
      const diskonAmt  = t.discountAmount || 0;
      const grand      = t.grandTotal || t.total || 0;
      const diskonBadge = diskonAmt > 0
        ? `<span style="color:var(--danger);font-weight:600;">− ${formatRp(diskonAmt)}</span>`
        : `<span style="color:var(--text-muted);font-size:0.78rem;">–</span>`;
      return `
        <tr>
          <td><code style="font-size:0.78rem">${t.noTransaksi || '–'}</code></td>
          <td>${formatTime(t.createdAt)}</td>
          <td>${t.jumlahItem || 0} item</td>
          <td><span class="badge badge-${metodeBadge(t.metode)}">${capitalize(t.metode || '–')}</span></td>
          <td style="color:var(--text-secondary)">${formatRp(sub)}</td>
          <td>${diskonBadge}</td>
          <td style="font-weight:700;color:var(--gold)">${formatRp(grand)}</td>
          <td>
            <button class="btn-detail" onclick="lihatDetailTrx('${t.id}', '${t.noTransaksi}')">Detail</button>
          </td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    console.error('Laporan error:', e);
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Gagal memuat data</td></tr>';
    showToast('Gagal memuat laporan: ' + e.message, 'error');
  }
}

async function lihatDetailTrx(trxId, noTransaksi) {
  const contentEl = document.getElementById('detail-trx-content');
  contentEl.innerHTML = '<p style="text-align:center;color:var(--text-muted);">Memuat...</p>';
  openModal('modal-detail-trx');

  try {
    const snap = await db.collection('transaction_details')
      .where('transactionId', '==', trxId)
      .get();

    const items   = snap.docs.map(d => d.data());
    const trxDoc  = await db.collection('transactions').doc(trxId).get();
    const trxData = trxDoc.data() || {};

    const subtotal      = trxData.subtotal || items.reduce((s, i) => s + i.subtotal, 0);
    const discountAmount = trxData.discountAmount || 0;
    const grandTotal    = trxData.grandTotal || trxData.total || 0;

    const diskonBlock = discountAmount > 0 ? `
      <div class="detail-trx-item" style="color:var(--text-secondary)">
        <span>Subtotal</span>
        <span>${formatRp(subtotal)}</span>
      </div>
      <div class="detail-trx-item" style="color:var(--danger)">
        <span>Diskon${trxData.discountReason ? ' (' + trxData.discountReason + ')' : ''}
          <small style="display:block;opacity:0.7">
            ${trxData.discountType === 'persen' ? trxData.discountValue + '%' : 'Nominal'}
          </small>
        </span>
        <span>− ${formatRp(discountAmount)}</span>
      </div>
    ` : '';

    contentEl.innerHTML = `
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.4rem;">No. Transaksi: <strong>${noTransaksi}</strong></p>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:0.4rem;">Waktu: ${formatDateTime(trxData.createdAt)}</p>
      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1rem;">Kasir: ${trxData.kasir || '–'}</p>
      ${items.map(i => `
        <div class="detail-trx-item">
          <span>${i.namaProduk} <small style="color:var(--text-muted)">x${i.qty}</small></span>
          <span style="font-weight:600">${formatRp(i.subtotal)}</span>
        </div>
      `).join('')}
      ${diskonBlock}
      <div class="detail-trx-total">
        <span>Grand Total</span>
        <span style="color:var(--gold)">${formatRp(grandTotal)}</span>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:0.5rem;font-size:0.83rem;color:var(--text-muted);">
        <span>Metode: ${capitalize(trxData.metode || '–')}</span>
        ${trxData.metode === 'tunai' ? `<span>Kembalian: ${formatRp(trxData.kembalian)}</span>` : ''}
      </div>
    `;
  } catch (e) {
    contentEl.innerHTML = `<p style="color:var(--danger)">Gagal memuat detail: ${e.message}</p>`;
  }
}

// =============================================
// BELANJA & PENGELUARAN
// =============================================

function hitungTotalPengeluaran() {
  const qty   = parseFloat(document.getElementById('p-qty')?.value || 0) || 0;
  const harga = parseFloat(document.getElementById('p-harga-satuan')?.value || 0) || 0;
  const total = Math.round(qty * harga);
  const el    = document.getElementById('p-total-display');
  const inp   = document.getElementById('p-total-harga');
  if (el)  el.textContent = formatRp(total);
  if (inp) inp.value = total;
}

async function simpanPengeluaran() {
  const tanggal    = document.getElementById('p-tanggal')?.value;
  const kategori   = document.getElementById('p-kategori')?.value;
  const item       = document.getElementById('p-item')?.value.trim();
  const qty        = parseFloat(document.getElementById('p-qty')?.value || 0);
  const satuan     = document.getElementById('p-satuan')?.value;
  const hargaSat   = parseFloat(document.getElementById('p-harga-satuan')?.value || 0);
  const totalHarga = Math.round(qty * hargaSat);
  const keterangan = document.getElementById('p-keterangan')?.value.trim();

  if (!tanggal || !kategori || !item || qty <= 0 || hargaSat <= 0) {
    showToast('Tanggal, Kategori, Item, Qty, dan Harga Satuan wajib diisi!', 'error');
    return;
  }

  const btnText = document.getElementById('btn-sp-text');
  const btnSpin = document.getElementById('btn-sp-spinner');
  btnText.classList.add('hidden');
  btnSpin.classList.remove('hidden');

  const data = {
    transactionDate: tanggal,
    category:   kategori,
    item,
    qty,
    unit:       satuan,
    unitPrice:  hargaSat,
    totalPrice: totalHarga,
    notes:      keterangan,
    updatedAt:  firebase.firestore.Timestamp.now(),
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
    loadPengeluaran();
    loadDashboard(); // refresh dashboard stats
  } catch (e) {
    showToast('Gagal menyimpan: ' + e.message, 'error');
  } finally {
    btnText.classList.remove('hidden');
    btnSpin.classList.add('hidden');
  }
}

function resetFormPengeluaran() {
  document.getElementById('pengeluaran-edit-id').value = '';
  document.getElementById('p-tanggal').value           = getTodayStr();
  document.getElementById('p-kategori').value          = '';
  document.getElementById('p-item').value              = '';
  document.getElementById('p-qty').value               = '';
  document.getElementById('p-satuan').value            = 'Kg';
  document.getElementById('p-harga-satuan').value      = '';
  document.getElementById('p-total-harga').value       = '0';
  document.getElementById('p-keterangan').value        = '';
  const el = document.getElementById('p-total-display');
  if (el) el.textContent = 'Rp 0';
}

function batalEditPengeluaran() {
  editPengeluaranId = null;
  document.getElementById('form-pengeluaran-title').textContent = '➕ Tambah Pengeluaran';
  document.getElementById('btn-simpan-pengeluaran').querySelector('#btn-sp-text').textContent = '💾 Simpan Pengeluaran';
  document.getElementById('btn-batal-edit-pengeluaran').classList.add('hidden');
  resetFormPengeluaran();
}

function openEditPengeluaran(id) {
  // Ambil dari tabel yang sudah di-cache
  const row = document.querySelector(`[data-pengeluaran-id="${id}"]`);
  if (!row) { loadPengeluaranById(id); return; }
}

async function loadPengeluaranById(id) {
  try {
    const doc = await db.collection('expenses').doc(id).get();
    if (!doc.exists) return;
    isiFormEditPengeluaran(id, doc.data());
  } catch (e) {
    showToast('Gagal memuat data: ' + e.message, 'error');
  }
}

function isiFormEditPengeluaran(id, data) {
  editPengeluaranId = id;
  document.getElementById('pengeluaran-edit-id').value     = id;
  document.getElementById('p-tanggal').value               = data.transactionDate || getTodayStr();
  document.getElementById('p-kategori').value              = data.category || '';
  document.getElementById('p-item').value                  = data.item || '';
  document.getElementById('p-qty').value                   = data.qty || '';
  document.getElementById('p-satuan').value                = data.unit || 'Pcs';
  document.getElementById('p-harga-satuan').value          = data.unitPrice || '';
  document.getElementById('p-keterangan').value            = data.notes || '';
  hitungTotalPengeluaran();

  document.getElementById('form-pengeluaran-title').textContent = '✏️ Edit Pengeluaran';
  document.getElementById('btn-simpan-pengeluaran').querySelector('#btn-sp-text').textContent = '💾 Update Pengeluaran';
  document.getElementById('btn-batal-edit-pengeluaran').classList.remove('hidden');

  // Scroll ke form
  document.getElementById('form-pengeluaran-title')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function openModalHapusPengeluaran(id, nama) {
  hapusPengeluaranId = id;
  document.getElementById('hapus-pengeluaran-nama').textContent = nama;
  openModal('modal-hapus-pengeluaran');
}

async function confirmHapusPengeluaran() {
  if (!hapusPengeluaranId) return;
  const btn = document.getElementById('btn-hapus-pengeluaran-confirm');
  btn.disabled = true;
  btn.textContent = 'Menghapus...';

  try {
    await db.collection('expenses').doc(hapusPengeluaranId).delete();
    showToast('Pengeluaran berhasil dihapus', 'success');
    closeModal('modal-hapus-pengeluaran');
    loadPengeluaran();
    loadDashboard();
  } catch (e) {
    showToast('Gagal menghapus: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Hapus';
    hapusPengeluaranId = null;
  }
}

async function loadPengeluaran() {
  const dateAwal   = document.getElementById('filter-p-awal')?.value;
  const dateAkhir  = document.getElementById('filter-p-akhir')?.value;
  const filterKatP = document.getElementById('filter-p-kategori')?.value;
  const tbody      = document.getElementById('tabel-pengeluaran');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Memuat data...</td></tr>';

  try {
    let query = db.collection('expenses').orderBy('transactionDate', 'desc').orderBy('createdAt', 'desc');

    if (dateAwal)  query = query.where('transactionDate', '>=', dateAwal);
    if (dateAkhir) query = query.where('transactionDate', '<=', dateAkhir);

    const snap = await query.get();
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filter kategori di client-side (hindari composite index)
    if (filterKatP) {
      list = list.filter(e => e.category === filterKatP);
    }

    // Total terfilter
    const totalFilter = list.reduce((s, e) => s + (e.totalPrice || 0), 0);
    const elTotal = document.getElementById('p-total-terfilter');
    if (elTotal) elTotal.textContent = formatRp(totalFilter);

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Tidak ada data pengeluaran pada periode ini</td></tr>';
      return;
    }

    const katBadgeColor = {
      'Bahan Makanan':    '#e67e22',
      'Bahan Minuman':    '#2980b9',
      'Bahan Gorengan':   '#8e44ad',
      'Alat & Operasional': '#16a085',
      'Asset':            '#c0392b',
    };

    tbody.innerHTML = list.map(e => {
      const badgeColor = katBadgeColor[e.category] || '#7f8c8d';
      const safeItem   = (e.item || '').replace(/'/g, "\\'");
      return `
        <tr data-pengeluaran-id="${e.id}">
          <td style="white-space:nowrap">${e.transactionDate || '–'}</td>
          <td><span class="badge" style="background:${badgeColor}20;color:${badgeColor};border:1px solid ${badgeColor}40">${e.category || '–'}</span></td>
          <td style="font-weight:500">${e.item || '–'}</td>
          <td>${e.qty ?? '–'}</td>
          <td>${e.unit || '–'}</td>
          <td>${formatRp(e.unitPrice)}</td>
          <td style="font-weight:700;color:var(--danger)">${formatRp(e.totalPrice)}</td>
          <td style="font-size:0.82rem;color:var(--text-muted)">${e.notes || '–'}</td>
          <td>
            <div class="tbl-actions">
              <button class="btn-icon edit" onclick="loadPengeluaranById('${e.id}')" title="Edit">✏️</button>
              <button class="btn-icon hapus" onclick="openModalHapusPengeluaran('${e.id}', '${safeItem}')" title="Hapus">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

  } catch (e) {
    console.error('Pengeluaran error:', e);
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Gagal memuat data</td></tr>';
    showToast('Gagal memuat pengeluaran: ' + e.message, 'error');
  }
}

// =============================================
// MODAL HELPERS
// =============================================
function openModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.remove('hidden');
    el.style.display = 'flex';
  }
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) {
    el.classList.add('hidden');
    el.style.display = '';
  }
}

function closeModalIfOutside(event, id) {
  if (event.target.id === id) closeModal(id);
}

// =============================================
// TOAST NOTIFICATIONS
// =============================================
function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span> ${msg}`;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 0.3s';
    setTimeout(() => toast.remove(), 350);
  }, 3000);
}

// =============================================
// UTILITY
// =============================================
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function metodeBadge(m) {
  const map = { tunai: 'success', qris: 'warning', transfer: 'warning' };
  return map[m] || 'warning';
}

// Handle Enter key on login
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const loginPage = document.getElementById('page-login');
    if (loginPage && loginPage.classList.contains('active')) {
      doLogin();
    }
  }
});
