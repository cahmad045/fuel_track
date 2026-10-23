import { useState, useEffect, useCallback, useRef } from "react";

// ── Supabase REST helpers ──
function createClient(url, key) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
  const base = `${url}/rest/v1/fuel_store`;
  return {
    async get(k) {
      const r = await fetch(`${base}?key=eq.${encodeURIComponent(k)}&select=value`, { headers });
      if (!r.ok) throw new Error(`GET failed: ${r.status}`);
      const d = await r.json();
      return d?.[0]?.value ?? null;
    },
    async set(k, v) {
      const r = await fetch(base, {
        method: "POST",
        headers: { ...headers, Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ key: k, value: v }),
      });
      if (!r.ok) throw new Error(`SET failed: ${r.status}`);
    },
  };
}

const DEFAULT_SHARED_KM = 93;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function getMonthKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function formatRs(n) {
  if (n == null || isNaN(n)) return "Rs 0";
  return `Rs ${Math.round(n).toLocaleString()}`;
}
function formatDate(ds) {
  const d = new Date(ds);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}
const emptyMonth = () => ({ preExistingBalance: 0, deposits: {}, carryForward: {}, oneWayFares: {}, trips: [] });

// ── Per-leg split logic ──
const normMode = (m) => (m === "one" ? "morning" : m); // legacy "one" = morning only
const MODE_TAG = { both: "", morning: " (AM)", return: " (PM)" };

function tripCosts(trip) {
  const fc = trip.fuelCost || 0;
  if (trip.mode === "estimate") {
    const sc = Math.min(trip.sharedCost || 0, fc);
    return { sharedCost: sc, personalCost: fc - sc };
  }
  const tk = trip.totalKm || 0;
  if (!tk) return { sharedCost: 0, personalCost: fc };
  const perKm = fc / tk;
  const sk = Math.min(trip.sharedKm || 0, tk);
  return { sharedCost: sk * perKm, personalCost: (tk - sk) * perKm };
}

function tripExtras(trip) {
  // legacy single extraFare is treated as a return-leg pickup
  return { extraAM: trip.extraFareAM || 0, extraPM: trip.extraFarePM ?? trip.extraFare ?? 0 };
}

// Each leg is its own pool: fixed contributions come off first, remainder split equally among registered riders on that leg.
function splitTrip({ sharedCost, personalCost, travelers, extraAM = 0, extraPM = 0, owFares = {} }) {
  const shares = {};
  const add = (p, v) => { shares[p] = (shares[p] || 0) + v; };
  const entries = Object.entries(travelers || {}).map(([p, m]) => [p, normMode(m)]);
  const legCost = sharedCost / 2;
  [["morning", extraAM], ["return", extraPM]].forEach(([leg, extra]) => {
    const riders = entries.filter(([, m]) => m === "both" || m === leg).map(([p]) => p);
    const fixed = entries.filter(([p, m]) => m === leg && (owFares[p] || 0) > 0).map(([p]) => p);
    let remaining = legCost - extra;
    fixed.forEach((p) => { add(p, owFares[p]); remaining -= owFares[p]; });
    const equal = riders.filter((p) => !fixed.includes(p));
    if (equal.length) equal.forEach((p) => add(p, remaining / equal.length));
    else add("Ahmad", remaining);
  });
  if (personalCost > 0) add("Ahmad", personalCost);
  return shares;
}

// ── Dark mode hook ──
function useDark() {
  const [dark, setDark] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    setDark(mq.matches);
    const handler = (e) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return dark;
}

// ── Theme ──
const theme = {
  light: {
    bg: "#ffffff", bgSec: "#f9fafb", text: "#1a1a1a", textSec: "#6b7280",
    border: "#e5e7eb", borderInput: "#d1d5db", card: "#ffffff",
  },
  dark: {
    bg: "#0f0f0f", bgSec: "#1a1a1a", text: "#e5e5e5", textSec: "#9ca3af",
    border: "#2a2a2a", borderInput: "#3a3a3a", card: "#1a1a1a",
  },
};

// ── Config Screen ──
function ConfigScreen({ onSave, t }) {
  const [url, setUrl] = useState("");
  const [key, setKey] = useState("");
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState("");

  const test = async () => {
    setTesting(true);
    setError("");
    try {
      const db = createClient(url.replace(/\/+$/, ""), key);
      await db.get("partners");
      onSave(url.replace(/\/+$/, ""), key);
    } catch (e) {
      setError("Connection failed. Check your URL and anon key.");
    }
    setTesting(false);
  };

  return (
    <div style={{ ...S.container, background: t.bg, color: t.text }}>
      <div style={{ padding: "40px 20px", maxWidth: 400, margin: "0 auto" }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, marginBottom: 8, letterSpacing: "-0.02em" }}>⛽ Fuel Tracker</h1>
        <p style={{ color: t.textSec, fontSize: 14, marginBottom: 24 }}>
          Connect your Supabase database. One-time setup per device.
        </p>
        <label style={{ ...S.label, color: t.textSec }}>Supabase Project URL</label>
        <input placeholder="https://xxxxx.supabase.co" value={url}
          onChange={(e) => setUrl(e.target.value)}
          style={{ ...S.input, background: t.bg, color: t.text, borderColor: t.borderInput }} />
        <label style={{ ...S.label, color: t.textSec }}>Anon Key</label>
        <input placeholder="eyJhbGciOi..." value={key}
          onChange={(e) => setKey(e.target.value)}
          style={{ ...S.input, background: t.bg, color: t.text, borderColor: t.borderInput, fontSize: 12 }} />
        {error && <p style={{ color: "#ef4444", fontSize: 13, marginBottom: 8 }}>{error}</p>}
        <button onClick={test} disabled={!url || !key || testing}
          style={{ ...S.primaryBtn, opacity: !url || !key || testing ? 0.5 : 1 }}>
          {testing ? "Testing..." : "Connect"}
        </button>
        <div style={{ marginTop: 24, padding: 16, background: t.bgSec, borderRadius: 10, fontSize: 13, color: t.textSec }}>
          <strong style={{ color: t.text }}>First-time setup:</strong><br /><br />
          1. Go to <strong>supabase.com</strong> → create free project<br />
          2. Go to <strong>SQL Editor</strong> → run this:<br />
          <pre style={{
            background: t.bg, padding: 10, borderRadius: 6, fontSize: 11,
            overflowX: "auto", marginTop: 8, whiteSpace: "pre-wrap", wordBreak: "break-all",
            border: `1px solid ${t.border}`
          }}>{`CREATE TABLE fuel_store (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE fuel_store ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all with anon key"
  ON fuel_store FOR ALL
  USING (true) WITH CHECK (true);`}</pre>
          3. Go to <strong>Settings → API</strong> → copy URL & anon key
        </div>
      </div>
    </div>
  );
}

// ── Main Export ──
export default function App() {
  const dark = useDark();
  const t = dark ? theme.dark : theme.light;
  const [config, setConfig] = useState(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("fuel-tracker-config") || "null");
      if (saved?.url && saved?.key) setConfig(saved);
    } catch {}
    setReady(true);
  }, []);

  const saveConfig = (url, key) => {
    const c = { url, key };
    localStorage.setItem("fuel-tracker-config", JSON.stringify(c));
    setConfig(c);
  };

  const disconnect = () => {
    localStorage.removeItem("fuel-tracker-config");
    setConfig(null);
  };

  if (!ready) return null;
  if (!config) return <ConfigScreen onSave={saveConfig} t={t} />;
  return <Tracker config={config} onDisconnect={disconnect} t={t} />;
}

// ── Tracker App ──
function Tracker({ config, onDisconnect, t }) {
  const db = useRef(createClient(config.url, config.key)).current;

  const [data, setData] = useState(null);
  const [partners, setPartners] = useState(null);
  const [currentMonth, setCurrentMonth] = useState(getMonthKey());
  const [view, setView] = useState("trips");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [tripForm, setTripForm] = useState({
    mode: "exact", // "exact" | "estimate"
    date: new Date().toISOString().slice(0, 10),
    totalKm: "", fuelCost: "", sharedKm: DEFAULT_SHARED_KM, sharedCost: "", extraFareAM: "", extraFarePM: "", travelers: {},
  });
  const [setupForm, setSetupForm] = useState({ preExistingBalance: 0, deposits: {}, carryForward: {}, oneWayFares: {} });
  const [newPartner, setNewPartner] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const [d, p] = await Promise.all([db.get("data"), db.get("partners")]);
        setData(d || {});
        setPartners(p || ["Ahmad", "Khubaib"]);
      } catch {
        setError("Failed to load. Check connection.");
        setData({});
        setPartners(["Ahmad", "Khubaib"]);
      }
      setLoading(false);
    })();
  }, [db]);

  const save = useCallback(async (newData, newPartners) => {
    setSaving(true);
    try {
      await db.set("data", newData);
      if (newPartners) await db.set("partners", newPartners);
      setError("");
    } catch { setError("Save failed"); }
    setSaving(false);
  }, [db]);

  if (loading) return (
    <div style={{ ...S.container, background: t.bg, color: t.text }}>
      <p style={{ color: t.textSec, textAlign: "center", marginTop: 80 }}>Loading...</p>
    </div>
  );

  // Carry over pre-existing balance and one-way fares from the latest earlier month if not set
  const inherited = (() => {
    const keys = Object.keys(data || {}).filter((k) => k < currentMonth).sort().reverse();
    let bal = 0, fares = {};
    for (const k of keys) { if (data[k]?.preExistingBalance) { bal = data[k].preExistingBalance; break; } }
    for (const k of keys) { if (data[k]?.oneWayFares && Object.values(data[k].oneWayFares).some((v) => v > 0)) { fares = data[k].oneWayFares; break; } }
    return { bal, fares };
  })();
  const rawMonth = data?.[currentMonth] || {};
  const hasFares = rawMonth.oneWayFares && Object.values(rawMonth.oneWayFares).some((v) => v > 0);
  const month = {
    ...emptyMonth(),
    ...rawMonth,
    trips: rawMonth.trips || [],
    preExistingBalance: rawMonth.preExistingBalance || inherited.bal,
    oneWayFares: hasFares ? rawMonth.oneWayFares : inherited.fares,
  };

  const updateMonth = (updater) => {
    const updated = { ...data, [currentMonth]: updater({ ...month, trips: [...month.trips] }) };
    setData(updated);
    save(updated);
  };

  // ── Calculation ──
  const calcSummary = () => {
    const shares = {};
    partners.forEach((p) => (shares[p] = 0));
    let totalFuel = 0, totalExtraFares = 0;
    const oneWayFares = month.oneWayFares || {};

    month.trips.forEach((trip) => {
      if (!trip.fuelCost) return;
      totalFuel += trip.fuelCost;
      const { extraAM, extraPM } = tripExtras(trip);
      totalExtraFares += extraAM + extraPM;
      const s = splitTrip({ ...tripCosts(trip), travelers: trip.travelers, extraAM, extraPM, owFares: oneWayFares });
      Object.entries(s).forEach(([p, v]) => { shares[p] = (shares[p] || 0) + v; });
    });

    const deposits = month.deposits || {};
    const totalDeposits = Object.values(deposits).reduce((a, b) => a + b, 0);
    const preExisting = month.preExistingBalance || 0;
    const cf = month.carryForward || {};

    const settlement = {};
    partners.forEach((p) => {
      const deposited = deposits[p] || 0;
      const owed = (shares[p] || 0) + (cf[p] || 0);
      settlement[p] = { deposited, owedThisMonth: shares[p] || 0, carryOver: cf[p] || 0, owed, diff: deposited - owed };
    });

    const accountBalance = preExisting + totalDeposits - totalFuel + totalExtraFares;
    return { shares, totalFuel, totalExtraFares, totalDeposits, preExisting, settlement, accountBalance, balanceIntact: accountBalance >= preExisting };
  };

  const summary = calcSummary();
  const monthLabel = (() => { const [y, m] = currentMonth.split("-"); return `${MONTHS[parseInt(m) - 1]} ${y}`; })();
  const prevMonth = () => { const [y, m] = currentMonth.split("-").map(Number); setCurrentMonth(getMonthKey(new Date(y, m - 2, 1))); };
  const nextMonth = () => { const [y, m] = currentMonth.split("-").map(Number); setCurrentMonth(getMonthKey(new Date(y, m, 1))); };

  const addTrip = () => {
    const isEstimate = tripForm.mode === "estimate";
    const trip = {
      id: Date.now(), date: tripForm.date, mode: tripForm.mode,
      fuelCost: parseFloat(tripForm.fuelCost) || 0,
      extraFareAM: parseFloat(tripForm.extraFareAM) || 0,
      extraFarePM: parseFloat(tripForm.extraFarePM) || 0,
      travelers: Object.keys(tripForm.travelers).length > 0 ? { ...tripForm.travelers } : { Ahmad: "both" },
      ...(isEstimate
        ? { sharedCost: parseFloat(tripForm.sharedCost) || 0 }
        : { totalKm: parseFloat(tripForm.totalKm) || 0, sharedKm: parseFloat(tripForm.sharedKm) || DEFAULT_SHARED_KM }),
    };
    if (!trip.fuelCost) return;
    if (!isEstimate && !trip.totalKm) return;
    if (isEstimate && !trip.sharedCost) return;
    updateMonth((m) => ({ ...m, trips: [...m.trips, trip].sort((a, b) => a.date.localeCompare(b.date)) }));
    setTripForm({ mode: tripForm.mode, date: new Date().toISOString().slice(0, 10), totalKm: "", fuelCost: "", sharedKm: DEFAULT_SHARED_KM, sharedCost: "", extraFareAM: "", extraFarePM: "", travelers: {} });
    setView("trips");
  };

  const deleteTrip = (id) => updateMonth((m) => ({ ...m, trips: m.trips.filter((t) => t.id !== id) }));

  const saveSetup = () => {
    updateMonth((m) => ({
      ...m,
      preExistingBalance: parseFloat(setupForm.preExistingBalance) || 0,
      deposits: { ...setupForm.deposits },
      carryForward: { ...setupForm.carryForward },
      oneWayFares: { ...setupForm.oneWayFares },
    }));
    setView("trips");
  };

  const openSetup = () => {
    setSetupForm({
      preExistingBalance: month.preExistingBalance || 0,
      deposits: { ...(month.deposits || {}) },
      carryForward: { ...(month.carryForward || {}) },
      oneWayFares: { ...(month.oneWayFares || {}) },
    });
    setView("setup");
  };

  const addPartner = () => {
    const name = newPartner.trim();
    if (!name || partners.includes(name)) return;
    const np = [...partners, name];
    setPartners(np);
    save(data, np);
    setNewPartner("");
  };

  const removePartner = (p) => {
    if (p === "Ahmad") return;
    const np = partners.filter((x) => x !== p);
    setPartners(np);
    save(data, np);
  };

  const toggleTraveler = (p) => {
    setTripForm((f) => {
      const cur = f.travelers[p];
      const nw = { ...f.travelers };
      // Cycle: absent -> both -> morning only -> return only -> absent
      if (!cur) nw[p] = "both";
      else if (cur === "both") nw[p] = "morning";
      else if (cur === "morning" || cur === "one") nw[p] = "return";
      else delete nw[p];
      return { ...f, travelers: nw };
    });
  };

  const inp = { ...S.input, background: t.bg, color: t.text, borderColor: t.borderInput };
  const lbl = { ...S.label, color: t.textSec };

  return (
    <div style={{ ...S.container, background: t.bg, color: t.text }}>
      {/* Header */}
      <div style={{ padding: "20px 16px 12px", borderBottom: `1px solid ${t.border}` }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>⛽ Fuel Tracker</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => setView("partners")} style={{ ...S.iconBtn, color: t.textSec }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
            </button>
            <button onClick={onDisconnect} style={{ ...S.iconBtn, fontSize: 11, color: "#ef4444" }}>✕ DB</button>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <button onClick={prevMonth} style={{ ...S.navBtn, borderColor: t.border, color: t.text }}>‹</button>
          <span style={{ fontSize: 15, fontWeight: 600 }}>{monthLabel}</span>
          <button onClick={nextMonth} style={{ ...S.navBtn, borderColor: t.border, color: t.text }}>›</button>
        </div>
        {error && <div style={{ color: "#ef4444", fontSize: 12, marginTop: 6 }}>{error}</div>}
      </div>

      {/* Stats */}
      {view !== "partners" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, padding: "12px 16px" }}>
          <div style={{ background: t.bgSec, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ ...S.statLabel, color: t.textSec }}>Fuel Spent</span>
            <span style={S.statValue}>{formatRs(summary.totalFuel)}</span>
          </div>
          <div style={{ background: t.bgSec, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ ...S.statLabel, color: t.textSec }}>Pre-Balance</span>
            <span style={{ ...S.statValue, color: summary.balanceIntact ? "#22c55e" : "#ef4444" }}>
              {summary.balanceIntact ? "Safe" : "Short!"}
            </span>
          </div>
          <div style={{ background: t.bgSec, borderRadius: 8, padding: "10px 12px", display: "flex", flexDirection: "column", gap: 2 }}>
            <span style={{ ...S.statLabel, color: t.textSec }}>Trips</span>
            <span style={S.statValue}>{month.trips.length}</span>
          </div>
        </div>
      )}

      {/* Tabs */}
      {view !== "partners" && (
        <div style={{ display: "flex", padding: "0 16px", borderBottom: `1px solid ${t.border}` }}>
          {[["trips", "Trips"], ["add", "+ Add"], ["setup", "Setup"], ["summary", "Summary"]].map(([k, label]) => (
            <button key={k} onClick={() => (k === "setup" ? openSetup() : setView(k))}
              style={{
                flex: 1, padding: "10px 0", background: "none", border: "none",
                borderBottom: view === k ? "2px solid #2563eb" : "2px solid transparent",
                cursor: "pointer", fontSize: 13, textAlign: "center",
                fontWeight: view === k ? 600 : 500,
                color: view === k ? t.text : t.textSec,
              }}>
              {label}
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: "12px 16px 80px" }}>

        {/* TRIPS */}
        {view === "trips" && (
          month.trips.length === 0
            ? <p style={{ textAlign: "center", color: t.textSec, marginTop: 40, fontSize: 14 }}>No trips yet. Tap "+ Add" to start.</p>
            : month.trips.map((trip) => {
              const isEst = trip.mode === "estimate";
              const te = Object.entries(trip.travelers);

              let perKm, sharedKm, personalKm, sharedCost, personalCost;
              if (isEst) {
                sharedCost = trip.sharedCost || 0;
                personalCost = trip.fuelCost - sharedCost;
              } else {
                perKm = trip.fuelCost / trip.totalKm;
                sharedKm = Math.min(trip.sharedKm, trip.totalKm);
                personalKm = trip.totalKm - sharedKm;
              }

              return (
                <div key={trip.id} style={{ background: t.bgSec, borderRadius: 10, padding: "12px 14px", marginBottom: 8, position: "relative" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div>
                      <span style={{ fontSize: 14, fontWeight: 600, display: "block" }}>
                        {formatDate(trip.date)}
                        {isEst && <span style={{ fontSize: 10, color: "#f59e0b", marginLeft: 6, fontWeight: 500 }}>EST</span>}
                      </span>
                      <span style={{ fontSize: 12, color: t.textSec, marginTop: 2, display: "block" }}>
                        {te.map(([p, m]) => p + MODE_TAG[normMode(m)]).join(", ")}
                      </span>
                    </div>
                    <button onClick={() => deleteTrip(trip.id)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 18, padding: "0 4px" }}>×</button>
                  </div>
                  <div style={{ display: "flex", gap: 6, fontSize: 13, marginTop: 8, color: t.textSec }}>
                    {!isEst && <><span>{trip.totalKm} km</span><span style={{ opacity: 0.4 }}>•</span></>}
                    <span>{formatRs(trip.fuelCost)}</span>
                    {!isEst && <><span style={{ opacity: 0.4 }}>•</span><span>{formatRs(perKm)}/km</span></>}
                    {isEst && <><span style={{ opacity: 0.4 }}>•</span><span>Shared: {formatRs(sharedCost)}</span></>}
                    {(() => { const { extraAM, extraPM } = tripExtras(trip); return <>
                      {extraAM > 0 && <><span style={{ opacity: 0.4 }}>•</span><span style={{ color: "#22c55e" }}>+{formatRs(extraAM)} AM pickup</span></>}
                      {extraPM > 0 && <><span style={{ opacity: 0.4 }}>•</span><span style={{ color: "#22c55e" }}>+{formatRs(extraPM)} PM pickup</span></>}
                    </>; })()}
                  </div>
                  {isEst && personalCost > 0 && <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 6, fontWeight: 500 }}>Personal: {formatRs(personalCost)}</div>}
                  {!isEst && personalKm > 0 && <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 6, fontWeight: 500 }}>Personal: {personalKm} km ({formatRs(personalKm * perKm)})</div>}
                  <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
                    {(() => {
                      const { extraAM, extraPM } = tripExtras(trip);
                      const s = splitTrip({ ...tripCosts(trip), travelers: trip.travelers, extraAM, extraPM, owFares: month.oneWayFares });
                      return te.map(([p]) => (
                        <span key={p} style={{ fontSize: 12, background: t.card, border: `1px solid ${t.border}`, borderRadius: 6, padding: "3px 8px", fontWeight: 500 }}>{p}: {formatRs(s[p] || 0)}</span>
                      ));
                    })()}
                  </div>
                </div>
              );
            })
        )}

        {/* ADD */}
        {view === "add" && (
          <div style={{ background: t.bgSec, borderRadius: 12, padding: 16 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>Log Trip</h2>

            {/* Mode Toggle */}
            <div style={{ display: "flex", gap: 0, marginBottom: 16, borderRadius: 8, overflow: "hidden", border: `1px solid ${t.border}` }}>
              {[["exact", "Exact (km)"], ["estimate", "Estimate (Rs)"]].map(([m, label]) => (
                <button key={m} onClick={() => setTripForm((f) => ({ ...f, mode: m }))}
                  style={{
                    flex: 1, padding: "8px 0", border: "none", cursor: "pointer", fontSize: 13, fontWeight: 600,
                    background: tripForm.mode === m ? "#2563eb" : t.bg,
                    color: tripForm.mode === m ? "#fff" : t.textSec,
                  }}>
                  {label}
                </button>
              ))}
            </div>

            <label style={lbl}>Date</label>
            <input type="date" value={tripForm.date} onChange={(e) => setTripForm((f) => ({ ...f, date: e.target.value }))} style={inp} />

            {tripForm.mode === "exact" ? (
              <>
                <label style={lbl}>Total KM (trip meter)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 100" value={tripForm.totalKm} onChange={(e) => setTripForm((f) => ({ ...f, totalKm: e.target.value }))} style={inp} />
                <label style={lbl}>Fuel Cost (Rs)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 2500" value={tripForm.fuelCost} onChange={(e) => setTripForm((f) => ({ ...f, fuelCost: e.target.value }))} style={inp} />
                <label style={lbl}>Shared Route KM (default 93)</label>
                <input type="number" inputMode="decimal" value={tripForm.sharedKm} onChange={(e) => setTripForm((f) => ({ ...f, sharedKm: e.target.value }))} style={inp} />
              </>
            ) : (
              <>
                <label style={lbl}>Total Fuel Cost (Rs)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 3000" value={tripForm.fuelCost} onChange={(e) => setTripForm((f) => ({ ...f, fuelCost: e.target.value }))} style={inp} />
                <label style={lbl}>Shared Amount to Split (Rs)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 2400" value={tripForm.sharedCost} onChange={(e) => setTripForm((f) => ({ ...f, sharedCost: e.target.value }))} style={inp} />
                {tripForm.fuelCost && tripForm.sharedCost && parseFloat(tripForm.fuelCost) > parseFloat(tripForm.sharedCost) && (
                  <div style={{ fontSize: 12, color: "#f59e0b", marginTop: -8, marginBottom: 12 }}>
                    Your personal: {formatRs(parseFloat(tripForm.fuelCost) - parseFloat(tripForm.sharedCost))}
                  </div>
                )}
              </>
            )}

            <label style={lbl}>Who traveled? (tap: absent → both → AM only → PM only)</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              {partners.map((p) => {
                const mode = normMode(tripForm.travelers[p]);
                const color = { both: "#2563eb", morning: "#f59e0b", return: "#8b5cf6" }[mode];
                return (
                  <button key={p} onClick={() => toggleTraveler(p)} style={{
                    padding: "8px 16px", borderRadius: 20, cursor: "pointer", fontSize: 14, fontWeight: 500,
                    border: `1px solid ${color || t.borderInput}`,
                    background: color || t.bg,
                    color: color ? "#fff" : t.text,
                  }}>
                    {p}{mode ? MODE_TAG[mode] : ""}
                  </button>
                );
              })}
            </div>

            <label style={lbl}>Extra passenger fare — morning (Rs, optional)</label>
            <input type="number" inputMode="decimal" placeholder="e.g. 400" value={tripForm.extraFareAM} onChange={(e) => setTripForm((f) => ({ ...f, extraFareAM: e.target.value }))} style={inp} />
            <label style={lbl}>Extra passenger fare — return (Rs, optional)</label>
            <input type="number" inputMode="decimal" placeholder="e.g. 400" value={tripForm.extraFarePM} onChange={(e) => setTripForm((f) => ({ ...f, extraFarePM: e.target.value }))} style={inp} />

            {/* Preview */}
            {(() => {
              const fc = parseFloat(tripForm.fuelCost) || 0;
              if (!fc || !Object.keys(tripForm.travelers).length) return null;
              const draft = {
                mode: tripForm.mode, fuelCost: fc,
                sharedCost: parseFloat(tripForm.sharedCost) || 0,
                totalKm: parseFloat(tripForm.totalKm) || 0,
                sharedKm: parseFloat(tripForm.sharedKm) || DEFAULT_SHARED_KM,
              };
              if (draft.mode === "estimate" && !draft.sharedCost) return null;
              if (draft.mode === "exact" && !draft.totalKm) return null;
              const costs = tripCosts(draft);
              const extraAM = parseFloat(tripForm.extraFareAM) || 0;
              const extraPM = parseFloat(tripForm.extraFarePM) || 0;
              const s = splitTrip({ ...costs, travelers: tripForm.travelers, extraAM, extraPM, owFares: month.oneWayFares });
              return (
                <div style={{ background: t.bg, border: `1px solid ${t.border}`, borderRadius: 8, padding: 12, marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", color: t.textSec, marginBottom: 8 }}>Split Preview</div>
                  {Object.entries(tripForm.travelers).map(([p, m]) => (
                    <div key={p} style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0" }}><span>{p}{MODE_TAG[normMode(m)]}</span><span style={{ fontWeight: 600 }}>{formatRs(s[p] || 0)}</span></div>
                  ))}
                  {extraAM > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0", color: "#22c55e" }}><span>Extra passenger (AM)</span><span style={{ fontWeight: 600 }}>{formatRs(extraAM)}</span></div>}
                  {extraPM > 0 && <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "3px 0", color: "#22c55e" }}><span>Extra passenger (PM)</span><span style={{ fontWeight: 600 }}>{formatRs(extraPM)}</span></div>}
                  {costs.personalCost > 0 && <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 4 }}>Includes Ahmad's personal: {formatRs(costs.personalCost)}</div>}
                </div>
              );
            })()}
            <button onClick={addTrip} style={S.primaryBtn}>Save Trip</button>
          </div>
        )}

        {/* SETUP */}
        {view === "setup" && (
          <div style={{ background: t.bgSec, borderRadius: 12, padding: 16 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>Month Setup</h2>
            <p style={{ fontSize: 13, color: t.textSec, marginBottom: 16 }}>Balance and deposits for {monthLabel}.</p>
            <label style={lbl}>Pre-existing Balance (Rs)</label>
            <input type="number" inputMode="decimal" value={setupForm.preExistingBalance} onChange={(e) => setSetupForm((f) => ({ ...f, preExistingBalance: e.target.value }))} style={inp} />
            <h3 style={{ fontSize: 15, fontWeight: 700, marginTop: 16, marginBottom: 12 }}>Fuel Deposits</h3>
            {partners.map((p) => (
              <div key={p} style={{ marginBottom: 10 }}>
                <label style={lbl}>{p}'s Deposit (Rs)</label>
                <input type="number" inputMode="decimal" value={setupForm.deposits[p] || ""} onChange={(e) => setSetupForm((f) => ({ ...f, deposits: { ...f.deposits, [p]: parseFloat(e.target.value) || 0 } }))} style={inp} />
              </div>
            ))}
            <h3 style={{ fontSize: 15, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Carry Forward</h3>
            <p style={{ fontSize: 13, color: t.textSec, marginBottom: 12 }}>Unpaid from previous months. 0 if settled.</p>
            {partners.map((p) => (
              <div key={p} style={{ marginBottom: 10 }}>
                <label style={lbl}>{p}'s Pending (Rs)</label>
                <input type="number" inputMode="decimal" value={setupForm.carryForward[p] || ""} onChange={(e) => setSetupForm((f) => ({ ...f, carryForward: { ...f.carryForward, [p]: parseFloat(e.target.value) || 0 } }))} style={inp} />
              </div>
            ))}
            <h3 style={{ fontSize: 15, fontWeight: 700, marginTop: 16, marginBottom: 8 }}>Single-Leg Fixed Fares</h3>
            <p style={{ fontSize: 13, color: t.textSec, marginBottom: 12 }}>Fixed amount a partner pays when they ride only one leg (AM only or PM only). Leave 0 to split that leg equally.</p>
            {partners.filter((p) => p !== "Ahmad").map((p) => (
              <div key={p} style={{ marginBottom: 10 }}>
                <label style={lbl}>{p}'s Single-Leg Fare (Rs)</label>
                <input type="number" inputMode="decimal" placeholder="e.g. 500" value={setupForm.oneWayFares[p] || ""} onChange={(e) => setSetupForm((f) => ({ ...f, oneWayFares: { ...f.oneWayFares, [p]: parseFloat(e.target.value) || 0 } }))} style={inp} />
              </div>
            ))}

            <button onClick={saveSetup} style={S.primaryBtn}>Save Setup</button>
          </div>
        )}

        {/* SUMMARY */}
        {view === "summary" && (
          <div style={{ background: t.bgSec, borderRadius: 12, padding: 16 }}>
            <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 4 }}>Month-End Summary</h2>
            <p style={{ fontSize: 13, color: t.textSec, marginBottom: 16 }}>{monthLabel} — {month.trips.length} trips</p>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: t.textSec, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${t.border}` }}>Account</div>
              <Row l="Pre-existing Balance" r={formatRs(summary.preExisting)} />
              <Row l="Total Deposits" r={formatRs(summary.totalDeposits)} />
              <Row l="Total Fuel Spent" r={formatRs(summary.totalFuel)} rc="#ef4444" />
              {summary.totalExtraFares > 0 && <Row l="Extra Fares Collected" r={formatRs(summary.totalExtraFares)} rc="#22c55e" />}
              <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 8, marginTop: 4 }}>
                <Row l="Expected Balance" r={formatRs(summary.accountBalance)} rw={700} rc={summary.balanceIntact ? "#22c55e" : "#ef4444"} />
                <Row l="Status" r={summary.balanceIntact ? `Safe (+${formatRs(summary.accountBalance - summary.preExisting)})` : `SHORT by ${formatRs(summary.preExisting - summary.accountBalance)}`} rc={summary.balanceIntact ? "#22c55e" : "#ef4444"} />
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: t.textSec, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${t.border}` }}>Settlement</div>
              {partners.map((p) => {
                const s = summary.settlement[p];
                if (!s) return null;
                return (
                  <div key={p} style={{ background: t.card, border: `1px solid ${t.border}`, borderRadius: 8, padding: 12, marginBottom: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6 }}>{p}</div>
                    <Row l="Deposited" r={formatRs(s.deposited)} />
                    <Row l="This Month" r={formatRs(s.owedThisMonth)} />
                    {s.carryOver > 0 && <Row l="Last Month Pending" r={formatRs(s.carryOver)} rc="#f59e0b" />}
                    <Row l="Total Owed" r={formatRs(s.owed)} rw={600} />
                    <div style={{ borderTop: `1px solid ${t.border}`, paddingTop: 6, marginTop: 4 }}>
                      <Row l={s.diff > 0 ? "Overpaid (refund)" : s.diff < 0 ? "Underpaid (owes)" : "Settled"} lw={600}
                        r={s.diff === 0 ? "—" : formatRs(Math.abs(s.diff))} rw={700} rc={s.diff >= 0 ? "#22c55e" : "#ef4444"} />
                    </div>
                  </div>
                );
              })}
            </div>

            {(() => {
              const owes = [], owed = [];
              partners.forEach((p) => { const d = summary.settlement[p]?.diff || 0; if (d < 0) owes.push({ name: p, amount: Math.abs(d) }); if (d > 0) owed.push({ name: p, amount: d }); });
              if (!owes.length && !owed.length) return null;
              return (
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: t.textSec, marginBottom: 8, paddingBottom: 6, borderBottom: `1px solid ${t.border}` }}>Action Required</div>
                  {owes.map((o) => <div key={o.name} style={{ padding: "10px 12px", borderRadius: 8, fontSize: 14, marginBottom: 6, background: "#fef2f2" }}><span style={{ color: "#dc2626", fontWeight: 600 }}>{o.name}</span> needs to pay <span style={{ fontWeight: 600 }}>{formatRs(o.amount)}</span></div>)}
                  {owed.map((o) => <div key={o.name} style={{ padding: "10px 12px", borderRadius: 8, fontSize: 14, marginBottom: 6, background: "#f0fdf4" }}><span style={{ color: "#16a34a", fontWeight: 600 }}>{o.name}</span> gets back <span style={{ fontWeight: 600 }}>{formatRs(o.amount)}</span></div>)}
                </div>
              );
            })()}
          </div>
        )}

        {/* PARTNERS */}
        {view === "partners" && (
          <div style={{ background: t.bgSec, borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ fontSize: 17, fontWeight: 700, marginBottom: 12 }}>Partners</h2>
              <button onClick={() => setView("trips")} style={{ ...S.iconBtn, color: t.textSec, fontSize: 18 }}>✕</button>
            </div>
            {partners.map((p) => (
              <div key={p} style={{ display: "flex", justifyContent: "space-between", padding: "10px 0", fontSize: 14 }}>
                <span style={{ fontWeight: p === "Ahmad" ? 600 : 400 }}>{p} {p === "Ahmad" ? "(you)" : ""}</span>
                {p !== "Ahmad" && <button onClick={() => removePartner(p)} style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", fontSize: 14 }}>Remove</button>}
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginTop: 12, alignItems: "center" }}>
              <input placeholder="New partner name" value={newPartner}
                onChange={(e) => setNewPartner(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addPartner()}
                style={{ ...inp, flex: 1, marginBottom: 0 }} />
              <button onClick={() => addPartner()} style={{
                padding: "10px 20px", background: "#2563eb", color: "#fff", border: "none",
                borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0,
              }}>Add</button>
            </div>
          </div>
        )}
      </div>

      {saving && <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "#1a1a1a", color: "#fff", padding: "6px 16px", borderRadius: 20, fontSize: 13, zIndex: 50 }}>Saving...</div>}
    </div>
  );
}

// ── Utility Row Component ──
function Row({ l, r, lw, rw, rc }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, padding: "4px 0" }}>
      <span style={{ fontWeight: lw || 400 }}>{l}</span>
      <span style={{ fontWeight: rw || 400, color: rc || "inherit" }}>{r}</span>
    </div>
  );
}

// ── Base Styles ──
const S = {
  container: { fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif", maxWidth: 480, margin: "0 auto", minHeight: "100vh", position: "relative" },
  iconBtn: { background: "none", border: "none", cursor: "pointer", padding: 4 },
  navBtn: { background: "none", border: "1px solid", borderRadius: 6, width: 32, height: 32, cursor: "pointer", fontSize: 18, display: "flex", alignItems: "center", justifyContent: "center" },
  statLabel: { fontSize: 11, fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.04em" },
  statValue: { fontSize: 15, fontWeight: 700 },
  label: { fontSize: 12, fontWeight: 600, display: "block", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.04em" },
  input: { width: "100%", padding: "10px 12px", border: "1px solid", borderRadius: 8, fontSize: 15, marginBottom: 12, boxSizing: "border-box", outline: "none" },
  primaryBtn: { width: "100%", padding: "12px", background: "#2563eb", color: "#ffffff", border: "none", borderRadius: 8, fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 8 },
};
