import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import ResearchWorkspacePage from './pages/ResearchWorkspacePage';
import AdminIngestionPage from './pages/AdminIngestionPage';
import { sendChatMessage, parseAssistantResponse } from './services/api';

const STORAGE_KEY = 'finsight_chat_sessions';

function loadSavedSessions() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch (err) {
    console.warn('[FinSight] Gagal membaca riwayat sesi dari localStorage:', err);
  }
  return [];
}

export default function App() {
  const [isAdminMode, setIsAdminMode] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [sessions, setSessions] = useState(loadSavedSessions);
  const [activeSessionId, setActiveSessionId] = useState(() => {
    const initial = loadSavedSessions();
    return initial.length > 0 ? initial[0].id : null;
  });
  const [isNewChat, setIsNewChat] = useState(() => {
    const initial = loadSavedSessions();
    return initial.length === 0;
  });
  const [isQueryLoading, setIsQueryLoading] = useState(false);

  // Simpan sesi ke localStorage setiap kali ada perubahan
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (err) {
      console.warn('[FinSight] Gagal menyimpan sesi ke localStorage:', err);
    }
  }, [sessions]);

  const activeSession = sessions.find((s) => s.id === activeSessionId) || sessions[0] || null;
  const isChatActive = !isNewChat && activeSession && activeSession.messages && activeSession.messages.length > 0;

  // Handler ekspor laporan (dipanggil dari Navbar atas saat chat aktif)
  const handleExport = () => {
    if (!activeSession) return;
    const formattedDate = new Date().toLocaleDateString('id-ID', { dateStyle: 'long' });
    let exportText = `# Laporan FinSight AI: ${activeSession.title}\nTanggal Ekspor: ${formattedDate}\n\n`;
    
    activeSession.messages.forEach((msg) => {
      if (msg.role === 'user') {
        exportText += `## Pertanyaan Analis:\n${msg.content}\n\n`;
      } else {
        exportText += `## Jawaban FinSight AI:\n`;
        (msg.paragraphs || []).forEach((p) => {
          exportText += `${p}\n\n`;
        });
        if (msg.citations && msg.citations.length > 0) {
          exportText += `### Referensi Sheet BEI:\n`;
          msg.citations.forEach((c, idx) => {
            exportText += `[${idx + 1}] [${c.sheet_code}] ${c.sheet_title} (${c.ticker} - ${c.period})\n`;
          });
          exportText += `\n`;
        }
      }
    });

    const blob = new Blob([exportText], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `FinSight_${activeSession.title.replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Menerima pertanyaan baru dari New Chat (Studio Prompt view) dengan multi-select filter
  const handleQueryFromStudio = async ({ query, banks, years, quarters }) => {
    const newSessionId = `sess-${Date.now()}`;
    const bankList = banks.join(', ');
    const yearList = years.join('/');
    const quarterList = quarters.join(', ');

    const userMessageId = `msg-${Date.now()}-u`;
    const aiMessageId = `msg-${Date.now()}-a`;

    const userMsg = {
      id: userMessageId,
      role: 'user',
      content: query,
      timestamp: 'Baru saja'
    };

    const pendingAiMsg = {
      id: aiMessageId,
      role: 'assistant',
      isPending: true,
      paragraphs: ['Menganalisis laporan keuangan BEI dengan FinSight RAG...']
    };

    const newSession = {
      id: newSessionId,
      title: `Analisis ${bankList} FY ${yearList} (${quarterList})`,
      preview: query.slice(0, 75) + '...',
      selectedBanks: banks,
      selectedYears: years,
      selectedQuarters: quarters,
      group: 'Hari Ini',
      timestamp: 'Hari Ini, ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) + ' WIB',
      messages: [userMsg, pendingAiMsg]
    };

    setSessions((prev) => [newSession, ...prev]);
    setActiveSessionId(newSessionId);
    setIsNewChat(false);
    setIsQueryLoading(true);

    try {
      const res = await sendChatMessage({
        question: query,
        ticker: banks,
        year: years,
        quarter: quarters,
        top_k: 3
      });

      const parsed = parseAssistantResponse(res.answer, res.sources);

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== newSessionId) return s;
          const updatedMessages = s.messages.map((m) => {
            if (m.id !== aiMessageId) return m;
            return {
              id: aiMessageId,
              role: 'assistant',
              isPending: false,
              paragraphs: parsed.paragraphs,
              table: parsed.table,
              citations: parsed.citations,
              followUpQuestions: [
                `Bagaimana rasio solvabilitas dan marjin untuk ${bankList}?`,
                `Berapa pertumbuhan Dana Pihak Ketiga (DPK) ${bankList} pada periode ini?`
              ]
            };
          });
          return { ...s, messages: updatedMessages };
        })
      );
    } catch (err) {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== newSessionId) return s;
          const updatedMessages = s.messages.map((m) => {
            if (m.id !== aiMessageId) return m;
            return {
              id: aiMessageId,
              role: 'assistant',
              isPending: false,
              paragraphs: [
                `Gagal menghubungi backend FinSight atau model AI: ${err.message}`,
                'Pastikan server backend FastAPI berjalan di http://localhost:8000 dan GEMINI_API_KEY telah dikonfigurasi di berkas .env.'
              ],
              citations: []
            };
          });
          return { ...s, messages: updatedMessages };
        })
      );
    } finally {
      setIsQueryLoading(false);
    }
  };

  // Memperbarui filter aktif pada sesi yang sedang dibuka
  const handleUpdateSessionFilters = (sessionId, updatedFilters) => {
    setSessions((prev) =>
      prev.map((sess) => (sess.id === sessionId ? { ...sess, ...updatedFilters } : sess))
    );
  };

  // Mengirim pesan lanjutan di sesi obrolan yang sedang aktif
  const handleSendMessage = async (userText) => {
    if (!activeSession) return;
    const currentSessionId = activeSession.id;
    const userMessageId = `msg-${Date.now()}-u`;
    const aiMessageId = `msg-${Date.now()}-a`;

    const userMsg = {
      id: userMessageId,
      role: 'user',
      content: userText,
      timestamp: 'Baru saja'
    };

    const pendingAiMsg = {
      id: aiMessageId,
      role: 'assistant',
      isPending: true,
      paragraphs: ['Menganalisis laporan keuangan BEI dengan FinSight RAG...']
    };

    setSessions((prev) =>
      prev.map((s) => (s.id === currentSessionId ? { ...s, messages: [...s.messages, userMsg, pendingAiMsg] } : s))
    );
    setIsQueryLoading(true);

    try {
      const res = await sendChatMessage({
        question: userText,
        ticker: activeSession.selectedBanks || ['BBCA'],
        year: activeSession.selectedYears || ['2026'],
        quarter: activeSession.selectedQuarters || ['Q1'],
        top_k: 3
      });

      const parsed = parseAssistantResponse(res.answer, res.sources);

      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== currentSessionId) return s;
          const updatedMessages = s.messages.map((m) => {
            if (m.id !== aiMessageId) return m;
            return {
              id: aiMessageId,
              role: 'assistant',
              isPending: false,
              paragraphs: parsed.paragraphs,
              table: parsed.table,
              citations: parsed.citations,
              followUpQuestions: [
                `Tampilkan perbandingan dengan kuartal sebelumnya`,
                `Bagaimana rincian pos akun pada sheet terkait?`
              ]
            };
          });
          return { ...s, messages: updatedMessages };
        })
      );
    } catch (err) {
      setSessions((prev) =>
        prev.map((s) => {
          if (s.id !== currentSessionId) return s;
          const updatedMessages = s.messages.map((m) => {
            if (m.id !== aiMessageId) return m;
            return {
              id: aiMessageId,
              role: 'assistant',
              isPending: false,
              paragraphs: [
                `Gagal menghubungi backend FinSight atau model AI: ${err.message}`,
                'Pastikan server backend FastAPI berjalan di http://localhost:8000 dan GEMINI_API_KEY telah dikonfigurasi di berkas .env.'
              ],
              citations: []
            };
          });
          return { ...s, messages: updatedMessages };
        })
      );
    } finally {
      setIsQueryLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#F8F9FA] text-[#111827]">
      {/* Sidebar Sisi Kiri: Memotong Headbar (Full Height 100vh) */}
      {!isAdminMode && (
        <Sidebar
          sessions={sessions}
          activeSessionId={isNewChat ? null : activeSessionId}
          onSelectSession={(id) => {
            setActiveSessionId(id);
            setIsNewChat(false);
          }}
          onNewSession={() => setIsNewChat(true)}
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
        />
      )}

      {/* Sisi Kanan: Headbar + Workspace Utama */}
      <div className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Headbar Ramping dengan Tombol Ekspor Kondisional */}
        <Navbar
          isAdminMode={isAdminMode}
          setIsAdminMode={setIsAdminMode}
          isChatActive={isChatActive}
          onExport={handleExport}
        />

        {/* Konten Halaman */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {isAdminMode ? (
            <AdminIngestionPage onBackToResearch={() => setIsAdminMode(false)} />
          ) : (
            <ResearchWorkspacePage
              sessions={sessions}
              activeSessionId={activeSessionId}
              isNewChat={isNewChat}
              isLoading={isQueryLoading}
              onSubmitNewQuery={handleQueryFromStudio}
              onSendMessage={handleSendMessage}
              onUpdateSessionFilters={handleUpdateSessionFilters}
            />
          )}
        </div>
      </div>
    </div>
  );
}
