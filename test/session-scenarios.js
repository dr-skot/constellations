// Shared lesson-session scenarios for the Candidate-3 golden (capture + verify).
// Pure function of the constellation catalog C, so capture-session-golden.js and
// lesson-session.js test build identical inputs. Covers the serialize field matrix
// (optional per-question fields, reveal states, history with nulls) and the resume
// validation matrix (valid, bad version, missing label, unresolvable abbr, null).

module.exports = function buildScenarios(C) {
  const con = abbr => C.find(c => c.abbr === abbr);
  const Ori = con('Ori'), UMa = con('UMa'), Sco = con('Sco'), Cru = con('Cru'), Leo = con('Leo');

  // Inputs to saveLessonSession: the live session object + the two reveal states.
  const serializeCases = [
    {
      name: 'minimal',
      session: {
        questions: [
          { con: Ori, type: 'identify', mode: 'diagram', answerMode: 'choice' },
          { con: UMa, type: 'identify', mode: 'diagram', answerMode: 'choice' },
        ],
        idx: 0, correct: 0, history: [], lessonIdx: 0, lessonLabel: 'Minimal',
      },
      revState: undefined, eqRevState: undefined,
    },
    {
      name: 'full-fields',
      session: {
        questions: [
          { con: Sco, type: 'find', mode: 'photo', answerMode: 'choice',
            distanceLevel: 0.5, noBounds: true, rotation: 1.23,
            startP: [0.1, 0.2, 0.3], startFov: 45 },
          { con: Leo, type: 'identify', mode: 'stars', answerMode: 'autocomplete',
            rotation: 2.0, choices: [Ori, UMa, Cru] },
        ],
        idx: 1, correct: 1, lessonIdx: 0, lessonLabel: 'Full',
        history: [
          { wasCorrect: true, rotation: 1.23, chosen: Sco, choices: [Sco, Ori, UMa] },
        ],
      },
      revState: { photo: false, diagram: true, art: false, boundary: true },
      eqRevState: { photo: true, diagram: false, art: true, boundary: false },
    },
    {
      name: 'history-with-null',
      session: {
        questions: [
          { con: Cru, type: 'find', mode: 'diagram', answerMode: 'choice', noBounds: true },
          { con: Leo, type: 'identify', mode: 'photo', answerMode: 'choice' },
        ],
        idx: 1, correct: 0, lessonIdx: 0, lessonLabel: 'Hist',
        history: [null, { wasCorrect: false, rotation: 0.5, chosen: Ori, choices: [] }],
      },
      revState: { photo: true, diagram: true, art: true, boundary: true },
      eqRevState: undefined,
    },
    {
      name: 'no-lesson-skips', // lessonIdx == null → saveLessonSession must store nothing
      session: {
        questions: [{ con: Ori, type: 'identify', mode: 'diagram' }],
        idx: 0, correct: 0, history: [], lessonIdx: null, lessonLabel: '',
      },
      revState: undefined, eqRevState: undefined,
    },
  ];

  // Inputs to tryResumeLesson: a raw sessionStorage payload.
  const resumeCases = [
    { name: 'valid-min', payload: {
        _v: 2, lessonLabel: 'M',
        questions: [{ abbr: 'Ori', type: 'identify', mode: 'diagram', answerMode: 'choice' }],
        idx: 0, correct: 0, history: [] } },
    { name: 'valid-fields', payload: {
        _v: 2, lessonLabel: 'F',
        questions: [{ abbr: 'Sco', type: 'find', mode: 'photo', answerMode: 'choice',
                      distanceLevel: 0.5, noBounds: true, rotation: 1.23,
                      startP: [0.1, 0.2, 0.3], startFov: 45 }],
        idx: 0, correct: 0,
        revState: { photo: false, diagram: true, art: false, boundary: true },
        eqRevState: { photo: true, diagram: false, art: true, boundary: false },
        history: [{ wasCorrect: true, rotation: 1.23, chosen: 'Sco', choices: ['Sco', 'Ori'] }] } },
    { name: 'bad-version', payload: { _v: 1, lessonLabel: 'X', questions: [], idx: 0, correct: 0 } },
    { name: 'no-label', payload: { _v: 2, lessonLabel: '', questions: [], idx: 0, correct: 0 } },
    { name: 'missing-con', payload: {
        _v: 2, lessonLabel: 'Y',
        questions: [{ abbr: 'ZZZ', type: 'identify', mode: 'diagram' }],
        idx: 0, correct: 0, history: [] } },
    { name: 'null-payload', payload: null },
  ];

  return { serializeCases, resumeCases };
};
