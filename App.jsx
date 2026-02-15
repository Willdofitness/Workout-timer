import React, { useEffect, useMemo, useRef, useState } from "react";

// Gym Rest Timer + Set Tracker (single-file React component)
// - Track sets per exercise
// - Auto-start rest timer on "SET DONE"
// - Logs rest per set (logged on Exercise Done / Finished)
// - LocalStorage persistence
// - Finished modal summary
// - Create printable report page (user taps Print -> Save as PDF)

const LS_KEY = "gym_timer_v1";

function nowMs() {
  return Date.now();
}

function formatSeconds(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}:${String(r).padStart(2, "0")}`;
}

function clamp(n, min, max) {
  const x = Number(n);
  if (Number.isNaN(x)) return min;
  return Math.max(min, Math.min(max, x));
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function defaultState() {
  const firstId = uid();
  return {
    sessionId: uid(),
    clientName: "",
    createdAt: new Date().toISOString(),
    activeExerciseId: firstId,
    exercises: {
      [firstId]: {
        id: firstId,
        name: "Exercise 1",
        targetRestSec: 90,
        sets: [], // { setNumber, completedAtISO, reps, weight, restSec }
        currentRest: {
          running: false,
          startedAtMs: null, // number (ms epoch) | number negative (paused elapsed ms) | null
        },
        notes: "",
      },
    },
    exerciseOrder: [firstId],
  };
}

export default function App() {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return defaultState();
      const parsed = JSON.parse(raw);
      if (!parsed?.exercises || !parsed?.activeExerciseId) return defaultState();
      if (!Array.isArray(parsed.exerciseOrder) || parsed.exerciseOrder.length === 0) return defaultState();
      return parsed;
    } catch {
      return defaultState();
    }
  });

  const [showSummary, setShowSummary] = useState(false);

  const [tick, setTick] = useState(0);
  const tickRef = useRef(null);

  // persist
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch {
      // ignore
    }
  }, [state]);

  // timer loop (1Hz)
  useEffect(() => {
    tickRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
    };
  }, []);

  const active = state.exercises[state.activeExerciseId];

  const restElapsedSec = useMemo(() => {
    if (!active?.currentRest?.running || !active.currentRest.startedAtMs) return 0;
    return (nowMs() - active.currentRest.startedAtMs) / 1000;
  }, [active?.currentRest?.running, active?.currentRest?.startedAtMs, tick]);

  const restOverTargetSec = useMemo(() => {
    const target = active?.targetRestSec ?? 0;
    return Math.max(0, Math.floor(restElapsedSec - target));
  }, [restElapsedSec, active?.targetRestSec]);

  function updateActive(patchFn) {
    setState((prev) => {
      const ex = prev.exercises[prev.activeExerciseId];
      if (!ex) return prev;
      const nextEx = patchFn(ex);
      return {
        ...prev,
        exercises: {
          ...prev.exercises,
          [prev.activeExerciseId]: nextEx,
        },
      };
    });
  }

  function setDone() {
    updateActive((ex) => {
      const setNumber = (ex.sets?.length ?? 0) + 1;
      let restSec = null;

      // If a rest was running, user probably tapped SET DONE twice quickly.
      // Finalize the running rest as the previous set's rest if it was missing.
      if (ex.currentRest?.running && ex.currentRest.startedAtMs) {
        restSec = Math.max(0, Math.round((nowMs() - ex.currentRest.startedAtMs) / 1000));
      }

      const nextSets = [...(ex.sets ?? [])];

      if (restSec != null && nextSets.length > 0) {
        const last = nextSets[nextSets.length - 1];
        if (last.restSec == null) {
          nextSets[nextSets.length - 1] = { ...last, restSec };
        }
      }

      nextSets.push({
        setNumber,
        completedAtISO: new Date().toISOString(),
        reps: "",
        weight: "",
        restSec: null,
      });

      return {
        ...ex,
        sets: nextSets,
        currentRest: {
          running: true,
          startedAtMs: nowMs(),
        },
      };
    });
  }

  function pauseRest() {
    updateActive((ex) => {
      if (!ex.currentRest?.running || !ex.currentRest.startedAtMs) return ex;
      const elapsedMs = nowMs() - ex.currentRest.startedAtMs;
      return {
        ...ex,
        currentRest: { running: false, startedAtMs: -elapsedMs },
      };
    });
  }

  function resumeRest() {
    updateActive((ex) => {
      if (ex.currentRest?.running) return ex;
      const stored = ex.currentRest?.startedAtMs;
      if (typeof stored === "number" && stored < 0) {
        const elapsedMs = -stored;
        return {
          ...ex,
          currentRest: { running: true, startedAtMs: nowMs() - elapsedMs },
        };
      }
      return {
        ...ex,
        currentRest: { running: true, startedAtMs: nowMs() },
      };
    });
  }

  function resetRest() {
    updateActive((ex) => ({
      ...ex,
      currentRest: { running: false, startedAtMs: null },
    }));
  }

  function finalizeRestForExercise(ex) {
    // If the most recent set has no rest logged yet, record the current rest timer value.
    let nextSets = ex.sets ?? [];

    if (nextSets.length > 0) {
      const lastIdx = nextSets.length - 1;
      const last = nextSets[lastIdx];

      if (last.restSec == null) {
        let elapsedSec = 0;
        if (ex.currentRest?.running && ex.currentRest.startedAtMs) {
          elapsedSec = Math.max(0, Math.round((nowMs() - ex.currentRest.startedAtMs) / 1000));
        } else if (typeof ex.currentRest?.startedAtMs === "number" && ex.currentRest.startedAtMs < 0) {
          elapsedSec = Math.max(0, Math.round((-ex.currentRest.startedAtMs) / 1000));
        }

        nextSets = nextSets.slice();
        nextSets[lastIdx] = { ...last, restSec: elapsedSec };
      }
    }

    return {
      ...ex,
      sets: nextSets,
      currentRest: { running: false, startedAtMs: null },
    };
  }

  function finishedWorkout() {
    // Finalize last rest (if needed), stop timer, then show summary.
    setState((prev) => {
      const id = prev.activeExerciseId;
      const ex = prev.exercises[id];
      if (!ex) return prev;
      return {
        ...prev,
        exercises: {
          ...prev.exercises,
          [id]: finalizeRestForExercise(ex),
        },
      };
    });
    setShowSummary(true);
  }

  function exerciseDone() {
    // Finalize active, then switch to next; if last exercise, create a new one inheriting rest.
    setState((prev) => {
      const currentId = prev.activeExerciseId;
      const ex = prev.exercises[currentId];
      if (!ex) return prev;

      const finalized = finalizeRestForExercise(ex);

      const order = prev.exerciseOrder ?? [];
      const idx = order.indexOf(currentId);

      if (idx >= 0 && idx < order.length - 1) {
        const nextId = order[idx + 1];
        return {
          ...prev,
          activeExerciseId: nextId,
          exercises: { ...prev.exercises, [currentId]: finalized },
        };
      }

      const newId = uid();
      const newExercise = {
        id: newId,
        name: `Exercise ${order.length + 1}`,
        targetRestSec: finalized.targetRestSec,
        sets: [],
        currentRest: { running: false, startedAtMs: null },
        notes: "",
      };

      return {
        ...prev,
        activeExerciseId: newId,
        exercises: {
          ...prev.exercises,
          [currentId]: finalized,
          [newId]: newExercise,
        },
        exerciseOrder: [...order, newId],
      };
    });
  }

  function updateSetField(setNumber, field, value) {
    updateActive((ex) => {
      const nextSets = (ex.sets ?? []).map((s) => {
        if (s.setNumber !== setNumber) return s;
        return { ...s, [field]: value };
      });
      return { ...ex, sets: nextSets };
    });
  }

  function undoLastSet() {
    updateActive((ex) => {
      if (!ex.sets?.length) return ex;
      return { ...ex, sets: ex.sets.slice(0, -1) };
    });
  }

  function addExercise() {
    const id = uid();
    setState((prev) => {
      const name = `Exercise ${prev.exerciseOrder.length + 1}`;
      return {
        ...prev,
        activeExerciseId: id,
        exercises: {
          ...prev.exercises,
          [id]: {
            id,
            name,
            targetRestSec: 90,
            sets: [],
            currentRest: { running: false, startedAtMs: null },
            notes: "",
          },
        },
        exerciseOrder: [...prev.exerciseOrder, id],
      };
    });
  }

  function deleteExercise(id) {
    setState((prev) => {
      if (!prev.exercises[id]) return prev;
      const nextExercises = { ...prev.exercises };
      delete nextExercises[id];
      const nextOrder = prev.exerciseOrder.filter((x) => x !== id);
      const nextActive = prev.activeExerciseId === id ? (nextOrder[0] ?? null) : prev.activeExerciseId;
      if (!nextActive) return defaultState();
      return {
        ...prev,
        activeExerciseId: nextActive,
        exercises: nextExercises,
        exerciseOrder: nextOrder,
      };
    });
  }

  function resetSession() {
    setState(defaultState());
    setShowSummary(false);
  }

  const summary = useMemo(() => {
    const sets = active?.sets ?? [];
    const restValues = sets.map((s) => s.restSec).filter((v) => typeof v === "number");
    const avg = restValues.length ? restValues.reduce((a, b) => a + b, 0) / restValues.length : 0;
    return {
      sets: sets.length,
      restLogged: restValues.length,
      avgSec: avg,
    };
  }, [active?.sets]);

  const restRunning = !!active?.currentRest?.running;
  const restDisplay = restRunning
    ? formatSeconds(restElapsedSec)
    : (() => {
        const ms = active?.currentRest?.startedAtMs;
        if (typeof ms === "number" && ms < 0) return formatSeconds((-ms) / 1000);
        return "0:00";
      })();

  function copyToClipboard(text) {
    // Works across Safari/iOS better than navigator.clipboard alone.
    try {
      if (navigator.clipboard?.writeText) {
        return navigator.clipboard.writeText(text);
      }
    } catch {
      // fall through
    }

    return new Promise((resolve, reject) => {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.top = "-9999px";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) resolve();
        else reject(new Error("copy failed"));
      } catch (e) {
        reject(e);
      }
    });
  }

  function createPdfOrShare() {
    const usedExerciseIds = (state.exerciseOrder ?? []).filter(
      (id) => (state.exercises[id]?.sets ?? []).length > 0
    );

    // Plain-text fallback (includes reps + weight per set)
    const lines = [];
    lines.push(`Client: ${(state.clientName ?? "").trim() || "—"}`);
    lines.push(`Session: ${new Date(state.createdAt).toLocaleString()}`);

    for (const id of usedExerciseIds) {
      const ex = state.exercises[id];
      const sets = ex.sets ?? [];
      const restVals = sets.map((s) => s.restSec).filter((v) => typeof v === "number");
      const avg = restVals.length ? Math.round(restVals.reduce((a, b) => a + b, 0) / restVals.length) : 0;

      lines.push(`\n${ex.name} — ${sets.length} sets${restVals.length ? ` (avg rest ${formatSeconds(avg)})` : ""}`);

      for (const s of sets) {
        const reps = (s.reps ?? "").toString().trim() || "—";
        const weight = (s.weight ?? "").toString().trim() || "—";
        const rest = s.restSec == null ? "—" : formatSeconds(s.restSec);
        lines.push(`  Set ${s.setNumber}: ${reps} reps @ ${weight} | Rest ${rest}`);
      }

      if ((ex.notes ?? "").trim()) {
        lines.push(`  Notes: ${(ex.notes ?? "").trim()}`);
      }
    }

    const text = lines.join("\n");

    const esc = (str) =>
      String(str)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

    const title = "Workout Summary";
    const dateLine = esc(new Date(state.createdAt).toLocaleString());
    const clientHtmlLine = esc((state.clientName ?? "").trim() || "—");

    const blocks = usedExerciseIds
      .map((id) => {
        const ex = state.exercises[id];
        const sets = ex.sets ?? [];
        const restVals = sets.map((s) => s.restSec).filter((v) => typeof v === "number");
        const avg = restVals.length ? Math.round(restVals.reduce((a, b) => a + b, 0) / restVals.length) : 0;

        const rows = sets
          .map((s) => {
            const reps = esc((s.reps ?? "").toString().trim() || "—");
            const weight = esc((s.weight ?? "").toString().trim() || "—");
            const rest = esc(s.restSec == null ? "—" : formatSeconds(s.restSec));
            return `
              <tr>
                <td>${s.setNumber}</td>
                <td>${reps}</td>
                <td>${weight}</td>
                <td>${rest}</td>
              </tr>`;
          })
          .join("\n");

        const notes = (ex.notes ?? "").trim();
        const notesHtml = notes
          ? `<div class="notes"><div class="label">Notes</div><div class="text">${esc(notes).replaceAll(
              "\n",
              "<br/>"
            )}</div></div>`
          : "";

        return `
          <section class="card">
            <div class="exTitle">${esc(ex.name)}</div>
            <div class="meta">${sets.length} sets${restVals.length ? ` · Avg rest ${esc(formatSeconds(avg))}` : ""}</div>
            <table>
              <thead>
                <tr>
                  <th>Set</th><th>Reps</th><th>Weight</th><th>Rest</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
            ${notesHtml}
          </section>`;
      })
      .join("\n");

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <style>
    @page { margin: 14mm; }
    body { font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #111; }
    .topbar { position: sticky; top: 0; background: #fff; border-bottom: 1px solid #eee; padding: 10px 0; margin-bottom: 14px; }
    .wrap { max-width: 820px; margin: 0 auto; padding: 0 12px; }
    .btns { display: flex; gap: 8px; flex-wrap: wrap; }
    button { appearance: none; border: 0; border-radius: 10px; padding: 10px 12px; background: #111; color: #fff; font-weight: 600; }
    button.secondary { background: #e5e7eb; color: #111; }
    h1 { margin: 0 0 6px 0; font-size: 20px; }
    .sub { margin: 0 0 14px 0; color: #444; font-size: 12px; }
    .hint { margin-top: 8px; color: #555; font-size: 12px; }
    .grid { display: grid; gap: 10px; }
    .card { border: 1px solid #e5e7eb; border-radius: 12px; padding: 12px; page-break-inside: avoid; }
    .exTitle { font-weight: 700; font-size: 14px; margin-bottom: 2px; }
    .meta { color: #555; font-size: 12px; margin-bottom: 8px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 8px 8px; border-top: 1px solid #eee; }
    th { background: #f7f7f7; border-top: 1px solid #e5e7eb; }
    .notes { margin-top: 10px; border-top: 1px solid #eee; padding-top: 10px; }
    .notes .label { font-size: 11px; color: #555; margin-bottom: 4px; font-weight: 600; }
    .notes .text { font-size: 12px; color: #111; }
    .footer { margin-top: 14px; font-size: 10px; color: #666; }
    @media print {
      .topbar { display: none; }
      .wrap { padding: 0; }
    }
  </style>
</head>
<body>
  <div class="topbar">
    <div class="wrap">
      <div class="btns">
        <button onclick="window.print()">Print / Save as PDF</button>
        <button class="secondary" onclick="window.close()">Close</button>
      </div>
      <div class="hint">On iPhone/iPad: tap <strong>Print</strong>, then in the print preview use Share to save/send the PDF.</div>
    </div>
  </div>

  <div class="wrap">
    <h1>${esc(title)}</h1>
    <p class="sub"><strong>Client:</strong> ${clientHtmlLine}<br/><strong>Date:</strong> ${dateLine}</p>
    <div class="grid">
      ${blocks || `<div class="card">No exercises recorded.</div>`}
    </div>
    <div class="footer">Generated by Workout Timer</div>
  </div>
</body>
</html>`;

    // Prefer Blob URL over document.write (more reliable on iOS/Safari)
    try {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w) {
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return;
      }
      URL.revokeObjectURL(url);
    } catch {
      // fall through
    }

    // If popups blocked, prefer share sheet (best for iOS)
    if (navigator.share) {
      navigator.share({ title: "Workout Summary", text }).catch(() => {});
      return;
    }

    copyToClipboard(text)
      .then(() => alert("Summary copied. You can paste it into Notes / Messages."))
      .catch(() => alert("Couldn’t open the report. Please allow popups for this site."));
  }

  const usedExercisesCount = useMemo(() => {
    return (state.exerciseOrder ?? []).filter((id) => (state.exercises[id]?.sets ?? []).length > 0).length;
  }, [state]);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="mx-auto max-w-3xl p-4 sm:p-6">
        {showSummary && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
            <div className="w-full max-w-2xl rounded-3xl bg-zinc-950 ring-1 ring-zinc-800">
              <div className="flex items-center justify-between border-b border-zinc-800 p-4">
                <div>
                  <div className="text-sm text-zinc-400">Session summary</div>
                  <div className="text-lg font-semibold">Workout completed</div>
                </div>
                <button
                  onClick={() => setShowSummary(false)}
                  className="rounded-2xl bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
                >
                  Close
                </button>
              </div>

              <div className="max-h-[70vh] overflow-auto p-4">
                <div className="text-sm text-zinc-400">{new Date(state.createdAt).toLocaleString()}</div>

                {usedExercisesCount === 0 ? (
                  <div className="mt-4 rounded-3xl bg-zinc-900 p-4 text-sm text-zinc-300 ring-1 ring-zinc-800">
                    No exercises recorded yet.
                  </div>
                ) : (
                  <div className="mt-4 flex flex-col gap-3">
                    {state.exerciseOrder
                      .filter((id) => (state.exercises[id]?.sets ?? []).length > 0)
                      .map((id) => {
                        const ex = state.exercises[id];
                        const sets = ex.sets ?? [];
                        const restVals = sets.map((s) => s.restSec).filter((v) => typeof v === "number");
                        const avg = restVals.length
                          ? Math.round(restVals.reduce((a, b) => a + b, 0) / restVals.length)
                          : 0;

                        return (
                          <div key={id} className="rounded-3xl bg-zinc-900 p-4 ring-1 ring-zinc-800">
                            <div className="min-w-0 flex flex-col">
                              <div className="truncate text-base font-semibold">{ex.name}</div>
                              <div className="mt-1 text-sm text-zinc-400">
                                {sets.length} sets{restVals.length ? ` · Avg rest ${formatSeconds(avg)}` : ""}
                              </div>
                            </div>

                            <div className="mt-3 overflow-hidden rounded-2xl ring-1 ring-zinc-800">
                              <table className="w-full text-left text-sm">
                                <thead className="bg-zinc-950/60">
                                  <tr className="text-zinc-300">
                                    <th className="px-3 py-2">Set</th>
                                    <th className="px-3 py-2">Reps</th>
                                    <th className="px-3 py-2">Weight</th>
                                    <th className="px-3 py-2">Rest</th>
                                  </tr>
                                </thead>
                                <tbody className="bg-zinc-900">
                                  {sets.map((s) => (
                                    <tr key={s.setNumber} className="border-t border-zinc-800">
                                      <td className="px-3 py-2 font-medium">{s.setNumber}</td>
                                      <td className="px-3 py-2">{s.reps || "—"}</td>
                                      <td className="px-3 py-2">{s.weight || "—"}</td>
                                      <td className="px-3 py-2 tabular-nums">
                                        {s.restSec == null ? "—" : formatSeconds(s.restSec)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {(ex.notes ?? "").trim().length > 0 && (
                              <div className="mt-3 rounded-2xl bg-zinc-950/40 p-3 text-sm text-zinc-200 ring-1 ring-zinc-800">
                                <div className="text-xs text-zinc-400">Notes</div>
                                <div className="mt-1 whitespace-pre-wrap">{ex.notes}</div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-800 p-4">
                <button
                  onClick={createPdfOrShare}
                  className="rounded-2xl bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
                >
                  Create PDF / Share
                </button>

                <button
                  onClick={resetSession}
                  className="rounded-2xl bg-red-600 px-3 py-2 text-sm hover:bg-red-500"
                >
                  New Session
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <label className="text-xs text-zinc-400">Client name</label>
            <input
              value={state.clientName ?? ""}
              onChange={(e) => setState((p) => ({ ...p, clientName: e.target.value }))}
              className="mt-1 w-full rounded-2xl bg-zinc-950/60 px-3 py-2 text-base outline-none ring-1 ring-zinc-800 focus:ring-zinc-600"
              placeholder="e.g., Will Bright"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={createPdfOrShare}
              className="rounded-2xl bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
            >
              Create PDF / Share
            </button>

            <button
              onClick={resetSession}
              className="rounded-2xl bg-red-600 px-3 py-2 text-sm hover:bg-red-500"
            >
              New Session
            </button>
          </div>
        </header>

        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {/* Exercise list */}
          <div className="rounded-3xl bg-zinc-900 p-4 sm:col-span-1">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">Exercises</h2>
              <button onClick={addExercise} className="rounded-2xl bg-zinc-800 px-3 py-1.5 text-sm hover:bg-zinc-700">
                + Add
              </button>
            </div>

            <div className="mt-3 flex flex-col gap-2">
              {state.exerciseOrder.map((id) => {
                const ex = state.exercises[id];
                const isActive = id === state.activeExerciseId;
                return (
                  <button
                    key={id}
                    onClick={() => setState((p) => ({ ...p, activeExerciseId: id }))}
                    className={
                      "rounded-2xl p-3 text-left transition " +
                      (isActive ? "bg-zinc-800 ring-1 ring-zinc-600" : "bg-zinc-950/40 hover:bg-zinc-800/60")
                    }
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex flex-col justify-between">
                        <div className="truncate text-sm font-medium">{ex.name}</div>
                        <div className="text-xs text-zinc-400">{(ex.sets ?? []).length} sets</div>
                      </div>
                      {state.exerciseOrder.length > 1 && (
                        <span
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            deleteExercise(id);
                          }}
                          className="rounded-xl bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
                          title="Delete"
                        >
                          ✕
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active exercise */}
          <div className="rounded-3xl bg-zinc-900 p-4 sm:col-span-2">
            {!active ? (
              <div className="text-zinc-300">No active exercise.</div>
            ) : (
              <>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex-1">
                    <label className="text-xs text-zinc-400">Exercise</label>
                    <div className="relative mt-1">
                      <input
                        value={active.name}
                        onChange={(e) => updateActive((ex) => ({ ...ex, name: e.target.value }))}
                        onFocus={(e) => {
                          // Fast rename: tap once, type to replace.
                          // If it's still a default name like "Exercise 1", select all.
                          const v = e.currentTarget.value || "";
                          if (/^Exercise\s+\d+$/i.test(v.trim())) e.currentTarget.select();
                        }}
                        className="w-full rounded-2xl bg-zinc-950/60 px-3 py-2 pr-16 text-base outline-none ring-1 ring-zinc-800 focus:ring-zinc-600"
                        placeholder="e.g., Incline DB Press"
                      />
                      <button
                        type="button"
                        onClick={() => updateActive((ex) => ({ ...ex, name: "" }))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 rounded-xl bg-zinc-800 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-700"
                        title="Clear name"
                      >
                        Clear
                      </button>
                    </div>
                  </div>

                  <div className="w-full sm:w-44">
                    <label className="text-xs text-zinc-400">Target rest (sec)</label>
                    <input
                      type="number"
                      value={active.targetRestSec}
                      onChange={(e) => {
                        const v = clamp(e.target.value || 0, 0, 3600);
                        updateActive((ex) => ({ ...ex, targetRestSec: v }));
                      }}
                      className="mt-1 w-full rounded-2xl bg-zinc-950/60 px-3 py-2 text-base outline-none ring-1 ring-zinc-800 focus:ring-zinc-600"
                    />
                  </div>
                </div>

                {/* Timer */}
                <div className="mt-5 rounded-3xl bg-zinc-950/50 p-4 ring-1 ring-zinc-800">
                  <div className="flex items-stretch justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs text-zinc-400">Rest timer</div>
                      <div className="mt-1 text-5xl font-semibold tabular-nums">{restDisplay}</div>
                      <div className="mt-1 text-sm text-zinc-400">
                        Target: {formatSeconds(active.targetRestSec)}
                        {restOverTargetSec > 0 ? (
                          <span className="ml-2 text-red-400">+{formatSeconds(restOverTargetSec)}</span>
                        ) : null}
                      </div>

                      <button
                        onClick={finishedWorkout}
                        className="mt-6 w-full rounded-2xl bg-zinc-800 px-4 py-3 text-base font-semibold hover:bg-zinc-700"
                      >
                        Finished
                      </button>
                    </div>

                    <div className="flex flex-col gap-2">
                      <button
                        onClick={setDone}
                        className="rounded-2xl bg-emerald-600 px-6 py-4 text-lg font-semibold hover:bg-emerald-500"
                      >
                        SET DONE
                      </button>

                      <div className="flex gap-2">
                        {restRunning ? (
                          <button
                            onClick={pauseRest}
                            className="flex-1 rounded-2xl bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
                          >
                            Pause
                          </button>
                        ) : (
                          <button
                            onClick={resumeRest}
                            className="flex-1 rounded-2xl bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
                          >
                            Resume
                          </button>
                        )}
                        <button
                          onClick={resetRest}
                          className="flex-1 rounded-2xl bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
                        >
                          Reset
                        </button>
                        <button
                          onClick={undoLastSet}
                          className="flex-1 rounded-2xl bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
                        >
                          Undo
                        </button>
                      </div>

                      <button
                        onClick={exerciseDone}
                        className="w-full rounded-2xl bg-red-600 px-4 py-3 text-base font-semibold hover:bg-red-500"
                      >
                        Exercise Done
                      </button>
                    </div>
                  </div>
                </div>

                {/* Sets table */}
                <div className="mt-5 rounded-3xl bg-zinc-950/40 p-4 ring-1 ring-zinc-800">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold">Sets</h3>
                    <div className="text-sm text-zinc-400">
                      {summary.sets} sets · {summary.restLogged} rests logged · Avg {formatSeconds(summary.avgSec)}
                    </div>
                  </div>

                  <div className="mt-3 overflow-hidden rounded-2xl ring-1 ring-zinc-800">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-zinc-900">
                        <tr className="text-zinc-300">
                          <th className="px-3 py-2">Set</th>
                          <th className="px-3 py-2">Reps</th>
                          <th className="px-3 py-2">Weight</th>
                          <th className="px-3 py-2">Rest</th>
                        </tr>
                      </thead>
                      <tbody className="bg-zinc-950/40">
                        {(active.sets ?? []).length === 0 ? (
                          <tr>
                            <td className="px-3 py-3 text-zinc-400" colSpan={4}>
                              Tap <span className="font-semibold text-zinc-200">SET DONE</span> after each set.
                            </td>
                          </tr>
                        ) : (
                          (active.sets ?? []).map((s) => (
                            <tr key={s.setNumber} className="border-t border-zinc-800">
                              <td className="px-3 py-2 font-medium">{s.setNumber}</td>
                              <td className="px-3 py-2">
                                <input
                                  inputMode="numeric"
                                  value={s.reps ?? ""}
                                  onChange={(e) => updateSetField(s.setNumber, "reps", e.target.value)}
                                  className="w-20 rounded-xl bg-zinc-950/60 px-2 py-1 text-sm outline-none ring-1 ring-zinc-800 focus:ring-zinc-600"
                                  placeholder="—"
                                />
                              </td>
                              <td className="px-3 py-2">
                                <input
                                  inputMode="decimal"
                                  value={s.weight ?? ""}
                                  onChange={(e) => updateSetField(s.setNumber, "weight", e.target.value)}
                                  className="w-24 rounded-xl bg-zinc-950/60 px-2 py-1 text-sm outline-none ring-1 ring-zinc-800 focus:ring-zinc-600"
                                  placeholder="kg"
                                />
                              </td>
                              <td className="px-3 py-2">
                                {s.restSec == null ? (
                                  <span className="text-zinc-400">—</span>
                                ) : (
                                  <span className="tabular-nums">{formatSeconds(s.restSec)}</span>
                                )}
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <div className="mt-4">
                    <label className="text-xs text-zinc-400">Notes (optional)</label>
                    <textarea
                      value={active.notes}
                      onChange={(e) => updateActive((ex) => ({ ...ex, notes: e.target.value }))}
                      className="mt-1 w-full rounded-2xl bg-zinc-950/60 px-3 py-2 text-sm outline-none ring-1 ring-zinc-800 focus:ring-zinc-600"
                      rows={3}
                      placeholder="e.g., 80kg x 8,8,7 — felt heavy"
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <footer className="mt-6 text-xs text-zinc-500">Autosaves to your device (localStorage). Clearing browser data resets it.</footer>
      </div>
    </div>
  );
}

// Tiny sanity checks (run in dev; harmless in production)
console.assert(formatSeconds(0) === "0:00", "formatSeconds(0) should be 0:00");
console.assert(formatSeconds(65) === "1:05", "formatSeconds(65) should be 1:05");
console.assert(formatSeconds(125) === "2:05", "formatSeconds(125) should be 2:05");
console.assert(clamp(5, 0, 3) === 3, "clamp upper bound");
console.assert(clamp(-1, 0, 3) === 0, "clamp lower bound");
console.assert(clamp("2", 0, 3) === 2, "clamp numeric string");
console.assert(clamp("nope", 0, 3) === 0, "clamp non-numeric returns min");
