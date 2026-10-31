import os
import json
import warnings
import pandas as pd

# Matikan UserWarning dari openpyxl terkait ekstensi data validation
warnings.filterwarnings("ignore", category=UserWarning, module="openpyxl")

def format_rupiah_number(val):
    if pd.isna(val):
        return "-"
    try:
        num = float(val)
        if num.is_integer():
            return f"{int(num):,}".replace(",", ".")
        return f"{num:,.2f}".replace(",", ".")
    except (ValueError, TypeError):
        return str(val)

def extract_xbrl_to_json(file_path):
    print(f"[1/3] Membaca file Excel: {file_path} ...")
    xls = pd.ExcelFile(file_path)
    
    # 1. Ambil konteks umum emiten dari sheet 1000000
    df_info = pd.read_excel(xls, sheet_name='1000000').dropna(how='all')
    info_dict = dict(zip(df_info.iloc[:, 0].astype(str).str.strip(), df_info.iloc[:, 1]))
    
    entity_name = info_dict.get("Nama entitas", "PT Bank Central Asia Tbk.")
    rounding = info_dict.get("Pembulatan yang digunakan dalam penyajian jumlah dalam laporan keuangan", "Jutaan / Millions")
    period_date = info_dict.get("Tanggal akhir periode berjalan", "2026-03-31")
    
    chroma_documents = []
    skip_sheets = {'Context', 'InlineXBRL', 'hidden', 'Token', '1000000'}
    
    print(f"[2/3] Mengekstrak {len(xls.sheet_names)} sheets...")
    for sheet in xls.sheet_names:
        if sheet in skip_sheets:
            continue
            
        try:
            df_header = pd.read_excel(xls, sheet_name=sheet, nrows=3)
            
            sheet_title_id = sheet
            sheet_title_en = sheet
            if len(df_header) > 1 and df_header.shape[1] > 0:
                if not pd.isna(df_header.iloc[1, 0]):
                    sheet_title_id = str(df_header.iloc[1, 0])
                if df_header.shape[1] > 2 and not pd.isna(df_header.iloc[1, 2]):
                    sheet_title_en = str(df_header.iloc[1, 2])
            
            period_current = "Periode_Berjalan"
            period_prior = "Periode_Sebelumnya"
            if len(df_header) > 2 and df_header.shape[1] > 2:
                if not pd.isna(df_header.iloc[2, 1]):
                    period_current = str(df_header.iloc[2, 1])
                if not pd.isna(df_header.iloc[2, 2]):
                    period_prior = str(df_header.iloc[2, 2])
            
            df_data = pd.read_excel(xls, sheet_name=sheet, skiprows=4)
            if df_data.shape[1] < 3:
                continue
                
            if df_data.shape[1] >= 4:
                df_data = df_data.iloc[:, :4]
                df_data.columns = ['Pos_Akun', 'Current', 'Prior', 'Account_EN']
            else:
                df_data = df_data.iloc[:, :3]
                df_data.columns = ['Pos_Akun', 'Current', 'Prior']
            
            df_data = df_data.dropna(subset=['Current', 'Prior'], how='all')
            df_data = df_data.dropna(subset=['Pos_Akun'])
            if df_data.empty:
                continue
            
            df_data[period_current] = df_data['Current'].apply(format_rupiah_number)
            df_data[period_prior] = df_data['Prior'].apply(format_rupiah_number)
            
            df_clean = df_data[['Pos_Akun', period_current, period_prior]]
            markdown_table = df_clean.to_markdown(index=False)
            
            page_content = (
                f"Emiten: {entity_name} (BBCA) | Tanggal Laporan: {period_date}\n"
                f"Bagian Laporan: [{sheet}] {sheet_title_id} ({sheet_title_en})\n"
                f"Satuan Angka: {rounding}\n\n"
                f"{markdown_table}"
            )
            
            chroma_documents.append({
                "id": f"BBCA_2026Q1_{sheet}",
                "page_content": page_content,
                "metadata": {
                    "ticker": "BBCA",
                    "period": str(period_date),
                    "sheet_code": str(sheet),
                    "sheet_title_id": sheet_title_id.strip(),
                    "rounding": str(rounding)
                }
            })
            print(f"  -> Berhasil mengekstrak sheet [{sheet}]: {sheet_title_id.strip()}")
            
        except Exception as e:
            print(f"  -> [SKIP] Sheet {sheet}: {e}")
            
    return chroma_documents


# ==========================================================
# BLOK EKSEKUSI UTAMA (Bagian ini yang sebelumnya belum ada)
# ==========================================================
if __name__ == "__main__":
    # Sesuaikan lokasi file Excel Anda
    input_excel_path = os.path.join("data", "raw", "FinancialStatement-2026-I-BBCA.xlsx")
    output_json_path = os.path.join("data", "processed", "bbca_financial_rag_data.json")
    
    # Cek apakah file ada di data/raw/, jika tidak ada cek di root folder proyek
    if not os.path.exists(input_excel_path):
        if os.path.exists("FinancialStatement-2026-I-BBCA.xlsx"):
            input_excel_path = "FinancialStatement-2026-I-BBCA.xlsx"
        else:
            print(f"[ERROR] File tidak ditemukan di '{input_excel_path}' maupun di root folder!")
            print("Pastikan file 'FinancialStatement-2026-I-BBCA.xlsx' sudah diletakkan di folder 'data/raw/'.")
            exit(1)

    # Jalankan ekstraksi
    docs = extract_xbrl_to_json(input_excel_path)
    
    # Buat folder data/processed jika belum ada
    os.makedirs(os.path.dirname(output_json_path), exist_ok=True)
    
    # Simpan hasil ke JSON
    print(f"[3/3] Menyimpan ke {output_json_path} ...")
    with open(output_json_path, "w", encoding="utf-8") as f:
        json.dump(docs, f, ensure_ascii=False, indent=2)
        
    print(f"\n[SELESAI] Berhasil mengekstrak {len(docs)} sheets ke '{output_json_path}'!")