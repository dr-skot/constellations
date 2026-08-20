# Performance tooling

Everything here answers a different question. Pick the one that matches what you
actually want to know, because they are not interchangeable — the static analysis and
the on-device probe disagreed sharply the one time both were run against the same
question, and the device was right.

| I want to know | Use |
|---|---|
| Where does a frame's time go, on the real device? | `draw-probe.js` |
| Does the app stall, and which subsystem causes it? | `index.html` (the ladder + bisect) |
| How does per-frame work scale as the view widens? | `fov-cost.js` |
| Is the app frame-limited, and by what? | `ab-draw.js` (draw vs no-draw), `load-sweep.js` (vs pixels) |
| How do I run any of this on the phone? | `ios-eval.js` — see below |

## Driving the phone from the Mac

**This is the important part, and it is easy to lose.** The iPhone is reachable over
the USB cable through the WebKit Inspector protocol, so probes can be run and results
read back without anyone squinting at a phone screen and typing numbers into chat.

Prerequisites, all of which fail silently and confusingly if missed:

1. Phone connected by cable, **unlocked**, screen on.
2. On the phone: **Settings → Safari → Advanced → Web Inspector = ON**. This applies to
   Brave too, which is WebKit underneath.
3. The browser **foregrounded** with the page open. A backgrounded tab or a locked
   phone reports "No inspectable page", and — separately — a hidden tab stops running
   `requestAnimationFrame` entirely, so nothing renders and any measurement reads zero.

Then:

```sh
brew install ios-webkit-debug-proxy          # once
ios_webkit_debug_proxy -c null:9221,:9222-9250 -F &
curl -s http://localhost:9222/json           # should list the page; confirms the chain
node perf/ios-eval.js some-probe.js          # evaluate a probe in the page
```

A probe is a file containing one JavaScript expression, evaluated in the page and its
value returned as JSON. Async is fine — `ios-eval.js` stashes the result on the page and
polls, because WebKit's `Runtime.evaluate` has no `awaitPromise`.

```js
// read-stats.js
(() => JSON.stringify({
  fov: Math.round(explore.fov),
  visible: exploreVisibleCons().length,
  scheduler: exploreScheduler().stats(),
  panel: document.getElementById('perf-draw-hud').textContent,
}))()
```

`IOS_PAGE=3` picks a page when several are open; `IOS_TIMEOUT` and `IOS_DEBUG` are the
other knobs.

**Browsers do not share localStorage.** Measurements taken in Brave are invisible in
Safari and vice versa, so a comparison run has to stay in one browser. Past freeze data
lives in Brave.

## The per-phase draw probe

```
index.html?perf=1&draw=1
```

Reports per-layer mean and max, the scheduler's coalesce count and draw duration, and
the field of view and visible-constellation count that produced them. Needs `?perf=1`
as well; it takes its own panel because `?perf=1` alone starts a measurement that owns
the shared one.

Measure with a **real finger**. A synthetic drag driver cannot reproduce the touch
sampling rate, which is precisely what a scheduler change is meant to affect.

It measures **main-thread CPU only**. `gl.drawElements` returns before the GPU has done
the work, so the photo and art phases read near zero even when fill rate costs real
time. All phases small with a bad frame total therefore means GPU or input rate, not any
layer.

## Frame rate and the load multiplier (issue #63)

```
index.html?perf=1&draw=1&load=2      # 2x the backing store, same geometry
```

The panel's verdict line reads from frames **produced**, not from rAF delivery:

```
render peak 28/s of 63   338/1046 served
verdict: DROPPING FRAMES (peak 28/s of 63)
rAF gap 17.0 p50  17.0 p95  17.0 worst   (delivery, not draws)
```

`of 63` is derived from the observed rAF floor, not assumed — a 60Hz phone reads 63, and
the same phone in **Low Power Mode reads 30**, because LPM halves the refresh rate. No
code change either way.

**Read `peak`, never the instantaneous rate.** A reading is taken after the finger lifts,
and by then the current rate is zero whether the run was healthy or catastrophic.

**`load=N` scales the canvas backing store.** It was built to isolate fill rate from
main-thread cost, and on this hardware it found nothing to isolate — see below.

### What was measured, 2026-08-20 (iPhone "Monolith", iOS 26.6, 60Hz)

Frame rate is **flat at ~17fps across a 25x range of pixels** (0.39 Mpx to 9.65 Mpx),
and ~24-28fps in both normal and Low Power Mode. Roughly 3ms per frame is main thread;
the remaining ~35-55ms is a **fixed** per-draw cost that scales with neither pixels nor
clock speed. The explorer therefore runs at about half the display rate during a drag,
which the CPU-only phase table could never show. It is not fill-rate limited, so no
headroom multiplier exists to report. Root cause is open.

### Three ways to take a wrong reading here

1. **The Web Inspector taxes what it measures.** The same drag read 17 draws/s while
   `ios-eval.js` was polling and 28 draws/s when the number was read off the phone
   screen by eye. Anything measured over the cable understates the app by roughly 40%.
   For a headline number, put the value on screen and read it with your eyes.
2. **Only one `ios-eval.js` may be in flight at a time.** Every invocation resets
   `window.__evDone` / `window.__evOut`, so a second call clobbers the result the first
   is still waiting for, and the first then polls until `IOS_TIMEOUT` and reports a
   timeout for a probe that finished.
3. **The interval window is 90 frames (~1.5s).** Reading the panel a few seconds after
   the finger lifts shows the idle period, not the drag — which is how a stuttering run
   reported `17.0 p50 / 0 of 90 late` all afternoon. Sample a fixed window under known
   conditions instead (`tmp/ab-draw.js`, `tmp/load-sweep.js` are the pattern), or read
   `peak`, which survives the lift.

Also: iOS throttles rAF to ~16Hz on an untouched device with `document.hidden` still
`false`, so a finger-free probe measures the idle timer. Measure while dragging.

### What this does NOT cover

**GPU memory pressure and process kills.** The 15-second freeze in `52acbc2` was the GPU
process being killed, and no amount of frame timing predicts that — the frames before a
jetsam kill look fine. A good number here does not close that class of bug.

## The stall ladder and bisect

`index.html` runs sixteen rungs: 1–10 add one thing each to a synthetic page, 11 is the
real app, 12–16 each remove one subsystem from it. The bisect halves a candidate set
instead of walking the ladder. `app-probe.js` drives the app for both.

The methodology comments in `app-probe.js` are worth reading before changing it — most
of them record a run that was wasted by getting it wrong, including the one where a
driver clicked a button no finger could have reached and measured the app thrashing
instead of the app being used.

## What one-off probes are for

Experiment-specific probes belong in `tmp/` and can be thrown away. Anything that
outlives its experiment belongs **here**, committed — `ios-eval.js` sat in `tmp/` for a
day and was assumed lost, which led to a flat "I have no way to reach your phone" in a
later session.
