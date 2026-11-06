import os
import sys
import glob
import shutil
import json
from datetime import datetime
from typing import List, Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, Field

# Pastikan modul src dapat di-import dengan benar
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
SRC_DIR = os.path.join(BASE_DIR, "src")
if SRC_DIR not in sys.path:
    sys.path.append(SRC_DIR)

from retriever import (
    get_filter_options, 
    get_chroma_collection, 
    index_document_chunks, 
    COLLECTION_NAME,
    JSON_DATA_PATH
)
from generator import answer_query
from ingest import extract_xbrl_to_json, parse_filename_meta

# --- 1. INISIALISASI FASTAPI APP ---
app = FastAPI(
    title="FinSight API Gateway",
    description=(
        "REST API Gateway untuk sistem FinSight (Financial RAG). "
        "Dirancang untuk melayani antarmuka frontend modern seperti React JS."
    ),
    version="1.0.0"
)

# --- 2. CORS MIDDLEWARE (Wajib untuk React JS) ---
# Memungkinkan request dari localhost:3000 (Create React App), localhost:5173 (Vite), dll.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 3. PYDANTIC SCHEMAS (Request & Response) ---
class ChatRequest(BaseModel):
    question: str = Field(..., description="Pertanyaan analisis keuangan dari pengguna")
    ticker: Optional[str] = Field(None, description="Kode emiten (misal: BBCA, BBNI), atau 'Semua'")
    year: Optional[str] = Field(None, description="Tahun laporan (misal: 2026, 2025), atau 'Semua'")
    quarter: Optional[str] = Field(None, description="Kuartal laporan (misal: Q1, Q2, Tahunan), atau 'Semua'")
    top_k: int = Field(3, ge=1, le=10, description="Jumlah referensi dokumen konteks yang diambil")

    class Config:
        json_schema_extra = {
            "example": {
                "question": "Berapa laba bersih pada periode berjalan dibandingkan sebelumnya?",
                "ticker": "BBCA",
                "year": "2026",
                "quarter": "Q1",
                "top_k": 3
            }
        }

class SourceItem(BaseModel):
    id: str
    sheet_code: Optional[str] = None
    sheet_title: Optional[str] = None
    ticker: Optional[str] = None
    entity_name: Optional[str] = None
    year: Optional[str] = None
    quarter: Optional[str] = None
    period: Optional[str] = None
    doc_type: Optional[str] = None
    rounding: Optional[str] = None
    hybrid_score: float
    distance: float
    snippet: str

class ChatResponse(BaseModel):
    status: str = "success"
    question: str
    filter_applied: dict
    answer: str
    sources: List[SourceItem]

class FilterOptionsData(BaseModel):
    banks: List[str]
    years: List[str]
    quarters: List[str]

class FilterResponse(BaseModel):
    status: str = "success"
    data: FilterOptionsData

class DocumentItem(BaseModel):
    filename: str
    ticker: str
    year: str
    quarter: str
    size_kb: float
    modified_at: str

class DocumentListResponse(BaseModel):
    status: str = "success"
    total_files: int
    documents: List[DocumentItem]

class UploadResponse(BaseModel):
    status: str = "success"
    message: str
    data: dict

class HealthResponse(BaseModel):
    status: str = "healthy"
    version: str = "1.0.0"
    collection_name: str
    database_docs_count: int
    timestamp: str


# --- 4. ENDPOINTS ---

@app.get("/", include_in_schema=False)
def root():
    """Mengarahkan root URL langsung ke dokumentasi interaktif Swagger UI."""
    return RedirectResponse(url="/docs")


@app.get("/api/health", response_model=HealthResponse, tags=["System"])
def health_check():
    """Mengecek status kesehatan server dan jumlah dokumen aktif di ChromaDB."""
    collection = get_chroma_collection(with_embeddings=False)
    doc_count = collection.count() if collection else 0
    return {
        "status": "healthy",
        "version": "1.0.0",
        "collection_name": COLLECTION_NAME,
        "database_docs_count": doc_count,
        "timestamp": datetime.utcnow().isoformat()
    }


@app.get("/api/filters", response_model=FilterResponse, tags=["Filters"])
def get_filters():
    """
    Mengambil opsi dinamis (Bank, Tahun, Kuartal) dari dokumen yang tersedia di database.
    Digunakan oleh React untuk mengisi elemen select/dropdown.
    """
    try:
        options = get_filter_options()
        return {
            "status": "success",
            "data": options
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengambil opsi filter: {str(e)}"
        )


@app.post("/api/chat", response_model=ChatResponse, tags=["RAG Chat"])
def chat_query(request: ChatRequest):
    """
    Menerima pertanyaan dan filter dari frontend, lalu menghasilkan jawaban analisis keuangan 
    menggunakan Gemini Flash dengan konteks dokumen dari ChromaDB.
    """
    # Normalisasi filter ("Semua" / empty -> None)
    clean_ticker = request.ticker if request.ticker and request.ticker.lower() not in ["semua", "all", "none", ""] else None
    clean_year = request.year if request.year and request.year.lower() not in ["semua", "all", "none", ""] else None
    clean_quarter = request.quarter if request.quarter and request.quarter.lower() not in ["semua", "all", "none", ""] else None

    try:
        answer_text, retrieved_sources = answer_query(
            query=request.question,
            ticker=clean_ticker,
            year=clean_year,
            quarter=clean_quarter,
            top_k=request.top_k
        )

        formatted_sources = []
        for src in retrieved_sources:
            meta = src.get("metadata", {})
            content = src.get("content", "")
            snippet = content[:400] + ("..." if len(content) > 400 else "")
            formatted_sources.append(SourceItem(
                id=str(src.get("id", "")),
                sheet_code=meta.get("sheet_code"),
                sheet_title=meta.get("sheet_title_id"),
                ticker=meta.get("ticker"),
                entity_name=meta.get("entity_name"),
                year=meta.get("year"),
                quarter=meta.get("quarter"),
                period=meta.get("period"),
                doc_type=meta.get("doc_type"),
                rounding=meta.get("rounding"),
                hybrid_score=float(src.get("hybrid_score", 0.0)),
                distance=float(src.get("distance", 0.0)),
                snippet=snippet
            ))

        return {
            "status": "success",
            "question": request.question,
            "filter_applied": {
                "ticker": clean_ticker or "Semua",
                "year": clean_year or "Semua",
                "quarter": clean_quarter or "Semua",
                "top_k": request.top_k
            },
            "answer": answer_text,
            "sources": formatted_sources
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Terjadi kesalahan saat memproses pertanyaan: {str(e)}"
        )


@app.get("/api/documents", response_model=DocumentListResponse, tags=["Document Management"])
def list_documents():
    """Mengambil daftar seluruh file laporan keuangan mentah (.xlsx) yang tersimpan di data/raw/."""
    raw_dir = os.path.join(BASE_DIR, "data", "raw")
    if not os.path.exists(raw_dir):
        return {"status": "success", "total_files": 0, "documents": []}

    files = glob.glob(os.path.join(raw_dir, "*.xlsx"))
    doc_items = []
    
    for f in sorted(files):
        fname = os.path.basename(f)
        year, quarter, ticker = parse_filename_meta(f)
        stat = os.stat(f)
        size_kb = round(stat.st_size / 1024, 2)
        mod_time = datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S")

        doc_items.append(DocumentItem(
            filename=fname,
            ticker=ticker or "UNKNOWN",
            year=year or "UNKNOWN",
            quarter=quarter or "UNKNOWN",
            size_kb=size_kb,
            modified_at=mod_time
        ))

    return {
        "status": "success",
        "total_files": len(doc_items),
        "documents": doc_items
    }


@app.post("/api/documents/upload", response_model=UploadResponse, tags=["Document Management"])
def upload_document(file: UploadFile = File(..., description="File laporan keuangan (.xlsx)")):
    """
    Mengunggah file laporan keuangan Excel baru. 
    Sistem akan otomatis mengekstrak tabel & narasi, lalu langsung mengindeksnya ke ChromaDB.
    """
    # 1. Validasi ekstensi file
    if not file.filename.lower().endswith((".xlsx", ".xls")):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Format file tidak valid. Hanya file Excel (.xlsx / .xls) yang diperbolehkan."
        )

    raw_dir = os.path.join(BASE_DIR, "data", "raw")
    os.makedirs(raw_dir, exist_ok=True)
    destination_path = os.path.join(raw_dir, file.filename)

    # 2. Simpan file ke data/raw/
    try:
        with open(destination_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal menyimpan file: {str(e)}"
        )
    finally:
        file.file.close()

    # 3. Validasi ukuran file (hindari file kosong / corrupt)
    file_size = os.path.getsize(destination_path)
    if file_size < 1000:
        if os.path.exists(destination_path):
            os.remove(destination_path)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"File terlalu kecil ({file_size} bytes) atau korup. Pastikan file Excel berisi data valid."
        )

    # 4. Ekstraksi dokumen menggunakan parser ingest.py
    try:
        new_chunks = extract_xbrl_to_json(destination_path)
        if not new_chunks:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Tidak ada lembar laporan atau pos akun yang berhasil diekstrak dari file Excel ini."
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengekstrak struktur file Excel: {str(e)}"
        )

    # 5. Indeks langsung ke database vektor ChromaDB
    try:
        indexed_count = index_document_chunks(new_chunks)
        collection = get_chroma_collection(with_embeddings=False)
        total_db_count = collection.count() if collection else 0
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Gagal mengindeks chunk ke ChromaDB: {str(e)}"
        )

    # 6. Sinkronisasi data ke financial_rag_data.json
    try:
        if os.path.exists(JSON_DATA_PATH):
            with open(JSON_DATA_PATH, "r", encoding="utf-8") as f:
                existing_data = json.load(f)
            # Hindari duplikasi ID
            existing_ids = {item["id"] for item in existing_data}
            for chunk in new_chunks:
                if chunk["id"] not in existing_ids:
                    existing_data.append(chunk)
            with open(JSON_DATA_PATH, "w", encoding="utf-8") as f:
                json.dump(existing_data, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print(f"[WARNING]: Gagal sinkronisasi ke file JSON: {e}")

    # Ambil metadata ringkasan dari chunk pertama
    meta_sample = new_chunks[0]["metadata"]
    return {
        "status": "success",
        "message": f"File '{file.filename}' berhasil diunggah dan diindeks ke ChromaDB.",
        "data": {
            "filename": file.filename,
            "ticker": meta_sample.get("ticker"),
            "entity_name": meta_sample.get("entity_name"),
            "year": meta_sample.get("year"),
            "quarter": meta_sample.get("quarter"),
            "period": meta_sample.get("period"),
            "chunks_indexed": indexed_count,
            "total_database_docs": total_db_count
        }
    }


if __name__ == "__main__":
    import uvicorn
    print("\n" + "=" * 60)
    print("        MENJALANKAN FINSIGHT API GATEWAY (FASTAPI)")
    print("=" * 60)
    print(" • Dokumentasi Interaktif (Swagger UI): http://localhost:8000/docs")
    print(" • Health Check Endpoint              : http://localhost:8000/api/health")
    print(" • Filters Endpoint                   : http://localhost:8000/api/filters")
    print("=" * 60 + "\n")
    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)

