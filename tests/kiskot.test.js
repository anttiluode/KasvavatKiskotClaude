/* node --test tests/ */
const test = require('node:test');
const assert = require('node:assert');
const K = require('../kiskot_core.js');
const E = require('../experiments/run.js');
const res = require('../results/results.json');

test('oracle equals brute force on a small grid', () => {
  for (const seed of [1, 2, 3]) {
    const env = K.makeEnv(seed, 3, 3); env.T = 8; env.phi = 10;
    let best = Infinity;
    (function dfs(u, len, delay) {
      if (delay > 60) return;
      if (u === env.T && K.inWindow(delay, env.phi)) best = Math.min(best, len);
      if (len > 14) return;
      for (const ei of env.adj[u]) { const e = env.edges[ei]; dfs(K.other(e, u), len + e.len, delay + e.delay); }
    })(env.S, 0, 0);
    const o = K.oracleWindow(env);
    assert.ok(Math.abs(o.len - best) < 1e-9, `seed ${seed}: dp ${o.len} vs brute ${best}`);
  }
});

test('the construction budget is never exceeded', () => {
  const { env } = E.world(101);
  for (const L of [new K.Walker(env, 'timing', { seed: 1, gamma: 2 }), new K.Tero(env)]) {
    for (let k = 0; k < 60; k++) {
      L.epoch(env);
      let c = 0; env.edges.forEach((e, i) => { c += L.w[i] * e.len; });
      assert.ok(c <= K.BUDGET + 1e-9);
    }
  }
});

test('deterministic', () => {
  const run = () => { const { env } = E.world(102), L = new K.Walker(env, 'timing', { seed: 2, gamma: 2 }); for (let k = 0; k < 40; k++) L.epoch(env); return JSON.stringify([...L.w]); };
  assert.strictEqual(run(), run());
});

test('worlds are built so the cheapest route misses the window', () => {
  for (const seed of [101, 105, 110]) {
    const { env } = E.world(seed), plain = K.oraclePlain(env), win = K.oracleWindow(env);
    assert.ok(!K.inWindow(plain.delay, env.phi) && win && win.len > plain.len);
  }
});

test('timing-gated rails find the window; time-blind learners and Physarum mostly do not', () => {
  const w = res.window_task;
  assert.ok(w.timing.learn.final_route_ok >= 12);
  assert.ok(w.timing.learn.final_route_ok >= w.flow.learn.final_route_ok + 6);
  assert.ok(w.tero.learn.final_route_ok <= 3);
  assert.ok(res.plain_task.tero.learn.final_route_ok === 20);       // control: where time does not matter, Physarum is right
});

test('recovery and retargeting: timing-gated rails re-route', () => {
  const w = res.window_task.timing;
  assert.ok(w.after_cut.final_route_ok >= 10 && w.after_retarget.final_route_ok >= 15);
});

test('lock-in: strong positive feedback stays on the head-start road', () => {
  const t = res.trap;
  assert.ok(t['gamma3_w0.002_rho0.01'].still_on_head_start_route_or_failed >= 18);
  assert.ok(t['gamma1_w0.02'].still_on_head_start_route_or_failed < t['gamma2_w0.002'].still_on_head_start_route_or_failed);
});
