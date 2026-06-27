/* ================================================
   TIKUM POS — Modul Konsinyasi
   Collections: consignment_stock, consignment_payment, consignment_return
   ================================================ */

'use strict';

// =============================================
// MASTER PRODUK — toggle konsinyasi fields
// =============================================
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

// =============================================
// KASIR — update consignment_stock saat terjual
// =============================================
async function updateKonsinyasiStokTerjual(produkId, qty) {
  try {
    // Cari batch consignment_stock terbaru yang masih punya qtySisa
    const snap = await db.collection('consignment_stock')
      .where('productId', '==', produkId)
      .orderBy('tanggalMasuk', 'asc')
      .get();

    let remaining = qty;
    for (const doc of snap.docs) {
      if (remaining <= 0) break;
      const data     = doc.data();
      const qSisa    = data.qtySisa || 0;
      if (qSisa <= 0) continue;
      const deduct   = Math.min(remaining, qSisa);
      await db.collection('consignment_stock').doc(doc.id).update({
        qtySisa:    firebase.firestore.FieldValue.increment(-deduct),
        qtyTerjual: firebase.firestore.FieldValue.increment(deduct),
        updatedAt:  firebase.firestore.Timestamp.now(),
      });
      remaining -= deduct;
    }
    // Refresh cache kasir jika sudah di-load
    if (typeof konsinyasiStokCache !== 'undefined') {
      konsinyasiStokCache[produkId] = Math.max((konsinyasiStokCache[produkId] || 0) - qty, 0);
    }
  } catch (e) {
    console.error('Update konsinyasi stok terjual error:', e);
  }
}

// =============================================
// BARANG MASUK — populate produk select
// =============================================
function populateKmProdukSelect() {
  const sel = _el('km-produk');
  if (!sel) return;
  const konsProduk = (typeof allProduk !== 'undefined' ? allProduk : [])
    .filter(p => p.jenis === 'konsinyasi' && p.status === 'aktif');
  sel.innerHTML = '<option value="">— Pilih Produk —</option>' +
    konsProduk.map(p => `<option value="${p.id}" data-supplier="${p.supplier||''}" data-harga="${p.hargaTitip||0}">${p.nama}</option>`).join('');
}

function onKmProdukChange() {
  const sel  = _el('km-produk');
  const opt  = sel?.options[sel.selectedIndex];
  _setVal('km-supplier',    opt?.dataset.supplier || '');
  const ht = opt?.dataset.harga;
  _el('km-harga-titip').value = ht ? 'Rp ' + parseInt(ht).toLocaleString('id-ID') : '';
}

async function simpanBarangMasuk() {
  const tanggal = _el('km-tanggal')?.value;
  const produkId = _el('km-produk')?.value;
  const qtyMasuk = parseInt(_el('km-qty')?.value || 0);
  const catatan  = _el('km-catatan')?.value.trim() || '';

  if (!tanggal || !produkId || qtyMasuk <= 0) {
    showToast('Tanggal, Produk, dan Qty Masuk wajib diisi!', 'error'); return;
  }

  const produk = (typeof allProduk !== 'undefined' ? allProduk : []).find(p => p.id === produkId);
  if (!produk) { showToast('Produk tidak ditemukan!', 'error'); return; }

  const btnT = _el('btn-km-text'); const btnS = _el('btn-km-spinner');
  btnT.classList.add('hidden'); btnS.classList.remove('hidden');

  try {
    const now = firebase.firestore.Timestamp.now();
    const tgl = firebase.firestore.Timestamp.fromDate(new Date(tanggal + 'T00:00:00'));

    await db.collection('consignment_stock').add({
      productId:   produkId,
      namaProduk:  produk.nama,
      supplier:    produk.supplier || '',
      hargaTitip:  produk.hargaTitip || 0,
      qtyMasuk,
      qtySisa:     qtyMasuk,
      qtyTerjual:  0,
      qtyDibayar:  0,
      qtyRetur:    0,
      tanggalMasuk: tgl,
      catatan,
      createdAt:   now,
      updatedAt:   now,
    });

    showToast('Barang masuk berhasil dicatat! ✅', 'success');
    _setVal('km-qty', '');
    _setVal('km-catatan', '');
    _el('km-produk').value = '';
    _setVal('km-supplier', '');
    _el('km-harga-titip').value = '';
    loadBarangMasuk();
    // Refresh cache stok kasir
    if (typeof konsinyasiStokCache !== 'undefined') {
      konsinyasiStokCache[produkId] = (konsinyasiStokCache[produkId] || 0) + qtyMasuk;
    }
  } catch (e) { showToast('Gagal menyimpan: ' + e.message, 'error'); }
  finally { btnT.classList.remove('hidden'); btnS.classList.add('hidden'); }
}

async function loadBarangMasuk() {
  const awal  = _el('km-filter-awal')?.value;
  const akhir = _el('km-filter-akhir')?.value;
  const tbody = _el('tabel-barang-masuk');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Memuat data...</td></tr>';

  try {
    let q = db.collection('consignment_stock').orderBy('tanggalMasuk', 'desc');
    if (awal)  q = q.where('tanggalMasuk', '>=', firebase.firestore.Timestamp.fromDate(new Date(awal  + 'T00:00:00')));
    if (akhir) q = q.where('tanggalMasuk', '<=', firebase.firestore.Timestamp.fromDate(new Date(akhir + 'T23:59:59')));

    const snap = await q.get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Tidak ada data barang masuk pada periode ini</td></tr>'; return;
    }

    tbody.innerHTML = list.map(r => `
      <tr>
        <td>${r.tanggalMasuk ? fmtTgl(r.tanggalMasuk) : '–'}</td>
        <td style="font-weight:500">${r.namaProduk||'–'}</td>
        <td>${r.supplier||'–'}</td>
        <td style="text-align:center;font-weight:600">${r.qtyMasuk}</td>
        <td>${formatRp(r.hargaTitip||0)}</td>
        <td style="color:var(--text-muted);font-size:0.82rem">${r.catatan||'–'}</td>
        <td>
          <div class="tbl-actions">
            <span style="font-size:0.75rem;color:var(--text-muted)">Sisa: <b>${r.qtySisa||0}</b></span>
          </div>
        </td>
      </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Gagal memuat data</td></tr>';
    showToast('Gagal memuat barang masuk: ' + e.message, 'error');
  }
}

// =============================================
// PEMBAYARAN — rekap per supplier & produk
// =============================================
async function loadRekap() {
  const filterSupplier = (_el('pay-filter-supplier')?.value || '').toLowerCase().trim();
  const tbody = _el('tabel-rekap-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Memuat rekap...</td></tr>';

  try {
    const snap = await db.collection('consignment_stock').get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    // Filter supplier
    const filtered = filterSupplier
      ? list.filter(r => (r.supplier||'').toLowerCase().includes(filterSupplier))
      : list;

    if (!filtered.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Tidak ada data</td></tr>'; return;
    }

    // Gabungkan per productId
    const map = {};
    filtered.forEach(r => {
      const key = r.productId;
      if (!map[key]) map[key] = { supplier:r.supplier||'–', namaProduk:r.namaProduk||'–', hargaTitip:r.hargaTitip||0, rows:[] };
      map[key].rows.push(r);
    });

    let html = '';
    for (const [pid, data] of Object.entries(map)) {
      const qMasuk   = data.rows.reduce((s, r) => s + (r.qtyMasuk   || 0), 0);
      const qTerjual = data.rows.reduce((s, r) => s + (r.qtyTerjual || 0), 0);
      const qDibayar = data.rows.reduce((s, r) => s + (r.qtyDibayar || 0), 0);
      const qBelum   = qTerjual - qDibayar;
      const totalHutang = qBelum * data.hargaTitip;
      html += `
        <tr>
          <td style="font-weight:500">${data.supplier}</td>
          <td>${data.namaProduk}</td>
          <td style="text-align:center">${qMasuk}</td>
          <td style="text-align:center;color:var(--success)">${qTerjual}</td>
          <td style="text-align:center;color:var(--gold)">${qDibayar}</td>
          <td style="text-align:center;color:${qBelum>0?'var(--danger)':'var(--text-muted)'};font-weight:600">${qBelum}</td>
          <td>${formatRp(data.hargaTitip)}</td>
          <td style="font-weight:700;color:var(--danger)">${formatRp(totalHutang)}</td>
          <td>
            <div class="tbl-actions">
              <button class="btn-icon edit" onclick="openModalBayar('${pid}','${escStr(data.namaProduk)}','${escStr(data.supplier)}',${qBelum},${data.hargaTitip})" title="Bayar">💳</button>
              <button class="btn-icon hapus" onclick="openModalRetur('${pid}','${escStr(data.namaProduk)}','${escStr(data.supplier)}')" title="Retur">↩️</button>
            </div>
          </td>
        </tr>`;
    }
    tbody.innerHTML = html;
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Gagal memuat rekap</td></tr>';
    showToast('Gagal memuat rekap: ' + e.message, 'error');
  }
}

async function loadRiwayatBayar() {
  const tbody = _el('tabel-riwayat-bayar');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Memuat...</td></tr>';
  try {
    const snap = await db.collection('consignment_payment').orderBy('tanggalBayar','desc').limit(50).get();
    const list = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    if (!list.length) { tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Belum ada riwayat pembayaran</td></tr>'; return; }
    tbody.innerHTML = list.map(r => `
      <tr>
        <td>${r.tanggalBayar ? fmtTgl(r.tanggalBayar) : '–'}</td>
        <td>${r.supplier||'–'}</td>
        <td>${r.namaProduk||'–'}</td>
        <td style="text-align:center;font-weight:600">${r.qtyBayar||0}</td>
        <td>${formatRp(r.hargaTitip||0)}</td>
        <td style="font-weight:700;color:var(--gold)">${formatRp(r.totalBayar||0)}</td>
        <td style="color:var(--text-muted);font-size:0.82rem">${r.catatan||'–'}</td>
      </tr>`).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">Gagal memuat riwayat</td></tr>';
  }
}

// =============================================
// MODAL BAYAR
// =============================================
let _bayarCtx = {};

function openModalBayar(produkId, namaProduk, supplier, qBelum, hargaTitip) {
  _bayarCtx = { produkId, namaProduk, supplier, qBelum: parseInt(qBelum)||0, hargaTitip: parseInt(hargaTitip)||0 };
  _el('bayar-info-box').innerHTML = `
    <div class="kons-info-row"><span>Produk</span><b>${namaProduk}</b></div>
    <div class="kons-info-row"><span>Supplier</span><b>${supplier}</b></div>
    <div class="kons-info-row"><span>Harga Titip</span><b>${formatRp(hargaTitip)}</b></div>
    <div class="kons-info-row"><span>Belum Dibayar</span><b style="color:var(--danger)">${qBelum} pcs</b></div>`;
  _setTxt('bayar-max-info', `Maksimal ${qBelum} pcs`);
  _setVal('bayar-tanggal', new Date().toISOString().split('T')[0]);
  _setVal('bayar-qty', '');
  _setVal('bayar-catatan', '');
  _setTxt('bayar-total-display', 'Rp 0');
  _el('bayar-total-val').value = 0;
  openModal('modal-bayar-konsinyasi');
}

function hitungTotalBayar() {
  const qty   = parseInt(_el('bayar-qty')?.value || 0) || 0;
  const total = qty * (_bayarCtx.hargaTitip || 0);
  _setTxt('bayar-total-display', formatRp(total));
  _el('bayar-total-val').value = total;
}

async function konfirmasiBayar() {
  const tanggal = _el('bayar-tanggal')?.value;
  const qty     = parseInt(_el('bayar-qty')?.value || 0);
  const catatan = _el('bayar-catatan')?.value.trim() || '';

  if (!tanggal || qty <= 0) { showToast('Tanggal dan Qty Bayar wajib diisi!', 'error'); return; }
  if (qty > _bayarCtx.qBelum) { showToast(`Qty bayar melebihi sisa hutang (${_bayarCtx.qBelum} pcs)!`, 'error'); return; }

  const totalBayar = qty * (_bayarCtx.hargaTitip || 0);
  const btnT = _el('btn-bayar-k-text'); const btnS = _el('btn-bayar-k-spin');
  btnT.classList.add('hidden'); btnS.classList.remove('hidden');

  try {
    const now    = firebase.firestore.Timestamp.now();
    const tglTs  = firebase.firestore.Timestamp.fromDate(new Date(tanggal + 'T00:00:00'));

    // Simpan ke consignment_payment
    await db.collection('consignment_payment').add({
      productId:   _bayarCtx.produkId,
      namaProduk:  _bayarCtx.namaProduk,
      supplier:    _bayarCtx.supplier,
      qtyBayar:    qty,
      hargaTitip:  _bayarCtx.hargaTitip,
      totalBayar,
      tanggalBayar: tglTs,
      catatan,
      createdAt:   now,
    });

    // Update qtyDibayar di consignment_stock (FIFO dari yang terlama)
    const snap = await db.collection('consignment_stock')
      .where('productId', '==', _bayarCtx.produkId)
      .orderBy('tanggalMasuk', 'asc')
      .get();

    let remaining = qty;
    const batch = db.batch();
    for (const doc of snap.docs) {
      if (remaining <= 0) break;
      const data       = doc.data();
      const belumBayar = (data.qtyTerjual || 0) - (data.qtyDibayar || 0);
      if (belumBayar <= 0) continue;
      const bayarIni   = Math.min(remaining, belumBayar);
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
  } catch (e) { showToast('Gagal mencatat pembayaran: ' + e.message, 'error'); }
  finally { btnT.classList.remove('hidden'); btnS.classList.add('hidden'); }
}

// =============================================
// MODAL RETUR
// =============================================
let _returCtx = {};

async function openModalRetur(produkId, namaProduk, supplier) {
  // Cari qtySisa total untuk produk ini
  const snap = await db.collection('consignment_stock')
    .where('productId', '==', produkId).get();
  const qtySisa = snap.docs.reduce((s, d) => s + (d.data().qtySisa || 0), 0);

  _returCtx = { produkId, namaProduk, supplier, qtySisa };
  _el('retur-info-box').innerHTML = `
    <div class="kons-info-row"><span>Produk</span><b>${namaProduk}</b></div>
    <div class="kons-info-row"><span>Supplier</span><b>${supplier}</b></div>
    <div class="kons-info-row"><span>Stok Sisa</span><b style="color:var(--success)">${qtySisa} pcs</b></div>`;
  _setTxt('retur-max-info', `Maksimal ${qtySisa} pcs`);
  _setVal('retur-tanggal', new Date().toISOString().split('T')[0]);
  _setVal('retur-qty', '');
  _setVal('retur-catatan', '');
  openModal('modal-retur-konsinyasi');
}

async function konfirmasiRetur() {
  const tanggal  = _el('retur-tanggal')?.value;
  const qtyRetur = parseInt(_el('retur-qty')?.value || 0);
  const catatan  = _el('retur-catatan')?.value.trim() || '';

  if (!tanggal || qtyRetur <= 0) { showToast('Tanggal dan Qty Retur wajib diisi!', 'error'); return; }
  if (qtyRetur > _returCtx.qtySisa) {
    showToast(`Qty retur melebihi stok sisa (${_returCtx.qtySisa} pcs)!`, 'error'); return;
  }

  const btnT = _el('btn-retur-text'); const btnS = _el('btn-retur-spin');
  btnT.classList.add('hidden'); btnS.classList.remove('hidden');

  try {
    const now   = firebase.firestore.Timestamp.now();
    const tglTs = firebase.firestore.Timestamp.fromDate(new Date(tanggal + 'T00:00:00'));

    // Simpan ke consignment_return
    await db.collection('consignment_return').add({
      productId:   _returCtx.produkId,
      namaProduk:  _returCtx.namaProduk,
      supplier:    _returCtx.supplier,
      qtyRetur,
      tanggalRetur: tglTs,
      catatan,
      createdAt:   now,
    });

    // Kurangi qtySisa di consignment_stock (FIFO terlama)
    const snap = await db.collection('consignment_stock')
      .where('productId', '==', _returCtx.produkId)
      .orderBy('tanggalMasuk', 'asc')
      .get();

    let remaining = qtyRetur;
    const batch = db.batch();
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

    // Refresh cache
    if (typeof konsinyasiStokCache !== 'undefined') {
      konsinyasiStokCache[_returCtx.produkId] = Math.max((konsinyasiStokCache[_returCtx.produkId]||0) - qtyRetur, 0);
    }

    closeModal('modal-retur-konsinyasi');
    showToast(`Retur ${qtyRetur} pcs berhasil dicatat! ✅`, 'success');
    loadRekap();
  } catch (e) { showToast('Gagal mencatat retur: ' + e.message, 'error'); }
  finally { btnT.classList.remove('hidden'); btnS.classList.add('hidden'); }
}

// =============================================
// LAPORAN KONSINYASI
// =============================================
async function loadDashboardKonsinyasi() {
  try {
    const snap = await db.collection('consignment_stock').get();
    const list = snap.docs.map(d => d.data());

    const suppliers = new Set(list.map(r => r.supplier).filter(Boolean));
    const produkSet = new Set(list.map(r => r.productId).filter(Boolean));
    const totalStok = list.reduce((s, r) => s + (r.qtySisa || 0), 0);

    // Hitung total hutang per produk
    const pMap = {};
    list.forEach(r => {
      const pid = r.productId;
      if (!pMap[pid]) pMap[pid] = { hargaTitip: r.hargaTitip || 0, belum: 0 };
      pMap[pid].belum += Math.max((r.qtyTerjual || 0) - (r.qtyDibayar || 0), 0);
    });
    const totalHutang = Object.values(pMap).reduce((s, p) => s + p.belum * p.hargaTitip, 0);

    _setTxt('kd-total-supplier', suppliers.size);
    _setTxt('kd-total-produk',  produkSet.size);
    _setTxt('kd-total-stok',    totalStok);
    _setTxt('kd-total-hutang',  formatRp(totalHutang));
  } catch (e) { console.error('Dashboard konsinyasi error:', e); }
}

async function loadLaporanKonsinyasi() {
  const awal     = _el('kl-awal')?.value;
  const akhir    = _el('kl-akhir')?.value;
  const fSupplier = (_el('kl-supplier')?.value||'').toLowerCase().trim();
  const fProduk   = (_el('kl-produk')?.value||'').toLowerCase().trim();
  const tbody     = _el('tabel-laporan-konsinyasi');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Memuat laporan...</td></tr>';

  try {
    let q = db.collection('consignment_stock').orderBy('tanggalMasuk', 'desc');
    if (awal)  q = q.where('tanggalMasuk', '>=', firebase.firestore.Timestamp.fromDate(new Date(awal  + 'T00:00:00')));
    if (akhir) q = q.where('tanggalMasuk', '<=', firebase.firestore.Timestamp.fromDate(new Date(akhir + 'T23:59:59')));

    const snap = await q.get();
    let list = snap.docs.map(d => ({ id:d.id, ...d.data() }));

    if (fSupplier) list = list.filter(r => (r.supplier||'').toLowerCase().includes(fSupplier));
    if (fProduk)   list = list.filter(r => (r.namaProduk||'').toLowerCase().includes(fProduk));

    // Agregasi per productId
    const pMap = {};
    list.forEach(r => {
      const key = r.productId;
      if (!pMap[key]) pMap[key] = {
        supplier: r.supplier||'–', namaProduk: r.namaProduk||'–',
        hargaTitip: r.hargaTitip||0,
        qMasuk:0, qTerjual:0, qDibayar:0, qRetur:0, qSisa:0,
      };
      pMap[key].qMasuk   += r.qtyMasuk   || 0;
      pMap[key].qTerjual += r.qtyTerjual || 0;
      pMap[key].qDibayar += r.qtyDibayar || 0;
      pMap[key].qRetur   += r.qtyRetur   || 0;
      pMap[key].qSisa    += r.qtySisa    || 0;
    });

    const rows = Object.values(pMap);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Tidak ada data pada periode ini</td></tr>'; return;
    }

    tbody.innerHTML = rows.map(r => {
      const belum    = r.qTerjual - r.qDibayar;
      const hutang   = belum * r.hargaTitip;
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
          <td style="font-weight:700;color:${hutang>0?'var(--danger)':'var(--success)'}">${formatRp(hutang)}</td>
        </tr>`;
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-state">Gagal memuat laporan</td></tr>';
    showToast('Gagal memuat laporan konsinyasi: ' + e.message, 'error');
  }
}

// =============================================
// INIT DEFAULT DATES
// =============================================
document.addEventListener('DOMContentLoaded', () => {
  const today        = new Date().toISOString().split('T')[0];
  const firstOfMonth = today.substring(0, 7) + '-01';

  _setVal('km-tanggal',      today);
  _setVal('km-filter-awal',  firstOfMonth);
  _setVal('km-filter-akhir', today);
  _setVal('kl-awal',         firstOfMonth);
  _setVal('kl-akhir',        today);
});

// =============================================
// HELPERS
// =============================================
function fmtTgl(ts) {
  if (!ts) return '–';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' });
}

function escStr(s) {
  return (s||'').replace(/'/g,"\\'").replace(/"/g,'&quot;');
}
