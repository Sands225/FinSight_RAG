import os
import sys
from dotenv import load_dotenv
from google import genai
from google.genai import types

# Pastikan import retriever dapat berjalan baik dari folder root maupun src
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from retriever import search_financial_docs

# Muat environment variable dari .env
load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
client = genai.Client(api_key=GEMINI_API_KEY) if GEMINI_API_KEY else None
DEFAULT_MODEL_NAME = os.getenv("GEMINI_MODEL", "gemini-3.5-flash-lite")

SYSTEM_PROMPT = """Anda adalah FinSight, asisten analis keuangan dan akuntansi cerdas khusus laporan keuangan emiten Bursa Efek Indonesia (BEI/IDX).

ATURAN KETAT ANALISIS KEUANGAN:
1. Jawab pertanyaan pengguna HANYA berdasarkan [KONTEKS LAPORAN KEUANGAN] yang diberikan.
2. JANGAN PERNAH menebak, mengarang, atau melakukan halusinasi angka. Jika data atau pos akun yang ditanyakan tidak ditemukan di dalam konteks, katakan secara eksplisit: "Maaf, informasi/pos akun tersebut tidak ditemukan pada bagian laporan keuangan yang tersedia."
3. BACA SATUAN ANGKA: Periksa satuan angka yang tertera pada header konteks dokumen (misal: Jutaan / In Million, Ribuan, atau Rupiah penuh).
   - Sebutkan angka asli pada tabel beserta satuan aslinya, lalu berikan konversinya (misal: miliar/triliun) agar mudah dipahami pembaca.
4. BACA PERIODE & ENTITAS:
   - Perhatikan Emiten dan Periode Tanggal pada header setiap dokumen konteks.
   - `CurrentYearInstant` / `CurrentYearDuration` = Periode Berjalan yang sedang dianalisis.
   - `PriorEndYearInstant` / `PriorYearDuration` = Periode Pembanding Sebelumnya.
5. Selalu cantumkan **Kutipan Sumber Laporan & Kode Sheet** (misal: *[Sumber: Sheet 4220000 - Laporan Posisi Keuangan]*) di akhir penjelasan Anda.
"""

def format_retrieved_context(retrieved_docs: list) -> str:
    """Menggabungkan hasil pencarian ChromaDB menjadi satu blok teks konteks yang rapi."""
    context_blocks = []
    for idx, doc in enumerate(retrieved_docs, 1):
        meta = doc["metadata"]
        block = (
            f"--- DOKUMEN #{idx} (Kode Sheet: {meta.get('sheet_code')} | "
            f"Judul: {meta.get('sheet_title_id')} | "
            f"Emiten: {meta.get('ticker')} | Periode: {meta.get('period')}) ---\n"
            f"{doc['content']}\n"
        )
        context_blocks.append(block)
    return "\n".join(context_blocks)

def answer_query(
    query: str, 
    ticker: str = None, 
    year: str = None, 
    quarter: str = None, 
    top_k: int = 3, 
    retrieved_docs: list = None,
    model: str = None
) -> tuple[str, list]:
    """
    Mengambil konteks dari ChromaDB dengan filter dinamis dan menghasilkan jawaban menggunakan Gemini.
    Mengembalikan tuple: (jawaban_teks, daftar_dokumen_sumber).
    """
    if not client:
        return "[ERROR]: GEMINI_API_KEY belum dikonfigurasi di file .env.", []
        
    # Ambil dokumen jika belum disediakan
    if retrieved_docs is None:
        retrieved_docs = search_financial_docs(
            query=query, 
            ticker=ticker, 
            year=year, 
            quarter=quarter, 
            top_k=top_k
        )
        
    if not retrieved_docs:
        filter_info = []
        if ticker and ticker.lower() != "semua":
            filter_info.append(f"Bank={ticker}")
        if year and year.lower() != "semua":
            filter_info.append(f"Tahun={year}")
        if quarter and quarter.lower() != "semua":
            filter_info.append(f"Kuartal={quarter}")
            
        filter_str = f" ({', '.join(filter_info)})" if filter_info else ""
        return (
            f"Maaf, tidak ada dokumen laporan keuangan yang cocok dengan filter{filter_str} di dalam database. "
            "Silakan periksa pilihan filter atau pastikan file laporan telah di-ingest.",
            []
        )
        
    formatted_context = format_retrieved_context(retrieved_docs)
    
    prompt = f"""[KONTEKS LAPORAN KEUANGAN]
{formatted_context}

[PERTANYAAN PENGGUNA]
{query}

Berikan jawaban yang terstruktur, akurat, dan sertakan kutipan kode sheet sumbernya:"""

    chosen_model = model or DEFAULT_MODEL_NAME

    try:
        response = client.models.generate_content(
            model=chosen_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.0,
            )
        )
        return response.text, retrieved_docs
    except Exception as e:
        # Fallback coba ke model standar flash jika model tertentu tidak tersedia
        if "not found" in str(e).lower() or "404" in str(e):
            try:
                response = client.models.generate_content(
                    model="gemini-2.5-flash",
                    contents=prompt,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM_PROMPT,
                        temperature=0.0,
                    )
                )
                return response.text, retrieved_docs
            except Exception as e2:
                return f"[ERROR GEMINI]: Gagal memanggil model ({e2}).", retrieved_docs
        return f"[ERROR GEMINI]: Gagal menghubungi model ({e}).", retrieved_docs


if __name__ == "__main__":
    print("=" * 60)
    print("    FINSIGHT GENERATOR - ANALISIS KEUANGAN BERBASIS AI")
    print("=" * 60)
    
    test_q = "Bagaimana laba perusahaan pada periode berjalan dibandingkan periode sebelumnya?"
    test_bank = "BBCA"
    test_year = "2026"
    test_quarter = "Q1"
    
    print(f"Filter Uji : Bank={test_bank}, Tahun={test_year}, Kuartal={test_quarter}")
    print(f"Pertanyaan : '{test_q}'\n")
    print("Menghubungi FinSight RAG Pipeline...\n")
    
    answer, docs = answer_query(
        query=test_q,
        ticker=test_bank,
        year=test_year,
        quarter=test_quarter,
        top_k=2
    )
    
    print("=== JAWABAN FINSIGHT ===")
    print(answer)
    print(f"\nTotal Dokumen Konteks Digunakan: {len(docs)}")
