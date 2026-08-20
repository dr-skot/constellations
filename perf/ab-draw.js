(async () => {
  // A/B, back to back on the same page, no finger involved.
  //   A: run a bare rAF loop for 2s and request NOTHING. Measures how fast the
  //      browser will deliver frames when the app draws nothing at all.
  //   B: identical loop, but request a draw every frame.
  // If B's rAF rate collapses while B's per-draw main-thread cost stays small, the
  // limit is downstream of the main thread — GPU fill or compositor backpressure —
  // which is the axis the phase table cannot see and the reason #63 exists.
  const sched = exploreScheduler();

  function run(ms, requestDraws) {
    return new Promise(res => {
      const t0 = performance.now();
      const d0 = sched.stats().draws;
      let ticks = 0, prev = t0;
      const gaps = [];
      function tick() {
        const t = performance.now();
        ticks++; gaps.push(t - prev); prev = t;
        if (requestDraws) sched.request();
        if (t - t0 < ms) requestAnimationFrame(tick);
        else {
          const dt = performance.now() - t0;
          gaps.sort((a, b) => a - b);
          res({
            rafFps: Math.round(ticks * 1000 / dt),
            gapP50: Math.round(gaps[Math.floor(gaps.length / 2)] * 10) / 10,
            gapMax: Math.round(gaps[gaps.length - 1] * 10) / 10,
            draws: sched.stats().draws - d0,
            drawFps: Math.round((sched.stats().draws - d0) * 1000 / dt),
            drawMsMean: Math.round(sched.stats().drawMs.mean * 10) / 10,
          });
        }
      }
      requestAnimationFrame(tick);
    });
  }

  const idle = await run(2000, false);
  await new Promise(r => setTimeout(r, 300));   // let the queue drain between phases
  const drawing = await run(2000, true);

  return JSON.stringify({
    loadScale: window._perfLoadScale,
    canvas: [document.getElementById('explore-canvas').width,
             document.getElementById('explore-canvas').height],
    A_noDraw: idle,
    B_drawEveryFrame: drawing,
  });
})()
