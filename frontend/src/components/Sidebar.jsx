import React, { useState } from 'react';
import { Search, Plus, MoreHorizontal, PanelLeftClose } from 'lucide-react';

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
  isOpen,
  onToggle
}) {
  const [searchQuery, setSearchQuery] = useState('');

  const filteredSessions = sessions.filter((s) =>
    s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.preview.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const todaySessions = filteredSessions.filter((s) => s.group === 'Hari Ini');
  const pastSessions = filteredSessions.filter((s) => s.group === '7 Hari Terakhir');

  // Kondisi Sidebar Tertutup: Hanya Logo FinSight yang muncul dan dapat ditekan untuk membuka
  if (!isOpen) {
    return (
      <aside className="w-16 flex-shrink-0 bg-[#FAFAFB] border-r border-gray-200 flex flex-col items-center py-3 select-none h-screen transition-all z-30">
        <button
          type="button"
          onClick={onToggle}
          className="w-9 h-9 rounded-lg bg-emerald-600 hover:bg-emerald-700 transition-colors flex items-center justify-center text-white font-bold text-base shadow-sm cursor-pointer"
          title="Buka Sidebar FinSight"
        >
          F
        </button>
      </aside>
    );
  }

  // Kondisi Sidebar Terbuka: Memotong headbar (Full Height 100vh)
  return (
    <aside className="w-80 flex-shrink-0 bg-[#FAFAFB] border-r border-gray-200 flex flex-col justify-between h-screen transition-all duration-300 z-30 select-none">
      {/* Top Header Row Sidebar: Logo, Tulisan FinSight (Non-Clickable), dan Tombol Tutup */}
      <div className="flex flex-col flex-1 overflow-hidden">
        <div className="h-14 px-4 border-b border-gray-200 flex items-center justify-between bg-white shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-600 flex items-center justify-center text-white font-bold text-sm shadow-sm select-none">
              F
            </div>
            <span className="text-base font-bold text-gray-900 tracking-tight select-none">
              FinSight
            </span>
          </div>

          <button
            type="button"
            onClick={onToggle}
            className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
            title="Tutup Sidebar"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        </div>

        {/* Content Section: Search & Scrollable History */}
        <div className="flex flex-col flex-1 overflow-hidden p-3.5">
          {/* Search Input Bar */}
          <div className="relative mb-3">
            <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Cari riset laporan keuangan..."
              className="w-full pl-9 pr-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-700 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500 shadow-2xs"
            />
          </div>

          {/* Categorized Sesi List */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {/* Hari Ini */}
            {todaySessions.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1.5 px-1">
                  Hari Ini
                </div>
                <div className="space-y-1.5">
                  {todaySessions.map((sess) => {
                    const isActive = sess.id === activeSessionId;
                    return (
                      <div
                        key={sess.id}
                        onClick={() => onSelectSession(sess.id)}
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer group ${
                          isActive
                            ? 'bg-white border-emerald-500/60 ring-1 ring-emerald-500/20 shadow-xs'
                            : 'bg-white border-gray-200/80 hover:border-gray-300 hover:shadow-2xs'
                        }`}
                      >
                        {/* Cukup menampilkan border tanggal/hari ini saja, tanpa filter emiten/tag */}
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200/60">
                            {sess.timestamp.split(',')[0]}
                          </span>
                          <MoreHorizontal className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <h3 className={`text-xs font-semibold leading-snug line-clamp-1 ${isActive ? 'text-emerald-900' : 'text-gray-900 group-hover:text-emerald-700'}`}>
                          {sess.title}
                        </h3>
                        <p className="text-[11px] text-gray-400 line-clamp-2 mt-0.5 leading-snug font-normal">
                          {sess.preview}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 7 Hari Terakhir */}
            {pastSessions.length > 0 && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-400 font-bold mb-1.5 px-1">
                  7 Hari Terakhir
                </div>
                <div className="space-y-1.5">
                  {pastSessions.map((sess) => {
                    const isActive = sess.id === activeSessionId;
                    return (
                      <div
                        key={sess.id}
                        onClick={() => onSelectSession(sess.id)}
                        className={`p-2.5 rounded-xl border transition-all cursor-pointer group ${
                          isActive
                            ? 'bg-white border-emerald-500/60 ring-1 ring-emerald-500/20 shadow-xs'
                            : 'bg-white border-gray-200/80 hover:border-gray-300 hover:shadow-2xs'
                        }`}
                      >
                        {/* Cukup menampilkan border tanggal saja, tanpa filter emiten/tag */}
                        <div className="flex items-center justify-between gap-1 mb-1.5">
                          <span className="text-[10px] font-medium bg-gray-100 text-gray-600 px-2 py-0.5 rounded border border-gray-200/60">
                            {sess.timestamp.split(',')[0]}
                          </span>
                          <MoreHorizontal className="w-3.5 h-3.5 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                        </div>
                        <h3 className={`text-xs font-medium leading-snug line-clamp-1 ${isActive ? 'text-emerald-900 font-semibold' : 'text-gray-800 group-hover:text-emerald-700'}`}>
                          {sess.title}
                        </h3>
                        <p className="text-[11px] text-gray-400 line-clamp-2 mt-0.5 leading-snug font-normal">
                          {sess.preview}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {filteredSessions.length === 0 && (
              <div className="text-center py-8 text-xs text-gray-400">
                Tidak ada sesi yang cocok.
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Pinned Bottom Button: Sesi Analisis Baru */}
      <div className="p-3 border-t border-gray-200 bg-white">
        <button
          onClick={onNewSession}
          type="button"
          className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-medium py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 text-xs shadow-sm transition-all cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-white" />
          <span>Analisis Laporan Baru</span>
        </button>
      </div>
    </aside>
  );
}
