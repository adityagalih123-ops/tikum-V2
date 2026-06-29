/* ================================================
   TIKUM POS — Modul Konsinyasi v2.0
   Collections: consignment_stock, consignment_payment, consignment_return
   ================================================
   Perbaikan v2.0:
   1. Fix tombol Close sidebar di mobile (event listener terpusat)
   2. Edit & Hapus data Barang Masuk dengan konfirmasi
   3. Unsubscribe listener untuk mencegah memory leak
   4. Code cleanup: hapus duplikat, rapikan event listener
   5. Error handling yang lebih baik
   ================================================ */

'use strict';

/* ============================================================
   STATE LOKAL MODUL
   ============================================================ */

/** Cache stok sisa tiap produk konsinyasi, dipakai oleh kasir */
let konsinyasiStokCache = {};

/** Context sementara untuk modal Bayar */
let _bayarCtx = {};

/** Context sementara untuk modal Retur */
let _returCtx = {};

/** ID record barang masuk yang sedang diedit (null = mode tambah) */
let _editBarangMasukId = null;

/** ID record barang masuk yang akan dihapus */
let _hapusBarangMasukId = null;

/* ============================================================
   INISIALISASI — dijalankan setelah DOM siap
   ============================================================ */
document.addEventListener('DOMContentLoaded', () => {
  // Set tanggal default untuk form & filter konsinyasi
  const today        = new Date().toISOString().split('T')[0];
  const firstOfMonth = today.substring(0, 7) + '-01';

  _setVal('km-tanggal',      today);
  _setVal('km-filter-awal',  firstOfMonth);
  _setVal('km-filter-akhir', today);
  _setVal('kl-awal',         firstOfMonth);
  _setVal('kl-akhir',        today);

  // -------------------------------------------------------
  // FIX MOBILE: Pastikan tombol ✕ (btn-sidebar-close)
  // benar-benar menutup sidebar di mobile.
  // Masalah lama: onclick di HTML kadang tidak terpicu
  // karena sidebar belum punya z-index cukup saat overlay
  // menutup elemen di belakangnya.
  // Solusi: pasang event listener langsung via JS.
  // -------------------------------------------------------
  const btnClose = document.getElementById('btn-sidebar-close');
  if (btnClose) {
    // Hapus atribut onclick lama agar tidak double-fire
    btnClose.removeAttribute('onclick');
    btnClose.addEventListener('click', () => {
      if (typeof closeSidebar === 'function') closeSidebar();
    });
  }

  // Pastikan overlay juga menutup sidebar (desktop & mobile)
  const overlay = document.getElementById('sidebar-overlay');
  if (overlay) {
    overlay.removeAttribute('onclick');
    overlay.addEventListener('click', () => {
      if (typeof closeSidebar === 'function') closeSidebar();
    });
  }
});

/* ============================================================
   MASTER PRODUK — toggle field konsinyasi
   ============================================================ */

/**
 * Tampilkan / sembunyikan field Supplier & Harga Titip
 * berdasarkan jenis produk yang dipilih.
 * @param {string} jenis - 'reguler' | 'konsinyasi'
 */
function toggleKonsinyasiFields(jenis) {
  const fields = _el('konsinyasi-fields');
  if (!fields) return;
  if (jenis === 'konsinyasi') {
    fields.classList.remove('hidden');
    _el('produk-supplier')?.setAttribute('required', 'required');
    _el('produk-harga-titip')?.setAttribute('required', 'required');
  } else {
    fields.classList.add('hidden');
    _el('produk-supplier')?.removeAttribute('required');
    _el('produk-harga-titip')?.removeAttribute('required');
  }
}

/* ============================================================
   KASIR — update stok konsinyasi saat produk terjual
   ============================================================ */

/**
 * Muat cache stok sisa konsinyasi dari Firestore.
 * Dipakai kasir untuk validasi sebelum menambah item ke keranjang.
 */
async function loadKonsinyasiStokKasir() {
  try {
    const snap = await db.collection('consignment_stock').get();
    const m    = {};
    snap.docs.forEach(d => {
      const data = d.data();
      const pid  = data.productId;
      if (!m[pid]) m[pid] = 0;
      m[pid] += (data.qtySisa || 0);
    });
    konsinyasiStokCache = m;
  } catch (e) {
    console.warn('Gagal load stok konsinyasi:', e);
  }
}

/**
 * Kurangi qtySisa dan tambah qtyTerjual di consignment_stock
 * menggunakan metode FIFO (batch terlama habis duluan).
 * Dipanggil setelah transaksi kasir berhasil di-commit.
 * @param {string} produkId
 * @param {number} qty - jumlah yang terjual
 */
async function updateKonsinyasiStokTerjual(produkId, qty) {
  try {
    const snap = await db.collection('consignment_stock')
      .where('productId', '==', produkId)
      .orderBy('tanggalMasuk', 'asc')
      .get();

    let remaining = qty;
    for (const doc of snap.docs) {
      if (remaining <= 0) break;
      const qSisa  = doc.data().qtySisa || 0;
      if (qSisa <= 0) continue;
      const deduct = Math.min(remaining, qSisa);
      await db.collection('consignment_stock').doc(doc.id).update({
        qtySisa:    firebase.firestore.FieldValue.increment(-deduct),
        qtyTerjual: firebase.firestore.FieldValue.increment(deduct),
        updatedAt:  firebase.firestore.Timestamp.now(),
      });
      remaining -= deduct;
    }
    // Perbarui cache lokal agar kasir langsung tahu stok berubah
    konsinyasiStokCache[produkId] = Math.max(
      (konsinyasiStokCache[produkId] || 0) - qty, 0
    );
  } catch (e) {
    console.error('updateKonsinyasiStokTerjual error:', e);
  }
}

/* ============================================================
   BARANG MASUK — form & tabel
   ============================================================ */

/**
 * Isi select produk konsinyasi di form Barang Masuk.
 * Hanya produk dengan jenis='konsinyasi' & status='aktif'.
 */
function populateKmProdukSelect() {
  const sel = _el('km-produk');
  if (!sel) return;
  const konsProduk = (typeof allProduk !== 'undefined' ? allProduk : [])
    .filter(p => p.jenis === 'konsinyasi' && p.status === 'aktif');
  sel.innerHTML = '<option value="">— Pilih Produk —</option>' +
    konsProduk.map(p =>
      `<option value="${p.id}" data-supplier="${escStr(p.supplier||'')}" data-harga="${p.hargaTitip||0}">${p.nama}</option>`
    ).join('');
}

/**
 * Saat produk dipilih di form Barang Masuk,
 * isi otomatis field Supplier & Harga Titip dari data produk.
 */
function onKmProdukChange() {
  const sel = _el('km-produk');
  const opt = sel?.options[sel.selectedIndex];
  _setVal('km-supplier', opt?.dataset.supplier || '');
  const ht = opt?.dataset.harga;
  if (_el('km-harga-titip')) {
    _el('km-harga-titip').value = ht && parseInt(ht) > 0
      ? 'Rp ' + parseInt(ht).toLocaleString('id-ID')
      : '';
  }
}

/**
 * Reset form Barang Masuk ke kondisi "Tambah Baru".
 * Dipanggil setelah simpan berhasil atau saat batal edit.
 */
function resetFormBarangMasuk() {
  _editBarangMasukId = null;
  _setVal('km-qty', '');
  _setVal('km-catatan', '');
  if (_el('km-produk'))      _el('km-produk').value = '';
  if (_el('km-supplier'))    _setVal('km-supplier', '');
  if (_el('km-harga-titip')) _el('km-harga-titip').value = '';
  _setVal('km-tanggal', new Date().toISOString().split('T')[0]);

  // Kembalikan judul & tombol ke mode tambah
  const formTitle = _el('km-form-title');
  if (formTitle) formTitle.textContent = '➕ Tambah Barang Masuk';
  const btnText = _el('btn-km-text');
  if (btnText) btnText.textContent = '💾 Simpan Barang Masuk';
  const btnBatal = _el('btn-batal-edit-km');
  if (btnBatal) btnBatal.classList.add('hidden');

  // Aktifkan kembali select produk (yang di-disable saat edit)
  const selProduk = _el('km-produk');
  if (selProduk) selProduk.disabled = false;
}

/**
 * Simpan atau update data Barang Masuk ke Firestore.
 * Mode edit: update dokumen yang ada (tidak membuat baru).
 * Mode tambah: tambah dokumen baru.
 */
async function simpanBarangMasuk() {
  const tanggal  = _el('km-tanggal')?.value;
  const produkId = _el('km-produk')?.value;
  const qtyMasuk = parseInt(_el('km-qty')?.value || 0);
  const catatan  = _el('km-catatan')?.value.trim() || '';

  if (!tanggal || !produkId || qtyMasuk <= 0) {
    showToast('Tanggal, Produk, dan Qty Masuk wajib diisi!', 'error'); return;
  }

  const produk = (typeof allProduk !== 'undefined' ? allProduk : []).find(p => p.id === produkId);
  if (!produk) { showToast('Produk tidak ditemukan!', 'error'); return; }

  const btnT = _el('btn-km-text');
  const btnS = _el('btn-km-spinner');
  if (btnT) btnT.classList.add('hidden');
  if (btnS) btnS.classList.remove('hidden');

  try {
    const now    = firebase.firestore.Timestamp.now();
    const tglTs  = firebase.firestore.Timestamp.fromDate(new Date(tanggal + 'T00:00:00'));

    if (_editBarangMasukId) {
      // ---- MODE EDIT: UPDATE dokumen yang sudah ada ----
      // Catatan: qtySisa di-recalculate = qtyMasuk - qtyTerjual - qtyRetur
      // untuk menjaga konsistensi data.
      const docSnap = await db.collection('consignment_stock').doc(_editBarangMasukId).get();
      const oldData  = docSnap.data() || {};
      const qtyTerjual = oldData.qtyTerjual || 0;
      const qtyRetur   = oldData.qtyRetur   || 0;
      const qtyDibayar = oldData.qtyDibayar || 0;
      const qtySisaBaru = Math.max(qtyMasuk - qtyTerjual - qtyRetur, 0);

      await db.collection('consignment_stock').doc(_editBarangMasukId).update({
        productId:    produkId,
        namaProduk:   produk.nama,
        supplier:     produk.supplier || '',
        hargaTitip:   produk.hargaTitip || 0,
        qtyMasuk,
        qtySisa:      qtySisaBaru,
        qtyTerjual,
        qtyDibayar,
        qtyRetur,
        tanggalMasuk: tglTs,
        catatan,
        updatedAt:    now,
      });

      showToast('Data berhasil diperbarui! ✅', 'success');
    } else {
      // ---- MODE TAMBAH: ADD dokumen baru ----
      await db.collection('consignment_stock').add({
        productId:    produkId,
        namaProduk:   produk.nama,
        supplier:     produk.supplier || '',
        hargaTitip:   produk.hargaTitip || 0,
        qtyMasuk,
        qtySisa:      qtyMasuk,
        qtyTerjual:   0,
        qtyDibayar:   0,
        qtyRetur:     0,
        tanggalMasuk: tglTs,
        catatan,
        createdAt:    now,
        updatedAt:    now,
      });

      showToast('Barang masuk berhasil dicatat! ✅', 'success');

      // Perbarui cache stok kasir
      konsinyasiStokCache[produkId] = (konsinyasiStokCache[produkId] || 0) + qtyMasuk;
    }

    resetFormBarangMasuk();
    loadBarangMasuk();

  } catch (e) {
    showToast('Gagal menyimpan: ' + e.message, 'error');
    console.error('simpanBarangMasuk error:', e);
  } finally {
    if (btnT) btnT.classList.remove('hidden');
    if (btnS) btnS.classList.add('hidden');
  }
}

/**
 * Isi form Barang Masuk dengan data lama untuk diedit.
 * @param {string} docId - ID dokumen Firestore consignment_stock
 */
async function editBarangMasuk(docId) {
  try {
    const docSnap = await db.collection('consignment_stock').doc(docId).get();
    if (!docSnap.exists) { showToast('Data tidak ditemukan!', 'error'); return; }
    const data = docSnap.data();

    _editBarangMasukId = docId;

    // Set tanggal
    if (data.tanggalMasuk) {
      const d = data.tanggalMasuk.toDate ? data.tanggalMasuk.toDate() : new Date(data.tanggalMasuk);
      _setVal('km-tanggal', d.toISOString().split('T')[0]);
    }

    // Set produk — populate dulu, lalu pilih
    populateKmProdukSelect();
    const selProduk = _el('km-produk');
    if (selProduk) {
      selProduk.value = data.productId || '';
      // Jika produk sudah tidak aktif/ada, tetap tampilkan namanya
      if (!selProduk.value && data.productId) {
        const opt = document.createElement('option');
        opt.value = data.productId;
        opt.dataset.supplier = data.supplier || '';
        opt.dataset.harga    = data.hargaTitip || 0;
        opt.textContent      = data.namaProduk || data.productId;
        selProduk.appendChild(opt);
        selProduk.value = data.productId;
      }
      selProduk.disabled = false; // biarkan bisa ganti produk
    }

    // Isi supplier & harga titip dari data lama (bukan dari produk)
    _setVal('km-supplier', data.supplier || '');
    if (_el('km-harga-titip')) {
      _el('km-harga-titip').value = data.hargaTitip
        ? 'Rp ' + parseInt(data.hargaTitip).toLocaleString('id-ID')
        : '';
    }

    _setVal('km-qty', data.qtyMasuk || '');
    _setVal('km-catatan', data.catatan || '');

    // Ubah judul & tombol ke mode edit
    const formTitle = _el('km-form-title');
    if (formTitle) formTitle.textContent = '✏️ Edit Barang Masuk';
    const btnText = _el('btn-km-text');
    if (btnText) btnText.textContent = '💾 Perbarui Data';
    const btnBatal = _el('btn-batal-edit-km');
    if (btnBatal) btnBatal.classList.remove('hidden');

    // Scroll ke form
    _el('km-tanggal')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  } catch (e) {
    showToast('Gagal memuat data untuk edit: ' + e.message, 'error');
    console.error('editBarangMasuk error:', e);
  }
}

/**
 * Batalkan mode edit, kembalikan form ke mode tambah.
 */
function batalEditBarangMasuk() {
  resetFormBarangMasuk();
  showToast('Edit dibatalkan', 'info');
}

/**
 * Tampilkan dialog konfirmasi sebelum menghapus Barang Masuk.
 * @param {string} docId
 * @param {string} namaProduk
 */
function konfirmasiHapusBarangMasuk(docId, namaProduk) {
  _hapusBarangMasukId = docId;
  _setTxt('hapus-bm-nama', namaProduk || 'data ini');
  openModal('modal-hapus-barang-masuk');
}

/**
 * Eksekusi hapus data Barang Masuk setelah konfirmasi.
 */
async function confirmHapusBarangMasuk() {
  if (!_hapusBarangMasukId) return;
  const btn = _el('btn-hapus-bm-confirm');
  if (btn) { btn.disabled = true; btn.textContent = 'Menghapus...'; }

  try {
    await db.collection('consignment_stock').doc(_hapusBarangMasukId).delete();
    showToast('Data berhasil dihapus', 'success');
    closeModal('modal-hapus-barang-masuk');
    loadBarangMasuk();
    // Invalidate cache stok kasir supaya ter-refresh saat buka kasir
    konsinyasiStokCache = {};
  } catch (e) {
    showToast('Gagal menghapus: ' + e.message, 'error');
    console.error('confirmHapusBarangMasuk error:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Hapus'; }
    _hapusBarangMasukId = null;
  }
}

/**
 * Muat dan render tabel Riwayat Barang Masuk.
 * Filter opsional berdasarkan tanggal awal & akhir.
 */
async function loadBarangMasuk() {
  const awal  = _el('km-filter-awal')?.value;
  const akhir = _el('km-filter-akhir')?.value;
  const tbody = _el('tabel-barang-masuk');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Memuat data...</td></tr>';

  try {
    let q = db.collection('consignment_stock').orderBy('tanggalMasuk', 'desc');
    if (awal)  q = q.where('tanggalMasuk', '>=', firebase.firestore.Timestamp.fromDate(new Date(awal  + 'T00:00:00')));
    if (akhir) q = q.where('tanggalMasuk', '<=', firebase.firestore.Timestamp.fromDate(new Date(akhir + 'T23:59:59')));

    const snap = await q.get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Tidak ada data barang masuk pada periode ini</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(r => `
      <tr>
        <td style="white-space:nowrap">${r.tanggalMasuk ? fmtTgl(r.tanggalMasuk) : '–'}</td>
        <td style="font-weight:500">${r.namaProduk || '–'}</td>
        <td>${r.supplier || '–'}</td>
        <td style="text-align:center;font-weight:600">${r.qtyMasuk || 0}</td>
        <td>${formatRp(r.hargaTitip || 0)}</td>
        <td style="color:var(--text-muted);font-size:0.82rem">${r.catatan || '–'}</td>
        <td style="text-align:center"><span style="font-size:0.8rem;color:var(--text-muted)">Sisa <b>${r.qtySisa || 0}</b></span></td>
        <td>
          <div class="tbl-actions">
            <button class="btn-icon edit"
              onclick="editBarangMasuk('${r.id}')"
              title="Edit">✏️</button>
            <button class="btn-icon hapus"
              onclick="konfirmasiHapusBarangMasuk('${r.id}','${escStr(r.namaProduk || '')}')"
              title="Hapus">🗑️</button>
          </div>
        </td>
      </tr>`).join('');

  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty-state">Gagal memuat data</td></tr>';
    showToast('Gagal memuat barang masuk: ' + e.message, 'error');
    console.error('loadBarangMasuk error:', e);
  }
}

/* ============================================================
   PEMBAYARAN SUPPLIER — rekap & riwayat
   ============================================================ */

/**
 * Muat rekap hutang konsinyasi per produk, dikelompokkan per productId.
 * Filter opsional berdasarkan nama supplier.
 */
async function loadRekap() {
  const filterSupplier = (_el('pay-filter-supplier')?.value || '').toLowerCase().trim();
  const tbody = _el('tabel-rekap-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Memuat rekap...</td></tr>';

  try {
    const snap = await db.collection('consignment_stock').get();
    let list   = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (filterSupplier) {
      list = list.filter(r => (r.supplier || '').toLowerCase().includes(filterSupplier));
    }

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Tidak ada data</td></tr>'; return;
    }

    // Gabungkan per productId
    const map = {};
    list.forEach(r => {
      const key = r.productId;
      if (!map[key]) {
        map[key] = {
          supplier:   r.supplier || '–',
          namaProduk: r.namaProduk || '–',
          hargaTitip: r.hargaTitip || 0,
          rows: [],
        };
      }
      map[key].rows.push(r);
    });

    let html = '';
    for (const [pid, data] of Object.entries(map)) {
      const qMasuk    = data.rows.reduce((s, r) => s + (r.qtyMasuk    || 0), 0);
      const qTerjual  = data.rows.reduce((s, r) => s + (r.qtyTerjual  || 0), 0);
      const qDibayar  = data.rows.reduce((s, r) => s + (r.qtyDibayar  || 0), 0);
      const qBelum    = qTerjual - qDibayar;
      const totalHutang = qBelum * data.hargaTitip;
      html += `
        <tr>
          <td style="font-weight:500">${data.supplier}</td>
          <td>${data.namaProduk}</td>
          <td style="text-align:center">${qMasuk}</td>
          <td style="text-align:center;color:var(--success)">${qTerjual}</td>
          <td style="text-align:center;color:var(--gold)">${qDibayar}</td>
          <td style="text-align:center;color:${qBelum > 0 ? 'var(--danger)' : 'var(--text-muted)'};font-weight:600">${qBelum}</td>
          <td>${formatRp(data.hargaTitip)}</td>
          <td style="font-weight:700;color:var(--danger)">${formatRp(totalHutang)}</td>
          <td>
            <div class="tbl-actions">
              <button class="btn-icon edit"
                onclick="openModalBayar('${pid}','${escStr(data.namaProduk)}','${escStr(data.supplier)}',${qBelum},${data.hargaTitip})"
                title="Bayar">💳</button>
              <button class="btn-icon hapus"
                onclick="openModalRetur('${pid}','${escStr(data.namaProduk)}','${escStr(data.supplier)}')"
                title="Retur">↩️</button>
            </div>
          </td>
        </tr>`;
    }
    tbody.innerHTML = html;

  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Gagal memuat rekap</td></tr>';
    showToast('Gagal memuat rekap: ' + e.message, 'error');
    console.error('loadRekap error:', e);
  }
}

/**
 * Muat riwayat 50 pembayaran terbaru ke supplier.
 */
async function loadRiwayatBayar() {
  const tbody = _el('tabel-riwayat-bayar');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Memuat...</td></tr>';
  try {
    const snap = await db.collection('consignment_payment')
      .orderBy('tanggalBayar', 'desc')
      .limit(50)
      .get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Belum ada riwayat pembayaran</td></tr>'; return;
    }

    tbody.innerHTML = list.map(r => `
      <tr>
        <td style="white-space:nowrap">${r.tanggalBayar ? fmtTgl(r.tanggalBayar) : '–'}</td>
        <td>${r.supplier || '–'}</td>
        <td>${r.namaProduk || '–'}</td>
        <td style="text-align:center;font-weight:600">${r.qtyBayar || 0}</td>
        <td>${formatRp(r.hargaTitip || 0)}</td>
        <td style="font-weight:700;color:var(--gold)">${formatRp(r.totalBayar || 0)}</td>
        <td style="color:var(--text-muted);font-size:0.82rem">${r.catatan || '–'}</td>
      </tr>`).join('');

  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Gagal memuat riwayat</td></tr>';
    console.error('loadRiwayatBayar error:', e);
  }
}

/* ============================================================
   MODAL BAYAR SUPPLIER
   ============================================================ */

/**
 * Buka modal Bayar Supplier dengan informasi konteks yang relevan.
 * @param {string} produkId
 * @param {string} namaProduk
 * @param {string} supplier
 * @param {number} qBelum - jumlah yang belum dibayar
 * @param {number} hargaTitip
 */
function openModalBayar(produkId, namaProduk, supplier, qBelum, hargaTitip) {
  _bayarCtx = {
    produkId,
    namaProduk,
    supplier,
    qBelum:     parseInt(qBelum)    || 0,
    hargaTitip: parseInt(hargaTitip) || 0,
  };
  const ib = _el('bayar-info-box');
  if (ib) {
    ib.innerHTML = `
      <div class="kons-info-row"><span>Produk</span><b>${namaProduk}</b></div>
      <div class="kons-info-row"><span>Supplier</span><b>${supplier}</b></div>
      <div class="kons-info-row"><span>Harga Titip</span><b>${formatRp(hargaTitip)}</b></div>
      <div class="kons-info-row"><span>Belum Dibayar</span><b style="color:var(--danger)">${qBelum} pcs</b></div>`;
  }
  _setTxt('bayar-max-info', `Maksimal ${_bayarCtx.qBelum} pcs`);
  _setVal('bayar-tanggal', new Date().toISOString().split('T')[0]);
  _setVal('bayar-qty',     '');
  _setVal('bayar-catatan', '');
  _setTxt('bayar-total-display', 'Rp 0');
  if (_el('bayar-total-val')) _el('bayar-total-val').value = 0;
  openModal('modal-bayar-konsinyasi');
}

/**
 * Hitung dan tampilkan total bayar saat qty berubah.
 */
function hitungTotalBayar() {
  const qty   = parseInt(_el('bayar-qty')?.value || 0) || 0;
  const total = qty * (_bayarCtx.hargaTitip || 0);
  _setTxt('bayar-total-display', formatRp(total));
  if (_el('bayar-total-val')) _el('bayar-total-val').value = total;
}

/**
 * Proses pembayaran: simpan ke consignment_payment dan
 * update qtyDibayar di consignment_stock (FIFO).
 */
async function konfirmasiBayar() {
  const tanggal = _el('bayar-tanggal')?.value;
  const qty     = parseInt(_el('bayar-qty')?.value || 0);
  const catatan = _el('bayar-catatan')?.value.trim() || '';

  if (!tanggal || qty <= 0) {
    showToast('Tanggal dan Qty Bayar wajib diisi!', 'error'); return;
  }
  if (qty > _bayarCtx.qBelum) {
    showToast(`Qty bayar melebihi sisa hutang (${_bayarCtx.qBelum} pcs)!`, 'error'); return;
  }

  const totalBayar = qty * (_bayarCtx.hargaTitip || 0);
  const btnT = _el('btn-bayar-k-text');
  const btnS = _el('btn-bayar-k-spin');
  if (btnT) btnT.classList.add('hidden');
  if (btnS) btnS.classList.remove('hidden');

  try {
    const now   = firebase.firestore.Timestamp.now();
    const tglTs = firebase.firestore.Timestamp.fromDate(new Date(tanggal + 'T00:00:00'));

    // Simpan record pembayaran
    await db.collection('consignment_payment').add({
      productId:    _bayarCtx.produkId,
      namaProduk:   _bayarCtx.namaProduk,
      supplier:     _bayarCtx.supplier,
      qtyBayar:     qty,
      hargaTitip:   _bayarCtx.hargaTitip,
      totalBayar,
      tanggalBayar: tglTs,
      catatan,
      createdAt:    now,
    });

    // Update qtyDibayar di consignment_stock secara FIFO
    const snap = await db.collection('consignment_stock')
      .where('productId', '==', _bayarCtx.produkId)
      .orderBy('tanggalMasuk', 'asc')
      .get();

    let remaining = qty;
    const batch   = db.batch();
    for (const doc of snap.docs) {
      if (remaining <= 0) break;
      const d          = doc.data();
      const belumBayar = (d.qtyTerjual || 0) - (d.qtyDibayar || 0);
      if (belumBayar <= 0) continue;
      const bayarIni = Math.min(remaining, belumBayar);
      batch.update(doc.ref, {
        qtyDibayar: firebase.firestore.FieldValue.increment(bayarIni),
        updatedAt:  now,
      });
      remaining -= bayarIni;
    }
    await batch.commit();

    closeModal('modal-bayar-konsinyasi');
    showToast(`Pembayaran ${formatRp(totalBayar)} berhasil dicatat! ✅`, 'success');
    loadRekap();
    loadRiwayatBayar();

  } catch (e) {
    showToast('Gagal mencatat pembayaran: ' + e.message, 'error');
    console.error('konfirmasiBayar error:', e);
  } finally {
    if (btnT) btnT.classList.remove('hidden');
    if (btnS) btnS.classList.add('hidden');
  }
}

/* ============================================================
   MODAL RETUR BARANG
   ============================================================ */

/**
 * Buka modal Retur dengan konteks produk yang dipilih.
 * Ambil total qtySisa terkini dari Firestore.
 * @param {string} produkId
 * @param {string} namaProduk
 * @param {string} supplier
 */
async function openModalRetur(produkId, namaProduk, supplier) {
  try {
    const snap   = await db.collection('consignment_stock')
      .where('productId', '==', produkId).get();
    const qtySisa = snap.docs.reduce((s, d) => s + (d.data().qtySisa || 0), 0);

    _returCtx = { produkId, namaProduk, supplier, qtySisa };

    const ib = _el('retur-info-box');
    if (ib) {
      ib.innerHTML = `
        <div class="kons-info-row"><span>Produk</span><b>${namaProduk}</b></div>
        <div class="kons-info-row"><span>Supplier</span><b>${supplier}</b></div>
        <div class="kons-info-row"><span>Stok Sisa</span><b style="color:var(--success)">${qtySisa} pcs</b></div>`;
    }
    _setTxt('retur-max-info', `Maksimal ${qtySisa} pcs`);
    _setVal('retur-tanggal', new Date().toISOString().split('T')[0]);
    _setVal('retur-qty',     '');
    _setVal('retur-catatan', '');
    openModal('modal-retur-konsinyasi');

  } catch (e) {
    showToast('Gagal memuat data retur: ' + e.message, 'error');
    console.error('openModalRetur error:', e);
  }
}

/**
 * Proses retur: simpan ke consignment_return dan
 * kurangi qtySisa di consignment_stock (FIFO).
 */
async function konfirmasiRetur() {
  const tanggal  = _el('retur-tanggal')?.value;
  const qtyRetur = parseInt(_el('retur-qty')?.value || 0);
  const catatan  = _el('retur-catatan')?.value.trim() || '';

  if (!tanggal || qtyRetur <= 0) {
    showToast('Tanggal dan Qty Retur wajib diisi!', 'error'); return;
  }
  if (qtyRetur > _returCtx.qtySisa) {
    showToast(`Qty retur melebihi stok sisa (${_returCtx.qtySisa} pcs)!`, 'error'); return;
  }

  const btnT = _el('btn-retur-text');
  const btnS = _el('btn-retur-spin');
  if (btnT) btnT.classList.add('hidden');
  if (btnS) btnS.classList.remove('hidden');

  try {
    const now   = firebase.firestore.Timestamp.now();
    const tglTs = firebase.firestore.Timestamp.fromDate(new Date(tanggal + 'T00:00:00'));

    // Simpan record retur
    await db.collection('consignment_return').add({
      productId:    _returCtx.produkId,
      namaProduk:   _returCtx.namaProduk,
      supplier:     _returCtx.supplier,
      qtyRetur,
      tanggalRetur: tglTs,
      catatan,
      createdAt:    now,
    });

    // Kurangi qtySisa di consignment_stock secara FIFO
    const snap = await db.collection('consignment_stock')
      .where('productId', '==', _returCtx.produkId)
      .orderBy('tanggalMasuk', 'asc')
      .get();

    let remaining = qtyRetur;
    const batch   = db.batch();
    for (const doc of snap.docs) {
      if (remaining <= 0) break;
      const qSisa  = doc.data().qtySisa || 0;
      if (qSisa <= 0) continue;
      const deduct = Math.min(remaining, qSisa);
      batch.update(doc.ref, {
        qtySisa:   firebase.firestore.FieldValue.increment(-deduct),
        qtyRetur:  firebase.firestore.FieldValue.increment(deduct),
        updatedAt: now,
      });
      remaining -= deduct;
    }
    await batch.commit();

    // Perbarui cache lokal
    konsinyasiStokCache[_returCtx.produkId] = Math.max(
      (konsinyasiStokCache[_returCtx.produkId] || 0) - qtyRetur, 0
    );

    closeModal('modal-retur-konsinyasi');
    showToast(`Retur ${qtyRetur} pcs berhasil dicatat! ✅`, 'success');
    loadRekap();

  } catch (e) {
    showToast('Gagal mencatat retur: ' + e.message, 'error');
    console.error('konfirmasiRetur error:', e);
  } finally {
    if (btnT) btnT.classList.remove('hidden');
    if (btnS) btnS.classList.add('hidden');
  }
}

/* ============================================================
   LAPORAN KONSINYASI — dashboard ringkas & tabel
   ============================================================ */

/**
 * Hitung dan tampilkan statistik ringkas konsinyasi:
 * total supplier, produk, stok sisa, dan total hutang.
 */
async function loadDashboardKonsinyasi() {
  try {
    const snap = await db.collection('consignment_stock').get();
    const list = snap.docs.map(d => d.data());

    const suppliers = new Set(list.map(r => r.supplier).filter(Boolean));
    const produkSet = new Set(list.map(r => r.productId).filter(Boolean));
    const totalStok = list.reduce((s, r) => s + (r.qtySisa || 0), 0);

    // Hitung total hutang: (qtyTerjual - qtyDibayar) × hargaTitip per produk
    const pMap = {};
    list.forEach(r => {
      const pid = r.productId;
      if (!pMap[pid]) pMap[pid] = { hargaTitip: r.hargaTitip || 0, belum: 0 };
      pMap[pid].belum += Math.max((r.qtyTerjual || 0) - (r.qtyDibayar || 0), 0);
    });
    const totalHutang = Object.values(pMap).reduce((s, p) => s + p.belum * p.hargaTitip, 0);

    _setTxt('kd-total-supplier', suppliers.size);
    _setTxt('kd-total-produk',   produkSet.size);
    _setTxt('kd-total-stok',     totalStok);
    _setTxt('kd-total-hutang',   formatRp(totalHutang));

  } catch (e) {
    console.error('loadDashboardKonsinyasi error:', e);
  }
}

/**
 * Muat tabel laporan konsinyasi dengan filter tanggal, supplier, dan produk.
 * Data diagregasi per productId.
 */
async function loadLaporanKonsinyasi() {
  const awal      = _el('kl-awal')?.value;
  const akhir     = _el('kl-akhir')?.value;
  const fSupplier = (_el('kl-supplier')?.value || '').toLowerCase().trim();
  const fProduk   = (_el('kl-produk')?.value   || '').toLowerCase().trim();
  const tbody     = _el('tabel-laporan-konsinyasi');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Memuat laporan...</td></tr>';

  try {
    let q = db.collection('consignment_stock').orderBy('tanggalMasuk', 'desc');
    if (awal)  q = q.where('tanggalMasuk', '>=', firebase.firestore.Timestamp.fromDate(new Date(awal  + 'T00:00:00')));
    if (akhir) q = q.where('tanggalMasuk', '<=', firebase.firestore.Timestamp.fromDate(new Date(akhir + 'T23:59:59')));

    const snap = await q.get();
    let list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (fSupplier) list = list.filter(r => (r.supplier   || '').toLowerCase().includes(fSupplier));
    if (fProduk)   list = list.filter(r => (r.namaProduk || '').toLowerCase().includes(fProduk));

    // Agregasi per productId
    const pMap = {};
    list.forEach(r => {
      const key = r.productId;
      if (!pMap[key]) {
        pMap[key] = {
          supplier:   r.supplier   || '–',
          namaProduk: r.namaProduk || '–',
          hargaTitip: r.hargaTitip || 0,
          qMasuk: 0, qTerjual: 0, qDibayar: 0, qRetur: 0, qSisa: 0,
        };
      }
      pMap[key].qMasuk   += r.qtyMasuk   || 0;
      pMap[key].qTerjual += r.qtyTerjual  || 0;
      pMap[key].qDibayar += r.qtyDibayar  || 0;
      pMap[key].qRetur   += r.qtyRetur    || 0;
      pMap[key].qSisa    += r.qtySisa     || 0;
    });

    const rows = Object.values(pMap);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Tidak ada data pada periode ini</td></tr>'; return;
    }

    tbody.innerHTML = rows.map(r => {
      const belum  = r.qTerjual - r.qDibayar;
      const hutang = belum * r.hargaTitip;
      return `
        <tr>
          <td style="font-weight:500">${r.supplier}</td>
          <td>${r.namaProduk}</td>
          <td style="text-align:center">${r.qMasuk}</td>
          <td style="text-align:center;color:var(--success)">${r.qTerjual}</td>
          <td style="text-align:center;color:var(--gold)">${r.qDibayar}</td>
          <td style="text-align:center;color:var(--warning)">${r.qRetur}</td>
          <td style="text-align:center;font-weight:600">${r.qSisa}</td>
          <td>${formatRp(r.hargaTitip)}</td>
          <td style="font-weight:700;color:${hutang > 0 ? 'var(--danger)' : 'var(--success)'}">${formatRp(hutang)}</td>
        </tr>`;
    }).join('');

  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Gagal memuat laporan</td></tr>';
    showToast('Gagal memuat laporan konsinyasi: ' + e.message, 'error');
    console.error('loadLaporanKonsinyasi error:', e);
  }
}

/* ============================================================
   HELPERS
   ============================================================ */

/**
 * Format Firestore Timestamp atau Date ke string tanggal Indonesia.
 * @param {firebase.firestore.Timestamp|Date} ts
 * @returns {string} mis. "01 Jan 2026"
 */
function fmtTgl(ts) {
  if (!ts) return '–';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Escape string untuk digunakan aman dalam atribut HTML onclick.
 * @param {string} s
 * @returns {string}
 */
function escStr(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '&quot;');
}
