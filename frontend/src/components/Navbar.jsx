import React, { useState } from 'react';
import { ShieldCheck, LogOut, Sparkles, Download } from 'lucide-react';

export default function Navbar({ isAdminMode, setIsAdminMode, isChatActive, onExport }) {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);

  return (
    <header className="h-14 bg-white/90 backdrop-blur-md border-b border-gray-200 px-6 flex items-center justify-between select-none z-20 shrink-0">
      {/* Sisi Kiri Header: Bersih tanpa teks / logo */}
      <div className="flex items-center gap-2">
        {isAdminMode && (
          <span className="text-xs font-semibold bg-amber-50 text-amber-800 border border-amber-200 px-2.5 py-0.5 rounded">
            Panel Administrator
          </span>
        )}
      </div>

      {/* Sisi Kanan: Tombol Ekspor (Kondisional) & Menu Profil */}
      <div className="flex items-center gap-3">
        {/* Tombol Ekspor: Hanya muncul jika ada sesi chat yang sedang aktif */}
        {isChatActive && !isAdminMode && (
          <button
            type="button"
            onClick={onExport || (() => alert('Mengekspor ringkasan laporan riset keuangan...'))}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-xs font-semibold text-gray-700 transition-all shadow-2xs cursor-pointer active:scale-95"
            title="Ekspor Analisis Laporan"
          >
            <Download className="w-3.5 h-3.5 text-gray-500" />
            <span>Ekspor</span>
          </button>
        )}

        {/* Menu Avatar Profil & Role Switcher */}
        <div className="relative">
          <button
            onClick={() => setProfileMenuOpen(!profileMenuOpen)}
            className="w-8 h-8 rounded-full bg-gray-900 hover:bg-gray-800 text-white flex items-center justify-center text-xs font-semibold tracking-tight ring-2 ring-gray-100 cursor-pointer transition-all shadow-2xs"
            title="Menu Akun & Akses Admin"
            type="button"
          >
            FS
          </button>

          {profileMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl border border-gray-200 shadow-xl py-1 z-50 animate-in fade-in zoom-in-95">
              <div className="px-3 py-2 border-b border-gray-100">
                <div className="text-xs font-bold text-gray-900">Peneliti FinSight</div>
                <div className="text-[11px] text-gray-400">analyst@finsight.local</div>
              </div>

              {/* Pilihan Hak Akses */}
              <div className="p-1">
                {isAdminMode ? (
                  <button
                    onClick={() => {
                      setIsAdminMode(false);
                      setProfileMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors font-medium cursor-pointer"
                  >
                    <Sparkles className="w-4 h-4 text-emerald-600" />
                    <span>Kembali ke Mode Riset</span>
                  </button>
                ) : (
                  <button
                    onClick={() => {
                      setIsAdminMode(true);
                      setProfileMenuOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 text-gray-700 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 text-gray-500" />
                    <span>Buka Panel Ingesti (Admin)</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    alert('Sesi riset aktif.');
                    setProfileMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs flex items-center gap-2 text-gray-500 hover:bg-gray-50 rounded-lg transition-colors cursor-pointer"
                >
                  <LogOut className="w-4 h-4 text-gray-400" />
                  <span>Keluarkan Sesi</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
