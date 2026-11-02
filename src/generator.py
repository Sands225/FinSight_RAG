import os
from dotenv import load_dotenv
from google import genai
from google.genai import types
from retriever import search_financial_docs

# Muat GEMINI_API_KEY dari file .env
load_dotenv()

# Inisialisasi Client Gemini (Otomatis membaca GEMINI_API_KEY dari environment/.env)
client = genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
MODEL_NAME = "gemini-3.5-flash-lite"

SYSTEM_PROMPT = """Anda adalah FinSight, asisten analis keuangan dan akuntansi ahli khusus laporan keuangan emiten Bursa Efek Indonesia (BEI/IDX).

ATURAN KETAT ANALISIS KEUANGAN:
1. Jawab pertanyaan pengguna HANYA berdasarkan [KONTEKS LAPORAN KEUANGAN] yang diberikan.
2. JANGAN PERNAH menebak, mengarang, atau melakukan halusinasi angka. Jika data atau pos akun yang ditanyakan tidak ditemukan di dalam konteks, katakan secara eksplisit: "Maaf, informasi/pos akun tersebut tidak ditemukan pada bagian laporan keuangan yang tersedia."
3. PERHATIKAN SATUAN ANGKA: Laporan keuangan BBCA disajikan dalam satuan **Jutaan Rupiah (In Million Rupiah)** kecuali untuk Laba per Saham (EPS) dan persentase suku bunga.
   - Contoh: Jika tertulis di tabel `23.963.776` dengan satuan Jutaan Rupiah, sebutkan baik angka di tabel (`Rp 23.963.776 juta`) maupun konversinya ke triliun/miliar (`atau sekitar Rp 23,96 triliun`) agar mudah dipahami.
4. PERHATIKAN PERIODE:
   - `CurrentYearInstant` / `CurrentYearDuration` = Periode Berjalan (31 Maret 2026 / Kuartal I 2026).
   - `PriorEndYearInstant` / `PriorYearDuration` = Periode Sebelumnya (31 Desember 2025 untuk Neraca, atau 31 Maret 2025 untuk Laba Rugi/Arus Kas).
5. Selalu cantumkan **Sumber Bagian Laporan dan Kode Sheet** (misal: *[Sumber: Sheet 4220000 - Laporan Posisi Keuangan]*) di akhir penjelasan Anda.
"""

def format_retrieved_context(retrieved_docs: list) -> str:
    """Menggabungkan hasil pencarian ChromaDB menjadi satu blok teks konteks yang rapi."""
    context_blocks = []
    for idx, doc in enumerate(retrieved_docs, 1):
        meta = doc["metadata"]
        block = (
            f"--- DOKUMEN #{idx} (Kode Sheet: {meta.get('sheet_code')} | "
            f"Judul: {meta.get('sheet_title_id')}) ---\n"
            f"{doc['content']}\n"
        )
        context_blocks.append(block)
    return "\n".join(context_blocks)

def answer_query(query: str, retrieved_docs: list = None, top_k: int = 3) -> str:
    """Mengambil konteks dari ChromaDB dan menghasilkan jawaban menggunakan Gemini Flash."""
    if retrieved_docs is None:
        retrieved_docs = search_financial_docs(query, top_k=top_k)
        
    if not retrieved_docs:
        return "Maaf, tidak ada dokumen relevan yang ditemukan di dalam database."
        
    formatted_context = format_retrieved_context(retrieved_docs)
    
    prompt = f"""[KONTEKS LAPORAN KEUANGAN]
{formatted_context}

[PERTANYAAN PENGGUNA]
{query}

Berikan jawaban yang terstruktur, akurat, dan sertakan kutipan kode sheet sumbernya:"""

    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                temperature=0.0,  # 0.0 agar angka keuangan deterministik & bebas halusinasi
            )
        )
        return response.text
    except Exception as e:
        return f"[ERROR GEMINI]: Gagal menghubungi model ({e}). Pastikan GEMINI_API_KEY di file .env sudah benar."


if __name__ == "__main__":
    test_question = (
        "Berapa jumlah Kas dan Laba Bersih (Jumlah laba rugi) BBCA pada periode berjalan "
        "dibandingkan periode sebelumnya?"
    )
    print(f"Pertanyaan: {test_question}\n")
    print("Mencari di ChromaDB dan menghubungi Gemini 2.5 Flash...\n")
    
    docs = search_financial_docs(test_question, top_k=3)
    jawaban = answer_query(test_question, retrieved_docs=docs)
    
    print("=== JAWABAN FINSIGHT (GEMINI FLASH) ===")
    print(jawaban)