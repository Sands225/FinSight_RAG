import os
import re
import json
import glob
import pandas as pd

def format_val(val):
    if pd.isna(val):
        return ""
    if isinstance(val, (int, float)):
        if pd.isna(val):
            return ""
        # Jika bilangan desimal kecil (seperti suku bunga 0.0108)
        if 0 < abs(val) < 1:
            return f"{val * 100:.2f}%"
        if float(val).is_integer():
            return f"{int(val):,}".replace(",", ".")
        return f"{val:,.2f}".replace(",", ".")
    return str(val).strip()

def get_clean_sheet_title(df_raw, sheet_code):
    """Mengambil judul asli sheet dari header XBRL dan baris awal."""
    col0_header = str(df_raw.columns[0]).strip()
    en_header = re.sub(r"^\[.*?\]\s*", "", col0_header)
    en_header = re.sub(r"\s*-\s*Financial and Sharia Industry$", "", en_header)
    
    id_title = ""
    for r in [1, 2, 3]:
        if r < len(df_raw):
            candidate = str(df_raw.iloc[r, 0]).strip()
            if candidate and candidate not in ["nan", "CurrentYearInstant", "CurrentYearDuration"]:
                id_title = candidate
                break
                
    if not id_title or id_title.lower() == "pengungkapan":
        return f"{id_title} - {en_header}" if id_title else en_header
    return f"{id_title} ({en_header})"

def parse_filename_meta(file_path):
    """Mengekstrak Tahun, Kuartal, dan Ticker dari pola nama file IDX."""
    base_name = os.path.basename(file_path)
    match = re.match(r"FinancialStatement-(\d{4})-([A-Za-z0-9]+)-([A-Za-z0-9]+)\.xlsx", base_name, re.IGNORECASE)
    if match:
        year = match.group(1)
        q_raw = match.group(2).upper()
        ticker = match.group(3).upper()
        q_map = {"I": "Q1", "II": "Q2", "III": "Q3", "IV": "Q4", "TAHUNAN": "Tahunan"}
        quarter = q_map.get(q_raw, q_raw)
        return year, quarter, ticker
    return "", "", ""

def extract_xbrl_to_json(file_path):
    if not os.path.exists(file_path) or os.path.getsize(file_path) < 1000:
        print(f"\n[SKIP] File kosong atau tidak valid (< 1 KB): {file_path}")
        return []
        
    print(f"\n[INGEST] Membaca file Excel: {file_path} ...")
    xls = pd.ExcelFile(file_path)
    
    file_year, file_quarter, file_ticker = parse_filename_meta(file_path)
    
    info_dict = {}
    if '1000000' in xls.sheet_names:
        df_info = pd.read_excel(file_path, sheet_name='1000000').dropna(how='all')
        info_dict = dict(zip(df_info.iloc[:, 0].astype(str).str.strip(), df_info.iloc[:, 1]))
        
    entity_name = str(info_dict.get("Nama entitas", file_ticker or "Emiten")).strip()
    ticker = str(info_dict.get("Kode entitas", file_ticker or "UNKNOWN")).strip().upper()
    period_date = str(info_dict.get("Tanggal akhir periode berjalan", "")).strip()
    rounding = str(info_dict.get("Pembulatan yang digunakan dalam penyajian jumlah dalam laporan keuangan", "Jutaan / In Million")).strip()
    
    # Fallback tanggal jika tidak ditemukan di sheet 1000000
    if not period_date and file_year:
        q_date_map = {"Q1": f"{file_year}-03-31", "Q2": f"{file_year}-06-30", "Q3": f"{file_year}-09-30", "Tahunan": f"{file_year}-12-31"}
        period_date = q_date_map.get(file_quarter, f"{file_year}-12-31")
        
    actual_year = file_year or (period_date[:4] if len(period_date) >= 4 else "2026")
    
    chroma_documents = []
    skip_sheets = {'Context', 'InlineXBRL', 'hidden', 'Token', '1000000'}
    
    for sheet in xls.sheet_names:
        if sheet in skip_sheets:
            continue
            
        try:
            df_raw = pd.read_excel(file_path, sheet_name=sheet)
            if df_raw.empty or len(df_raw) < 4:
                continue
                
            full_title = get_clean_sheet_title(df_raw, sheet)
            header_context = (
                f"Emiten: {entity_name} ({ticker}) | Periode: {period_date}\n"
                f"Bagian Laporan: [{sheet}] {full_title}\n"
                f"Satuan Angka: {rounding}\n\n"
            )
            
            # KASUS 1: Sheet Narasi Panjang / Pengungkapan (3 kolom, berisi teks paragraf)
            if df_raw.shape[1] == 3:
                df_text = df_raw.iloc[4:, :2].copy()
                df_text.columns = ["Topik", "Penjelasan"]
                df_text["Topik"] = df_text["Topik"].ffill()
                df_text = df_text.dropna(subset=["Penjelasan"])
                df_text = df_text[df_text["Penjelasan"].astype(str).str.strip() != "-"]
                
                grouped = df_text.groupby("Topik", sort=False)["Penjelasan"].apply(
                    lambda x: "\n\n".join(x.astype(str).str.strip())
                ).reset_index()
                
                for idx, row in grouped.iterrows():
                    topik = str(row["Topik"]).strip()
                    isi = str(row["Penjelasan"]).strip()
                    if not isi:
                        continue
                    
                    chunk_content = f"{header_context}### Topik: {topik}\n\n{isi}"
                    chroma_documents.append({
                        "id": f"{ticker}_{actual_year}_{file_quarter}_{sheet}_{idx+1}",
                        "page_content": chunk_content,
                        "metadata": {
                            "ticker": ticker,
                            "entity_name": entity_name,
                            "year": str(actual_year),
                            "quarter": str(file_quarter),
                            "period": str(period_date),
                            "sheet_code": str(sheet),
                            "sheet_title_id": f"{full_title} - {topik}",
                            "doc_type": "narrative_disclosure",
                            "rounding": str(rounding)
                        }
                    })
                    
            # KASUS 2: Tabel Standar 4 Kolom (Neraca, Laba Rugi, Arus Kas, dll)
            elif df_raw.shape[1] == 4:
                p_curr = str(df_raw.iloc[2, 1]) if not pd.isna(df_raw.iloc[2, 1]) else "Current_Period"
                p_prior = str(df_raw.iloc[2, 2]) if not pd.isna(df_raw.iloc[2, 2]) else "Prior_Period"
                
                df_data = df_raw.iloc[4:, :3].copy()
                df_data.columns = ["Pos_Akun", p_curr, p_prior]
                df_data = df_data.dropna(subset=[p_curr, p_prior], how="all").dropna(subset=["Pos_Akun"])
                if df_data.empty:
                    continue
                    
                df_data[p_curr] = df_data[p_curr].apply(format_val)
                df_data[p_prior] = df_data[p_prior].apply(format_val)
                
                md_table = df_data.to_markdown(index=False)
                chroma_documents.append({
                    "id": f"{ticker}_{actual_year}_{file_quarter}_{sheet}",
                    "page_content": header_context + md_table,
                    "metadata": {
                        "ticker": ticker,
                        "entity_name": entity_name,
                        "year": str(actual_year),
                        "quarter": str(file_quarter),
                        "period": str(period_date),
                        "sheet_code": str(sheet),
                        "sheet_title_id": full_title,
                        "doc_type": "financial_table",
                        "rounding": str(rounding)
                    }
                })
                
            # KASUS 3: Tabel Multi-Kolom (> 4 Kolom)
            else:
                df_multi = df_raw.iloc[1:].copy()
                df_multi = df_multi.dropna(how="all").dropna(axis=1, how="all")
                if df_multi.empty:
                    continue
                
                df_multi.iloc[:, 0] = df_multi.iloc[:, 0].ffill()
                df_formatted = df_multi.map(format_val)
                
                new_headers = [
                    col if col else f"Kolom_{i}" 
                    for i, col in enumerate(df_formatted.iloc[0].tolist())
                ]
                df_formatted = df_formatted.iloc[1:]
                df_formatted.columns = new_headers
                
                md_table = df_formatted.to_markdown(index=False)
                chroma_documents.append({
                    "id": f"{ticker}_{actual_year}_{file_quarter}_{sheet}",
                    "page_content": header_context + md_table,
                    "metadata": {
                        "ticker": ticker,
                        "entity_name": entity_name,
                        "year": str(actual_year),
                        "quarter": str(file_quarter),
                        "period": str(period_date),
                        "sheet_code": str(sheet),
                        "sheet_title_id": full_title,
                        "doc_type": "breakdown_table",
                        "rounding": str(rounding)
                    }
                })
                
        except Exception as e:
            print(f"  -> [SKIP] Sheet {sheet}: {e}")
            
    print(f"  -> Selesai! Berhasil mengekstrak {len(chroma_documents)} chunks.")
    return chroma_documents

def ingest_all_raw_files(raw_dir="data/raw", output_json="data/processed/financial_rag_data.json"):
    """Mengekstrak seluruh file Excel yang ada di folder data/raw/ dan menyimpannya ke JSON terpadu."""
    xlsx_files = glob.glob(os.path.join(raw_dir, "*.xlsx"))
    if not xlsx_files:
        print(f"Tidak ada file .xlsx ditemukan di '{raw_dir}'.")
        return []
        
    print(f"Ditemukan {len(xlsx_files)} file laporan keuangan di '{raw_dir}'...")
    all_chunks = []
    
    for f in xlsx_files:
        try:
            chunks = extract_xbrl_to_json(f)
            all_chunks.extend(chunks)
        except Exception as e:
            print(f"[ERROR]: Gagal memproses {f}: {e}")
            
    os.makedirs(os.path.dirname(output_json), exist_ok=True)
    with open(output_json, "w", encoding="utf-8") as out:
        json.dump(all_chunks, out, ensure_ascii=False, indent=2)
        
    print(f"\n[SELESAI] Total {len(all_chunks)} chunks berhasil diekstrak dan disimpan ke '{output_json}'.")
    return all_chunks

if __name__ == "__main__":
    print("=" * 60)
    print("     FINSIGHT INGESTION - EKSTRAKSI MULTI-EMITEN BEI")
    print("=" * 60)
    
    raw_directory = os.path.join("data", "raw")
    target_output = os.path.join("data", "processed", "financial_rag_data.json")
    
    all_extracted_docs = ingest_all_raw_files(raw_dir=raw_directory, output_json=target_output)
    print(f"\n[SUKSES] Total {len(all_extracted_docs)} dokumen siap dimasukkan ke ChromaDB.")
