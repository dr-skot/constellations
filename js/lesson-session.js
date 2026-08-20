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

// v3 added the question's state (issue #77). v2 payloads are migrated rather than
// discarded — see stateFromV2 below.
const LESSON_SESSION_V = 3;
const LESSON_SESSION_V_MIN = 2;

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
    ...(q.choices ? { choices: q.choices } : {}),
    // The state has to survive a reload or the reload path still double-counts the
    // exposure, which is half of #77. Only a non-default state is emitted, like every
    // other optional field here: `unasked` is what a missing key means on the way back
    // in, so writing it would make serialize→restore→serialize stop being a fixed point.
    ...(q.state && q.state !== 'unasked' ? { state: q.state } : {})
  };
}

// What a v2 question's state must have been. Both paths already recorded their first ask
// by accident, in fields kept for other reasons: an identify question sets q.rotation the
// first time it renders (js/quiz.js), a find question sets q.startP / q.startFov
// (js/course.js). An answer record outranks both — that question is answered whatever its
// render fields say.
//
// This is why a v2 payload can be migrated instead of dropped, and dropping would have
// meant discarding an in-flight lesson from a tab opened before the upgrade.
function stateFromV2(q, hist) {
  if (hist) return 'answered';
  if (q.rotation != null || q.startP != null) return 'asked';
  return 'unasked';
}

// Rebuild a question from its on-disk form, resolving abbr against the catalog.
// Returns null if the constellation is unknown (caller treats that as a whole-
// session failure, matching the original length-mismatch guard).
function questionFromJSON(q, catalog, state) {
  const con = catalog.find(c => c.abbr === q.abbr);
  if (!con) return null;
  return { con, type: q.type, mode: q.mode,
           answerMode: q.answerMode,
           ...(q.distanceLevel != null ? { distanceLevel: q.distanceLevel } : {}),
           ...(q.noBounds ? { noBounds: true } : {}),
           ...(q.rotation != null ? { rotation: q.rotation } : {}),
           ...(q.startP ? { startP: q.startP, startFov: q.startFov } : {}),
           ...(q.choices ? { choices: q.choices } : {}),
           state: state || q.state || 'unasked' };
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
  if (!data || !data.lessonLabel) return null;
  if (!(data._v >= LESSON_SESSION_V_MIN && data._v <= LESSON_SESSION_V)) return null;
  // A payload older than the current version predates the question state and has it
  // inferred; the current one carries it. Keyed off the constant, so the next bump does
  // not silently leave this reading "migrate from v3 too".
  const migrate = data._v < LESSON_SESSION_V;
  const questions = data.questions
    .map((q, i) => questionFromJSON(q, catalog,
      migrate ? stateFromV2(q, (data.history || [])[i]) : null))
    .filter(Boolean);
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
