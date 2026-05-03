import React, { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Target, Check, X, Undo2, Redo2, Save, History, Download,
  ChevronLeft, ChevronRight, Trash2, Crosshair,
  ArrowLeft, Calendar, MapPin, Trophy, CloudSun, Edit3, Pencil
} from "lucide-react";

const POSITIONS = 5;
const SHOTS_PER_POSITION = 5;
const TOTAL_SHOTS = POSITIONS * SHOTS_PER_POSITION;

const WEATHER_OPTIONS = [
  { key: "sun", label: "Sol" },
  { key: "cloud", label: "Nublado" },
  { key: "rain", label: "Chuva" },
  { key: "wind", label: "Vento" },
];

const emptySession = () => ({
  shots: Array(POSITIONS).fill(null).map(() =>
    Array(SHOTS_PER_POSITION).fill(null).map(() => ({ hit: null, cartridges: null }))
  ),
  currentPos: 0,
  startedAt: new Date().toISOString(),
  meta: {
    competition: "",
    location: "",
    date: new Date().toISOString().slice(0,10),
    weather: "",
  },
  note: "",
});

async function loadHistory() {
  try {
    const list = await window.storage.list("session:");
    if (!list?.keys?.length) return [];
    const sessions = [];
    for (const key of list.keys) {
      try {
        const res = await window.storage.get(key);
        if (res?.value) sessions.push(JSON.parse(res.value));
      } catch {}
    }
    return sessions.sort((a, b) => new Date(b.finishedAt) - new Date(a.finishedAt));
  } catch { return []; }
}

async function saveSession(session) {
  const id = `session:${Date.now()}`;
  const payload = { ...session, id, finishedAt: new Date().toISOString() };
  await window.storage.set(id, JSON.stringify(payload));
  return payload;
}

async function updateStoredSession(session) {
  if (!session.id) return session;
  await window.storage.set(session.id, JSON.stringify(session));
  return session;
}

async function deleteSession(id) { await window.storage.delete(id); }

async function loadDraft() {
  try {
    const r = await window.storage.get("draft:current");
    return r?.value ? JSON.parse(r.value) : null;
  } catch { return null; }
}

async function saveDraft(session) {
  try { await window.storage.set("draft:current", JSON.stringify(session)); } catch {}
}

async function clearDraft() {
  try { await window.storage.delete("draft:current"); } catch {}
}

const isComplete = (shot) => shot && shot.hit !== null && shot.cartridges !== null;
const countHits = (shots) => shots.flat().filter((s) => s?.hit === true).length;
const countLogged = (shots) => shots.flat().filter(isComplete).length;
const countCartridges = (shots) => shots.flat().reduce((sum, s) => sum + (s?.cartridges || 0), 0);
const posHits = (row) => row.filter((s) => s?.hit === true).length;
const posLogged = (row) => row.filter(isComplete).length;
const posCartridges = (row) => row.reduce((sum, s) => sum + (s?.cartridges || 0), 0);

function toCSV(sessions) {
  const head = ["date","competition","location","weather","score","total","cartridges","P1","P2","P3","P4","P5","note"];
  const rows = sessions.map(s => {
    const hits = countHits(s.shots);
    const logged = countLogged(s.shots);
    const cart = countCartridges(s.shots);
    const m = s.meta || {};
    return [
      new Date(s.finishedAt).toISOString(),
      (m.competition||"").replace(/[,\n]/g," "),
      (m.location||"").replace(/[,\n]/g," "),
      m.weather || "",
      hits, logged, cart,
      ...s.shots.map(posHits),
      (s.note || "").replace(/[,\n]/g, " ")
    ].join(",");
  });
  return [head.join(","), ...rows].join("\n");
}

function download(filename, content, type="text/plain") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("pt-PT", { day:"2-digit", month:"2-digit", year:"2-digit" });
  } catch { return iso; }
}

export default function App() {
  const [view, setView] = useState("home");
  const [session, setSession] = useState(null);
  const [history, setHistory] = useState([]);
  const [undoStack, setUndoStack] = useState([]);
  const [redoStack, setRedoStack] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState(null);
  const [flash, setFlash] = useState(null);
  const [pendingHit, setPendingHit] = useState(null);
  const [metaEditOpen, setMetaEditOpen] = useState(false);
  const [editMetaSession, setEditMetaSession] = useState(null);

  useEffect(() => {
    (async () => {
      const h = await loadHistory();
      const d = await loadDraft();
      setHistory(h);
      if (d) setSession(d);
      setLoading(false);
    })();
  }, []);

  useEffect(() => {
    if (session && view === "session") saveDraft(session);
  }, [session, view]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(null), 1800); };

  const startSession = () => {
    setSession(emptySession());
    setUndoStack([]); setRedoStack([]); setPendingHit(null);
    setMetaEditOpen(true);
    setView("session");
  };

  const resumeSession = () => { setPendingHit(null); setView("session"); };

  const updateMeta = (patch) => {
    setSession((s) => s ? { ...s, meta: { ...(s.meta || {}), ...patch } } : s);
  };

  const pickHitMiss = (hit) => {
    if (!session) return;
    const pos = session.currentPos;
    const row = session.shots[pos];
    const nextIdx = row.findIndex((s) => !isComplete(s));
    if (nextIdx === -1) return;
    setFlash(hit ? "hit" : "miss");
    setTimeout(() => setFlash(null), 180);
    setPendingHit(hit);
  };

  const commitShot = useCallback((cartridges) => {
    if (!session || pendingHit === null) return;
    const pos = session.currentPos;
    const row = session.shots[pos];
    const nextIdx = row.findIndex((s) => !isComplete(s));
    if (nextIdx === -1) return;

    setUndoStack((u) => [...u, JSON.parse(JSON.stringify(session))]);
    setRedoStack([]);

    setSession((s) => {
      const shots = s.shots.map((r) => r.map((sh) => ({ ...sh })));
      shots[pos][nextIdx] = { hit: pendingHit, cartridges };
      let currentPos = s.currentPos;
      const totalLogged = shots.flat().filter(isComplete).length;
      if (totalLogged < TOTAL_SHOTS) {
        let next = (pos + 1) % POSITIONS;
        for (let i = 0; i < POSITIONS; i++) {
          const idx = (pos + 1 + i) % POSITIONS;
          if (shots[idx].some((x) => !isComplete(x))) { next = idx; break; }
        }
        currentPos = next;
      }
      return { ...s, shots, currentPos };
    });
    setPendingHit(null);
  }, [session, pendingHit]);

  const cancelPending = () => setPendingHit(null);

  const undo = () => {
    if (!undoStack.length) return;
    const prev = undoStack[undoStack.length - 1];
    setRedoStack((r) => [...r, JSON.parse(JSON.stringify(session))]);
    setUndoStack((u) => u.slice(0, -1));
    setSession(prev); setPendingHit(null);
  };

  const redo = () => {
    if (!redoStack.length) return;
    const next = redoStack[redoStack.length - 1];
    setUndoStack((u) => [...u, JSON.parse(JSON.stringify(session))]);
    setRedoStack((r) => r.slice(0, -1));
    setSession(next); setPendingHit(null);
  };

  const goToPosition = (i) => { setPendingHit(null); setSession((s) => ({ ...s, currentPos: i })); };

  const finishSession = async () => {
    if (!session) return;
    const saved = await saveSession(session);
    await clearDraft();
    setHistory((h) => [saved, ...h]);
    setSession(null);
    setUndoStack([]); setRedoStack([]); setPendingHit(null);
    setView("history");
    showToast("SESSÃO GUARDADA");
  };

  const abandonSession = async () => {
    if (!confirm("Descartar sessão atual?")) return;
    await clearDraft();
    setSession(null);
    setUndoStack([]); setRedoStack([]); setPendingHit(null);
    setView("home");
  };

  const exportCSV = () => { if (history.length) download(`trap-score-${new Date().toISOString().slice(0,10)}.csv`, toCSV(history), "text/csv"); };
  const exportJSON = () => { if (history.length) download(`trap-score-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(history, null, 2), "application/json"); };

  const removeSession = async (id) => {
    if (!confirm("Eliminar esta sessão?")) return;
    await deleteSession(id);
    setHistory((h) => h.filter((s) => s.id !== id));
    setSelected(null);
    setView("history");
    showToast("SESSÃO ELIMINADA");
  };

  const saveEditedMeta = async (updatedSession) => {
    await updateStoredSession(updatedSession);
    setHistory((h) => h.map((s) => s.id === updatedSession.id ? updatedSession : s));
    if (selected?.id === updatedSession.id) setSelected(updatedSession);
    setEditMetaSession(null);
    showToast("ALTERAÇÕES GUARDADAS");
  };

  useEffect(() => {
    if (view !== "session") return;
    const onKey = (e) => {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
      if (pendingHit === null) {
        if (e.key === "h" || e.key === "H") pickHitMiss(true);
        else if (e.key === "m" || e.key === "M") pickHitMiss(false);
      } else {
        if (e.key === "1") commitShot(1);
        else if (e.key === "2") commitShot(2);
        else if (e.key === "Escape") cancelPending();
      }
      if (e.key === "ArrowLeft") setSession((s) => s ? { ...s, currentPos: Math.max(0, s.currentPos - 1) } : s);
      else if (e.key === "ArrowRight") setSession((s) => s ? { ...s, currentPos: Math.min(POSITIONS - 1, s.currentPos + 1) } : s);
      else if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); redo(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [view, pendingHit, commitShot, session, undoStack, redoStack]);

  return (
    <div className="min-h-screen w-full bg-white text-neutral-900 antialiased"
         style={{ fontFamily: "'Inter', system-ui, -apple-system, sans-serif" }}>
      <div className="pointer-events-none fixed inset-0 opacity-[0.015]"
           style={{ backgroundImage: "radial-gradient(#000 1px, transparent 1px)", backgroundSize: "20px 20px" }}/>

      <AnimatePresence>
        {flash && (
          <motion.div
            initial={{ opacity: 0.3 }} animate={{ opacity: 0 }} exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            className={`pointer-events-none fixed inset-0 z-40 ${flash === "hit" ? "bg-emerald-500" : "bg-rose-500"}`}/>
        )}
      </AnimatePresence>

      <div className="relative mx-auto max-w-xl px-5 pb-10 pt-6">
        <Header view={view} onHome={() => setView("home")} />

        <AnimatePresence mode="wait">
          {loading ? (
            <motion.div key="load" className="mt-24 text-center text-neutral-400 tracking-widest text-xs"
              initial={{opacity:0}} animate={{opacity:1}}>A CARREGAR...</motion.div>
          ) : view === "home" ? (
            <HomeView key="home" history={history} hasDraft={!!session}
              onStart={startSession} onResume={resumeSession} onHistory={() => setView("history")} />
          ) : view === "session" ? (
            <SessionView key="session" session={session} pendingHit={pendingHit}
              onPickHitMiss={pickHitMiss} onCommit={commitShot} onCancelPending={cancelPending}
              onUndo={undo} onRedo={redo}
              canUndo={!!undoStack.length} canRedo={!!redoStack.length}
              onGoPos={goToPosition} onFinish={finishSession} onAbandon={abandonSession}
              onUpdateMeta={updateMeta}
              metaEditOpen={metaEditOpen} setMetaEditOpen={setMetaEditOpen} />
          ) : view === "history" ? (
            <HistoryView key="history" history={history}
              onOpen={(s) => { setSelected(s); setView("detail"); }}
              onEdit={(s) => setEditMetaSession(s)}
              onDelete={removeSession}
              onExportCSV={exportCSV} onExportJSON={exportJSON}
              onBack={() => setView("home")} />
          ) : view === "detail" && selected ? (
            <DetailView key="detail" session={selected}
              onBack={() => setView("history")}
              onDelete={() => removeSession(selected.id)}
              onEdit={() => setEditMetaSession(selected)} />
          ) : null}
        </AnimatePresence>

        <AnimatePresence>
          {metaEditOpen && session && (
            <MetaEditor
              title="Dados da sessão"
              meta={session.meta}
              onChange={updateMeta}
              onClose={() => setMetaEditOpen(false)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {editMetaSession && (
            <PastSessionEditor
              session={editMetaSession}
              onSave={saveEditedMeta}
              onClose={() => setEditMetaSession(null)}
              onDelete={() => removeSession(editMetaSession.id)}
            />
          )}
        </AnimatePresence>

        <AnimatePresence>
          {toast && (
            <motion.div
              initial={{y:40,opacity:0}} animate={{y:0,opacity:1}} exit={{y:40,opacity:0}}
              className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50
                         bg-neutral-900 text-white px-5 py-2.5
                         text-xs font-semibold tracking-[0.2em] rounded-full shadow-lg">
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function Header({ view, onHome }) {
  const label = view === "session" ? "EM TIRO" : view === "history" ? "ARQUIVO" : view === "detail" ? "DETALHE" : "PRONTO";
  return (
    <header className="flex items-center justify-between pb-5 border-b border-neutral-200">
      <button onClick={onHome} className="flex items-center gap-2.5 group hover:opacity-80 transition">
        <div className="relative flex items-center justify-center h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 shadow-md overflow-hidden">
          <svg className="h-6 w-6 text-white" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">
            <g transform="translate(30, 40) scale(1.2)">
              <circle cx="20" cy="15" r="8" fill="#FFF" opacity="0.9"/>
              <ellipse cx="20" cy="35" rx="7" ry="12" fill="#FFF"/>
              <line x1="20" y1="30" x2="45" y2="20" stroke="#FFF" strokeWidth="2.5" strokeLinecap="round"/>
              <line x1="45" y1="20" x2="58" y2="15" stroke="#FFF" strokeWidth="2" strokeLinecap="round"/>
              <path d="M 58 15 Q 70 10 80 8" stroke="#FFF" strokeWidth="1.5" fill="none" strokeLinecap="round"/>
              <circle cx="75" cy="5" r="1.5" fill="#FCA5A5"/>
            </g>
          </svg>
        </div>
        <div className="text-left">
          <div className="text-[10px] tracking-[0.35em] text-neutral-400 leading-none">TRAP</div>
          <div className="text-base font-bold tracking-tight leading-tight text-neutral-900">Trap Score</div>
        </div>
      </button>
      <div className="flex items-center gap-2">
        <div className="h-1.5 w-1.5 rounded-full bg-emerald-500"/>
        <div className="text-[10px] tracking-[0.3em] text-neutral-500 font-medium">{label}</div>
      </div>
    </header>
  );
}

function HomeView({ history, hasDraft, onStart, onResume, onHistory }) {
  const stats = useMemo(() => {
    if (!history.length) return null;
    const scores = history.map(s => countHits(s.shots));
    const avg = scores.reduce((a,b)=>a+b,0) / scores.length;
    const best = Math.max(...scores);
    return { sessions: history.length, avg: avg.toFixed(1), best };
  }, [history]);

  return (
    <motion.div initial={{opacity:0, y:8}} animate={{opacity:1, y:0}} exit={{opacity:0}}
      className="mt-10 space-y-8">
      <div>
        <div className="text-[10px] tracking-[0.4em] text-neutral-400 mb-3">DISCIPLINA</div>
        <h1 className="text-5xl font-bold tracking-tight leading-[0.95] text-neutral-900">
          Trap<br/><span className="text-neutral-300">5 × 5</span>
        </h1>
      </div>

      {stats && (
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Sessões" value={stats.sessions}/>
          <Stat label="Média" value={stats.avg} suffix="/25"/>
          <Stat label="Melhor" value={stats.best} suffix="/25" highlight/>
        </div>
      )}

      <div className="space-y-2.5">
        {hasDraft && (
          <button onClick={onResume}
            className="group w-full flex items-center justify-between bg-amber-50 border border-amber-200
                       rounded-xl px-5 py-4 hover:bg-amber-100/70 transition">
            <div className="text-left">
              <div className="text-[10px] tracking-[0.3em] text-amber-700 font-semibold">RETOMAR</div>
              <div className="text-sm font-semibold text-amber-900">sessão em aberto</div>
            </div>
            <ChevronRight className="h-5 w-5 text-amber-700 group-hover:translate-x-1 transition"/>
          </button>
        )}

        <button onClick={onStart}
          className="group relative w-full overflow-hidden bg-neutral-900 text-white
                     rounded-xl px-6 py-7 hover:bg-neutral-800 transition
                     shadow-[0_10px_40px_-15px_rgba(0,0,0,0.3)]">
          <div className="flex items-center justify-between">
            <div className="text-left">
              <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-medium">INICIAR</div>
              <div className="text-2xl font-bold tracking-tight">Nova sessão</div>
            </div>
            <div className="flex items-center justify-center h-12 w-12 rounded-full bg-white/10 group-hover:bg-white/20 transition">
              <Target className="h-6 w-6" strokeWidth={1.75}/>
            </div>
          </div>
        </button>

        <button onClick={onHistory}
          className="group w-full flex items-center justify-between bg-white border border-neutral-200 hover:border-neutral-300
                     rounded-xl px-5 py-4 transition">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center h-9 w-9 rounded-full bg-neutral-100">
              <History className="h-4 w-4 text-neutral-600"/>
            </div>
            <div className="text-left">
              <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-medium">ARQUIVO</div>
              <div className="text-sm font-semibold text-neutral-900">{history.length} sess{history.length===1?"ão":"ões"}</div>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 text-neutral-400 group-hover:translate-x-1 transition"/>
        </button>
      </div>
    </motion.div>
  );
}

function Stat({ label, value, suffix, highlight }) {
  return (
    <div className={`rounded-xl px-4 py-3.5 ${highlight ? "bg-neutral-900 text-white" : "bg-neutral-50"}`}>
      <div className={`text-[10px] tracking-[0.25em] font-medium ${highlight ? "text-neutral-400" : "text-neutral-500"}`}>
        {label.toUpperCase()}
      </div>
      <div className="mt-1 flex items-baseline gap-0.5">
        <div className="text-2xl font-bold tabular-nums tracking-tight">{value}</div>
        {suffix && <div className={`text-xs font-medium ${highlight ? "text-neutral-500" : "text-neutral-400"}`}>{suffix}</div>}
      </div>
    </div>
  );
}

function WeatherIcon({ type, className = "h-3.5 w-3.5" }) {
  if (type === "sun") return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>
    </svg>
  );
  if (type === "cloud") return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17.5 19a4.5 4.5 0 100-9h-1.8A7 7 0 104 14.9"/>
    </svg>
  );
  if (type === "rain") return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 13a4 4 0 00-4-9 5 5 0 00-5 5 4 4 0 00-2 7.5"/><path d="M8 19l-1 2M12 19l-1 2M16 19l-1 2"/>
    </svg>
  );
  if (type === "wind") return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h10a3 3 0 100-6M3 12h16a3 3 0 110 6M3 16h7"/>
    </svg>
  );
  return <CloudSun className={className}/>;
}

function MetaBar({ meta, onEdit }) {
  const m = meta || {};
  const weather = WEATHER_OPTIONS.find(w => w.key === m.weather);
  const items = [
    { icon: <Trophy className="h-3.5 w-3.5"/>, label: "PROVA", value: m.competition || "—" },
    { icon: <MapPin className="h-3.5 w-3.5"/>, label: "LOCAL", value: m.location || "—" },
    { icon: <Calendar className="h-3.5 w-3.5"/>, label: "DATA", value: m.date ? formatDate(m.date) : "—" },
    { icon: m.weather ? <WeatherIcon type={m.weather}/> : <CloudSun className="h-3.5 w-3.5"/>, label: "TEMPO", value: weather?.label || "—" },
  ];
  return (
    <button onClick={onEdit}
      className="w-full rounded-2xl bg-white border border-neutral-200 hover:border-neutral-300 transition p-3 text-left group">
      <div className="grid grid-cols-2 gap-2.5">
        {items.map((it, i) => (
          <div key={i} className="flex items-start gap-2 min-w-0">
            <div className="mt-0.5 text-neutral-500 shrink-0">{it.icon}</div>
            <div className="min-w-0 flex-1">
              <div className="text-[9px] tracking-[0.25em] text-neutral-400 font-semibold">{it.label}</div>
              <div className="text-xs font-semibold text-neutral-900 truncate">{it.value}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-2 pt-2 border-t border-neutral-100 flex items-center justify-center gap-1.5 text-[9px] tracking-[0.25em] text-neutral-400 font-medium group-hover:text-neutral-700 transition">
        <Edit3 className="h-3 w-3"/> EDITAR INFORMAÇÃO
      </div>
    </button>
  );
}

function MetaEditor({ title, meta, onChange, onClose }) {
  const m = meta || {};
  return (
    <motion.div
      initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}>
      <motion.div
        initial={{y:40, opacity:0}} animate={{y:0, opacity:1}} exit={{y:40, opacity:0}}
        className="w-full max-w-md bg-white rounded-2xl p-5 shadow-xl space-y-4"
        onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-semibold">INFORMAÇÃO</div>
            <div className="text-lg font-bold tracking-tight">{title}</div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900">
            <X className="h-5 w-5"/>
          </button>
        </div>

        <div className="space-y-3.5">
          <LabeledInput icon={<Trophy className="h-4 w-4"/>} label="Prova"
            value={m.competition || ""} placeholder="ex: Campeonato Regional"
            onChange={(v)=>onChange({ competition: v })}/>
          <LabeledInput icon={<MapPin className="h-4 w-4"/>} label="Localização"
            value={m.location || ""} placeholder="ex: Clube de Tiro de Lisboa"
            onChange={(v)=>onChange({ location: v })}/>
          <LabeledInput icon={<Calendar className="h-4 w-4"/>} label="Data" type="date"
            value={m.date || ""} onChange={(v)=>onChange({ date: v })}/>

          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <CloudSun className="h-4 w-4 text-neutral-500"/>
              <label className="text-xs font-semibold text-neutral-700">Tempo</label>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {WEATHER_OPTIONS.map(w => (
                <button key={w.key}
                  onClick={()=>onChange({ weather: m.weather === w.key ? "" : w.key })}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition
                    ${m.weather === w.key
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 text-neutral-600 hover:border-neutral-400"}`}>
                  <WeatherIcon type={w.key} className="h-4 w-4"/>
                  <span className="text-[10px] font-semibold">{w.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <button onClick={onClose}
          className="w-full py-3 rounded-xl bg-neutral-900 text-white font-semibold text-sm hover:bg-neutral-800 transition">
          Concluir
        </button>
      </motion.div>
    </motion.div>
  );
}

function PastSessionEditor({ session, onSave, onClose, onDelete }) {
  const [draft, setDraft] = useState(session.meta || {});

  const update = (patch) => setDraft((d) => ({ ...d, ...patch }));

  const save = () => {
    onSave({ ...session, meta: draft });
  };

  const confirmDelete = () => {
    onClose();
    onDelete();
  };

  return (
    <motion.div
      initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}}
      className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
      onClick={onClose}>
      <motion.div
        initial={{y:40, opacity:0}} animate={{y:0, opacity:1}} exit={{y:40, opacity:0}}
        className="w-full max-w-md bg-white rounded-2xl p-5 shadow-xl space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e)=>e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-semibold">EDITAR SESSÃO</div>
            <div className="text-lg font-bold tracking-tight">
              {countHits(session.shots)}<span className="text-neutral-400 text-sm">/25</span>
            </div>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-900">
            <X className="h-5 w-5"/>
          </button>
        </div>

        <div className="space-y-3.5">
          <LabeledInput icon={<Trophy className="h-4 w-4"/>} label="Prova"
            value={draft.competition || ""} placeholder="ex: Campeonato Regional"
            onChange={(v)=>update({ competition: v })}/>
          <LabeledInput icon={<MapPin className="h-4 w-4"/>} label="Localização"
            value={draft.location || ""} placeholder="ex: Clube de Tiro de Lisboa"
            onChange={(v)=>update({ location: v })}/>
          <LabeledInput icon={<Calendar className="h-4 w-4"/>} label="Data" type="date"
            value={draft.date || ""} onChange={(v)=>update({ date: v })}/>

          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <CloudSun className="h-4 w-4 text-neutral-500"/>
              <label className="text-xs font-semibold text-neutral-700">Tempo</label>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {WEATHER_OPTIONS.map(w => (
                <button key={w.key}
                  onClick={()=>update({ weather: draft.weather === w.key ? "" : w.key })}
                  className={`flex flex-col items-center gap-1 py-2.5 rounded-lg border transition
                    ${draft.weather === w.key
                      ? "border-neutral-900 bg-neutral-900 text-white"
                      : "border-neutral-200 text-neutral-600 hover:border-neutral-400"}`}>
                  <WeatherIcon type={w.key} className="h-4 w-4"/>
                  <span className="text-[10px] font-semibold">{w.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2 pt-1">
          <button onClick={save}
            className="w-full py-3 rounded-xl bg-neutral-900 text-white font-semibold text-sm hover:bg-neutral-800 transition">
            Guardar alterações
          </button>
          <button onClick={confirmDelete}
            className="w-full py-3 rounded-xl border border-neutral-200 hover:border-rose-400 text-neutral-500 hover:text-rose-600 hover:bg-rose-50 font-semibold text-sm transition flex items-center justify-center gap-2">
            <Trash2 className="h-4 w-4"/> Eliminar sessão
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function LabeledInput({ icon, label, value, onChange, placeholder, type="text" }) {
  return (
    <div>
      <div className="flex items-center gap-2 mb-1.5">
        <div className="text-neutral-500">{icon}</div>
        <label className="text-xs font-semibold text-neutral-700">{label}</label>
      </div>
      <div className="relative">
        <input
          type={type}
          value={value}
          onChange={(e)=>onChange(e.target.value)}
          placeholder={placeholder}
          className="block w-full box-border px-3 py-2.5 rounded-lg border border-neutral-200 bg-white
                     text-sm text-neutral-900 text-left
                     focus:outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900/10
                     transition appearance-none
                     [&::-webkit-date-and-time-value]:text-left
                     [&::-webkit-calendar-picker-indicator]:opacity-60
                     [&::-webkit-calendar-picker-indicator]:cursor-pointer"
          style={type === "date" ? { minHeight: "42px" } : {}}
        />
      </div>
    </div>
  );
}

function SessionView({ session, pendingHit, onPickHitMiss, onCommit, onCancelPending,
                       onUndo, onRedo, canUndo, canRedo, onGoPos, onFinish, onAbandon,
                       onUpdateMeta, metaEditOpen, setMetaEditOpen }) {
  const hits = countHits(session.shots);
  const logged = countLogged(session.shots);
  const cartridges = countCartridges(session.shots);
  const stationsDone = session.shots.filter((r) => r.every(isComplete)).length;
  const complete = logged === TOTAL_SHOTS;

  const pos = session.currentPos;
  const row = session.shots[pos];
  const nextIdx = row.findIndex((s) => !isComplete(s));
  const awaitingCartridges = pendingHit !== null;

  return (
    <motion.div initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} className="mt-6 space-y-4">

      <MetaBar meta={session.meta} onEdit={()=>setMetaEditOpen(true)}/>

      <div className="rounded-2xl bg-neutral-900 text-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-medium">PONTUAÇÃO</div>
            <div className="mt-1 flex items-baseline gap-1">
              <div className="text-6xl font-bold tabular-nums leading-none tracking-tight">{hits}</div>
              <div className="text-2xl text-neutral-500 font-medium">/25</div>
            </div>
          </div>
          <div className="text-right space-y-3">
            <div>
              <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-medium">ESTAÇÕES</div>
              <div className="mt-1 flex items-baseline gap-0.5 justify-end">
                <div className="text-3xl font-bold tabular-nums leading-none">{stationsDone}</div>
                <div className="text-base text-neutral-500 font-medium">/{POSITIONS}</div>
              </div>
            </div>
            <div>
              <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-medium">CARTUCHOS</div>
              <div className="mt-1 text-xl font-bold tabular-nums leading-none">{cartridges}</div>
            </div>
          </div>
        </div>
        <div className="mt-5 grid gap-[3px]" style={{gridTemplateColumns: "repeat(25, 1fr)"}}>
          {session.shots.flat().map((s, i) => (
            <div key={i} className={`h-1.5 rounded-full transition-all ${
              s?.hit === true ? "bg-emerald-400" :
              s?.hit === false ? "bg-rose-500" :
              i === logged ? "bg-white/60 animate-pulse" : "bg-white/10"
            }`}/>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2.5">
          <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-medium">POSIÇÕES</div>
          <div className="text-[10px] tracking-[0.2em] text-neutral-400">← →</div>
        </div>
        <div className="grid grid-cols-5 gap-2">
          {session.shots.map((r, i) => {
            const pHits = posHits(r);
            const pLog = posLogged(r);
            const pCart = posCartridges(r);
            const active = i === pos;
            return (
              <button key={i} onClick={() => onGoPos(i)}
                className={`relative py-3 rounded-xl transition text-center border
                  ${active ? "border-neutral-900 bg-neutral-900 text-white" :
                    pLog === SHOTS_PER_POSITION ? "border-neutral-200 bg-neutral-50" :
                    "border-neutral-200 bg-white hover:border-neutral-300"}`}>
                <div className={`text-[9px] tracking-[0.2em] font-medium text-neutral-400`}>P{i+1}</div>
                <div className={`mt-0.5 text-lg font-bold tabular-nums ${active?"text-white":"text-neutral-900"}`}>
                  {pHits}<span className={`text-[10px] ${active?"text-neutral-500":"text-neutral-400"}`}>/{pLog}</span>
                </div>
                <div className={`text-[9px] font-semibold tabular-nums mt-0.5
                  ${active ? "text-amber-400" : "text-neutral-400"}`}>
                  {pCart}c
                </div>
                <div className="flex gap-0.5 justify-center mt-1">
                  {r.map((s,j) => (
                    <div key={j} className={`h-1 w-1 rounded-full ${
                      s?.hit === true ? (active ? "bg-emerald-400" : "bg-emerald-500") :
                      s?.hit === false ? (active ? "bg-rose-400" : "bg-rose-500") :
                      (active ? "bg-white/20" : "bg-neutral-200")
                    }`}/>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-2xl bg-white border border-neutral-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-medium">A DISPARAR</div>
            <div className="text-2xl font-bold tracking-tight text-neutral-900">Posição {pos+1}</div>
          </div>
          <div className="flex gap-1.5">
            <NavBtn disabled={pos===0} onClick={() => onGoPos(pos-1)}><ChevronLeft/></NavBtn>
            <NavBtn disabled={pos===POSITIONS-1} onClick={() => onGoPos(pos+1)}><ChevronRight/></NavBtn>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-2 mb-5">
          {row.map((s, i) => {
            const isNext = i === nextIdx;
            return (
              <motion.div key={i}
                animate={isNext ? { scale: [1, 1.03, 1] } : {}}
                transition={{ repeat: isNext ? Infinity : 0, duration: 1.4 }}
                className={`aspect-square flex items-center justify-center rounded-xl border-2 transition relative
                  ${s?.hit === true ? "border-emerald-500 bg-emerald-50" :
                    s?.hit === false ? "border-rose-500 bg-rose-50" :
                    isNext ? "border-neutral-900 bg-neutral-50" :
                    "border-neutral-200 bg-neutral-50/50"}`}>
                {s?.hit === true ? <Check className="h-5 w-5 text-emerald-600" strokeWidth={3}/> :
                 s?.hit === false ? <X className="h-5 w-5 text-rose-600" strokeWidth={3}/> :
                 <div className={`text-xs font-bold ${isNext ? "text-neutral-900" : "text-neutral-300"}`}>{i+1}</div>}
                {isComplete(s) && (
                  <div className="absolute bottom-0.5 right-1 text-[9px] font-bold tabular-nums text-neutral-500">
                    {s.cartridges}c
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <motion.button whileTap={{ scale: 0.95 }}
            disabled={complete || awaitingCartridges}
            onClick={() => onPickHitMiss(true)}
            className={`py-3 rounded-xl font-bold text-sm tracking-wide transition flex items-center justify-center gap-2
              ${pendingHit === true
                ? "bg-emerald-600 text-white ring-4 ring-emerald-200"
                : "bg-emerald-600 text-white hover:bg-emerald-500 active:bg-emerald-700"}
              disabled:opacity-30 disabled:cursor-not-allowed`}>
            <Check className="h-4 w-4" strokeWidth={3}/>
            ACERTO
          </motion.button>
          <motion.button whileTap={{ scale: 0.95 }}
            disabled={complete || awaitingCartridges}
            onClick={() => onPickHitMiss(false)}
            className={`py-3 rounded-xl font-bold text-sm tracking-wide transition flex items-center justify-center gap-2
              ${pendingHit === false
                ? "bg-rose-600 text-white ring-4 ring-rose-200"
                : "bg-white border-2 border-rose-500 text-rose-600 hover:bg-rose-50 active:bg-rose-100"}
              disabled:opacity-30 disabled:cursor-not-allowed`}>
            <X className="h-4 w-4" strokeWidth={3}/>
            FALHA
          </motion.button>
        </div>

        <AnimatePresence initial={false}>
          {awaitingCartridges && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginTop: 0 }}
              animate={{ opacity: 1, height: "auto", marginTop: 10 }}
              exit={{ opacity: 0, height: 0, marginTop: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden">
              <div className="flex items-center justify-between mb-1.5">
                <div className="text-[10px] tracking-[0.3em] text-neutral-500 font-semibold">CARTUCHOS</div>
                <button onClick={onCancelPending}
                  className="text-[10px] tracking-[0.2em] text-neutral-400 hover:text-neutral-900 font-medium">
                  CANCELAR
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <CartridgeBtn n={1} onClick={() => onCommit(1)}/>
                <CartridgeBtn n={2} onClick={() => onCommit(2)}/>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <div className="mt-3 text-center text-[10px] tracking-[0.25em] text-neutral-400 font-medium">
          {awaitingCartridges ? "ESCOLHE 1 OU 2 PARA AVANÇAR" :
            complete ? "SESSÃO COMPLETA" : "1. ACERTO/FALHA   →   2. CARTUCHOS"}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <IconBtn label="Anular" icon={<Undo2 className="h-4 w-4"/>} disabled={!canUndo} onClick={onUndo}/>
        <IconBtn label="Refazer" icon={<Redo2 className="h-4 w-4"/>} disabled={!canRedo} onClick={onRedo}/>
        <IconBtn label="Descartar" icon={<Trash2 className="h-4 w-4"/>} onClick={onAbandon} danger/>
        <IconBtn label={complete?"Guardar":"Fechar"} icon={<Save className="h-4 w-4"/>} onClick={onFinish} primary={complete}/>
      </div>

      {!complete && logged > 0 && (
        <div className="text-center text-[10px] tracking-[0.3em] text-neutral-400 font-medium">
          {TOTAL_SHOTS - logged} TIROS RESTANTES
        </div>
      )}
    </motion.div>
  );
}

function CartridgeBtn({ n, onClick }) {
  return (
    <motion.button whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="py-3 rounded-xl bg-neutral-900 text-white hover:bg-neutral-800 active:bg-black
                 transition flex items-center justify-center gap-2">
      <div className="flex items-center gap-0.5">
        {Array.from({length:n}).map((_,i)=>(
          <div key={i} className="relative">
            <div className="h-3 w-1.5 rounded-t-sm bg-amber-400"/>
            <div className="h-1 w-1.5 rounded-b-sm bg-amber-600"/>
          </div>
        ))}
      </div>
      <span className="text-sm font-bold tabular-nums">{n}</span>
      <span className="text-[10px] tracking-[0.2em] text-neutral-400 font-medium">CART</span>
    </motion.button>
  );
}

function NavBtn({ onClick, disabled, children }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="h-9 w-9 flex items-center justify-center rounded-lg border border-neutral-200
                 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900
                 disabled:opacity-30 disabled:cursor-not-allowed transition">
      {React.cloneElement(children, { className: "h-4 w-4" })}
    </button>
  );
}

function IconBtn({ label, icon, onClick, disabled, primary, danger }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`py-3 px-2 flex flex-col items-center gap-1 rounded-xl border transition
        ${primary ? "border-neutral-900 bg-neutral-900 text-white hover:bg-neutral-800" :
          danger ? "border-neutral-200 text-neutral-500 hover:border-rose-400 hover:text-rose-600 hover:bg-rose-50" :
          "border-neutral-200 text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"}
        disabled:opacity-30 disabled:cursor-not-allowed`}>
      {icon}
      <span className="text-[10px] tracking-wide font-semibold">{label}</span>
    </button>
  );
}

function TrendChart({ history }) {
  const data = useMemo(() => {
    const last = history.slice(0, 10).reverse();
    return last.map((s, i) => ({
      idx: i,
      score: countHits(s.shots),
      cart: countCartridges(s.shots),
      date: new Date(s.finishedAt),
    }));
  }, [history]);

  if (data.length < 2) return null;

  const W = 320, H = 180;
  const P = { top: 18, right: 38, bottom: 28, left: 32 };
  const innerW = W - P.left - P.right;
  const innerH = H - P.top - P.bottom;

  const scoreMax = 25;
  const cartMin = Math.min(...data.map(d => d.cart));
  const cartMax = Math.max(...data.map(d => d.cart));
  const cartPad = Math.max(2, Math.round((cartMax - cartMin) * 0.2));
  const cartLo = Math.max(0, cartMin - cartPad);
  const cartHi = cartMax + cartPad;

  const xStep = data.length === 1 ? 0 : innerW / (data.length - 1);
  const x = (i) => P.left + i * xStep;
  const yScore = (v) => P.top + innerH - (v / scoreMax) * innerH;
  const yCart = (v) => P.top + innerH - ((v - cartLo) / (cartHi - cartLo || 1)) * innerH;

  const scorePath = data.map((d, i) => `${i===0?"M":"L"}${x(i)},${yScore(d.score)}`).join(" ");
  const cartPath  = data.map((d, i) => `${i===0?"M":"L"}${x(i)},${yCart(d.cart)}`).join(" ");

  const yTicks = [0, 5, 10, 15, 20, 25];
  const cartTicks = [cartLo, cartLo + (cartHi-cartLo)/2, cartHi].map(v => Math.round(v));

  const avgScore = (data.reduce((s,d)=>s+d.score,0) / data.length).toFixed(1);
  const avgCart = (data.reduce((s,d)=>s+d.cart,0) / data.length).toFixed(0);

  return (
    <div className="rounded-2xl bg-white border border-neutral-200 p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-semibold">TENDÊNCIA</div>
          <div className="text-sm font-bold text-neutral-900">Últimas {data.length} sessões</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-neutral-900"/>
            <div className="text-[10px] font-semibold text-neutral-600">Pontuação</div>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-amber-500"/>
            <div className="text-[10px] font-semibold text-neutral-600">Cartuchos</div>
          </div>
        </div>
      </div>

      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="auto" className="overflow-visible">
        {yTicks.map(v => (
          <g key={`gl-${v}`}>
            <line x1={P.left} x2={P.left + innerW} y1={yScore(v)} y2={yScore(v)}
              stroke="#f5f5f5" strokeWidth="1"/>
            <text x={P.left - 6} y={yScore(v)} dy="3"
              textAnchor="end" className="text-[9px] fill-neutral-400 font-medium">{v}</text>
          </g>
        ))}
        {cartTicks.map((v, i) => (
          <text key={`rt-${i}`} x={P.left + innerW + 6}
            y={yCart(v)} dy="3" textAnchor="start"
            className="text-[9px] fill-amber-600 font-medium">{v}</text>
        ))}

        <line x1={P.left} x2={P.left + innerW} y1={yScore(0)} y2={yScore(0)}
          stroke="#e5e5e5" strokeWidth="1"/>

        <path d={cartPath} fill="none" stroke="#f59e0b" strokeWidth="2"
          strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3"/>
        {data.map((d, i) => (
          <circle key={`cd-${i}`} cx={x(i)} cy={yCart(d.cart)} r="3"
            fill="#fff" stroke="#f59e0b" strokeWidth="2"/>
        ))}

        <path d={scorePath} fill="none" stroke="#171717" strokeWidth="2.25"
          strokeLinecap="round" strokeLinejoin="round"/>
        {data.map((d, i) => (
          <circle key={`sd-${i}`} cx={x(i)} cy={yScore(d.score)} r="3.5"
            fill="#171717" stroke="#fff" strokeWidth="1.5"/>
        ))}

        {data.map((d, i) => {
          const label = d.date.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
          const show = data.length <= 6 || i === 0 || i === data.length - 1 || i % 2 === 0;
          if (!show) return null;
          return (
            <text key={`xl-${i}`} x={x(i)} y={H - 8}
              textAnchor="middle" className="text-[8px] fill-neutral-400 font-medium">
              {label}
            </text>
          );
        })}
      </svg>

      <div className="mt-2 pt-2 border-t border-neutral-100 grid grid-cols-2 gap-2 text-center">
        <div>
          <div className="text-[9px] tracking-[0.25em] text-neutral-400 font-semibold">MÉDIA PONTUAÇÃO</div>
          <div className="text-sm font-bold tabular-nums text-neutral-900 mt-0.5">{avgScore}<span className="text-neutral-400 text-xs">/25</span></div>
        </div>
        <div>
          <div className="text-[9px] tracking-[0.25em] text-neutral-400 font-semibold">MÉDIA CARTUCHOS</div>
          <div className="text-sm font-bold tabular-nums text-amber-600 mt-0.5">{avgCart}</div>
        </div>
      </div>
    </div>
  );
}

function HistoryView({ history, onOpen, onEdit, onDelete, onExportCSV, onExportJSON, onBack }) {
  return (
    <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="mt-6 space-y-5">
      <button onClick={onBack} className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-neutral-500 hover:text-neutral-900 font-medium">
        <ArrowLeft className="h-3.5 w-3.5"/> VOLTAR
      </button>

      <div>
        <div className="text-[10px] tracking-[0.4em] text-neutral-400 mb-2">ARQUIVO</div>
        <h2 className="text-4xl font-bold tracking-tight text-neutral-900">Sessões</h2>
      </div>

      {history.length >= 2 && <TrendChart history={history}/>}

      {history.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <button onClick={onExportCSV}
            className="flex items-center justify-center gap-2 rounded-xl border border-neutral-200 hover:border-neutral-400 py-3 text-xs font-semibold text-neutral-700 transition">
            <Download className="h-3.5 w-3.5"/> Exportar CSV
          </button>
          <button onClick={onExportJSON}
            className="flex items-center justify-center gap-2 rounded-xl border border-neutral-200 hover:border-neutral-400 py-3 text-xs font-semibold text-neutral-700 transition">
            <Download className="h-3.5 w-3.5"/> Exportar JSON
          </button>
        </div>
      )}

      {!history.length ? (
        <div className="py-24 text-center">
          <div className="flex items-center justify-center h-14 w-14 rounded-full bg-neutral-100 mx-auto mb-4">
            <Target className="h-6 w-6 text-neutral-400" strokeWidth={1.5}/>
          </div>
          <div className="text-sm text-neutral-500 font-medium">Sem registos ainda</div>
          <div className="text-xs text-neutral-400 mt-1">Inicia a tua primeira sessão</div>
        </div>
      ) : (
        <div className="space-y-2">
          {history.map((s, i) => (
            <HistoryRow key={s.id} session={s} index={history.length - i}
              onOpen={() => onOpen(s)}
              onEdit={() => onEdit(s)}
              onDelete={() => onDelete(s.id)}/>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function HistoryRow({ session, index, onOpen, onEdit, onDelete }) {
  const hits = countHits(session.shots);
  const cart = countCartridges(session.shots);
  const d = new Date(session.finishedAt);
  const dateStr = d.toLocaleDateString("pt-PT", { day:"2-digit", month:"short", year:"numeric" });
  const timeStr = d.toLocaleTimeString("pt-PT", { hour:"2-digit", minute:"2-digit" });
  const tier = hits >= 23 ? { label: "Excelente", color: "bg-emerald-500" } :
               hits >= 20 ? { label: "Muito bom", color: "bg-emerald-400" } :
               hits >= 15 ? { label: "Bom", color: "bg-amber-400" } :
               hits >= 10 ? { label: "Médio", color: "bg-orange-400" } :
                            { label: "Fraco", color: "bg-rose-400" };
  const m = session.meta || {};

  const stopAnd = (fn) => (e) => { e.stopPropagation(); fn(); };

  return (
    <div className="group rounded-xl border border-neutral-200 hover:border-neutral-400 bg-white transition overflow-hidden">
      <button onClick={onOpen}
        className="w-full flex items-center gap-4 p-4 text-left">
        <div className="flex flex-col items-center justify-center w-14 shrink-0">
          <div className="text-3xl font-bold tabular-nums leading-none text-neutral-900">{hits}</div>
          <div className="text-[10px] text-neutral-400 font-medium tabular-nums mt-0.5">/25</div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className={`h-1.5 w-1.5 rounded-full ${tier.color}`}/>
            <div className="text-sm font-semibold text-neutral-900 truncate">
              {m.competition || tier.label}
            </div>
            {m.weather && <WeatherIcon type={m.weather} className="h-3 w-3 text-neutral-400 shrink-0"/>}
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5 font-medium truncate">
            {m.location ? `${m.location} · ` : ""}#{String(index).padStart(3,"0")} · {dateStr} · {timeStr}
          </div>
          <div className="flex gap-[2px] mt-2">
            {session.shots.flat().map((sh,j)=>(
              <div key={j} className={`flex-1 h-1 rounded-full ${
                sh?.hit === true ? "bg-emerald-500" :
                sh?.hit === false ? "bg-rose-400" : "bg-neutral-200"
              }`}/>
            ))}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-neutral-300 group-hover:text-neutral-900 transition shrink-0"/>
      </button>

      <div className="flex border-t border-neutral-100 divide-x divide-neutral-100">
        <button onClick={stopAnd(onEdit)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] tracking-wide font-semibold text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900 transition">
          <Pencil className="h-3.5 w-3.5"/> Editar
        </button>
        <button onClick={stopAnd(onDelete)}
          className="flex-1 flex items-center justify-center gap-1.5 py-2.5 text-[11px] tracking-wide font-semibold text-neutral-500 hover:bg-rose-50 hover:text-rose-600 transition">
          <Trash2 className="h-3.5 w-3.5"/> Eliminar
        </button>
      </div>
    </div>
  );
}

function DetailView({ session, onBack, onDelete, onEdit }) {
  const hits = countHits(session.shots);
  const cart = countCartridges(session.shots);
  const d = new Date(session.finishedAt);
  const tier = hits >= 23 ? "Excelente" : hits >= 20 ? "Muito bom" : hits >= 15 ? "Bom" : hits >= 10 ? "Médio" : "Fraco";
  const efficiency = cart > 0 ? ((hits / cart) * 100).toFixed(0) : "0";
  const m = session.meta || {};
  const weather = WEATHER_OPTIONS.find(w => w.key === m.weather);

  return (
    <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}} className="mt-6 space-y-5">
      <div className="flex items-center justify-between">
        <button onClick={onBack} className="flex items-center gap-2 text-[11px] tracking-[0.2em] text-neutral-500 hover:text-neutral-900 font-medium">
          <ArrowLeft className="h-3.5 w-3.5"/> ARQUIVO
        </button>
        <button onClick={onEdit}
          className="flex items-center gap-1.5 text-[11px] tracking-wide font-semibold text-neutral-600 hover:text-neutral-900 transition">
          <Pencil className="h-3.5 w-3.5"/> EDITAR
        </button>
      </div>

      {(m.competition || m.location || m.weather || m.date) && (
        <div className="rounded-2xl bg-white border border-neutral-200 p-4">
          <div className="grid grid-cols-2 gap-3">
            {m.competition && (
              <div className="flex items-start gap-2">
                <Trophy className="h-3.5 w-3.5 text-neutral-500 mt-0.5"/>
                <div className="min-w-0">
                  <div className="text-[9px] tracking-[0.25em] text-neutral-400 font-semibold">PROVA</div>
                  <div className="text-xs font-semibold text-neutral-900 truncate">{m.competition}</div>
                </div>
              </div>
            )}
            {m.location && (
              <div className="flex items-start gap-2">
                <MapPin className="h-3.5 w-3.5 text-neutral-500 mt-0.5"/>
                <div className="min-w-0">
                  <div className="text-[9px] tracking-[0.25em] text-neutral-400 font-semibold">LOCAL</div>
                  <div className="text-xs font-semibold text-neutral-900 truncate">{m.location}</div>
                </div>
              </div>
            )}
            {m.date && (
              <div className="flex items-start gap-2">
                <Calendar className="h-3.5 w-3.5 text-neutral-500 mt-0.5"/>
                <div className="min-w-0">
                  <div className="text-[9px] tracking-[0.25em] text-neutral-400 font-semibold">DATA</div>
                  <div className="text-xs font-semibold text-neutral-900 truncate">{formatDate(m.date)}</div>
                </div>
              </div>
            )}
            {m.weather && (
              <div className="flex items-start gap-2">
                <div className="mt-0.5 text-neutral-500"><WeatherIcon type={m.weather}/></div>
                <div className="min-w-0">
                  <div className="text-[9px] tracking-[0.25em] text-neutral-400 font-semibold">TEMPO</div>
                  <div className="text-xs font-semibold text-neutral-900 truncate">{weather?.label}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="rounded-2xl bg-neutral-900 text-white p-6">
        <div className="flex items-center gap-2 text-[10px] tracking-[0.3em] text-neutral-400 font-medium">
          <Calendar className="h-3 w-3"/>
          {d.toLocaleDateString("pt-PT",{weekday:"long",day:"2-digit",month:"long",year:"numeric"}).toUpperCase()}
        </div>
        <div className="mt-4 flex items-end justify-between">
          <div>
            <div className="text-7xl font-bold tabular-nums leading-none tracking-tight">
              {hits}<span className="text-neutral-500 text-3xl">/25</span>
            </div>
            <div className="text-[10px] tracking-[0.3em] text-neutral-400 mt-3 font-medium">RESULTADO</div>
          </div>
          <div className="text-right">
            <div className="text-2xl font-bold tracking-tight">{tier}</div>
            <div className="text-[10px] tracking-[0.3em] text-neutral-400 mt-1 font-medium">CLASSIFICAÇÃO</div>
          </div>
        </div>
        <div className="mt-5 pt-5 border-t border-white/10 grid grid-cols-2 gap-4">
          <div>
            <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-medium">CARTUCHOS</div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">{cart}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-[0.3em] text-neutral-400 font-medium">EFICIÊNCIA</div>
            <div className="text-2xl font-bold tabular-nums mt-0.5">
              {efficiency}<span className="text-sm text-neutral-500">%</span>
            </div>
          </div>
        </div>
      </div>

      <div>
        <div className="text-[10px] tracking-[0.3em] text-neutral-400 mb-3 font-medium">POR POSIÇÃO</div>
        <div className="space-y-2">
          {session.shots.map((row, i) => {
            const h = posHits(row);
            const c = posCartridges(row);
            return (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-neutral-200 bg-white p-3">
                <div className="w-7">
                  <div className="text-[10px] tracking-[0.2em] text-neutral-500 font-semibold">P{i+1}</div>
                  <div className="text-[9px] text-neutral-400 font-medium mt-0.5">{c}c</div>
                </div>
                <div className="flex gap-1.5 flex-1">
                  {row.map((s, j) => (
                    <div key={j} className={`flex-1 h-10 flex items-center justify-center rounded-lg border relative
                      ${s?.hit === true ? "border-emerald-500 bg-emerald-50" :
                        s?.hit === false ? "border-rose-300 bg-rose-50" :
                        "border-neutral-200 bg-neutral-50"}`}>
                      {s?.hit === true ? <Check className="h-4 w-4 text-emerald-600" strokeWidth={3}/> :
                       s?.hit === false ? <X className="h-4 w-4 text-rose-500" strokeWidth={3}/> : null}
                      {isComplete(s) && (
                        <div className="absolute bottom-0 right-0.5 text-[8px] font-bold tabular-nums text-neutral-500">
                          {s.cartridges}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                <div className="text-lg font-bold tabular-nums w-8 text-right text-neutral-900">
                  {h}<span className="text-xs text-neutral-400">/5</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <button onClick={onDelete}
        className="w-full flex items-center justify-center gap-2 rounded-xl border border-neutral-200 hover:border-rose-400 text-neutral-500 hover:text-rose-600 py-3.5 text-xs font-semibold transition">
        <Trash2 className="h-3.5 w-3.5"/> Eliminar sessão
      </button>
    </motion.div>
  );
}
