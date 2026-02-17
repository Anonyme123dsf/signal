'use client'
import { useState, useEffect, useRef } from "react";

// ─── Design tokens ─────────────────────────────────────────────────────────
const MOODS = {
  green:   { label: "Stabil",              emoji: "🟢", color: "#4ade80", bg: "rgba(74,222,128,0.12)", border: "rgba(74,222,128,0.35)" },
  orange:  { label: "Angespannt",          emoji: "🟠", color: "#fb923c", bg: "rgba(251,146,60,0.12)",  border: "rgba(251,146,60,0.35)"  },
  red:     { label: "Überfordert",         emoji: "🔴", color: "#f87171", bg: "rgba(248,113,113,0.12)", border: "rgba(248,113,113,0.35)" },
  deepred: { label: "Tiefrot – Ich brauche Hilfe", emoji: "🔥", color: "#ff4444", bg: "rgba(255,68,68,0.15)",  border: "rgba(255,68,68,0.4)"  },
};

const MOCK_FRIENDS = [
  { id: 1, nickname: "Max",     mood: "orange", message: "Stress wegen Prüfung",   updated: "vor 2h",   available: false },
  { id: 2, nickname: "Jonas",   mood: "red",    message: "Trennung",                updated: "vor 30min",available: true  },
  { id: 3, nickname: "Lukas",   mood: "green",  message: "Training war gut 💪",      updated: "vor 1h",   available: true  },
  { id: 4, nickname: "Finn",    mood: "deepred",message: "Krass überfordert gerade", updated: "vor 5min", available: false },
  { id: 5, nickname: "Ben",     mood: "green",  message: "",                         updated: "vor 4h",   available: false },
  { id: 6, nickname: "Noah",    mood: "orange", message: "Zu wenig Schlaf",          updated: "vor 6h",   available: true  },
];

const MOCK_MESSAGES = {
  1: [
    { id: 1, from: "them", text: "Hey, alles ok?", time: "14:22" },
    { id: 2, from: "me",   text: "Geht so. Prüfung morgen.", time: "14:23" },
    { id: 3, from: "them", text: "Ich kenn das. War bei mir genauso. Du schaffst das.", time: "14:24" },
  ],
  2: [
    { id: 1, from: "them", text: "Bin gerade am Boden.", time: "13:58" },
    { id: 2, from: "me",   text: "Ich bin da. Was ist passiert?", time: "14:00" },
  ],
};

const GROUNDING = [
  { n: 5, sense: "Dinge, die du SIEHST",   icon: "👁" },
  { n: 4, sense: "Dinge, die du SPÜRST",   icon: "🖐" },
  { n: 3, sense: "Dinge, die du HÖRST",    icon: "👂" },
  { n: 2, sense: "Dinge, die du RIECHST",  icon: "👃" },
  { n: 1, sense: "Ding,  das du SCHMECKST",icon: "👅" },
];

// ─── Utility ────────────────────────────────────────────────────────────────
function timeAgo(ts: string) { return ts; }

// ─── Sub-components ─────────────────────────────────────────────────────────
function MoodDot({ level, size = 10 }) {
  const m = MOODS[level] || MOODS.green;
  return (
    <span style={{
      display: "inline-block", width: size, height: size, borderRadius: "50%",
      background: m.color, boxShadow: `0 0 ${size/2}px ${m.color}55`, flexShrink: 0,
    }} />
  );
}

function Avatar({ name, mood }) {
  const m = MOODS[mood] || MOODS.green;
  return (
    <div style={{
      width: 42, height: 42, borderRadius: "50%", display: "flex", alignItems: "center",
      justifyContent: "center", fontSize: 16, fontWeight: 700, flexShrink: 0,
      background: `linear-gradient(135deg, ${m.bg}, #1a1a2e)`,
      border: `1.5px solid ${m.border}`, color: m.color, position: "relative",
    }}>
      {name[0].toUpperCase()}
      <span style={{
        position: "absolute", bottom: -2, right: -2, width: 12, height: 12,
        borderRadius: "50%", background: m.color, border: "2px solid #0d0d1a",
        boxShadow: `0 0 6px ${m.color}`,
      }} />
    </div>
  );
}

// ─── Screen: Onboarding / Mood Input ────────────────────────────────────────
function MoodScreen({ onSubmit }) {
  const [selected, setSelected] = useState(null);
  const [msg, setMsg] = useState("");
  const [pulse, setPulse] = useState(false);

  function handleSelect(k) {
    setSelected(k);
    setPulse(true);
    setTimeout(() => setPulse(false), 400);
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", padding: "32px 20px",
      background: "radial-gradient(ellipse at 50% 0%, #0f1629 0%, #0a0a12 70%)",
    }}>
      {/* Logo */}
      <div style={{ marginBottom: 48, textAlign: "center" }}>
        <div style={{ fontSize: 13, letterSpacing: "0.3em", color: "#4a4a6a", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>
          SIGNAL
        </div>
        <div style={{ width: 40, height: 1, background: "linear-gradient(90deg, transparent, #5555aa, transparent)", margin: "8px auto" }} />
      </div>

      <h1 style={{
        fontSize: "clamp(22px,5vw,30px)", fontFamily: "'Playfair Display', Georgia, serif",
        fontWeight: 500, color: "#e8e8f0", textAlign: "center", marginBottom: 8,
        lineHeight: 1.3, letterSpacing: "-0.02em",
      }}>
        Wie geht es dir gerade?
      </h1>
      <p style={{ color: "#4a4a6a", fontSize: 13, marginBottom: 40, textAlign: "center" }}>
        Nur du und deine Freunde sehen das.
      </p>

      {/* Mood buttons */}
      <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 10 }}>
        {Object.entries(MOODS).map(([key, m]) => (
          <button key={key} onClick={() => handleSelect(key)} style={{
            width: "100%", padding: "16px 20px", borderRadius: 12,
            border: `1.5px solid ${selected === key ? m.border : "#1e1e2e"}`,
            background: selected === key ? m.bg : "#111122",
            color: selected === key ? m.color : "#8888aa",
            display: "flex", alignItems: "center", gap: 12, cursor: "pointer",
            transition: "all 0.2s", fontSize: 15, fontWeight: selected === key ? 600 : 400,
            outline: "none", transform: selected === key ? "scale(1.02)" : "scale(1)",
            boxShadow: selected === key ? `0 4px 24px ${m.color}22` : "none",
            fontFamily: "inherit",
          }}>
            <span style={{ fontSize: 20 }}>{m.emoji}</span>
            <span>{m.label}</span>
          </button>
        ))}
      </div>

      {/* Optional text */}
      {selected && (
        <div style={{ width: "100%", maxWidth: 360, marginTop: 16, animation: "fadeUp 0.3s ease" }}>
          <div style={{ position: "relative" }}>
            <input
              maxLength={120}
              value={msg}
              onChange={e => setMsg(e.target.value)}
              placeholder="Kurze Notiz (optional)…"
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 10,
                border: "1px solid #1e1e2e", background: "#0d0d1a",
                color: "#c8c8e0", fontSize: 14, outline: "none", boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
            <span style={{ position: "absolute", right: 12, bottom: 10, fontSize: 11, color: "#3a3a5a" }}>
              {msg.length}/120
            </span>
          </div>
        </div>
      )}

      <button
        disabled={!selected}
        onClick={() => selected && onSubmit({ mood: selected, message: msg })}
        style={{
          marginTop: 24, padding: "14px 40px", borderRadius: 10, fontSize: 15,
          fontWeight: 600, cursor: selected ? "pointer" : "not-allowed", fontFamily: "inherit",
          background: selected ? `linear-gradient(135deg, ${MOODS[selected].color}cc, ${MOODS[selected].color}88)` : "#1a1a2a",
          color: selected ? "#000" : "#3a3a5a", border: "none",
          transition: "all 0.3s", transform: selected ? "scale(1)" : "scale(0.98)",
          boxShadow: selected ? `0 8px 32px ${MOODS[selected].color}44` : "none",
        }}
      >
        Weiter →
      </button>

      <p style={{ marginTop: 24, fontSize: 12, color: "#2a2a4a", textAlign: "center" }}>
        Kein Klarname. Kein Profil. Nur Verbindung.
      </p>
    </div>
  );
}

// ─── Screen: Dashboard ──────────────────────────────────────────────────────
function DashboardScreen({ myMood, onOpenChat, onOpenCrisis }) {
  const [addFriend, setAddFriend] = useState(false);
  const [searchVal, setSearchVal] = useState("");

  const myM = MOODS[myMood.mood];
  const sortedFriends = [...MOCK_FRIENDS].sort((a, b) => {
    const order = { deepred: 0, red: 1, orange: 2, green: 3 };
    return order[a.mood] - order[b.mood];
  });

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a12", fontFamily: "inherit" }}>
      {/* Header */}
      <div style={{
        padding: "20px 20px 0", display: "flex", alignItems: "center",
        justifyContent: "space-between", maxWidth: 480, margin: "0 auto",
      }}>
        <div>
          <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#3a3a5a", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>
            SIGNAL
          </div>
          <div style={{ fontSize: 13, color: "#5a5a7a", marginTop: 2 }}>Dein Kreis</div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={() => setAddFriend(true)} style={{
            padding: "8px 14px", borderRadius: 8, fontSize: 12, background: "#1a1a2a",
            border: "1px solid #2a2a3e", color: "#6a6a9a", cursor: "pointer", fontFamily: "inherit",
          }}>+ Freund</button>
          <button onClick={() => alert("Einstellungen / Profil")} style={{
            width: 34, height: 34, borderRadius: "50%", background: "#1a1a2a",
            border: "1px solid #2a2a3e", color: "#6a6a9a", cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center",
          }}>⚙</button>
        </div>
      </div>

      {/* My mood card */}
      <div style={{ padding: "20px 20px 0", maxWidth: 480, margin: "0 auto" }}>
        <div style={{
          padding: "16px 18px", borderRadius: 14,
          background: `linear-gradient(135deg, ${myM.bg}, #0f0f1e)`,
          border: `1px solid ${myM.border}`,
        }}>
          <div style={{ fontSize: 11, color: "#4a4a6a", letterSpacing: "0.15em", marginBottom: 8, textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>Deine Stimmung</div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 22 }}>{myM.emoji}</span>
            <div>
              <div style={{ color: myM.color, fontWeight: 600, fontSize: 16 }}>{myM.label}</div>
              {myMood.message && <div style={{ color: "#7a7a9a", fontSize: 13, marginTop: 2 }}>{myMood.message}</div>}
            </div>
          </div>
        </div>
      </div>

      {/* Crisis alert for friends */}
      {MOCK_FRIENDS.some(f => f.mood === "deepred") && (
        <div style={{ padding: "12px 20px 0", maxWidth: 480, margin: "0 auto" }}>
          <div style={{
            padding: "12px 16px", borderRadius: 10,
            background: "rgba(255,68,68,0.08)", border: "1px solid rgba(255,68,68,0.3)",
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 18 }}>🔥</span>
            <div>
              <div style={{ color: "#ff6666", fontSize: 13, fontWeight: 600 }}>Finn braucht gerade Unterstützung</div>
              <div style={{ color: "#8a4a4a", fontSize: 12, marginTop: 2 }}>Schick ihm eine Nachricht.</div>
            </div>
            <button onClick={() => onOpenChat(MOCK_FRIENDS.find(f => f.mood === "deepred"))} style={{
              marginLeft: "auto", padding: "6px 12px", borderRadius: 8, fontSize: 12,
              background: "rgba(255,68,68,0.2)", border: "1px solid rgba(255,68,68,0.4)",
              color: "#ff8888", cursor: "pointer", fontFamily: "inherit", flexShrink: 0,
            }}>Schreiben</button>
          </div>
        </div>
      )}

      {/* Friends list */}
      <div style={{ padding: "16px 20px", maxWidth: 480, margin: "0 auto", paddingBottom: 100 }}>
        <div style={{ fontSize: 11, color: "#3a3a5a", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 12 }}>
          DEIN KREIS — {MOCK_FRIENDS.length} Personen
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sortedFriends.map(friend => {
            const m = MOODS[friend.mood];
            return (
              <div key={friend.id} onClick={() => onOpenChat(friend)} style={{
                padding: "14px 16px", borderRadius: 12, cursor: "pointer",
                background: "#111122", border: `1px solid #1a1a2e`,
                display: "flex", alignItems: "center", gap: 12,
                transition: "all 0.15s", position: "relative", overflow: "hidden",
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = m.border; e.currentTarget.style.background = m.bg; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a1a2e"; e.currentTarget.style.background = "#111122"; }}
              >
                {/* Mood line on left */}
                <div style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: m.color, borderRadius: "3px 0 0 3px" }} />
                <Avatar name={friend.nickname} mood={friend.mood} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color: "#d0d0e8", fontWeight: 600, fontSize: 14 }}>{friend.nickname}</span>
                    {friend.available && (
                      <span style={{ fontSize: 10, color: "#4ade80", background: "rgba(74,222,128,0.1)", padding: "1px 6px", borderRadius: 4, border: "1px solid rgba(74,222,128,0.2)" }}>
                        verfügbar
                      </span>
                    )}
                  </div>
                  {friend.message ? (
                    <div style={{ color: "#5a5a7a", fontSize: 12, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {friend.message}
                    </div>
                  ) : (
                    <div style={{ color: "#3a3a5a", fontSize: 12, marginTop: 2 }}>—</div>
                  )}
                </div>
                <div style={{ textAlign: "right", flexShrink: 0 }}>
                  <div style={{ fontSize: 11, color: "#3a3a5a" }}>{friend.updated}</div>
                  <div style={{ fontSize: 16, marginTop: 2 }}>{m.emoji}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bottom nav */}
      <BottomNav active="home" />

      {/* Add friend modal */}
      {addFriend && (
        <Modal onClose={() => { setAddFriend(false); setSearchVal(""); }}>
          <div style={{ fontSize: 16, fontWeight: 600, color: "#d0d0e8", marginBottom: 6 }}>Freund hinzufügen</div>
          <div style={{ fontSize: 13, color: "#5a5a7a", marginBottom: 20 }}>Teile deinen Code oder suche einen Nicknamen.</div>
          <div style={{
            padding: "10px 14px", borderRadius: 8, background: "#0d0d1a",
            border: "1px solid #3a3a5a", color: "#7a7a9a", fontSize: 13,
            marginBottom: 16, letterSpacing: "0.2em", textAlign: "center",
            fontFamily: "'DM Mono', monospace",
          }}>
            Dein Code: <strong style={{ color: "#8888cc" }}>X7F-9KM</strong>
          </div>
          <input
            value={searchVal}
            onChange={e => setSearchVal(e.target.value)}
            placeholder="Nickname oder Code suchen…"
            style={{
              width: "100%", padding: "12px 14px", borderRadius: 8,
              border: "1px solid #2a2a3e", background: "#111122",
              color: "#c0c0e0", fontSize: 14, outline: "none", boxSizing: "border-box",
              fontFamily: "inherit",
            }}
          />
          <button onClick={() => { alert("Einladung gesendet!"); setAddFriend(false); }} style={{
            marginTop: 14, width: "100%", padding: "12px", borderRadius: 8,
            background: "#5555aa", border: "none", color: "#fff", fontSize: 14,
            fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
          }}>
            Anfrage senden
          </button>
        </Modal>
      )}
    </div>
  );
}

// ─── Screen: Chat ────────────────────────────────────────────────────────────
function ChatScreen({ friend, onBack }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState(MOCK_MESSAGES[friend.id] || []);
  const bottomRef = useRef(null);
  const m = MOODS[friend.mood];

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  function send() {
    if (!input.trim()) return;
    setMessages(prev => [...prev, { id: Date.now(), from: "me", text: input.trim(), time: new Date().toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }) }]);
    setInput("");
  }

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: "#0a0a12" }}>
      {/* Header */}
      <div style={{
        padding: "16px 20px", borderBottom: "1px solid #1a1a2e",
        display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        background: "#0d0d1a",
      }}>
        <button onClick={onBack} style={{ background: "none", border: "none", color: "#6a6a9a", cursor: "pointer", fontSize: 20, padding: "0 4px 0 0" }}>←</button>
        <Avatar name={friend.nickname} mood={friend.mood} />
        <div>
          <div style={{ color: "#d0d0e8", fontWeight: 600, fontSize: 15 }}>{friend.nickname}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
            <MoodDot level={friend.mood} size={8} />
            <span style={{ color: m.color, fontSize: 12 }}>{m.label}</span>
            {friend.message && <span style={{ color: "#4a4a6a", fontSize: 12 }}>· {friend.message}</span>}
          </div>
        </div>
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "#3a3a5a", fontSize: 13, marginTop: 40 }}>
            Keine Nachrichten noch. Sag etwas. 👋
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} style={{
            display: "flex", justifyContent: msg.from === "me" ? "flex-end" : "flex-start",
          }}>
            <div style={{
              maxWidth: "72%", padding: "10px 14px", borderRadius: msg.from === "me" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
              background: msg.from === "me" ? "#2a2a5a" : "#1a1a2a",
              border: msg.from === "me" ? "1px solid #4a4a8a" : "1px solid #2a2a3e",
              color: msg.from === "me" ? "#d0d0f8" : "#b0b0cc",
              fontSize: 14, lineHeight: 1.5,
            }}>
              {msg.text}
              <div style={{ fontSize: 10, color: msg.from === "me" ? "#6a6a9a" : "#4a4a6a", marginTop: 4, textAlign: "right" }}>{msg.time}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{
        padding: "12px 16px", borderTop: "1px solid #1a1a2e", background: "#0d0d1a",
        display: "flex", gap: 10, alignItems: "flex-end",
      }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && send()}
          placeholder="Schreib etwas…"
          style={{
            flex: 1, padding: "12px 14px", borderRadius: 10,
            border: "1px solid #2a2a3e", background: "#111122",
            color: "#c0c0e0", fontSize: 14, outline: "none", fontFamily: "inherit",
          }}
        />
        <button onClick={send} style={{
          width: 42, height: 42, borderRadius: 10, background: input.trim() ? "#5555aa" : "#1a1a2a",
          border: "none", color: "#fff", cursor: "pointer", fontSize: 18,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "background 0.2s", flexShrink: 0,
        }}>↑</button>
      </div>
    </div>
  );
}

// ─── Screen: Crisis (🔥) ─────────────────────────────────────────────────────
function CrisisScreen({ onStable, onChat }) {
  const [step, setStep] = useState("main"); // main | grounding
  const [gStep, setGStep] = useState(0);

  if (step === "grounding") {
    const current = GROUNDING[gStep];
    return (
      <div style={{
        minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", padding: "32px 24px", background: "#0a0a12",
      }}>
        <div style={{ fontSize: 11, color: "#4a4a6a", letterSpacing: "0.3em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 40 }}>
          5-4-3-2-1 METHODE
        </div>
        <div style={{
          width: "100%", maxWidth: 360, padding: "32px 24px", borderRadius: 16,
          background: "#0f0f1e", border: "1px solid #2a2a3e", textAlign: "center",
        }}>
          <div style={{ fontSize: 52, marginBottom: 16 }}>{current.icon}</div>
          <div style={{ fontSize: 48, fontWeight: 700, color: "#5555aa", fontFamily: "'Playfair Display', serif", marginBottom: 8 }}>
            {current.n}
          </div>
          <div style={{ fontSize: 18, color: "#c0c0e8", marginBottom: 8 }}>{current.sense}</div>
          <div style={{ fontSize: 13, color: "#5a5a7a", lineHeight: 1.6 }}>
            Benenne sie in Gedanken oder laut.
          </div>
          <div style={{ display: "flex", gap: 10, marginTop: 28 }}>
            {gStep > 0 && (
              <button onClick={() => setGStep(g => g - 1)} style={{
                flex: 1, padding: "12px", borderRadius: 8, background: "#1a1a2a",
                border: "1px solid #2a2a3e", color: "#8888aa", cursor: "pointer", fontFamily: "inherit",
              }}>← Zurück</button>
            )}
            {gStep < GROUNDING.length - 1 ? (
              <button onClick={() => setGStep(g => g + 1)} style={{
                flex: 2, padding: "12px", borderRadius: 8, background: "#2a2a5a",
                border: "none", color: "#d0d0f8", cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
              }}>Weiter →</button>
            ) : (
              <button onClick={onStable} style={{
                flex: 2, padding: "12px", borderRadius: 8, background: "#4ade80",
                border: "none", color: "#000", cursor: "pointer", fontFamily: "inherit", fontWeight: 700,
              }}>Ich bin stabiler 🌿</button>
            )}
          </div>
        </div>
        <button onClick={() => setStep("main")} style={{ marginTop: 20, background: "none", border: "none", color: "#3a3a5a", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}>
          ← Zurück
        </button>
      </div>
    );
  }

  return (
    <div style={{
      minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "32px 24px",
      background: "radial-gradient(ellipse at 50% 30%, #1a0a0a 0%, #0a0a12 70%)",
    }}>
      <div style={{ fontSize: 56, marginBottom: 20 }}>🔥</div>
      <h1 style={{
        fontSize: 24, fontFamily: "'Playfair Display', serif", color: "#f0d0d0",
        textAlign: "center", marginBottom: 10, fontWeight: 500,
      }}>
        Du bist nicht allein.
      </h1>
      <p style={{ color: "#7a5a5a", fontSize: 14, textAlign: "center", maxWidth: 300, lineHeight: 1.7, marginBottom: 36 }}>
        Atme kurz durch. Es gibt Menschen die dir jetzt helfen können.
      </p>

      <div style={{ width: "100%", maxWidth: 360, display: "flex", flexDirection: "column", gap: 10 }}>
        <button onClick={onChat} style={{
          padding: "16px", borderRadius: 12, background: "rgba(255,68,68,0.15)",
          border: "1px solid rgba(255,68,68,0.35)", color: "#ff8888",
          fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
        }}>
          💬 Jetzt mit jemandem chatten
        </button>

        <button onClick={() => setStep("grounding")} style={{
          padding: "16px", borderRadius: 12, background: "#111122",
          border: "1px solid #2a2a3e", color: "#9090cc",
          fontSize: 15, cursor: "pointer", fontFamily: "inherit",
        }}>
          🧘 Grounding-Übung starten
        </button>

        {/* Crisis numbers */}
        <div style={{ padding: "14px 16px", borderRadius: 12, background: "#0f0f1e", border: "1px solid #2a2a3e", marginTop: 4 }}>
          <div style={{ fontSize: 11, color: "#4a4a6a", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 10 }}>
            KRISENTELEFON
          </div>
          {[
            { country: "🇩🇪 Deutschland", number: "0800 111 0 111", free: true },
            { country: "🇦🇹 Österreich",  number: "142",            free: true },
            { country: "🇨🇭 Schweiz",     number: "143",            free: true },
          ].map(c => (
            <div key={c.country} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0", borderBottom: "1px solid #1a1a2a" }}>
              <span style={{ color: "#8a8aaa", fontSize: 13 }}>{c.country}</span>
              <a href={`tel:${c.number}`} style={{ color: "#aaaaee", fontSize: 14, fontFamily: "'DM Mono', monospace", textDecoration: "none", fontWeight: 600 }}>
                {c.number}
              </a>
            </div>
          ))}
        </div>

        <button onClick={onStable} style={{
          padding: "14px", borderRadius: 12, background: "rgba(74,222,128,0.1)",
          border: "1px solid rgba(74,222,128,0.25)", color: "#4ade80",
          fontSize: 14, cursor: "pointer", fontFamily: "inherit", marginTop: 8,
        }}>
          ✓ Ich bin wieder stabil
        </button>
      </div>
    </div>
  );
}

// ─── Screen: Reminders ──────────────────────────────────────────────────────
function RemindersScreen() {
  const [reminders, setReminders] = useState([
    { id: 1, text: "Max diese Woche schreiben", active: true, date: "Di, 18. Feb" },
    { id: 2, text: "Check-in: Jonas", active: true, date: "Fr, 21. Feb" },
  ]);
  const [newR, setNewR] = useState("");

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a12", padding: "24px 20px 100px", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#3a3a5a", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>SIGNAL</div>
        <h2 style={{ color: "#c0c0e0", fontSize: 20, fontFamily: "'Playfair Display', serif", fontWeight: 500, marginTop: 4 }}>Erinnerungen</h2>
      </div>

      {/* System reminders */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 11, color: "#3a3a5a", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 10 }}>AUTOMATISCH</div>
        {[
          { text: "Finn ist seit 3 Tagen im roten Bereich", icon: "🔴", color: "#f87171" },
          { text: "Dein letztes Mood-Update war vor 2 Tagen", icon: "🟠", color: "#fb923c" },
        ].map((r, i) => (
          <div key={i} style={{
            padding: "12px 14px", borderRadius: 10, background: "#0f0f1e",
            border: `1px solid ${r.color}33`, marginBottom: 8,
            display: "flex", alignItems: "center", gap: 10,
          }}>
            <span style={{ fontSize: 16 }}>{r.icon}</span>
            <span style={{ color: "#9090aa", fontSize: 13 }}>{r.text}</span>
          </div>
        ))}
      </div>

      {/* Custom reminders */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ fontSize: 11, color: "#3a3a5a", letterSpacing: "0.2em", textTransform: "uppercase", fontFamily: "'DM Mono', monospace", marginBottom: 10 }}>MEINE REMINDER</div>
        {reminders.map(r => (
          <div key={r.id} style={{
            padding: "12px 14px", borderRadius: 10, background: "#111122",
            border: "1px solid #1e1e2e", marginBottom: 8,
            display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <div style={{ color: "#b0b0cc", fontSize: 14 }}>{r.text}</div>
              <div style={{ color: "#3a3a5a", fontSize: 12, marginTop: 2 }}>{r.date}</div>
            </div>
            <button onClick={() => setReminders(prev => prev.filter(x => x.id !== r.id))} style={{
              background: "none", border: "none", color: "#3a3a5a", cursor: "pointer", fontSize: 16,
            }}>✕</button>
          </div>
        ))}
      </div>

      {/* Add new */}
      <div style={{ display: "flex", gap: 8 }}>
        <input
          value={newR}
          onChange={e => setNewR(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Enter" && newR.trim()) {
              setReminders(prev => [...prev, { id: Date.now(), text: newR.trim(), active: true, date: "Diese Woche" }]);
              setNewR("");
            }
          }}
          placeholder="Neuer Reminder…"
          style={{
            flex: 1, padding: "12px 14px", borderRadius: 10,
            border: "1px solid #2a2a3e", background: "#111122",
            color: "#c0c0e0", fontSize: 14, outline: "none", fontFamily: "inherit",
          }}
        />
        <button onClick={() => {
          if (!newR.trim()) return;
          setReminders(prev => [...prev, { id: Date.now(), text: newR.trim(), active: true, date: "Diese Woche" }]);
          setNewR("");
        }} style={{
          padding: "12px 16px", borderRadius: 10, background: "#2a2a5a",
          border: "none", color: "#9090ee", cursor: "pointer", fontFamily: "inherit", fontSize: 20,
        }}>+</button>
      </div>

      <BottomNav active="reminders" />
    </div>
  );
}

// ─── Screen: Communities ─────────────────────────────────────────────────────
function CommunitiesScreen({ onOpenGroupChat }) {
  const groups = [
    { id: 1, name: "Prüfungszeit 🎓",   type: "anonym",  members: 34, mood: "orange", lastMsg: "Schafft jemand heute noch Mathe?" },
    { id: 2, name: "Trennung & Neustart", type: "anonym",  members: 18, mood: "red",    lastMsg: "Tag 7 ohne Kontakt. Ist schon was." },
    { id: 3, name: "Meine Jungs 🤙",     type: "privat",  members: 5,  mood: "green",  lastMsg: "Wer hat Bock Freitag?" },
    { id: 4, name: "Einsamkeit & Co.",   type: "anonym",  members: 61, mood: "red",    lastMsg: "Manchmal fühlt sich die Wohnung riesig an." },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#0a0a12", padding: "24px 20px 100px", maxWidth: 480, margin: "0 auto" }}>
      <div style={{ marginBottom: 28 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#3a3a5a", textTransform: "uppercase", fontFamily: "'DM Mono', monospace" }}>SIGNAL</div>
        <h2 style={{ color: "#c0c0e0", fontSize: 20, fontFamily: "'Playfair Display', serif", fontWeight: 500, marginTop: 4 }}>Communities</h2>
      </div>

      {/* Type filters */}
      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        {["Alle", "Privat", "Anonym", "Challenges"].map(t => (
          <button key={t} style={{
            padding: "6px 12px", borderRadius: 20, fontSize: 12,
            background: t === "Alle" ? "#2a2a5a" : "#111122",
            border: `1px solid ${t === "Alle" ? "#5555aa" : "#1e1e2e"}`,
            color: t === "Alle" ? "#aaaaee" : "#5a5a7a", cursor: "pointer", fontFamily: "inherit",
          }}>{t}</button>
        ))}
      </div>

      {groups.map(g => {
        const m = MOODS[g.mood];
        return (
          <div key={g.id} onClick={() => onOpenGroupChat(g)} style={{
            padding: "14px 16px", borderRadius: 12, marginBottom: 8, cursor: "pointer",
            background: "#111122", border: "1px solid #1a1a2e",
            display: "flex", gap: 12, alignItems: "center", transition: "all 0.15s",
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = "#2a2a4e"; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = "#1a1a2e"; }}
          >
            <div style={{
              width: 44, height: 44, borderRadius: 10, background: m.bg,
              border: `1px solid ${m.border}`, display: "flex", alignItems: "center",
              justifyContent: "center", fontSize: 20, flexShrink: 0,
            }}>
              {g.name.slice(-2)}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#c0c0e0", fontSize: 14, fontWeight: 600 }}>{g.name.slice(0, -2).trim() || g.name}</span>
                <span style={{ fontSize: 10, color: "#4a4a6a", background: "#1a1a2a", padding: "1px 6px", borderRadius: 4, border: "1px solid #2a2a3e" }}>
                  {g.type}
                </span>
              </div>
              <div style={{ color: "#4a4a6a", fontSize: 12, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {g.lastMsg}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 11, color: "#3a3a5a" }}>{g.members} Mitglieder</div>
              <MoodDot level={g.mood} size={8} />
            </div>
          </div>
        );
      })}

      <button onClick={() => alert("Gruppe erstellen")} style={{
        width: "100%", padding: "14px", borderRadius: 10, marginTop: 8,
        background: "#111122", border: "1px dashed #2a2a4e", color: "#5a5a8a",
        fontSize: 14, cursor: "pointer", fontFamily: "inherit",
      }}>
        + Neue Gruppe erstellen
      </button>

      <BottomNav active="community" />
    </div>
  );
}

// ─── Shared: Modal ────────────────────────────────────────────────────────────
function Modal({ children, onClose }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", zIndex: 100,
      display: "flex", alignItems: "flex-end", justifyContent: "center",
    }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{
        width: "100%", maxWidth: 480, background: "#0f0f1e",
        border: "1px solid #2a2a3e", borderBottom: "none",
        borderRadius: "16px 16px 0 0", padding: "28px 24px 40px",
        animation: "slideUp 0.25s ease",
      }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#2a2a4e", margin: "0 auto 24px" }} />
        {children}
      </div>
    </div>
  );
}

// ─── Shared: Bottom Nav ───────────────────────────────────────────────────────
function BottomNav({ active, onChange }) {
  const items = [
    { id: "home",      icon: "⬡",  label: "Kreis"    },
    { id: "community", icon: "◎",  label: "Gruppen"  },
    { id: "reminders", icon: "⏱",  label: "Reminder" },
    { id: "profile",   icon: "◫",  label: "Profil"   },
  ];
  return (
    <div style={{
      position: "fixed", bottom: 0, left: 0, right: 0,
      background: "#0d0d1a", borderTop: "1px solid #1a1a2e",
      display: "flex", justifyContent: "space-around", padding: "10px 0 20px",
      zIndex: 50,
    }}>
      {items.map(item => (
        <button key={item.id} onClick={() => onChange?.(item.id)} style={{
          display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
          background: "none", border: "none", cursor: "pointer",
          color: item.id === active ? "#8888ee" : "#3a3a5a",
          transition: "color 0.2s", padding: "4px 16px",
        }}>
          <span style={{ fontSize: 18 }}>{item.icon}</span>
          <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em" }}>
            {item.label.toUpperCase()}
          </span>
        </button>
      ))}
    </div>
  );
}

// ─── Root App ────────────────────────────────────────────────────────────────
export default function App() {
  const [screen, setScreen] = useState("mood"); // mood | dashboard | chat | crisis | reminders | community
  const [myMood, setMyMood] = useState(null);
  const [activeChat, setActiveChat] = useState(null);
  const [activeGroup, setActiveGroup] = useState(null);

  function handleMoodSubmit(data) {
    setMyMood(data);
    if (data.mood === "deepred") {
      setScreen("crisis");
    } else {
      setScreen("dashboard");
    }
  }

  function nav(to) {
    setScreen(to);
    setActiveChat(null);
    setActiveGroup(null);
  }

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;700&family=DM+Mono:wght@300;400&display=swap');
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', system-ui, -apple-system, sans-serif; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes slideUp { from { transform: translateY(100%); } to { transform: translateY(0); } }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #2a2a4e; border-radius: 4px; }
        * { -webkit-tap-highlight-color: transparent; }
        button, input { font-family: 'DM Sans', system-ui, -apple-system, sans-serif; }
      `}</style>

      <div style={{ maxWidth: 480, margin: "0 auto", position: "relative" }}>
        {screen === "mood" && (
          <MoodScreen onSubmit={handleMoodSubmit} />
        )}
        {screen === "dashboard" && myMood && (
          <DashboardScreen
            myMood={myMood}
            onOpenChat={f => { setActiveChat(f); setScreen("chat"); }}
            onOpenCrisis={() => setScreen("crisis")}
          />
        )}
        {screen === "chat" && activeChat && (
          <ChatScreen friend={activeChat} onBack={() => setScreen("dashboard")} />
        )}
        {screen === "crisis" && (
          <CrisisScreen
            onStable={() => { setMyMood({ mood: "green", message: "Wieder stabil 🌿" }); setScreen("dashboard"); }}
            onChat={() => { setActiveChat(MOCK_FRIENDS[1]); setScreen("chat"); }}
          />
        )}
        {screen === "reminders" && (
          <RemindersScreen />
        )}
        {screen === "community" && (
          <CommunitiesScreen
            onOpenGroupChat={g => { setActiveGroup(g); alert(`Öffne Gruppe: ${g.name}`); }}
          />
        )}

        {/* Nav override for screens with bottomnav */}
        {["dashboard", "reminders", "community"].includes(screen) && (
          <div style={{ position: "fixed", bottom: 0, left: "50%", transform: "translateX(-50%)", width: "100%", maxWidth: 480, zIndex: 60 }}>
            <div style={{
              background: "#0d0d1a", borderTop: "1px solid #1a1a2e",
              display: "flex", justifyContent: "space-around", padding: "10px 0 20px",
            }}>
              {[
                { id: "dashboard",  icon: "⬡",  label: "Kreis"    },
                { id: "community",  icon: "◎",  label: "Gruppen"  },
                { id: "reminders",  icon: "⏱",  label: "Reminder" },
                { id: "profile",    icon: "◫",  label: "Profil"   },
              ].map(item => (
                <button key={item.id} onClick={() => nav(item.id)} style={{
                  display: "flex", flexDirection: "column", alignItems: "center", gap: 3,
                  background: "none", border: "none", cursor: "pointer",
                  color: item.id === screen ? "#8888ee" : "#3a3a5a",
                  transition: "color 0.2s", padding: "4px 16px",
                }}>
                  <span style={{ fontSize: 18 }}>{item.icon}</span>
                  <span style={{ fontSize: 10, fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em" }}>
                    {item.label.toUpperCase()}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
