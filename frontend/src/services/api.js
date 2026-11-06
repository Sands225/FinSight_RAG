// FinSight API Client - Komunikasi Terpusat dengan Backend FastAPI

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

/**
 * Helper untuk menangani response fetch dan parsing error
 */
async function handleResponse(response) {
  if (!response.ok) {
    let errorMessage = `HTTP error! Status: ${response.status}`;
    try {
      const errorData = await response.json();
      if (errorData.detail) {
        errorMessage = typeof errorData.detail === 'string' ? errorData.detail : JSON.stringify(errorData.detail);
      }
    } catch {
      // response bukan JSON
    }
    throw new Error(errorMessage);
  }
  return response.json();
}

/**
 * 1. Mengecek kesehatan konektivitas backend FastAPI & ChromaDB
 */
export async function fetchHealth() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/health`);
    return await handleResponse(res);
  } catch (error) {
    console.warn('[FinSight API] Backend offline atau gagal dihubungi:', error.message);
    return {
      status: 'offline',
      database_docs_count: 751,
      collection_name: 'idx_financial_statements'
    };
  }
}

/**
 * 2. Mengambil statistik kapasitas memori ChromaDB
 */
export async function fetchStorageStats() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/system/storage`);
    return await handleResponse(res);
  } catch (error) {
    console.warn('[FinSight API] Gagal mengambil storage stats, menggunakan fallback:', error.message);
    return {
      status: 'offline',
      collection_name: 'idx_financial_statements',
      total_chunks: 751,
      storage_used: '9.4 MB',
      storage_capacity: '10 GB',
      storage_percentage: 1,
      embedding_model: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
      dimension: 768,
      last_updated: 'Sinkronisasi Otomatis'
    };
  }
}

/**
 * 3. Mengambil opsi filter dinamis (Bank, Tahun, Kuartal) dari database riil
 */
export async function fetchFilterOptions() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/filters`);
    const json = await handleResponse(res);
    return json.data || json;
  } catch (error) {
    console.warn('[FinSight API] Menggunakan filter fallback:', error.message);
    return {
      banks: ['BBCA', 'BBNI'],
      years: ['2026', '2025'],
      quarters: ['Q1', 'Q2', 'Q3', 'Tahunan']
    };
  }
}

/**
 * 4. Mengirim pertanyaan analisis keuangan ke RAG Pipeline (FastAPI -> ChromaDB -> Gemini)
 */
export async function sendChatMessage({ question, ticker, year, quarter, top_k = 3 }) {
  const payload = {
    question,
    ticker: Array.isArray(ticker) && ticker.length > 0 ? ticker : (ticker || null),
    year: Array.isArray(year) && year.length > 0 ? year : (year || null),
    quarter: Array.isArray(quarter) && quarter.length > 0 ? quarter : (quarter || null),
    top_k
  };

  const res = await fetch(`${API_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });

  return handleResponse(res);
}

/**
 * 5. Mengambil daftar dokumen laporan keuangan mentah di server (data/raw/)
 */
export async function fetchDocuments() {
  try {
    const res = await fetch(`${API_BASE_URL}/api/documents`);
    const json = await handleResponse(res);
    return json.documents || [];
  } catch (error) {
    console.warn('[FinSight API] Gagal mengambil daftar dokumen:', error.message);
    return [];
  }
}

/**
 * 6. Mengunggah berkas laporan keuangan baru ke server & mengindeks ke ChromaDB
 */
export async function uploadDocument(file) {
  const formData = new FormData();
  formData.append('file', file);

  const res = await fetch(`${API_BASE_URL}/api/documents/upload`, {
    method: 'POST',
    body: formData
  });

  return handleResponse(res);
}

/**
 * Helper: Mengurai (parse) output mentah Gemini menjadi struktur terpadu:
 * - Paragraf naratif dengan sitasi IEEE [1], [2]
 * - Komponen tabel finansial terstruktur (jika terdeteksi tabel markdown)
 * - Komponen referensi sitasi sheet terverifikasi
 */
export function parseAssistantResponse(rawAnswer, sources = []) {
  if (!rawAnswer) {
    return {
      paragraphs: ['Maaf, tidak ada tanggapan yang dihasilkan.'],
      table: null,
      citations: sources
    };
  }

  // 1. Deteksi apakah ada tabel markdown di dalam jawaban
  const lines = rawAnswer.split('\n');
  const tableLines = [];
  const narrativeLines = [];
  let inTable = false;

  for (const line of lines) {
    const isTableSeparator = /^\|[\s:\-|]+\|$/.test(line.trim());
    const isTableRow = line.trim().startsWith('|') && line.trim().endsWith('|');

    if (isTableRow || isTableSeparator) {
      inTable = true;
      tableLines.push(line.trim());
    } else {
      if (inTable && line.trim() === '') {
        inTable = false;
      }
      narrativeLines.push(line);
    }
  }

  // Parsing tabel jika ditemukan minimal header + separator + 1 baris
  let parsedTable = null;
  if (tableLines.length >= 3) {
    try {
      const headerLine = tableLines[0];
      const headers = headerLine.split('|').map(s => s.trim()).filter(Boolean);

      const rows = [];
      for (let i = 2; i < tableLines.length; i++) {
        const rawLine = tableLines[i].trim();
        // Lewati jika baris ini adalah baris pemisah separator (:--- | :--- | :---)
        if (/^\|?[\s:\-|]+\|?$/.test(rawLine)) continue;

        const rowCells = rawLine.split('|').map(s => s.trim()).filter(Boolean);
        if (rowCells.length === 0) continue;

        // Jangan masukkan jika baris ini menduplikasi baris header di tengah tabel
        const isDuplicateHeader = rowCells.length === headers.length && 
          rowCells.every((c, cIdx) => c.toLowerCase() === headers[cIdx].toLowerCase());
        if (isDuplicateHeader) continue;

        rows.push(rowCells);
      }

      if (headers.length > 0 && rows.length > 0) {
        parsedTable = {
          title: 'Ikhtisar Indikator Finansial Terverifikasi',
          headers,
          rows
        };
      }
    } catch (e) {
      console.warn('Gagal parsing tabel markdown:', e);
    }
  }

  // Pisahkan teks narasi menjadi elemen-elemen blok terstruktur yang rapi
  // 1. Bersihkan seluruh tag <br>, <br/> mentah menjadi baris baru
  let rawNarrativeText = (parsedTable ? narrativeLines : lines)
    .join('\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .trim();

  // 2. Normalisasi spasi sitasi: hilangkan spasi di depan sitasi dan spasi sebelum tanda baca
  rawNarrativeText = rawNarrativeText.replace(/\s+(\[\d+(?:,\s*\d+)*\])/g, '$1');
  rawNarrativeText = rawNarrativeText.replace(/(\[\d+(?:,\s*\d+)*\])\s+([.,;:])/g, '$1$2');

  // 3. Pisahkan sub-bullet yang berpotensi tergabung dalam satu baris (misal "...[1] * Q2 2025: ...")
  rawNarrativeText = rawNarrativeText.replace(/(\[\d+(?:,\s*\d+)*\])\s+\*\s+([A-Za-z0-9])/g, '$1\n- $2');
  rawNarrativeText = rawNarrativeText.replace(/:\*\s+([A-Za-z0-9])/g, ':\n- $1');

  const allLines = rawNarrativeText.split('\n');
  const normalizedBlocks = [];
  let currentGroup = [];

  for (const rawLine of allLines) {
    const line = rawLine.trim();
    if (!line) {
      if (currentGroup.length > 0) {
        normalizedBlocks.push(currentGroup.join(' '));
        currentGroup = [];
      }
      continue;
    }

    // Pola blok terpisah: heading (###), nomor urut (1. ), bullet (- / * / •), quote (>), divider (---)
    const isSpecialBlock = /^(#{1,4}\s|\d+\.\s|[-*•]\s|>\s|---|---|\*\*\*)/.test(line);

    if (isSpecialBlock) {
      if (currentGroup.length > 0) {
        normalizedBlocks.push(currentGroup.join(' '));
        currentGroup = [];
      }
      normalizedBlocks.push(line);
    } else {
      currentGroup.push(line);
    }
  }

  if (currentGroup.length > 0) {
    normalizedBlocks.push(currentGroup.join(' '));
  }

  const paragraphs = normalizedBlocks.length > 0 ? normalizedBlocks : [rawNarrativeText];

  // Format citations agar cocok dengan komponen SheetReferencesIEEE
  const citations = (sources || []).map((src, idx) => ({
    id: src.id || `src-${idx + 1}`,
    sheet_code: src.sheet_code || '',
    sheet_title: src.sheet_title || 'Laporan Keuangan Resmi BEI',
    ticker: src.ticker || '',
    entityName: src.entity_name || src.ticker || 'Emiten BEI',
    period: src.period || '',
    rounding: src.rounding || 'Jutaan / In Million',
    snippet: src.snippet || '',
    distance: src.distance || 0
  }));

  return {
    paragraphs,
    table: parsedTable,
    citations
  };
}
