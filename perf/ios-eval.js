#!/usr/bin/env node
// Evaluate JavaScript inside a page running on the connected iPhone, via
// ios_webkit_debug_proxy (WebKit Inspector protocol). Zero dependencies —
// Node 22 has a global WebSocket.
//
//   node tmp/ios-eval.js <file-with-expression>
//   IOS_PAGE=3 node tmp/ios-eval.js <file>      # pick a page when several are open
//
// iOS 12.2+ exposes pages through the Target domain: commands must be wrapped in
// Target.sendMessageToTarget and replies arrive inside Target.dispatchMessageFromTarget.
// This handles that, falling back to the flat protocol on older devices.

const fs = require('fs');

const PORT = process.env.IOS_PORT || 9222;
const src = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8')
                            : fs.readFileSync(0, 'utf8');

// Nothing here may hang. Every await below can wait on a reply that never comes —
// a stale session, a closed tab, a target that acknowledges and goes quiet — and
// an unbounded wait on silence is indistinguishable from a broken cable. This
// bounds the whole run, not one stage, so a failure costs seconds and says so.
// IOS_WATCHDOG overrides; it must exceed IOS_TIMEOUT for a genuinely slow probe.
const WATCHDOG = Number(process.env.IOS_WATCHDOG) ||
                 Math.max(8000, (Number(process.env.IOS_TIMEOUT) || 60000) + 5000);
setTimeout(() => {
  console.error(`# gave up after ${WATCHDOG}ms. Run tmp/ios-trace.js for a per-step log.`);
  process.exit(9);
}, WATCHDOG).unref();

async function main() {
  const pages = await fetch(`http://localhost:${PORT}/json`).then(r => r.json());
  const want = process.env.IOS_PAGE;
  const page = want
    ? pages.find(p => new RegExp(`/page/${want}$`).test(p.webSocketDebuggerUrl || ''))
    : pages.find(p => /constellations/.test(p.url || '')) || pages[0];
  if (!page) {
    console.error('No inspectable page. On the phone: Settings > Safari > Advanced >');
    console.error('Web Inspector = ON, then open the site and foreground it.');
    process.exit(2);
  }
  console.error(`# page: ${page.url}`);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0, targetId = null, havePageTarget = false;
  const pending = new Map();

  const raw = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id;
    pending.set(msgId, { res, rej });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  // A command to the page: wrapped once a target exists, flat otherwise.
  const send = (method, params = {}) => {
    if (!targetId) return raw(method, params);
    return new Promise((res, rej) => {
      const msgId = ++id;
      pending.set(msgId, { res, rej });
      ws.send(JSON.stringify({
        id: ++id, method: 'Target.sendMessageToTarget',
        params: { targetId, message: JSON.stringify({ id: msgId, method, params }) },
      }));
    });
  };

  const handle = msg => {
    if (msg.method === 'Target.targetCreated') {
      const info = msg.params?.targetInfo;
      // The FIRST page target wins, and nothing may overwrite it.
      //
      // This device announces five targets for one tab: page-33, three frames,
      // then page-54. The previous rule ("type === 'page' || !targetId") let the
      // LAST page target win, so every command went to page-54 — a blank,
      // detached target that acknowledges the Target.sendMessageToTarget envelope
      // and then never answers the inner command. The result was silence, and
      // silence here means the poll loop below spins until it is killed. It also
      // explains a probe reporting location.href === 'about:blank' for a tab that
      // was plainly showing a real page.
      if (info) {
        if (info.type === 'page' && !havePageTarget) {
          targetId = info.targetId; havePageTarget = true;
        } else if (!targetId) {
          targetId = info.targetId;      // pre-12.2 devices announce no page target
        }
      }
      return;
    }
    if (msg.method === 'Target.dispatchMessageFromTarget') {
      let inner; try { inner = JSON.parse(msg.params.message); } catch { return; }
      return handle(inner);
    }
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
    }
  };

  ws.addEventListener('message', ev => {
    if (process.env.IOS_DEBUG) console.error('<<', String(ev.data).slice(0, 400));
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  });

  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', e => rej(new Error('ws: ' + (e.message || 'failed'))));
  });

  // Nudge the device into announcing its target, then give it a moment to arrive.
  try { await raw('Inspector.enable'); } catch {}
  await new Promise(r => setTimeout(r, 400));
  try { await send('Runtime.enable'); } catch {}

  // WebKit's Runtime.evaluate has no awaitPromise, so the async body stashes its
  // result on the page and we poll for it. That also lets a probe take its time.
  const body = src.trim();
  const kick =
    `window.__evDone = false; window.__evOut = null;` +
    `(async () => { try { window.__evOut = await ${body.startsWith('{') ? '(' + body + ')' : body}; }` +
    ` catch (e) { window.__evOut = 'ERROR: ' + (e && e.stack || e); }` +
    ` window.__evDone = true; })(); 'started'`;

  const evaluate = expression => send('Runtime.evaluate', {
    expression, returnByValue: true, generatePreview: false,
  });

  const started = await evaluate(kick);
  if (started.wasThrown) { console.error('THREW:', JSON.stringify(started.result)); process.exit(1); }

  const deadline = Date.now() + (Number(process.env.IOS_TIMEOUT) || 60000);
  let out;
  while (Date.now() < deadline) {
    const p = await evaluate(`window.__evDone ? JSON.stringify(window.__evOut ?? null) : ''`);
    const v = p.result?.value;
    if (v) { out = v; break; }
    await new Promise(r => setTimeout(r, 250));
  }
  if (out === undefined) { console.error('timed out waiting for the probe'); process.exit(3); }

  // The probe's own value is usually already a JSON string; unwrap one level.
  let parsed; try { parsed = JSON.parse(out); } catch { parsed = out; }
  console.log(typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 1));
  ws.close();
}

main().catch(e => { console.error(e.message); process.exit(1); });
