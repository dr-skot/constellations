#!/usr/bin/env node
// perf/ios-eval.js with a log line at EVERY step, for when the cable goes quiet.
//
//   node perf/ios-trace.js <probe.js>
//   IOS_TARGET=page-33 node perf/ios-trace.js <probe.js>   # force one target
//
// USE THIS FIRST when a probe hangs. The whole failure mode of the inspector
// protocol is silence — a wrong target ACKs the envelope and never answers the
// inner command — so "it hung" tells you nothing about which stage owns it. The
// LAST LINE PRINTED names the stage. That is the entire point: one run, every
// step logged, rather than one guess per run.
//
// It is how the page-54 bug below was found, after several rounds of bounding a
// different stage each time and learning nothing. fs.writeSync, not console.log,
// so nothing is lost in a buffer when the process is killed. Hard 4s watchdog, so
// it cannot itself become the thing that hangs.
const fs = require('fs');

const PORT = process.env.IOS_PORT || 9222;
const src = process.argv[2] ? fs.readFileSync(process.argv[2], 'utf8') : '(() => "ping")()';

const T0 = Date.now();
const log = (...a) => fs.writeSync(2, (Date.now() - T0) + 'ms  ' + a.join(' ') + '\n');

// Hard watchdog: this can never hang, whatever stage stalls.
setTimeout(() => { log('WATCHDOG — hung, exiting'); process.exit(9); }, 4000);

async function main() {
  log('01 start');

  log('02 fetching', `http://localhost:${PORT}/json`);
  const pages = await fetch(`http://localhost:${PORT}/json`).then(r => r.json());
  log('03 page list ok, count=' + pages.length);

  const want = process.env.IOS_PAGE;
  const page = want
    ? pages.find(p => new RegExp(`/page/${want}$`).test(p.webSocketDebuggerUrl || ''))
    : pages.find(p => /constellations/.test(p.url || '')) || pages[0];
  if (!page) { log('04 NO PAGE'); process.exit(2); }
  log('04 page chosen:', page.url);
  log('05 ws url:', page.webSocketDebuggerUrl);

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  log('06 WebSocket constructed');

  let id = 0, targetId = null;
  const pending = new Map();

  const raw = (method, params = {}) => new Promise((res, rej) => {
    const msgId = ++id;
    pending.set(msgId, { res, rej });
    log('   >> raw id=' + msgId, method);
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });

  const send = (method, params = {}) => {
    if (!targetId) { log('   (no targetId — flat protocol)'); return raw(method, params); }
    return new Promise((res, rej) => {
      const msgId = ++id;
      pending.set(msgId, { res, rej });
      log('   >> wrapped id=' + msgId, method);
      ws.send(JSON.stringify({
        id: ++id, method: 'Target.sendMessageToTarget',
        params: { targetId, message: JSON.stringify({ id: msgId, method, params }) },
      }));
    });
  };

  let havePage = false;
  const FORCE = process.env.IOS_TARGET;
  const handle = msg => {
    if (msg.method === 'Target.targetCreated') {
      const info = msg.params?.targetInfo;
      // FIRST page target wins, not the last. The device announces several, and
      // the later ones are blank/detached — which is what "about:blank" was.
      if (info) {
        if (info.type === 'page' && !havePage) { targetId = info.targetId; havePage = true; }
        else if (!targetId) targetId = info.targetId;
      }
      if (FORCE) targetId = FORCE;
      log('   targetCreated type=' + info?.type + ' id=' + info?.targetId + '  using=' + targetId);
      return;
    }
    if (msg.method === 'Target.dispatchMessageFromTarget') {
      let inner; try { inner = JSON.parse(msg.params.message); } catch { return; }
      return handle(inner);
    }
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      log('   << reply id=' + msg.id + (msg.error ? ' ERROR' : ' ok'));
      msg.error ? rej(new Error(JSON.stringify(msg.error))) : res(msg.result);
      return;
    }
    log('   << unmatched', msg.method || ('id=' + msg.id));
  };

  ws.addEventListener('message', ev => {
    log('   <<< raw frame ' + String(ev.data).length + 'b');
    let msg; try { msg = JSON.parse(ev.data); } catch { return; }
    handle(msg);
  });
  ws.addEventListener('error', e => log('   !!! ws error:', e.message || 'unknown'));
  ws.addEventListener('close', e => log('   !!! ws closed code=' + e.code));

  log('07 awaiting ws open');
  await new Promise((res, rej) => {
    ws.addEventListener('open', () => { log('08 ws OPEN'); res(); });
    ws.addEventListener('error', e => rej(new Error('ws: ' + (e.message || 'failed'))));
  });

  log('09 sending Inspector.enable');
  try { await raw('Inspector.enable'); log('10 Inspector.enable replied'); }
  catch (e) { log('10 Inspector.enable threw:', e.message); }

  log('11 waiting 400ms for target');
  await new Promise(r => setTimeout(r, 400));
  log('12 targetId is', String(targetId));

  log('13 sending Runtime.enable');
  try { await send('Runtime.enable'); log('14 Runtime.enable replied'); }
  catch (e) { log('14 Runtime.enable threw:', e.message); }

  const body = src.trim();
  const kick =
    `window.__evDone = false; window.__evOut = null;` +
    `(async () => { try { window.__evOut = await ${body.startsWith('{') ? '(' + body + ')' : body}; }` +
    ` catch (e) { window.__evOut = 'ERROR: ' + (e && e.stack || e); }` +
    ` window.__evDone = true; })(); 'started'`;

  const evaluate = expression => send('Runtime.evaluate', {
    expression, returnByValue: true, generatePreview: false,
  });

  log('15 sending kick evaluate');
  const started = await evaluate(kick);
  log('16 kick replied:', JSON.stringify(started).slice(0, 200));

  for (let i = 0; i < 8; i++) {
    log('17 poll ' + i);
    const p = await evaluate(`window.__evDone ? JSON.stringify(window.__evOut ?? null) : ''`);
    const v = p.result?.value;
    log('18 poll ' + i + ' value=' + JSON.stringify(v));
    if (v) { log('19 RESULT: ' + v); ws.close(); return; }
    await new Promise(r => setTimeout(r, 250));
  }
  log('19 no result after 8 polls');
  ws.close();
}

main().catch(e => { log('FATAL', e.message); process.exit(1); });
