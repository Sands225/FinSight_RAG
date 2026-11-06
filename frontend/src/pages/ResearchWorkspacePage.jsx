import React, { useState, useRef, useEffect } from 'react';
import {
  ArrowRight,
  CornerDownLeft,
  Sparkles,
  TrendingUp,
  Calendar,
  Clock,
  ChevronDown,
  ArrowUp,
  Check,
  FileText
} from 'lucide-react';
import { fetchFilterOptions } from '../services/api';

// Saran Prompt Riset Finansial Awal untuk Analis
const SUGGESTED_PROMPTS = [
  {
    title: 'Analisis Laba Bersih & Marjin BBCA',
    query: 'Berapa laba bersih konsolidasian BBCA pada Q1 2026 dan bagaimana tren margin bunga bersihnya (NIM)?',
    banks: ['BBCA'],
    years: ['2026'],
    quarters: ['Q1']
  },
  {
    title: 'Kualitas Aset & NPL BBNI',
    query: 'Bagaimana rasio NPL Gross dan coverage rasio BBNI pada laporan keuangan tahun 2025?',
    banks: ['BBNI'],
    years: ['2025'],
    quarters: ['Tahunan']
  },
  {
    title: 'Komparasi Pertumbuhan Kredit BBCA & BBNI',
    query: 'Bandingkan pertumbuhan penyaluran kredit dan rasio dana murah (CASA) antara BBCA dan BBNI.',
    banks: ['BBCA', 'BBNI'],
    years: ['2026', '2025'],
    quarters: ['Q1', 'Tahunan']
  }
];

// Helper untuk merender teks dengan format heading, bold, italic, list item, dan inline sitasi [1], [2]
function FormattedParagraph({ text }) {
  const trimmed = text.trim();

  // Garis pemisah horizontal
  if (trimmed === '---' || trimmed === '***') {
    return <hr className="border-t border-gray-200/80 my-3" />;
  }

  // Heading H3 (### ...)
  if (trimmed.startsWith('### ')) {
    const headingText = trimmed.replace(/^###\s+/, '');
    return (
      <h3 className="text-sm font-bold text-gray-900 mt-3 mb-1 text-[14px]">
        {renderInlineSpans(headingText)}
      </h3>
    );
  }

  // Heading H2 (## ...)
  if (trimmed.startsWith('## ')) {
    const headingText = trimmed.replace(/^##\s+/, '');
    return (
      <h2 className="text-sm font-bold text-gray-950 mt-4 mb-1.5 text-[15px]">
        {renderInlineSpans(headingText)}
      </h2>
    );
  }

  // Numbered item (1. ..., 2. ...)
  const numberedMatch = trimmed.match(/^(\d+\.)\s+(.*)/);
  if (numberedMatch) {
    return (
      <div className="flex items-start gap-2 text-[13.5px] sm:text-[14px] leading-relaxed text-gray-900 mt-2 mb-1">
        <span className="font-bold text-gray-900 shrink-0">{numberedMatch[1]}</span>
        <div className="flex-1">{renderInlineSpans(numberedMatch[2])}</div>
      </div>
    );
  }

  // Blockquote / Catatan (> ...)
  if (trimmed.startsWith('> ')) {
    const quoteText = trimmed.replace(/^>\s+/, '');
    return (
      <div className="border-l-2 border-emerald-500 pl-3 py-1.5 my-2 text-xs italic text-gray-700 bg-emerald-50/30 rounded-r-lg leading-relaxed">
        {renderInlineSpans(quoteText)}
      </div>
    );
  }

  // List Item (- ..., * ..., • ...)
  if (trimmed.startsWith('- ') || trimmed.startsWith('* ') || trimmed.startsWith('• ')) {
    const listText = trimmed.replace(/^[-*•]\s+/, '');
    return (
      <div className="flex items-start gap-2.5 text-[13.5px] sm:text-[14px] leading-relaxed text-gray-800 my-1">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-600 mt-2 shrink-0"></span>
        <div className="flex-1">{renderInlineSpans(listText)}</div>
      </div>
    );
  }

  // Paragraf biasa
  return (
    <p className="leading-relaxed text-gray-800 text-[13.5px] sm:text-[14px]">
      {renderInlineSpans(text)}
    </p>
  );
}

// Fungsi pembantu parsing teks inline (**bold**, *italic*, dan [1], [2])
function renderInlineSpans(rawText) {
  const parts = rawText.split(/(\*\*.*?\*\*|\*.*?\*|\[\d+(?:,\s*\d+)*\])/g);
  return parts.map((part, i) => {
    if (!part) return null;
    if (part.startsWith('**') && part.endsWith('**')) {
      return (
        <strong key={i} className="font-semibold text-gray-950">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('*') && part.endsWith('*')) {
      return (
        <em key={i} className="italic text-gray-700">
          {part.slice(1, -1)}
        </em>
      );
    }
    // Deteksi sitasi: [1], [2], [1, 2] (Format superscript / pangkat warna abu-abu netral, tidak bisa diklik)
    if (/^\[\d+(?:,\s*\d+)*\]$/.test(part)) {
      return (
        <sup
          key={i}
          className="text-[9.5px] font-normal text-gray-400 select-none tracking-tight align-super -top-0.5 relative"
        >
          {part}
        </sup>
      );
    }
    return part;
  });
}

// Komponen Visualisasi Tabel Data Finansial Terstruktur
function FinancialTable({ data }) {
  if (!data || !data.headers || !data.rows) return null;

  const isWideTable = data.headers.length > 5;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white my-3 shadow-2xs">
      {data.title && (
        <div className="px-4 py-2.5 bg-slate-100/90 border-b border-slate-200 text-xs font-bold text-slate-800 flex items-center justify-between gap-2">
          <span className="truncate">{data.title}</span>
          {isWideTable && (
            <span className="shrink-0 text-[11px] font-normal text-slate-600 bg-slate-200/70 px-2 py-0.5 rounded-full">
              {data.headers.length} Kolom • Geser horizontal →
            </span>
          )}
        </div>
      )}
      <div className="overflow-x-auto relative">
        <table className="w-full text-left border-separate border-spacing-0 text-xs">
          <thead>
            <tr>
              {data.headers.map((h, i) => (
                <th
                  key={i}
                  className={`px-3.5 py-3 text-xs font-bold uppercase tracking-wider border-b-2 border-slate-300 ${
                    i === 0
                      ? 'sticky left-0 z-30 bg-slate-100 text-left text-slate-900 border-r border-slate-300 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.12)] min-w-[200px] sm:min-w-[240px]'
                      : 'text-right min-w-[120px] whitespace-nowrap bg-slate-100 text-slate-800'
                  }`}
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, rIdx) => {
              // Deteksi jika baris ini adalah sub-header kategori (misal: "Aktivitas Arus Kas" dengan kolom lain kosong)
              const firstCell = String(row[0] || '').trim();
              const otherCellsEmpty = row.slice(1).every((c) => !c || c === '-' || c === '---');
              const isSectionHeader = otherCellsEmpty && firstCell.length > 0;

              if (isSectionHeader) {
                return (
                  <tr key={rIdx} className="bg-slate-50 border-y border-slate-200">
                    <td
                      colSpan={data.headers.length}
                      className="px-3.5 py-2 text-xs font-bold text-slate-900 tracking-wide"
                    >
                      {renderInlineSpans(firstCell.replace(/^[-*•]\s*/, ''))}
                    </td>
                  </tr>
                );
              }

              return (
                <tr
                  key={rIdx}
                  className="group hover:bg-[#f0fdf4] transition-colors"
                >
                  {row.map((rawCell, cIdx) => {
                    const cellStr = String(rawCell || '').trim();
                    // Bersihkan prefix bullet Markdown (- , * , • ) dari teks pos akun
                    const cleanCell = cellStr.replace(/^[-*•]\s+/, '');

                    return (
                      <td
                        key={cIdx}
                        className={`px-3.5 py-2.5 text-xs text-gray-800 border-b border-gray-100 ${
                          cIdx === 0
                            ? 'sticky left-0 z-20 bg-white group-hover:bg-[#f0fdf4] text-left font-medium text-gray-900 border-r border-gray-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.06)] min-w-[200px] sm:min-w-[240px] transition-colors'
                            : 'text-right font-normal min-w-[120px] whitespace-nowrap tabular-nums text-gray-900'
                        }`}
                      >
                        {renderInlineSpans(cleanCell)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Helper untuk mengekstrak informasi sheet secara aman dan menghindari "Sheet []"
function getSheetDisplayInfo(cite) {
  let code = cite.sheet_code || cite.sheetCode || '';
  let title = cite.sheet_title || cite.sheetTitle || '';

  // Ekstrak dari format legacy pageOrSheet jika ada
  if (!code && cite.pageOrSheet) {
    const match = cite.pageOrSheet.match(/\[(.*?)\]/);
    if (match) code = match[1];
    const cleanTitle = cite.pageOrSheet.replace(/.*?\[.*?\]\s*/, '').replace(/^[•\-\s]+/, '');
    if (cleanTitle && !title) title = cleanTitle;
  }

  // Ekstrak kode 7 digit dari id jika ada
  if (!code && cite.id) {
    const parts = String(cite.id).split('_');
    const lastPart = parts[parts.length - 1];
    if (/^\d{7}$/.test(lastPart)) {
      code = lastPart;
    }
  }

  return {
    code,
    title: title || 'Laporan Keuangan Resmi BEI'
  };
}

// Komponen Sitasi Referensi Sheet Laporan Keuangan BEI ([1], [2])
function SheetReferencesIEEE({ citations }) {
  const [expandedId, setExpandedId] = useState(null);

  if (!citations || citations.length === 0) return null;

  return (
    <div className="rounded-xl border border-gray-200/80 bg-gray-50/40 p-3.5 my-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-700">
          <FileText className="w-3.5 h-3.5 text-gray-400" />
          <span>Referensi Sheet Laporan Keuangan BEI</span>
        </div>
        <span className="text-[11px] text-gray-400 font-medium">
          {citations.length} Sheet Terverifikasi
        </span>
      </div>

      <div className="grid grid-cols-1 gap-2 pt-0.5">
        {citations.map((cite, idx) => {
          const citationNumber = idx + 1;
          const isExpanded = expandedId === (cite.id || idx);
          const { code, title } = getSheetDisplayInfo(cite);

          return (
            <div
              key={cite.id || idx}
              id={`citation-${citationNumber}`}
              className="bg-white rounded-lg border border-gray-200 hover:border-gray-300 p-2.5 shadow-2xs transition-all"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  {/* Penomoran [1], [2] Abu-abu Minimalis Selaras dengan Judul Laporan */}
                  <div className="flex items-center flex-wrap gap-1.5 text-xs">
                    <span className="font-normal text-xs text-gray-400 select-none">
                      [{citationNumber}]
                    </span>
                    <span className="font-semibold text-gray-900 truncate max-w-[320px] sm:max-w-[500px]">
                      {code ? `[${code}]` : ''} {title}
                    </span>
                  </div>

                  <div className="text-[11.5px] text-gray-500 flex items-center gap-2 flex-wrap pl-5 sm:pl-6">
                    <span className="font-medium text-gray-700">{cite.entityName || cite.ticker}</span>
                    <span>•</span>
                    <span>Periode: {cite.period}</span>
                    {cite.rounding && (
                      <>
                        <span>•</span>
                        <span>Satuan: {cite.rounding}</span>
                      </>
                    )}
                  </div>
                </div>

                {cite.snippet && (
                  <button
                    type="button"
                    onClick={() => setExpandedId(isExpanded ? null : (cite.id || idx))}
                    className="shrink-0 text-[11px] font-medium text-gray-500 hover:text-gray-800 flex items-center gap-0.5 px-2 py-1 rounded-md hover:bg-gray-100 transition-colors cursor-pointer"
                  >
                    <span>{isExpanded ? 'Tutup Pos Akun' : 'Lihat Pos Akun'}</span>
                    <ChevronDown className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </button>
                )}
              </div>

              {/* Kutipan Snippet Pembuktian Pos Akun dari Sheet */}
              {isExpanded && cite.snippet && (
                <div className="mt-2.5 pt-2 border-t border-gray-100 text-xs text-gray-700 bg-gray-50/70 p-2.5 rounded-md font-normal leading-relaxed">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500 block mb-1">
                    Kutipan Pos Akun Resmi dari Sheet:
                  </span>
                  <div className="text-[11px] bg-white p-2 rounded border border-gray-200/80 text-gray-800 whitespace-pre-line font-mono">
                    {cite.snippet}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Komponen Reusable Multi-Select Dropdown dengan Checkbox (Semua Font Inter)
function MultiSelectPill({
  icon: Icon,
  labelPrefix = '',
  options,
  selected = [],
  onChange,
  placeholder = 'Pilih'
}) {
  const [open, setOpen] = useState(false);

  // Label tampilan pada tombol pill
  const getButtonLabel = () => {
    if (!selected || selected.length === 0) return placeholder;
    if (selected.length === 1) return `${labelPrefix}${selected[0]}`;
    if (selected.length === 2) return `${labelPrefix}${selected.join(', ')}`;
    return `${labelPrefix}${selected[0]}, +${selected.length - 1} lainnya`;
  };

  const toggleOption = (val) => {
    if (selected.includes(val)) {
      if (selected.length > 1) {
        onChange(selected.filter((item) => item !== val));
      }
    } else {
      onChange([...selected, val]);
    }
  };

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-700 transition shadow-2xs whitespace-nowrap cursor-pointer"
      >
        {Icon && <Icon className="w-3.5 h-3.5 text-emerald-600 shrink-0" />}
        <span>{getButtonLabel()}</span>
        <ChevronDown className="w-3 h-3 text-slate-400 shrink-0" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
          ></div>
          <div className="absolute bottom-full mb-1 left-0 w-52 bg-white rounded-xl border border-gray-200 shadow-xl py-1 z-50 animate-in fade-in zoom-in-95">
            <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider border-b border-gray-100 flex items-center justify-between">
              <span>Pilih Multi-Filter</span>
              <span className="text-emerald-700 font-semibold">{selected.length} dipilih</span>
            </div>
            <div className="max-h-48 overflow-y-auto py-1">
              {options.map((opt) => {
                const val = typeof opt === 'object' ? opt.code : opt;
                const desc = typeof opt === 'object' ? opt.name : null;
                const isChecked = selected.includes(val);

                return (
                  <button
                    key={val}
                    type="button"
                    onClick={() => toggleOption(val)}
                    className="w-full text-left px-3 py-1.5 text-xs flex items-center justify-between hover:bg-emerald-50 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div
                        className={`w-3.5 h-3.5 rounded flex items-center justify-center border transition-all ${
                          isChecked
                            ? 'bg-emerald-600 border-emerald-600 text-white'
                            : 'border-gray-300 bg-white'
                        }`}
                      >
                        {isChecked && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                      </div>
                      <span className={`truncate ${isChecked ? 'font-bold text-emerald-900' : 'text-gray-700'}`}>
                        {labelPrefix}{val}
                      </span>
                    </div>
                    {desc && (
                      <span className="text-[10px] text-gray-400 shrink-0 pl-1">
                        {desc.split(' ')[2] || ''}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function ResearchWorkspacePage({
  sessions,
  activeSessionId,
  isNewChat,
  isLoading = false,
  onSubmitNewQuery,
  onSendMessage,
  onUpdateSessionFilters
}) {
  // State opsi filter dinamis dari database riil
  const [filterOptions, setFilterOptions] = useState({
    banks: [
      { code: 'BBCA', name: 'PT Bank Central Asia Tbk' },
      { code: 'BBNI', name: 'PT Bank Negara Indonesia (Persero) Tbk' },
      { code: 'BBRI', name: 'PT Bank Rakyat Indonesia (Persero) Tbk' },
      { code: 'BMRI', name: 'PT Bank Mandiri (Persero) Tbk' }
    ],
    years: ['2026', '2025', '2024', '2023'],
    quarters: ['Q1', 'Q2', 'Q3', 'Tahunan']
  });

  useEffect(() => {
    let mounted = true;
    fetchFilterOptions().then((opts) => {
      if (mounted && opts) {
        setFilterOptions((prev) => ({
          banks: opts.banks || prev.banks,
          years: opts.years || prev.years,
          quarters: opts.quarters || prev.quarters
        }));
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // State filter untuk New Chat view
  const [newPromptText, setNewPromptText] = useState('');
  const [newSelectedBanks, setNewSelectedBanks] = useState(['BBCA']);
  const [newSelectedYears, setNewSelectedYears] = useState(['2026']);
  const [newSelectedQuarters, setNewSelectedQuarters] = useState(['Q1']);

  // State input obrolan lanjutan di thread view
  const [threadInput, setThreadInput] = useState('');

  // Ref untuk kontainer utama dan titik jangkar auto-scroll ke paling bawah
  const mainScrollRef = useRef(null);
  const messagesEndRef = useRef(null);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0];
  const showPromptStudio = isNewChat || !activeSession || (activeSession.messages && activeSession.messages.length === 0);

  // Fungsi pembantu auto-scroll mentok ke paling bawah container obrolan
  const scrollToBottom = (behavior = 'smooth') => {
    if (mainScrollRef.current) {
      mainScrollRef.current.scrollTo({
        top: mainScrollRef.current.scrollHeight,
        behavior
      });
    } else {
      messagesEndRef.current?.scrollIntoView({ behavior, block: 'end' });
    }
  };

  // Auto-scroll saat pengguna membuka atau berpindah ke salah satu sesi riwayat (history chat)
  useEffect(() => {
    if (!showPromptStudio) {
      const timer = setTimeout(() => {
        scrollToBottom('auto');
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [activeSessionId, showPromptStudio]);

  // Auto-scroll saat pengguna selesai ngechat / menerima pesan baru / status loading berubah
  useEffect(() => {
    if (!showPromptStudio && activeSession?.messages?.length > 0) {
      const timer = setTimeout(() => {
        scrollToBottom('smooth');
      }, 80);
      return () => clearTimeout(timer);
    }
  }, [activeSession?.messages?.length, isLoading, showPromptStudio]);

  // Filter aktif pada sesi yang sedang dibuka (bisa diubah-ubah di setiap history chat)
  const activeBanks = activeSession?.selectedBanks || ['BBCA'];
  const activeYears = activeSession?.selectedYears || ['2026'];
  const activeQuarters = activeSession?.selectedQuarters || ['Q1'];

  const handleUpdateActiveBanks = (banks) => {
    if (onUpdateSessionFilters && activeSession) {
      onUpdateSessionFilters(activeSession.id, { selectedBanks: banks });
    }
  };

  const handleUpdateActiveYears = (years) => {
    if (onUpdateSessionFilters && activeSession) {
      onUpdateSessionFilters(activeSession.id, { selectedYears: years });
    }
  };

  const handleUpdateActiveQuarters = (quarters) => {
    if (onUpdateSessionFilters && activeSession) {
      onUpdateSessionFilters(activeSession.id, { selectedQuarters: quarters });
    }
  };

  // Handler submit dari New Chat
  const handleNewChatSubmit = (e) => {
    e?.preventDefault();
    if (!newPromptText.trim()) return;
    onSubmitNewQuery({
      query: newPromptText,
      banks: newSelectedBanks,
      years: newSelectedYears,
      quarters: newSelectedQuarters
    });
    setNewPromptText('');
  };

  // Handler memilih saran prompt cepat
  const handleSelectSuggested = (item) => {
    onSubmitNewQuery({
      query: item.query,
      banks: item.banks,
      years: item.years,
      quarters: item.quarters
    });
  };

  // Handler kirim pesan lanjutan di thread
  const handleSendThreadMessage = (e) => {
    e?.preventDefault();
    if (!threadInput.trim()) return;
    onSendMessage(threadInput);
    setThreadInput('');
  };

  return (
    <div className="flex-1 overflow-y-auto relative bg-[#F8F9FA] flex flex-col h-full font-sans">
      {showPromptStudio ? (
        /* ========================================================= */
        /* KONDISI 1: NEW CHAT / STUDIO PROMPT VIEW                  */
        /* ========================================================= */
        <div className="flex-1 flex flex-col items-center justify-center px-4 sm:px-6 py-10 max-w-4xl mx-auto w-full relative z-10 selection:bg-emerald-100 selection:text-emerald-900">
          {/* Ambient Background Glow */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden -z-10">
            <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[320px] rounded-full bg-gradient-to-tr from-emerald-200/30 via-teal-100/20 to-indigo-100/15 blur-[90px]"></div>
          </div>

          {/* Header Hero */}
          <section className="text-center mb-7 max-w-2xl mx-auto">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-normal tracking-tight text-slate-900 leading-tight">
              Wawasan finansial apa yang ingin Anda <span className="font-extrabold text-slate-950">eksplorasi</span> hari ini?
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 font-normal max-w-md mx-auto leading-relaxed">
              Analisis mendalam dari keterbukaan informasi dan laporan keuangan emiten perbankan BEI.
            </p>
          </section>

          {/* Floating AI Prompt Box */}
          <section className="w-full max-w-[740px] relative group mb-8">
            <div aria-hidden="true" className="absolute -inset-1 rounded-3xl bg-gradient-to-r from-emerald-400/25 via-teal-300/20 to-purple-500/20 blur-lg opacity-85 transition-all duration-500 group-hover:opacity-100 pointer-events-none"></div>

            <div className="relative bg-white border border-emerald-400/40 rounded-2xl shadow-glow transition-all duration-300 focus-within:border-emerald-500 focus-within:ring-4 focus-within:ring-emerald-500/20">
              {/* Input Textarea */}
              <div className="px-5 py-4">
                <textarea
                  value={newPromptText}
                  onChange={(e) => setNewPromptText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleNewChatSubmit();
                    }
                  }}
                  className="w-full resize-none border-0 p-0 text-slate-800 placeholder:text-slate-400 text-sm focus:ring-0 leading-relaxed font-normal bg-transparent outline-none"
                  placeholder="Tanyakan analisis keuangan terkait laba bersih, NIM, likuiditas, rasio risiko NPL, atau CASA..."
                  rows={3}
                  spellCheck="false"
                />
              </div>

              {/* Toolbar Multi-Select Filter Pills */}
              <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/60 rounded-b-2xl flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  {/* Multi-Select Bank / Emiten */}
                  <MultiSelectPill
                    icon={TrendingUp}
                    options={filterOptions.banks}
                    selected={newSelectedBanks}
                    onChange={setNewSelectedBanks}
                    placeholder="Pilih Emiten"
                  />

                  {/* Multi-Select Tahun Fiskal */}
                  <MultiSelectPill
                    icon={Calendar}
                    labelPrefix="FY "
                    options={filterOptions.years}
                    selected={newSelectedYears}
                    onChange={setNewSelectedYears}
                    placeholder="Pilih Tahun"
                  />

                  {/* Multi-Select Kuartal / Periode */}
                  <MultiSelectPill
                    icon={Clock}
                    options={filterOptions.quarters}
                    selected={newSelectedQuarters}
                    onChange={setNewSelectedQuarters}
                    placeholder="Pilih Periode"
                  />
                </div>

                {/* Send Button */}
                <button
                  type="button"
                  onClick={handleNewChatSubmit}
                  disabled={!newPromptText.trim() || isLoading}
                  className={`w-8 h-8 rounded-full flex items-center justify-center shadow-sm transition-all ${
                    newPromptText.trim() && !isLoading
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer active:scale-95'
                      : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                  }`}
                  title={isLoading ? 'Sedang Menganalisis...' : 'Kirim Pertanyaan Analisis'}
                >
                  <ArrowUp className={`w-4 h-4 ${isLoading ? 'animate-bounce' : ''}`} />
                </button>
              </div>
            </div>
          </section>

          {/* Quick Suggested Prompts */}
          <section className="w-full max-w-[740px]">
            <div className="text-xs font-semibold text-gray-500 mb-2.5 px-1 flex items-center gap-1.5">
              <span className="text-emerald-600">✦</span>
              <span>Rekomendasi Analisis Cepat:</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
              {SUGGESTED_PROMPTS.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelectSuggested(item)}
                  className="p-3 bg-white hover:bg-emerald-50/40 rounded-xl border border-gray-200/80 hover:border-emerald-300 transition-all cursor-pointer shadow-2xs group"
                >
                  <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                    <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 px-1.5 py-0.2 rounded">
                      {item.banks.join(', ')}
                    </span>
                    <span className="text-[10px] text-gray-500 font-medium">
                      FY {item.years.join('/')}
                    </span>
                    <span className="text-[10px] text-gray-400 font-medium">
                      {item.quarters.join(', ')}
                    </span>
                  </div>
                  <h4 className="text-xs font-semibold text-gray-800 group-hover:text-emerald-800 line-clamp-1">
                    {item.title}
                  </h4>
                  <p className="text-[11px] text-gray-500 line-clamp-2 mt-0.5 leading-snug">
                    {item.query}
                  </p>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : (
        /* ========================================================= */
        /* KONDISI 2: CONVERSATION THREAD VIEW                       */
        /* ========================================================= */
        <main ref={mainScrollRef} className="flex-1 overflow-y-auto px-6 md:px-10 lg:px-14 pt-8 md:pt-10 pb-8">
          <div className="max-w-4xl mx-auto space-y-6 pb-6">
            {/* Daftar Pesan Percakapan */}
            {activeSession?.messages?.map((msg, index) => {
              if (msg.role === 'user') {
                return (
                  <div
                    key={msg.id || index}
                    className="bg-emerald-50/60 border border-emerald-300 rounded-2xl p-4 md:p-5 shadow-2xs"
                  >
                    <p className="text-sm md:text-base font-medium text-gray-900 leading-snug">
                      {msg.content}
                    </p>
                  </div>
                );
              }

              // State Loading / Sedang Menganalisis
              if (msg.isPending) {
                return (
                  <article
                    key={msg.id || index}
                    className="bg-white rounded-2xl border border-gray-200/90 p-6 md:p-8 shadow-xs space-y-4 animate-pulse"
                  >
                    <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping"></span>
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                        ANALISIS FINSIGHT AI (SEDANG MEMPROSES...)
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-emerald-900 font-medium py-2">
                      <div className="w-4 h-4 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin shrink-0"></div>
                      <span>Menganalisis lembar laporan keuangan BEI & mengaitkan sitasi bukti akun...</span>
                    </div>
                  </article>
                );
              }

              // Respons AI - Fokus Murni pada Paragraf & Tabel Finansial
              const paragraphs = msg.paragraphs || (msg.content ? [msg.content] : []);

              return (
                <article
                  key={msg.id || index}
                  className="bg-white rounded-2xl border border-gray-200/90 p-6 md:p-8 shadow-xs space-y-5"
                >
                  {/* Header AI */}
                  <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                    <span className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                      ANALISIS FINSIGHT AI
                    </span>
                  </div>

                  {/* Konten Paragraf Naratif yang Mengalir dengan Sitasi */}
                  <div className="space-y-3.5 text-gray-800">
                    {paragraphs.map((paraText, pIdx) => (
                      <FormattedParagraph
                        key={pIdx}
                        text={paraText}
                      />
                    ))}
                  </div>

                  {/* Komponen Tabel Finansial Terstruktur (jika ada data tabel) */}
                  {msg.table && (
                    <FinancialTable data={msg.table} />
                  )}

                  {/* Sumber & Sitasi Sheet Laporan Keuangan BEI ([1], [2]) */}
                  {msg.citations && msg.citations.length > 0 && (
                    <SheetReferencesIEEE
                      citations={msg.citations}
                    />
                  )}

                  {/* Pertanyaan Lanjutan yang Disarankan */}
                  {msg.followUpQuestions && msg.followUpQuestions.length > 0 && (
                    <div className="rounded-xl border border-gray-200 bg-gray-50/70 p-4 space-y-2.5 mt-2">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-800">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Pertanyaan Lanjutan yang Disarankan:</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {msg.followUpQuestions.map((q, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => onSendMessage(q)}
                            className="bg-white border border-gray-200 hover:border-emerald-300 text-gray-800 hover:bg-emerald-50/50 px-3 py-1.5 rounded-xl text-xs font-medium shadow-2xs transition-colors flex items-center gap-1.5 group cursor-pointer text-left"
                          >
                            <span>{q}</span>
                            <ArrowRight className="w-3 h-3 text-gray-400 group-hover:translate-x-0.5 transition-transform" />
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </article>
              );
            })}

            {/* Titik Jangkar Auto-Scroll ke Pesan Terbawah */}
            <div ref={messagesEndRef} className="h-1" />

            {/* Sticky Bottom Copilot Input yang Ramping & Hemat Ruang */}
            <div className="sticky bottom-4 z-20">
              <div className="bg-white/95 backdrop-blur-md rounded-2xl border border-gray-200/90 shadow-xl p-3 transition-all focus-within:ring-2 focus-within:ring-emerald-500/30 focus-within:border-emerald-500">
                {/* Kolom Textarea Pertanyaan */}
                <div className="mb-2">
                  <textarea
                    value={threadInput}
                    onChange={(e) => setThreadInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSendThreadMessage();
                      }
                    }}
                    className="w-full text-xs sm:text-sm text-gray-800 placeholder-gray-400 border-0 focus:ring-0 px-1 py-0.5 resize-none bg-transparent leading-relaxed outline-none"
                    placeholder="Tulis pertanyaan lanjutan atau instruksi perbandingan rasio keuangan berikutnya..."
                    rows={2}
                  />
                </div>

                {/* Bottom Bar: Filter di Kiri Bawah & Tombol Kirim di Kanan Bawah */}
                <div className="flex flex-wrap items-center justify-between pt-2 border-t border-gray-100 gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mr-1">
                      Filter:
                    </span>

                    {/* Multi-Select Bank */}
                    <MultiSelectPill
                      icon={TrendingUp}
                      options={filterOptions.banks}
                      selected={activeBanks}
                      onChange={handleUpdateActiveBanks}
                      placeholder="Pilih Emiten"
                    />

                    {/* Multi-Select Tahun */}
                    <MultiSelectPill
                      icon={Calendar}
                      labelPrefix="FY "
                      options={filterOptions.years}
                      selected={activeYears}
                      onChange={handleUpdateActiveYears}
                      placeholder="Pilih Tahun"
                    />

                    {/* Multi-Select Kuartal / Periode */}
                    <MultiSelectPill
                      icon={Clock}
                      options={filterOptions.quarters}
                      selected={activeQuarters}
                      onChange={handleUpdateActiveQuarters}
                      placeholder="Pilih Periode"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSendThreadMessage}
                    disabled={!threadInput.trim() || isLoading}
                    className={`px-3.5 py-1.5 rounded-xl flex items-center gap-1.5 text-xs font-semibold transition-all ${
                      threadInput.trim() && !isLoading
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white cursor-pointer active:scale-95 shadow-xs'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    <span>{isLoading ? 'Memproses...' : 'Kirim'}</span>
                    <CornerDownLeft className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          </div>
        </main>
      )}
    </div>
  );
}
