// ═══════════════════════════════════════════════════════════
// LESSON SESSION — pure persistence round-trip
// ═══════════════════════════════════════════════════════════
//
// The single home for turning an in-flight lesson session into its plain
// sessionStorage payload and back. Pure obj↔obj: no sessionStorage, no DOM.
// The quiz.js adapter (saveLessonSession / tryResumeLesson) owns storage and the
// toggle-group application; this module owns the shape, the versioning, the
// con↔abbr conversion, and the optional per-question fields — so those live once
// instead of being duplicated across save and resume.

const LESSON_SESSION_V = 2;

// Serialize a question to its on-disk form (con → abbr; only present optional
// fields are emitted, preserving the historical key order for byte-stability).
function questionToJSON(q) {
  return {
    abbr: q.con.abbr, type: q.type, mode: q.mode,
    answerMode: q.answerMode,
    ...(q.distanceLevel != null ? { distanceLevel: q.distanceLevel } : {}),
    ...(q.noBounds ? { noBounds: true } : {}),
    ...(q.rotation != null ? { rotation: q.rotation } : {}),
    ...(q.startP ? { startP: q.startP, startFov: q.startFov } : {}),
    ...(q.choices ? { choices: q.choices } : {})
  };
}

// Rebuild a question from its on-disk form, resolving abbr against the catalog.
// Returns null if the constellation is unknown (caller treats that as a whole-
// session failure, matching the original length-mismatch guard).
function questionFromJSON(q, catalog) {
  const con = catalog.find(c => c.abbr === q.abbr);
  if (!con) return null;
  return { con, type: q.type, mode: q.mode,
           answerMode: q.answerMode,
           ...(q.distanceLevel != null ? { distanceLevel: q.distanceLevel } : {}),
           ...(q.noBounds ? { noBounds: true } : {}),
           ...(q.rotation != null ? { rotation: q.rotation } : {}),
           ...(q.startP ? { startP: q.startP, startFov: q.startFov } : {}),
           ...(q.choices ? { choices: q.choices } : {}) };
}

// Live session (+ optional reveal states) → the plain sessionStorage payload.
function sessionToJSON(session, revState, eqRevState) {
  return {
    _v: LESSON_SESSION_V,
    lessonLabel: session.lessonLabel,
    questions: session.questions.map(questionToJSON),
    idx: session.idx,
    correct: session.correct,
    revState: revState ? { ...revState } : undefined,
    eqRevState: eqRevState ? { ...eqRevState } : undefined,
    history: (session.history || []).map(h => h ? {
      ...h,
      chosen: h.chosen?.abbr || null,
      choices: (h.choices || []).map(c => c?.abbr || c)
    } : null)
  };
}

// Payload + catalog → restored session fields, or null if the payload is unusable
// (wrong version, missing label, or any question whose abbr does not resolve).
// The returned object carries exactly what the adapter applies to its globals:
// the reconstructed session pieces plus the two reveal states (possibly undefined).
function sessionFromJSON(data, catalog) {
  if (!data || !data.lessonLabel || data._v !== LESSON_SESSION_V) return null;
  const questions = data.questions.map(q => questionFromJSON(q, catalog)).filter(Boolean);
  if (questions.length !== data.questions.length) return null;
  const history = (data.history || []).map(h => {
    if (!h) return null;
    return {
      ...h,
      chosen: typeof h.chosen === 'string' ? catalog.find(c => c.abbr === h.chosen) || null : h.chosen,
      choices: (h.choices || []).map(c => typeof c === 'string' ? catalog.find(con => con.abbr === c) || c : c)
    };
  });
  return {
    lessonLabel: data.lessonLabel,
    questions,
    idx: data.idx,
    correct: data.correct,
    history,
    revState: data.revState,
    eqRevState: data.eqRevState,
  };
}
