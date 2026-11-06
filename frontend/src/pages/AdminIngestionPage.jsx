import React, { useState, useRef, useEffect } from 'react';
import {
  CheckCircle2,
  Circle,
  FileText,
  Database,
  RefreshCw,
  ArrowLeft,
  UploadCloud,
  Sliders,
  Check,
  ChevronDown,
  Info
} from 'lucide-react';
import {
  fetchDocuments,
  fetchStorageStats,
  uploadDocument
} from '../services/api';

// Kamus master referensi emiten terdaftar di BEI untuk auto-fill & suggestion
const IDX_TICKER_SUGGESTIONS = [
  { code: 'BBCA', name: 'PT Bank Central Asia Tbk.' },
  { code: 'BBNI', name: 'PT Bank Negara Indonesia (Persero) Tbk.' },
  { code: 'BBRI', name: 'PT Bank Rakyat Indonesia (Persero) Tbk.' },
  { code: 'BMRI', name: 'PT Bank Mandiri (Persero) Tbk.' },
  { code: 'BBTN', name: 'PT Bank Tabungan Negara (Persero) Tbk.' },
  { code: 'BRIS', name: 'PT Bank Syariah Indonesia Tbk.' },
  { code: 'BDMN', name: 'PT Bank Danamon Indonesia Tbk.' },
  { code: 'BNGA', name: 'PT Bank CIMB Niaga Tbk.' },
  { code: 'ARTO', name: 'PT Bank Jago Tbk.' },
  { code: 'BTPN', name: 'PT Bank BTPN Tbk.' },
  { code: 'BFIN', name: 'PT BFI Finance Indonesia Tbk.' },
  { code: 'TLKM', name: 'PT Telkom Indonesia (Persero) Tbk.' },
  { code: 'ASII', name: 'PT Astra International Tbk.' },
  { code: 'GOTO', name: 'PT GoTo Gojek Tokopedia Tbk.' }
];

const COMPREHENSIVE_YEARS = ['2027', '2026', '2025', '2024', '2023', '2022', '2021', '2020'];

export default function AdminIngestionPage({ onBackToResearch }) {
  const fileInputRef = useRef(null);

  // State Dokumen Riil dari Server
  const [serverFiles, setServerFiles] = useState([]);
  const [storageStats, setStorageStats] = useState({
    collection_name: 'idx_financial_statements',
    total_chunks: 751,
    storage_used: '25.3 MB',
    storage_capacity: '10 GB',
    storage_percentage: 1
  });

  // State Berkas Unggahan (Awalnya kosong / belum ada berkas)
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // State Metadata (Dikosongkan di awal, otomatis terisi saat berkas dipilih)
  const [ticker, setTicker] = useState('');
  const [entityName, setEntityName] = useState('');
  const [fiscalYear, setFiscalYear] = useState('');
  const [quarter, setQuarter] = useState('');
  const [rounding, setRounding] = useState('Jutaan / In Million');

  // State Parameter Chunking & Vektorisasi
  const [showAdvancedParams, setShowAdvancedParams] = useState(false);
  const [chunkSize, setChunkSize] = useState(1000);
  const [overlapWindow, setOverlapWindow] = useState(100);
  const [embeddingModel] = useState('paraphrase-multilingual-MiniLM-L12-v2');

  // State Pipeline Proses
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [pipelineProgress, setPipelineProgress] = useState(0);
  const [ingestionComplete, setIngestionComplete] = useState(false);

  // Muat data dokumen dan statistik server saat komponen pertama kali dibuka
  useEffect(() => {
    let isMounted = true;
    const fetchInitialData = async () => {
      try {
        const [docs, storage] = await Promise.all([
          fetchDocuments(),
          fetchStorageStats()
        ]);
        if (!isMounted) return;
        if (docs) setServerFiles(docs);
        if (storage) setStorageStats(storage);
      } catch (err) {
        console.warn('[FinSight Admin] Gagal sinkronisasi data server:', err);
      }
    };
    fetchInitialData();
    return () => {
      isMounted = false;
    };
  }, []);

  const refreshAdminData = async () => {
    try {
      const [docs, storage] = await Promise.all([
        fetchDocuments(),
        fetchStorageStats()
      ]);
      if (docs) setServerFiles(docs);
      if (storage) setStorageStats(storage);
    } catch (err) {
      console.warn('[FinSight Admin] Gagal merefresh data admin:', err);
    }
  };

  // Helper auto-deteksi metadata dari nama berkas yang dipilih pengguna
  const handleFileSelection = (file) => {
    if (!file) return;
    setSelectedFile(file);
    setIngestionComplete(false);
    setPipelineProgress(0);

    const fname = file.name.toUpperCase();

    // 1. Ekstrak Ticker dari pola resmi BEI: FinancialStatement-YYYY-PERIOD-TICKER.xlsx
    let detectedTicker = '';
    const idxPattern = fname.match(/FINANCIALSTATEMENT-?\d{4}-?[A-Z0-9]+-?([A-Z0-9]+)/);
    if (idxPattern && idxPattern[1]) {
      detectedTicker = idxPattern[1].replace(/\.(XLSX|XLS|CSV)$/, '');
    } else {
      // Cek apakah ada kecocokan di kamus emiten
      for (const item of IDX_TICKER_SUGGESTIONS) {
        if (fname.includes(item.code)) {
          detectedTicker = item.code;
          break;
        }
      }
    }

    if (!detectedTicker) {
      const matchWord = fname.match(/\b([A-Z]{4})\b/);
      if (matchWord) detectedTicker = matchWord[1];
    }

    if (detectedTicker) {
      setTicker(detectedTicker);
      const matched = IDX_TICKER_SUGGESTIONS.find((e) => e.code === detectedTicker);
      if (matched) {
        setEntityName(matched.name);
      } else {
        setEntityName(`PT ${detectedTicker} Tbk.`);
      }
    } else {
      setTicker('');
      setEntityName('');
    }

    // 2. Ekstrak Tahun Fiskal
    const yearMatch = fname.match(/\b(202\d|201\d)\b/);
    if (yearMatch) {
      setFiscalYear(yearMatch[1]);
    } else {
      setFiscalYear('2026');
    }

    // 3. Ekstrak Kuartal / Periode Pelaporan
    if (fname.includes('TAHUNAN') || fname.includes('FY') || fname.includes('AUDITED') || fname.includes('-IV-') || fname.includes('_IV_')) {
      setQuarter('Tahunan');
    } else if (fname.includes('Q1') || fname.includes('-I-') || fname.includes('_I_')) {
      setQuarter('Q1');
    } else if (fname.includes('Q2') || fname.includes('-II-') || fname.includes('_II_')) {
      setQuarter('Q2');
    } else if (fname.includes('Q3') || fname.includes('-III-') || fname.includes('_III_')) {
      setQuarter('Q3');
    } else {
      setQuarter('Q1');
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0]);
    }
  };

  // Eksekusi Ingesti Nyata ke Backend FastAPI
  const handleStartIngestion = async () => {
    if (!selectedFile) {
      alert('Silakan pilih berkas Excel (.xlsx / .xls) atau CSV terlebih dahulu.');
      return;
    }
    setPipelineRunning(true);
    setIngestionComplete(false);
    setPipelineProgress(25);

    try {
      const t1 = setTimeout(() => setPipelineProgress(50), 500);
      const t2 = setTimeout(() => setPipelineProgress(75), 1200);

      await uploadDocument(selectedFile);

      clearTimeout(t1);
      clearTimeout(t2);
      setPipelineProgress(100);
      setPipelineRunning(false);
      setIngestionComplete(true);

      // Sinkronisasi data daftar berkas dan ChromaDB
      await refreshAdminData();
    } catch (err) {
      setPipelineRunning(false);
      alert(`Gagal memproses ingesti berkas: ${err.message}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto px-6 md:px-10 lg:px-16 py-8 bg-[#F8F9FA] font-sans">
      <div className="max-w-5xl mx-auto space-y-6 pb-20">
        
        {/* Top Back Action Bar */}
        <div className="flex items-center justify-between">
          <button
            type="button"
            onClick={onBackToResearch}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-gray-700 bg-white hover:bg-gray-50 border border-gray-200 rounded-lg transition-colors shadow-2xs cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Kembali ke Mode Riset (User)</span>
          </button>
        </div>

        {/* Top Status Bar: Koleksi Vektor & Penyimpanan Vektor (ChromaDB) */}
        <div className="bg-white rounded-xl border border-gray-200/90 px-4 py-2.5 shadow-2xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          {/* Koleksi Vektor */}
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-emerald-600 shrink-0" />
            <span className="text-gray-500 font-medium">Koleksi Vektor:</span>
            <code className="text-xs font-semibold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200/70 font-mono">
              {storageStats.collection_name || 'idx_financial_statements'}
            </code>
          </div>

          {/* Penyimpanan Vektor (ChromaDB) */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-gray-500 font-medium">Penyimpanan Vektor:</span>
            <div className="w-20 bg-gray-200 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-emerald-600 h-1.5 rounded-full transition-all duration-500"
                style={{ width: `${storageStats.storage_percentage}%` }}
              ></div>
            </div>
            <span className="font-bold text-gray-800 tabular-nums">
              {storageStats.storage_percentage}%
            </span>
            <span className="text-[11px] text-gray-400">
              ({storageStats.storage_used} / {storageStats.storage_capacity} • {storageStats.total_chunks} Chunks Aktif)
            </span>
          </div>
        </div>

        {/* Top Header Card */}
        <div className="bg-white rounded-2xl border border-gray-200/90 p-6 shadow-xs space-y-1.5">
          <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
            Ingesti & Vektorisasi Laporan Keuangan BEI
          </h1>
          <p className="text-xs sm:text-sm text-gray-500 leading-relaxed max-w-3xl">
            Unggah berkas laporan keuangan resmi (.xlsx / .csv) dari emiten BEI mana pun. Sistem akan mengekstrak tabel pos akun, membuat vektor embedding numerik, dan menyimpannya ke database ChromaDB.
          </p>
        </div>

        {/* Drag & Drop Upload Zone */}
        <section className="bg-white rounded-2xl border border-gray-200/90 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">
              Unggah Berkas Laporan Keuangan (.xlsx / .csv)
            </h2>
            <span className="text-[11px] text-gray-400 font-medium">Mendukung: Excel (.xlsx / .xls) & CSV</span>
          </div>

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files && e.target.files[0]) {
                handleFileSelection(e.target.files[0]);
              }
            }}
            accept=".xlsx,.xls,.csv"
            className="hidden"
          />

          {/* Interactive Dropzone */}
          <div
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current && fileInputRef.current.click()}
            className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-emerald-500 bg-emerald-50/50'
                : 'border-gray-300 hover:border-emerald-400 bg-gray-50/50 hover:bg-emerald-50/20'
            }`}
          >
            <div className="flex flex-col items-center justify-center space-y-2">
              <div className="w-12 h-12 rounded-full bg-emerald-100/80 text-emerald-700 flex items-center justify-center">
                <UploadCloud className="w-6 h-6" />
              </div>
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-gray-800">
                  <span className="text-emerald-700 underline">Klik untuk memilih berkas</span> atau seret berkas ke area ini
                </p>
                <p className="text-[11px] text-gray-400">
                  Format resmi BEI: FinancialStatement-[Tahun]-[Kuartal]-[KodeEmiten].xlsx
                </p>
              </div>
            </div>
          </div>

          {/* Active / Detected File Card */}
          {selectedFile && (
            <div className="p-3.5 rounded-xl bg-gray-50 border border-gray-200 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-bold text-gray-900 truncate">
                    {selectedFile.name}
                  </div>
                  <div className="text-[11px] text-gray-500">
                    Ukuran: {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB • Berkas Terdeteksi & Siap Divalidasi
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => fileInputRef.current && fileInputRef.current.click()}
                className="shrink-0 px-2.5 py-1 text-xs font-medium text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50 rounded-lg border border-emerald-200 transition-colors cursor-pointer"
              >
                Ganti Berkas
              </button>
            </div>
          )}
        </section>

        {/* Section: Form Penyesuaian Metadata (Editable Form) */}
        <section className="bg-white rounded-2xl border border-gray-200/90 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">
              Peninjauan & Penyesuaian Metadata Dokumen
            </h2>
          </div>

          {/* Banner Status Kontekstual */}
          {!selectedFile ? (
            <div className="p-3.5 rounded-xl bg-amber-50/70 border border-amber-200/80 text-xs text-amber-900 flex items-start gap-2.5">
              <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                <strong>Belum ada berkas yang dipilih:</strong> Silakan pilih atau seret berkas laporan keuangan (.xlsx / .csv) di atas terlebih dahulu. Sistem akan otomatis mendeteksi kode emiten, tahun, dan kuartal dari nama berkas untuk dapat Anda sesuaikan di sini.
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-emerald-50/80 border border-emerald-200 text-xs text-emerald-900 flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
              <div className="leading-relaxed">
                Metadata di bawah otomatis diekstrak dari berkas <strong>{selectedFile.name}</strong>. Anda dapat mengoreksi atau mengubahnya secara bebas sebelum proses vektorisasi ke ChromaDB.
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4 pt-1">
            {/* Ticker Input Bebas (Bisa mengetik emiten apa saja di BEI dengan saran Datalist) */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase text-gray-600 flex items-center justify-between">
                <span>Kode Emiten / Ticker</span>
                <span className="text-[10px] text-gray-400 font-normal lowercase">(bebas ketik emiten BEI)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  list="idx-tickers-datalist"
                  value={ticker}
                  onChange={(e) => {
                    const val = e.target.value.toUpperCase();
                    setTicker(val);
                    const match = IDX_TICKER_SUGGESTIONS.find((item) => item.code === val);
                    if (match) {
                      setEntityName(match.name);
                    }
                  }}
                  placeholder={selectedFile ? "Misal: BBRI, BMRI, BBTN, ASII" : "Pilih berkas di atas dulu"}
                  disabled={!selectedFile}
                  maxLength={6}
                  className="w-full h-9 px-3 rounded-lg bg-gray-50 border border-gray-200 text-xs font-bold text-gray-900 tracking-wider focus:outline-none focus:ring-1 focus:ring-emerald-500 uppercase disabled:bg-gray-100 disabled:text-gray-400"
                />
                <datalist id="idx-tickers-datalist">
                  {IDX_TICKER_SUGGESTIONS.map((item) => (
                    <option key={item.code} value={item.code}>
                      {item.code} — {item.name}
                    </option>
                  ))}
                </datalist>
              </div>
            </div>

            {/* Nama Resmi Entitas / Perusahaan (Bebas Diedit) */}
            <div className="space-y-1 sm:col-span-2">
              <label className="text-[11px] font-bold uppercase text-gray-600">
                Nama Resmi Entitas / Perusahaan
              </label>
              <input
                type="text"
                value={entityName}
                onChange={(e) => setEntityName(e.target.value)}
                placeholder={selectedFile ? "Contoh: PT Bank Rakyat Indonesia (Persero) Tbk." : "Pilih berkas di atas dulu"}
                disabled={!selectedFile}
                className="w-full h-9 px-3 rounded-lg bg-gray-50 border border-gray-200 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium disabled:bg-gray-100 disabled:text-gray-400"
              />
            </div>

            {/* Tahun Fiskal */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase text-gray-600">Tahun Fiskal</label>
              <select
                value={fiscalYear}
                onChange={(e) => setFiscalYear(e.target.value)}
                disabled={!selectedFile}
                className="w-full h-9 px-3 rounded-lg bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">{selectedFile ? 'Pilih Tahun' : '-'}</option>
                {COMPREHENSIVE_YEARS.map((y) => (
                  <option key={y} value={y}>
                    Tahun {y}
                  </option>
                ))}
              </select>
            </div>

            {/* Kuartal / Periode Pelaporan */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase text-gray-600">Kuartal / Periode Pelaporan</label>
              <select
                value={quarter}
                onChange={(e) => setQuarter(e.target.value)}
                disabled={!selectedFile}
                className="w-full h-9 px-3 rounded-lg bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="">{selectedFile ? 'Pilih Periode' : '-'}</option>
                <option value="Q1">Kuartal 1 (Q1 - per 31 Maret)</option>
                <option value="Q2">Kuartal 2 (Q2 - per 30 Juni)</option>
                <option value="Q3">Kuartal 3 (Q3 - per 30 September)</option>
                <option value="Tahunan">Laporan Tahunan (Full Year - per 31 Desember)</option>
              </select>
            </div>

            {/* Satuan Angka (Pembulatan) */}
            <div className="space-y-1">
              <label className="text-[11px] font-bold uppercase text-gray-600">Satuan Angka (Pembulatan)</label>
              <select
                value={rounding}
                onChange={(e) => setRounding(e.target.value)}
                disabled={!selectedFile}
                className="w-full h-9 px-3 rounded-lg bg-gray-50 border border-gray-200 text-xs font-semibold text-gray-900 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer disabled:bg-gray-100 disabled:text-gray-400"
              >
                <option value="Jutaan / In Million">Jutaan Rupiah (In Million)</option>
                <option value="Miliaran / In Billion">Miliaran Rupiah (In Billion)</option>
                <option value="Ribuan / In Thousand">Ribuan Rupiah (In Thousand)</option>
                <option value="Penuh / In Full">Rupiah Penuh (In Full Amount)</option>
              </select>
            </div>
          </div>
        </section>

        {/* Section: Parameter Teknis Chunking (Opsional / Collapsible) */}
        <section className="bg-white rounded-2xl border border-gray-200/90 p-5 shadow-xs space-y-3">
          <div
            onClick={() => setShowAdvancedParams(!showAdvancedParams)}
            className="flex items-center justify-between cursor-pointer select-none"
          >
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-gray-500" />
              <h3 className="text-xs font-bold text-gray-800">
                Pengaturan Teknis Chunking & Model Embedding (Opsional)
              </h3>
            </div>
            <div className="flex items-center gap-1 text-[11px] text-gray-400">
              <span>{showAdvancedParams ? 'Tutup Pengaturan' : 'Lihat & Sesuaikan'}</span>
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${showAdvancedParams ? 'rotate-180' : ''}`} />
            </div>
          </div>

          {showAdvancedParams && (
            <div className="pt-2 border-t border-gray-100 grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 space-y-1">
                <span className="text-[10px] uppercase text-gray-500 font-semibold">Ukuran Chunk (Karakter)</span>
                <input
                  type="number"
                  value={chunkSize}
                  onChange={(e) => setChunkSize(Number(e.target.value))}
                  className="w-full h-8 px-2 bg-white border border-gray-200 rounded text-xs font-bold text-gray-900"
                />
                <p className="text-[10px] text-gray-400 leading-tight">Default 1.000 karakter optimal untuk baris akun sheet BEI.</p>
              </div>

              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 space-y-1">
                <span className="text-[10px] uppercase text-gray-500 font-semibold">Overlap Window (Karakter)</span>
                <input
                  type="number"
                  value={overlapWindow}
                  onChange={(e) => setOverlapWindow(Number(e.target.value))}
                  className="w-full h-8 px-2 bg-white border border-gray-200 rounded text-xs font-bold text-gray-900"
                />
                <p className="text-[10px] text-gray-400 leading-tight">Mempertahankan konteks antar potongan baris tabel.</p>
              </div>

              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 space-y-1">
                <span className="text-[10px] uppercase text-gray-500 font-semibold">Model Embedding Vektor</span>
                <div className="h-8 flex items-center px-2 bg-gray-100 rounded text-xs font-semibold text-emerald-800 truncate">
                  {embeddingModel}
                </div>
                <p className="text-[10px] text-gray-400 leading-tight">Output: 768 Dimensi Vektor Multilingual.</p>
              </div>
            </div>
          )}
        </section>

        {/* Section: Eksekusi Ingesti & Pemantau Pipeline Real-Time */}
        <section className="bg-white rounded-2xl border border-gray-200/90 p-6 shadow-xs space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-gray-900">
              Pemrosesan Pipeline & Penyimpanan ke ChromaDB
            </h2>
            <div className="flex items-center gap-2">
              {pipelineRunning && (
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
              )}
              <span className="text-xs font-bold text-emerald-700">
                {pipelineRunning
                  ? `Memproses Ingesti (${pipelineProgress}%)`
                  : ingestionComplete
                  ? 'Ingesti Berhasil: Berkas Tersimpan di ChromaDB'
                  : selectedFile
                  ? 'Berkas Siap Diproses'
                  : 'Menunggu Pemilihan Berkas'}
              </span>
            </div>
          </div>

          {/* 4 Pipeline Stages */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {/* Tahap 1: Ekstraksi Dokumen */}
            <div className={`p-3.5 rounded-xl border space-y-1 transition-all ${
              pipelineProgress >= 25
                ? 'bg-emerald-50/50 border-emerald-200'
                : pipelineRunning && pipelineProgress < 25
                ? 'bg-white border-emerald-400 ring-2 ring-emerald-100'
                : 'bg-gray-50/80 border-gray-200/80'
            }`}>
              <div className="flex items-center justify-between">
                {pipelineProgress >= 25 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : pipelineRunning && pipelineProgress < 25 ? (
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                ) : (
                  <Circle className="w-4 h-4 text-gray-300" />
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  pipelineProgress >= 25
                    ? 'bg-emerald-100 text-emerald-800'
                    : pipelineRunning && pipelineProgress < 25
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {pipelineProgress >= 25 ? 'Selesai' : pipelineRunning && pipelineProgress < 25 ? 'Memproses...' : 'Menunggu'}
                </span>
              </div>
              <div className="text-xs font-bold text-gray-900 pt-1">1. Ekstraksi Dokumen</div>
              <p className="text-[10px] text-gray-500 font-medium">Membaca Sheet & Metadata</p>
            </div>

            {/* Tahap 2: Pemotongan Semantik */}
            <div className={`p-3.5 rounded-xl border space-y-1 transition-all ${
              pipelineProgress >= 50
                ? 'bg-emerald-50/50 border-emerald-200'
                : pipelineRunning && pipelineProgress >= 25 && pipelineProgress < 50
                ? 'bg-white border-emerald-400 ring-2 ring-emerald-100'
                : 'bg-gray-50/80 border-gray-200/80'
            }`}>
              <div className="flex items-center justify-between">
                {pipelineProgress >= 50 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : pipelineRunning && pipelineProgress >= 25 && pipelineProgress < 50 ? (
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                ) : (
                  <Circle className="w-4 h-4 text-gray-300" />
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  pipelineProgress >= 50
                    ? 'bg-emerald-100 text-emerald-800'
                    : pipelineRunning && pipelineProgress >= 25 && pipelineProgress < 50
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {pipelineProgress >= 50 ? 'Selesai' : pipelineRunning && pipelineProgress >= 25 && pipelineProgress < 50 ? 'Memproses...' : 'Menunggu'}
                </span>
              </div>
              <div className="text-xs font-bold text-gray-900 pt-1">2. Pemotongan Semantik</div>
              <p className="text-[10px] text-gray-500 font-medium">Format Tabel Markdown Pos Akun</p>
            </div>

            {/* Tahap 3: Vektorisasi Embedding */}
            <div className={`p-3.5 rounded-xl border space-y-1 transition-all ${
              pipelineProgress >= 75
                ? 'bg-emerald-50/50 border-emerald-200'
                : pipelineRunning && pipelineProgress >= 50 && pipelineProgress < 75
                ? 'bg-white border-emerald-400 ring-2 ring-emerald-100'
                : 'bg-gray-50/80 border-gray-200/80'
            }`}>
              <div className="flex items-center justify-between">
                {pipelineProgress >= 75 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : pipelineRunning && pipelineProgress >= 50 && pipelineProgress < 75 ? (
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                ) : (
                  <Circle className="w-4 h-4 text-gray-300" />
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  pipelineProgress >= 75
                    ? 'bg-emerald-100 text-emerald-800'
                    : pipelineRunning && pipelineProgress >= 50 && pipelineProgress < 75
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {pipelineProgress >= 75 ? 'Selesai' : pipelineRunning && pipelineProgress >= 50 && pipelineProgress < 75 ? 'Memproses...' : 'Menunggu'}
                </span>
              </div>
              <div className="text-xs font-bold text-gray-900 pt-1">3. Vektorisasi Embedding</div>
              <p className="text-[10px] text-gray-500 font-medium">768 Dimensi Semantik</p>
            </div>

            {/* Tahap 4: Simpan ChromaDB */}
            <div className={`p-3.5 rounded-xl border space-y-1 transition-all ${
              pipelineProgress === 100
                ? 'bg-emerald-50 border-emerald-300'
                : pipelineRunning && pipelineProgress >= 75 && pipelineProgress < 100
                ? 'bg-white border-emerald-400 ring-2 ring-emerald-100'
                : 'bg-gray-50/80 border-gray-200/80'
            }`}>
              <div className="flex items-center justify-between">
                {pipelineProgress === 100 ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : pipelineRunning && pipelineProgress >= 75 && pipelineProgress < 100 ? (
                  <RefreshCw className="w-4 h-4 text-emerald-600 animate-spin" />
                ) : (
                  <Database className="w-4 h-4 text-gray-400" />
                )}
                <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${
                  pipelineProgress === 100
                    ? 'bg-emerald-600 text-white'
                    : pipelineRunning && pipelineProgress >= 75 && pipelineProgress < 100
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                    : 'bg-gray-100 text-gray-500'
                }`}>
                  {pipelineProgress === 100 ? 'Siap Kueri' : pipelineRunning && pipelineProgress >= 75 && pipelineProgress < 100 ? 'Menyimpan...' : 'Menunggu'}
                </span>
              </div>
              <div className="text-xs font-bold text-gray-900 pt-1">4. Simpan ChromaDB</div>
              <p className="text-[10px] text-gray-500 font-medium">Koleksi Terindeks</p>
            </div>
          </div>

          {/* Action Trigger Button */}
          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={handleStartIngestion}
              disabled={pipelineRunning || !selectedFile}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:bg-gray-300 text-white text-xs font-semibold flex items-center gap-2 transition-all shadow-sm active:scale-95 cursor-pointer disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${pipelineRunning ? 'animate-spin' : ''}`} />
              <span>
                {pipelineRunning
                  ? 'Sedang Memproses Ingesti...'
                  : selectedFile
                  ? `Mulai Ingesti & Vektorisasi (${ticker || 'Berkas'})`
                  : 'Pilih Berkas Terlebih Dahulu'}
              </span>
            </button>
          </div>
        </section>

        {/* DAFTAR BERKAS TERVERIFIKASI DI SERVER (data/raw/) */}
        <section className="bg-white rounded-2xl border border-gray-200/90 p-6 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-600" />
              <h2 className="text-sm font-bold text-gray-900">
                Repositori Berkas Laporan Keuangan di Server (data/raw/)
              </h2>
            </div>
            <span className="text-[11px] text-gray-400 font-medium">
              {serverFiles.length} Berkas Aktif
            </span>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-xl">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-gray-600 text-[11px] font-semibold uppercase tracking-wider">
                  <th className="px-3.5 py-2.5">Nama Berkas</th>
                  <th className="px-3 py-2.5">Emiten</th>
                  <th className="px-3 py-2.5">Tahun / Kuartal</th>
                  <th className="px-3 py-2.5 text-right">Ukuran</th>
                  <th className="px-3.5 py-2.5 text-right">Status Database</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {serverFiles.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-gray-400">
                      Memuat daftar berkas dari server...
                    </td>
                  </tr>
                ) : (
                  serverFiles.map((f, i) => (
                    <tr key={f.filename || i} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-3.5 py-2.5 font-medium text-gray-900 flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                        <span className="truncate max-w-[280px] sm:max-w-[380px]">{f.filename}</span>
                      </td>
                      <td className="px-3 py-2.5 font-bold text-emerald-800">{f.ticker}</td>
                      <td className="px-3 py-2.5 text-gray-700">
                        FY {f.year} • {f.quarter}
                      </td>
                      <td className="px-3 py-2.5 text-right text-gray-500 font-normal">
                        {f.size_kb ? `${(f.size_kb / 1024).toFixed(1)} MB` : f.size || '-'}
                      </td>
                      <td className="px-3.5 py-2.5 text-right">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                          <Check className="w-3 h-3 text-emerald-600" />
                          Terindeks
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

      </div>
    </div>
  );
}
