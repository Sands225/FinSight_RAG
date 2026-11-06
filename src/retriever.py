import os
import re
import json
import chromadb
from chromadb.utils import embedding_functions

JSON_DATA_PATH = os.path.join("data", "processed", "financial_rag_data.json")
CHROMA_DB_DIR = os.path.join("vectorstore")
COLLECTION_NAME = "idx_financial_statements"
EMBEDDING_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

# Daftar kode sheet Laporan Keuangan Utama (Primary Financial Statements)
PRIMARY_STATEMENT_CODES = {"4220000", "4312000", "4322000", "4410000", "4410000PY", "4510000", "4520000"}

def compact_markdown_table(text: str) -> str:
    """Merapatkan spasi hanya pada baris tabel Markdown (yang diawali dengan '|')."""
    cleaned_lines = []
    for line in text.split("\n"):
        stripped = line.strip()
        if stripped.startswith("|") and stripped.endswith("|"):
            if re.match(r"^\|[\s:\-\|]+\|$", stripped):
                cleaned_lines.append("|---|---|---|")
                continue
            cells = [c.strip() for c in stripped.strip("|").split("|")]
            cleaned_lines.append("| " + " | ".join(cells) + " |")
        else:
            cleaned_lines.append(line)
    return "\n".join(cleaned_lines)

def build_embedding_summary(doc_content: str, metadata: dict) -> str:
    """Menaruh kata kunci laporan & daftar pos akun di baris paling atas untuk model embedding."""
    sheet_code = str(metadata.get("sheet_code", ""))
    title = metadata.get("sheet_title_id", "")
    
    # Tambahkan sinonim populer untuk laporan utama agar model embedding langsung mengenali
    alias_keywords = ""
    if sheet_code == "4220000":
        alias_keywords = "Neraca, Balance Sheet, Posisi Keuangan, Kas, Giro, Pinjaman, Total Aset, Liabilitas, Ekuitas"
    elif sheet_code in {"4312000", "4322000"}:
        alias_keywords = "Laporan Laba Rugi, Income Statement, Profit and Loss, Pendapatan Bunga, Beban Bunga, Laba Bersih, Jumlah Laba Rugi, EPS"
    elif sheet_code in {"4510000", "4520000"}:
        alias_keywords = "Laporan Arus Kas, Cash Flow Statement, Aktivitas Operasi, Investasi, Pendanaan, Kas dan Setara Kas"
    elif sheet_code in {"4410000", "4410000PY"}:
        alias_keywords = "Laporan Perubahan Ekuitas, Modal Saham, Saldo Laba Ditahan"

    account_names = []
    for line in doc_content.split("\n"):
        stripped = line.strip()
        if stripped.startswith("|") and not re.match(r"^\|[\s:\-\|]+\|$", stripped):
            parts = [p.strip() for p in stripped.strip("|").split("|")]
            if parts and parts[0] not in ["Pos_Akun", "Deskripsi", "Topik", ""]:
                account_names.append(parts[0])
                
    # Batasi daftar pos akun maksimal 35 item pertama di header agar ringkas
    accounts_str = ", ".join(account_names[:35])
    
    header_summary = f"[{sheet_code}] {title}\n"
    if alias_keywords:
        header_summary += f"Kata Kunci Utama: {alias_keywords}\n"
    if accounts_str:
        header_summary += f"Pos Akun: {accounts_str}\n\n"
        
    return header_summary + compact_markdown_table(doc_content)

_CHROMA_CLIENT = None
_EMBEDDING_FN = None

def get_chroma_client():
    global _CHROMA_CLIENT
    if _CHROMA_CLIENT is None:
        _CHROMA_CLIENT = chromadb.PersistentClient(path=CHROMA_DB_DIR)
    return _CHROMA_CLIENT

def get_embedding_function():
    global _EMBEDDING_FN
    if _EMBEDDING_FN is None:
        _EMBEDDING_FN = embedding_functions.SentenceTransformerEmbeddingFunction(
            model_name=EMBEDDING_MODEL_NAME,
            device="cpu"
        )
    return _EMBEDDING_FN

def get_chroma_collection(collection_name: str = COLLECTION_NAME, with_embeddings: bool = True):
    client = get_chroma_client()
    if with_embeddings:
        emb_fn = get_embedding_function()
        return client.get_or_create_collection(
            name=collection_name,
            embedding_function=emb_fn,
            metadata={"hnsw:space": "cosine"}
        )
    else:
        try:
            return client.get_collection(name=collection_name)
        except Exception:
            emb_fn = get_embedding_function()
            return client.get_or_create_collection(name=collection_name, embedding_function=emb_fn)

def get_available_entities(collection_name: str = COLLECTION_NAME) -> dict:
    """Mengambil daftar emiten (ticker) dan periode yang saat ini tersimpan di ChromaDB tanpa memuat model PyTorch."""
    try:
        collection = get_chroma_collection(collection_name, with_embeddings=False)
        if collection.count() == 0:
            return {}
        data = collection.get(include=["metadatas"])
        metadatas = data.get("metadatas", [])
        
        summary = {}
        for meta in metadatas:
            ticker = meta.get("ticker", "UNKNOWN").upper()
            period = meta.get("period", "UNKNOWN")
            if ticker not in summary:
                summary[ticker] = set()
            summary[ticker].add(period)
            
        return {k: sorted(list(v)) for k, v in summary.items()}
    except Exception:
        return {}

def get_filter_options(collection_name: str = COLLECTION_NAME) -> dict:
    """
    Mengembalikan opsi unik Bank, Tahun, dan Kuartal yang tersedia untuk dropdown UI.
    """
    available = get_available_entities(collection_name)
    banks = sorted(list(available.keys()))
    
    all_periods = set()
    for periods in available.values():
        all_periods.update(periods)
        
    years = sorted(list({p.split("-")[0] for p in all_periods if re.match(r"^\d{4}", p)}), reverse=True)
    
    quarters_found = set()
    for p in all_periods:
        if p.endswith("03-31"):
            quarters_found.add("Q1")
        elif p.endswith("06-30"):
            quarters_found.add("Q2")
        elif p.endswith("09-30"):
            quarters_found.add("Q3")
        elif p.endswith("12-31"):
            quarters_found.add("Tahunan")
            
    standard_quarters = ["Q1", "Q2", "Q3", "Tahunan"]
    quarters = [q for q in standard_quarters if q in quarters_found]
    if not quarters:
        quarters = standard_quarters
        
    return {
        "banks": banks if banks else ["BBCA", "BBNI"],
        "years": years if years else ["2026", "2025"],
        "quarters": quarters
    }

def resolve_period_from_quarter(quarter_input: str, year: str = None, available_periods: list = None) -> str:
    """
    Menerjemahkan input tahun & kuartal fleksibel
    (misal: year='2025', quarter='Q1' atau 'Tahunan', atau quarter='2025 Q1')
    menjadi format tanggal akhir periode (YYYY-MM-DD).
    """
    if not quarter_input and not year:
        return None
        
    q_str = str(quarter_input).strip().upper() if quarter_input else ""
    y_str = str(year).strip() if year else ""
    
    # 1. Jika pengguna langsung memasukkan format tanggal lengkap YYYY-MM-DD
    if re.match(r"^\d{4}-\d{2}-\d{2}$", q_str):
        return q_str
        
    # Ekstrak tahun jika tertulis di dalam teks kuartal (misal: "2025 Q1" atau "Q3 2026")
    year_in_q = re.search(r"\b(20\d{2})\b", q_str)
    if year_in_q:
        y_str = year_in_q.group(1)
        # Bersihkan tahun dari string kuartal
        q_str = q_str.replace(y_str, "").strip()

    quarter_month_map = {
        "1": "03-31",
        "Q1": "03-31",
        "I": "03-31",
        "TW1": "03-31",
        "TW 1": "03-31",
        "KUARTAL 1": "03-31",
        "2": "06-30",
        "Q2": "06-30",
        "II": "06-30",
        "TW2": "06-30",
        "TW 2": "06-30",
        "KUARTAL 2": "06-30",
        "SEMESTER 1": "06-30",
        "3": "09-30",
        "Q3": "09-30",
        "III": "09-30",
        "TW3": "09-30",
        "TW 3": "09-30",
        "KUARTAL 3": "09-30",
        "4": "12-31",
        "Q4": "12-31",
        "IV": "12-31",
        "TW4": "12-31",
        "TW 4": "12-31",
        "KUARTAL 4": "12-31",
        "TAHUNAN": "12-31",
        "ANNUAL": "12-31",
        "FY": "12-31"
    }
    
    target_month_day = quarter_month_map.get(q_str)
    
    # Jika tahun dan kuartal/bulan spesifik diketahui langsung
    if y_str and target_month_day:
        target_period = f"{y_str}-{target_month_day}"
        if available_periods:
            if target_period in available_periods:
                return target_period
        return target_period

    # Jika hanya tahun yang diketahui atau dicocokkan dengan periode yang tersedia
    if available_periods:
        for p in available_periods:
            match_y = (not y_str) or p.startswith(y_str)
            match_q = (not target_month_day) or p.endswith(target_month_day)
            if match_y and match_q:
                return p
                
    if y_str and target_month_day:
        return f"{y_str}-{target_month_day}"
        
    return None

def build_vector_store(json_path: str = JSON_DATA_PATH, collection_name: str = COLLECTION_NAME):
    if not os.path.exists(json_path):
        raise FileNotFoundError(f"File JSON tidak ditemukan: {json_path}")
        
    with open(json_path, "r", encoding="utf-8") as f:
        chunks = json.load(f)
        
    collection = get_chroma_collection(collection_name)
    
    ids, documents_for_embedding, metadatas = [], [], []
    print(f"[1/2] Mengoptimalkan struktur teks & memproses embedding untuk {len(chunks)} chunks...")
    
    for item in chunks:
        ids.append(item["id"])
        compact_doc = build_embedding_summary(item["page_content"], item["metadata"])
        documents_for_embedding.append(compact_doc)
        metadatas.append(item["metadata"])
        
    batch_size = 100
    total = len(chunks)
    for start_idx in range(0, total, batch_size):
        end_idx = min(start_idx + batch_size, total)
        collection.upsert(
            ids=ids[start_idx:end_idx],
            documents=documents_for_embedding[start_idx:end_idx],
            metadatas=metadatas[start_idx:end_idx]
        )
        print(f"  -> Progress: {end_idx}/{total} chunks tersimpan...")
        
    print(f"[2/2] Selesai! Total dokumen tersimpan di ChromaDB: {collection.count()}")

def index_document_chunks(chunks: list, collection_name: str = COLLECTION_NAME) -> int:
    """Mengindeks daftar chunk dokumen baru secara langsung ke ChromaDB."""
    if not chunks:
        return 0
    collection = get_chroma_collection(collection_name)
    ids, documents_for_embedding, metadatas = [], [], []
    for item in chunks:
        ids.append(item["id"])
        documents_for_embedding.append(build_embedding_summary(item["page_content"], item["metadata"]))
        metadatas.append(item["metadata"])
        
    batch_size = 100
    total = len(chunks)
    for start_idx in range(0, total, batch_size):
        end_idx = min(start_idx + batch_size, total)
        collection.upsert(
            ids=ids[start_idx:end_idx],
            documents=documents_for_embedding[start_idx:end_idx],
            metadatas=metadatas[start_idx:end_idx]
        )
    return total

def search_financial_docs(
    query: str, 
    ticker: str = None, 
    year: str = None,
    quarter: str = None, 
    period: str = None, 
    top_k: int = 3, 
    doc_type_filter: str = None,
    collection_name: str = COLLECTION_NAME
):
    """
    Hybrid Search (ChromaDB Cosine Distance + Financial Statement & Account Reranking)
    dengan dukungan filter dinamis Bank (Ticker), Tahun (Year), dan Kuartal (Period).
    """
    collection = get_chroma_collection(collection_name)
    total_docs = collection.count()
    if total_docs == 0:
        build_vector_store(collection_name=collection_name)
        total_docs = collection.count()
        
    # --- 1. DYNAMIC METADATA FILTERING (Bank, Tahun & Kuartal) ---
    where_conditions = []
    
    clean_ticker = str(ticker).strip().upper() if ticker and str(ticker).strip() and str(ticker).strip().lower() not in ["semua", "all", "none", ""] else None
    if clean_ticker:
        where_conditions.append({"ticker": clean_ticker})
        
    clean_year = str(year).strip() if year and str(year).strip() and str(year).strip().lower() not in ["semua", "all", "none", ""] else None
    clean_quarter = str(quarter).strip() if quarter and str(quarter).strip() and str(quarter).strip().lower() not in ["semua", "all", "none", ""] else None

    resolved_period = period.strip() if period and str(period).strip() and str(period).strip().lower() not in ["semua", "all", "none", ""] else None
    if not resolved_period and (clean_quarter or clean_year):
        available_info = get_available_entities(collection_name)
        ticker_periods = available_info.get(clean_ticker, []) if clean_ticker else [p for per_list in available_info.values() for p in per_list]
        resolved_period = resolve_period_from_quarter(clean_quarter, year=clean_year, available_periods=ticker_periods)
        
    if resolved_period:
        where_conditions.append({"period": resolved_period})
        
    if doc_type_filter:
        where_conditions.append({"doc_type": doc_type_filter})
        
    if len(where_conditions) == 1:
        where_clause = where_conditions[0]
    elif len(where_conditions) > 1:
        where_clause = {"$and": where_conditions}
    else:
        where_clause = None
        
    # Ambil kandidat dari ChromaDB
    n_query = total_docs
    try:
        results = collection.query(
            query_texts=[query],
            n_results=n_query,
            where=where_clause
        )
    except Exception:
        results = collection.query(
            query_texts=[query],
            n_results=min(total_docs, max(top_k * 5, 10)),
            where=where_clause
        )
    
    if not results or not results["ids"] or len(results["ids"][0]) == 0:
        return []

    # --- 2. INTENT MAPPING & FINANCIAL RERANKING ---
    q_lower = query.lower()
    is_policy_query = any(w in q_lower for w in ["kebijakan", "psak", "definisi", "metode penyusutan", "prinsip"])
    
    # Pemetaan topik laporan keuangan utama lintas sektor
    target_sheets = set()
    # Posisi Keuangan / Neraca
    if any(w in q_lower for w in ["kas", "giro", "tabungan", "deposito", "aset", "liabilitas", "pinjaman", "kredit", "neraca", "posisi keuangan", "obligasi", "piutang", "persediaan"]):
        if "arus kas" not in q_lower:
            target_sheets.add("4220000")
    # Laba Rugi Komprehensif
    if any(w in q_lower for w in ["laba", "rugi", "pendapatan", "beban", "komprehensif", "eps", "per saham", "opex", "pajak", "penjualan", "cogs", "beban pokok"]):
        target_sheets.update(["4322000", "4312000"])
    # Arus Kas
    if "arus kas" in q_lower or "aktivitas operasi" in q_lower or "aktivitas investasi" in q_lower or "aktivitas pendanaan" in q_lower:
        target_sheets.update(["4510000", "4520000"])
    # Perubahan Ekuitas
    if "perubahan ekuitas" in q_lower or "modal saham" in q_lower or "saldo laba" in q_lower or "dividen" in q_lower:
        target_sheets.update(["4410000", "4410000PY"])

    # Stopwords dinamis (kata umum + ticker yang sedang dicari)
    stopwords = {"berapa", "jumlah", "total", "nilai", "pada", "periode", "berjalan", "sebelumnya", "dan", "yang", "dari", "untuk", "apakah", "bagaimana", "tahun", "bank", "kuartal"}
    if clean_ticker:
        stopwords.add(clean_ticker.lower())
    query_terms = [w for w in re.findall(r"\w+", q_lower) if len(w) >= 3 and w not in stopwords]

    scored_candidates = []
    for i in range(len(results["ids"][0])):
        doc_id = results["ids"][0][i]
        content = results["documents"][0][i]
        meta = results["metadatas"][0][i]
        cosine_dist = results["distances"][0][i]
        
        sheet_code = str(meta.get("sheet_code", ""))
        doc_type = meta.get("doc_type", "")
        content_lower = content.lower()
        title_lower = meta.get("sheet_title_id", "").lower()
        
        adjusted_score = cosine_dist
        
        # Prioritas kuat jika sheet adalah Laporan Keuangan Utama yang sesuai topik pertanyaan
        if not is_policy_query:
            if sheet_code in target_sheets:
                adjusted_score -= 0.45
            elif sheet_code in PRIMARY_STATEMENT_CODES:
                adjusted_score -= 0.20
            elif doc_type == "narrative_disclosure":
                adjusted_score += 0.25
                
        # Bonus kecocokan kata kunci pos akun di baris tabel
        for term in query_terms:
            if f"| {term} |" in content_lower:
                adjusted_score -= 0.15
            elif f"| {term}" in content_lower or term in title_lower:
                adjusted_score -= 0.08
                
        scored_candidates.append({
            "id": doc_id,
            "content": content,
            "metadata": meta,
            "distance": round(cosine_dist, 4),
            "hybrid_score": round(adjusted_score, 4)
        })
        
    scored_candidates.sort(key=lambda x: x["hybrid_score"])
    return scored_candidates[:top_k]


if __name__ == "__main__":
    print("=" * 60)
    print("    FINSIGHT RETRIEVER - PENCARIAN DOKUMEN KEUANGAN DINAMIS")
    print("=" * 60)
    
    # 1. Tampilkan data yang tersedia di database
    available = get_available_entities()
    if not available:
        print("\nDatabase kosong, sedang membangun index awal...")
        build_vector_store()
        available = get_available_entities()
        
    print("\nData Bank / Emiten & Periode yang Tersedia di Database:")
    for ticker_name, periods in available.items():
        print(f"  • Bank/Ticker : {ticker_name}")
        print(f"    Periode     : {', '.join(periods)}")
    print("-" * 60)
    
    # 2. Minta input dinamis dari pengguna
    try:
        user_bank = input("\n[1/4] Mau dari Bank/Emiten apa? (misal: BBCA, BBNI, kosongkan jika semua): ").strip()
        user_year = input("[2/4] Mau tahun berapa? (misal: 2025, 2026, kosongkan jika semua): ").strip()
        user_quarter = input("[3/4] Mau kuartal berapa? (misal: Q1, Q2, Q3, Tahunan/Q4, kosongkan jika semua): ").strip()
        user_question = input("[4/4] Masukkan pertanyaan keuangan Anda: ").strip()
    except (EOFError, KeyboardInterrupt):
        user_bank = "BBCA"
        user_year = "2026"
        user_quarter = "Q1"
        user_question = "Berapa jumlah kas dan laba bersih pada periode berjalan?"
        print(f"\n(Mode Non-Interaktif terdeteksi, input pengujian: Bank={user_bank}, Tahun={user_year}, Q={user_quarter}, Pertanyaan='{user_question}')")

    if not user_question:
        user_question = "Berapa jumlah kas dan laba bersih pada periode berjalan?"
        print(f"Pertanyaan kosong, menggunakan default: '{user_question}'")
        
    print(f"\n[PROSES] Mencari dokumen relevan untuk Bank='{user_bank or 'Semua'}', Tahun='{user_year or 'Semua'}', Kuartal='{user_quarter or 'Semua'}'...")
    
    hits = search_financial_docs(
        query=user_question,
        ticker=user_bank if user_bank else None,
        year=user_year if user_year else None,
        quarter=user_quarter if user_quarter else None,
        top_k=2
    )
    
    if not hits:
        print("\n[HASIL] Tidak ditemukan dokumen yang cocok dengan filter yang ditentukan.")
    else:
        for idx, hit in enumerate(hits, 1):
            meta = hit["metadata"]
            print(f"\n--- Hasil #{idx} (Skor Hybrid: {hit['hybrid_score']} | Jarak Cosine: {hit['distance']}) ---")
            print(f"Emiten / Bank : {meta.get('ticker')} | Periode: {meta.get('period')}")
            print(f"Bagian Laporan: [{meta.get('sheet_code')}] {meta.get('sheet_title_id')}")
            print(f"Tipe Dokumen  : {meta.get('doc_type')}")
            print(f"Cuplikan Isi  :\n{hit['content'][:350]}...\n")
