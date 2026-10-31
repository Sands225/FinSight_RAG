import os
import re
import json
import pandas as pd

def format_val(val):
    if pd.isna(val):
        return ""
    if isinstance(val, (int, float)):
        if pd.isna(val):
            return ""
        # Jika bilangan desimal kecil (seperti suku bunga 0.0108 di sheet 4624100)
        if 0 < abs(val) < 1:
            return f"{val * 100:.2f}%"
        if float(val).is_integer():
            return f"{int(val):,}".replace(",", ".")
        return f"{val:,.2f}".replace(",", ".")
    return str(val).strip()

def get_clean_sheet_title(df_raw, sheet_code):
    """Mengambil judul asli sheet dari header XBRL dan baris awal."""
    col0_header = str(df_raw.columns[0]).strip()
    # Bersihkan prefix kode [4611100_BD] dari header bahasa Inggris
    en_header = re.sub(r"^\[.*?\]\s*", "", col0_header)
    en_header = re.sub(r"\s*-\s*Financial and Sharia Industry$", "", en_header)
    
    # Cari judul bahasa Indonesia di baris 1 atau 2 (hindari CurrentYearInstant)
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

def extract_xbrl_to_json(file_path):
    print(f"[1/3] Membaca file Excel: {file_path} ...")
    xls = pd.ExcelFile(file_path)
    
    df_info = pd.read_excel(file_path, sheet_name='1000000').dropna(how='all')
    info_dict = dict(zip(df_info.iloc[:, 0].astype(str).str.strip(), df_info.iloc[:, 1]))
    
    entity_name = info_dict.get("Nama entitas", "PT Bank Central Asia Tbk.")
    rounding = info_dict.get("Pembulatan yang digunakan dalam penyajian jumlah dalam laporan keuangan", "Jutaan / In Million")
    period_date = info_dict.get("Tanggal akhir periode berjalan", "2026-03-31")
    
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
                f"Emiten: {entity_name} (BBCA) | Periode: {period_date}\n"
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
                
                # Kelompokkan per topik agar tidak menjadi 1 chunk 376.000 karakter
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
                        "id": f"BBCA_2026Q1_{sheet}_{idx+1}",
                        "page_content": chunk_content,
                        "metadata": {
                            "ticker": "BBCA",
                            "period": str(period_date),
                            "sheet_code": str(sheet),
                            "sheet_title_id": f"{full_title} - {topik}",
                            "doc_type": "narrative_disclosure",
                            "rounding": str(rounding)
                        }
                    })
                    
            # KASUS 2: Tabel Standar 4 Kolom (Neraca, Laba Rugi, Arus Kas, Catatan Bunga)
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
                    "id": f"BBCA_2026Q1_{sheet}",
                    "page_content": header_context + md_table,
                    "metadata": {
                        "ticker": "BBCA",
                        "period": str(period_date),
                        "sheet_code": str(sheet),
                        "sheet_title_id": full_title,
                        "doc_type": "financial_table",
                        "rounding": str(rounding)
                    }
                })
                
            # KASUS 3: Tabel Multi-Kolom (Perubahan Ekuitas & Rincian Breakdown > 4 Kolom)
            else:
                df_multi = df_raw.iloc[1:].copy()
                # Buang baris & kolom yang sepenuhnya kosong
                df_multi = df_multi.dropna(how="all").dropna(axis=1, how="all")
                if df_multi.empty:
                    continue
                
                # Format semua sel angka dan lakukan forward-fill pada kolom kategori pertama
                df_multi.iloc[:, 0] = df_multi.iloc[:, 0].ffill()
                df_formatted = df_multi.map(format_val)
                
                # Gunakan baris pertama yang valid sebagai header tabel
                new_headers = [
                    col if col else f"Kolom_{i}" 
                    for i, col in enumerate(df_formatted.iloc[0].tolist())
                ]
                df_formatted = df_formatted.iloc[1:]
                df_formatted.columns = new_headers
                
                md_table = df_formatted.to_markdown(index=False)
                chroma_documents.append({
                    "id": f"BBCA_2026Q1_{sheet}",
                    "page_content": header_context + md_table,
                    "metadata": {
                        "ticker": "BBCA",
                        "period": str(period_date),
                        "sheet_code": str(sheet),
                        "sheet_title_id": full_title,
                        "doc_type": "breakdown_table",
                        "rounding": str(rounding)
                    }
                })
                
        except Exception as e:
            print(f"  -> [SKIP] Sheet {sheet}: {e}")
            
    return chroma_documents

if __name__ == "__main__":
    input_excel_path = os.path.join("data", "raw", "FinancialStatement-2026-I-BBCA.xlsx")
    output_json_path = os.path.join("data", "processed", "bbca_financial_rag_data.json")
    
    if not os.path.exists(input_excel_path) and os.path.exists("FinancialStatement-2026-I-BBCA.xlsx"):
        input_excel_path = "FinancialStatement-2026-I-BBCA.xlsx"
        
    docs = extract_xbrl_to_json(input_excel_path)
    os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
    
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)
        
    print(f"\n[SELESAI] Berhasil mengekstrak {len(docs)} chunks optimal ke '{output_json_path}'!")