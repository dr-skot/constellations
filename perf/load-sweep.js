(async () => {
  // Sweep the load multiplier in one run. exploreBackingScale() reads
  // window._perfLoadScale live and drawExplore resizes whenever the backing store no
  // longer matches, so the multiplier can be changed between phases without a reload
  // — which keeps every sample on one page, one GPU state, one thermal condition.
  //
  // Below 1 is included deliberately: if frame rate RISES as pixels fall, the limit is
  // fill rate. If it does not move, the pixels were never the problem and the load
  // multiplier in #63 is measuring the wrong axis.
  const sched = exploreScheduler();
  const canvas = document.getElementById('explore-canvas');

  function sample(ms) {
    return new Promise(res => {
      const t0 = performance.now();
      const d0 = sched.stats().draws;
      let ticks = 0, prev = t0;
      const gaps = [];
      function tick() {
        const t = performance.now();
        ticks++; gaps.push(t - prev); prev = t;
        sched.request();
        if (t - t0 < ms) requestAnimationFrame(tick);
        else {
          const dt = performance.now() - t0;
          gaps.sort((a, b) => a - b);
          res({
            drawFps: Math.round((sched.stats().draws - d0) * 1000 / dt),
            gapP50: Math.round(gaps[Math.floor(gaps.length / 2)] * 10) / 10,
            drawMsMean: Math.round(sched.stats().drawMs.mean * 10) / 10,
          });
        }
      }
      requestAnimationFrame(tick);
    });
  }

  const out = [];
  for (const scale of [0.5, 0.75, 1, 1.5, 2, 2.5]) {
    window._perfLoadScale = scale;
    sched.request();
    await new Promise(r => setTimeout(r, 600));   // let the resize land and settle
    const r = await sample(2000);
    out.push({
      load: scale,
      px: canvas.width * canvas.height,
      mpx: Math.round(canvas.width * canvas.height / 10000) / 100,
      ...r,
    });
  }
  window._perfLoadScale = 1;
  return JSON.stringify(out);
})()
