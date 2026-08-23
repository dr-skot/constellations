// js/guide-exit-label.js
// What the control that leaves a finding guide should say (issue #66).
//
// It used to say "← Back" from every origin, naming none of them — and on
// find-help.html a second control said exactly the same words and meant one slide,
// not the whole guide. Two controls, one label, opposite scopes.
//
// The rule: name the destination where there is one, name the action where there
// isn't. The destinations are the routes that come back (the router's `detours`
// table) plus the find question a guide can be opened OVER, from "? Help", with no
// detour in flight. Free explore is the case with nowhere to go — the learner is
// already looking at the explorer, so the overlay is closing rather than retracing
// anything, and it says so without an arrow.
//
// Pure, and its own file for the usual reason: the wording is then testable without
// a browser (test/guide-exit-label.js) while the module that opens the guide keeps
// its fetches and its DOM.
//
//   route           the route a detour in flight returns to (detourOrigin()?.name),
//                   or null when none is in flight
//   conName         for the viewer, the constellation it was showing — the viewer's
//                   own name for itself, as its breadcrumb reads
//   lessonFindQuestion  a lesson's find question is waiting underneath — the guide
//                   saved an explorer quiz on its way in, and an explorer quiz is
//                   only ever a lesson's find question (#92). This used to read the
//                   `lessonMode` flag and be deliberately narrower than that flag's
//                   name; the flag is gone and the two now say the same thing.
function guideExitLabel({ route = null, conName = null, lessonFindQuestion = false } = {}) {
  // The unnamed-viewer case cannot be reached through the app — the router declines a
  // detour to an abbr it cannot resolve — but it is still a return to the viewer, so
  // it must not fall through to a label that claims to be closing.
  if (route === 'view')        return conName ? `← Back to ${conName}` : '← Back to the figure';
  if (route === 'calibration') return '← Back to level check';
  if (route === 'lesson' || lessonFindQuestion) return '← Back to lesson';
  return 'Close guide';
}
