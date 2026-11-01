import os
import re
import json
import chromadb
from chromadb.utils import embedding_functions

JSON_DATA_PATH = os.path.join("data", "processed", "bbca_financial_rag_data.json")
CHROMA_DB_DIR = os.path.join("vectorstore")
COLLECTION_NAME = "bbca_financial_2026q1"
EMBEDDING_MODEL_NAME = "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"

# Daftar kode sheet Laporan Keuangan Utama (Primary Financial Statements)
PRIMARY_STATEMENT_CODES = {"4220000", "4312000", "4322000", "4410000", "4410000PY", "4510000", "4520000"}

def compact_markdown_table(text: str) -> str:
    """Merapatkan spasi hanya pada baris tabel Markdown (yang diawali dengan '|')."""
    cleaned_lines = []
    for line in text.split("\n"):
        stripped = line.strip()
        # Pastikan hanya memproses baris tabel (diawali dan diakhiri dengan '|')
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

def get_chroma_collection():
    client = chromadb.PersistentClient(path=CHROMA_DB_DIR)
    emb_fn = embedding_functions.SentenceTransformerEmbeddingFunction(
        model_name=EMBEDDING_MODEL_NAME,
        device="cpu"
    )
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        embedding_function=emb_fn,
        metadata={"hnsw:space": "cosine"}
    )

def build_vector_store():
    if not os.path.exists(JSON_DATA_PATH):
        raise FileNotFoundError(f"File JSON tidak ditemukan: {JSON_DATA_PATH}")
        
    with open(JSON_DATA_PATH, "r", encoding="utf-8") as f:
        chunks = json.load(f)
        
    collection = get_chroma_collection()
    
    ids, documents_for_embedding, metadatas = [], [], []
    print(f"[1/2] Mengoptimalkan struktur teks & memproses embedding untuk {len(chunks)} chunks...")
    
    for item in chunks:
        ids.append(item["id"])
        compact_doc = build_embedding_summary(item["page_content"], item["metadata"])
        documents_for_embedding.append(compact_doc)
        metadatas.append(item["metadata"])
        
    collection.upsert(ids=ids, documents=documents_for_embedding, metadatas=metadatas)
    print(f"[2/2] Selesai! Total dokumen tersimpan di ChromaDB: {collection.count()}")

def search_financial_docs(query: str, top_k: int = 3, doc_type_filter: str = None):
    """
    Hybrid Search (ChromaDB Cosine Distance + Financial Account & Statement Reranking).
    """
    collection = get_chroma_collection()
    total_docs = collection.count()
    if total_docs == 0:
        build_vector_store()
        total_docs = collection.count()
        
    where_clause = {"doc_type": doc_type_filter} if doc_type_filter else None
    
    # Ambil SEMUA dokumen di koleksi (60 chunks) agar laporan utama tidak terpotong di top-20
    results = collection.query(
        query_texts=[query],
        n_results=total_docs,
        where=where_clause
    )
    
    q_lower = query.lower()
    is_policy_query = any(w in q_lower for w in ["kebijakan", "psak", "definisi", "metode penyusutan", "prinsip"])
    
    # Pemetaan maksud pertanyaan (Intent Mapping) ke kode laporan utama
    target_sheets = set()
    if any(w in q_lower for w in ["kas", "giro", "tabungan", "deposito", "aset", "liabilitas", "pinjaman", "kredit", "neraca", "posisi keuangan", "obligasi"]):
        if "arus kas" not in q_lower:
            target_sheets.add("4220000")
    if any(w in q_lower for w in ["laba", "rugi", "pendapatan", "beban", "komprehensif", "eps", "per saham", "opex", "pajak"]):
        target_sheets.update(["4322000", "4312000"])
    if "arus kas" in q_lower or "aktivitas operasi" in q_lower or "aktivitas investasi" in q_lower:
        target_sheets.update(["4510000", "4520000"])
    if "perubahan ekuitas" in q_lower or "modal saham" in q_lower or "saldo laba" in q_lower:
        target_sheets.update(["4410000", "4410000PY"])

    stopwords = {"berapa", "jumlah", "total", "nilai", "pada", "periode", "berjalan", "sebelumnya", "dan", "yang", "dari", "untuk", "bbca", "bank", "bca", "apakah", "bagaimana", "tahun"}
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
        
        # 1. Prioritas kuat jika sheet adalah Laporan Keuangan Utama yang sesuai topik pertanyaan
        if not is_policy_query:
            if sheet_code in target_sheets:
                adjusted_score -= 0.45  # Tarik langsung Laporan Utama (Neraca / Laba Rugi / Arus Kas) ke posisi teratas
            elif sheet_code in PRIMARY_STATEMENT_CODES:
                adjusted_score -= 0.20
            elif doc_type == "narrative_disclosure":
                adjusted_score += 0.25  # Turunkan teks kebijakan akuntansi jika user menanyakan angka
                
        # 2. Bonus kecocokan kata kunci pos akun di baris tabel (contoh: "| kas |" atau "jumlah laba (rugi)")
        for term in query_terms:
            if f"| {term} |" in content_lower:
                adjusted_score -= 0.15  # Exact match nama pos akun di dalam sel tabel
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
    build_vector_store()
    
    test_query = "Berapa jumlah kas dan laba bersih BBCA pada periode berjalan?"
    print(f"\n[TEST QUERY]: '{test_query}'")
    
    hits = search_financial_docs(test_query, top_k=2)
    for idx, hit in enumerate(hits, 1):
        print(f"\n--- Hasil #{idx} (ID: {hit['id']} | Hybrid Score: {hit['hybrid_score']} | Cosine: {hit['distance']}) ---")
        print(f"Judul Sheet : {hit['metadata']['sheet_title_id']}")
        print(f"Tipe Dokumen: {hit['metadata']['doc_type']}")
        print(f"Cuplikan Isi:\n{hit['content'][:400]}...\n")