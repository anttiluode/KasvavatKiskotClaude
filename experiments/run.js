/* K1: growing rails. Run: node experiments/run.js -> results/results.json
   20 random worlds (seeds 101..120; the learner settings were tuned on seeds 1..3 only).
   Every world is built so the interesting case holds: the cheapest rail from S to T arrives OUTSIDE the target's
   window, but a costlier route inside it exists. A time-blind learner should find the wrong road. */
const fs = require('fs');
const path = require('path');
const K = require('../kiskot_core.js');

const EPOCHS = 250, SEEDS = Array.from({ length: 20 }, (_, i) => 101 + i);
const med = a => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return +(s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2).toFixed(3); };
const mean = a => (a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
const cloneEnv = e => ({ ...e, edges: e.edges.map(x => ({ ...x })) });
const dist = (env, a, b) => Math.hypot((a % env.gw) - (b % env.gw), Math.floor(a / env.gw) - Math.floor(b / env.gw));

/* a world: graph, source S=0, target T far away, window phase phi such that the plain-shortest route misses it. */
function world(seed) {
  const env = K.makeEnv(seed), R = env.R;
  const far = [...Array(env.n).keys()].filter(i => dist(env, 0, i) >= 6 && dist(env, 0, i) <= 8.5);
  const pick = (T, avoid) => {
    env.T = T; const plain = K.oraclePlain(env);
    for (let k = 0; k < 200; k++) {
      env.phi = Math.floor(R() * K.PERIOD);
      const w = K.oracleWindow(env);
      if (w && !K.inWindow(plain.delay, env.phi) && (!avoid || true)) return { T, phi: env.phi };
    }
    return null;
  };
  let first = null, second = null;
  for (let k = 0; k < 50 && !first; k++) first = pick(far[Math.floor(R() * far.length)]);
  const far2 = far.filter(i => first && dist(env, first.T, i) >= 4);
  for (let k = 0; k < 50 && !second; k++) second = pick(far2[Math.floor(R() * far2.length)]);
  env.T = first.T; env.phi = first.phi;
  return { env, first, second };
}

const METHODS = {
  static: (env, s) => new K.Walker(env, 'static', { seed: s }),
  flow: (env, s) => new K.Walker(env, 'flow', { seed: s, gamma: 2 }),
  timing: (env, s) => new K.Walker(env, 'timing', { seed: s, gamma: 2 }),
  tero: env => new K.Tero(env),
};

function judge(env, L, task) {
  const r = L.route(env), orc = task === 'window' ? K.oracleWindow(env) : K.oraclePlain(env);
  const ok = r.reached && (task === 'plain' || K.inWindow(r.delay, env.phi));
  return { ok, ratio: ok && orc ? r.len / orc.len : null, orc };
}

function learn(env, L, task, epochs, checkEvery = 5) {
  let rec = null, rates = [];
  for (let k = 1; k <= epochs; k++) {
    const x = L.epoch(env); rates.push(x.inwin);
    if (k % checkEvery === 0 && rec === null && judge(env, L, task).ok) rec = k;
  }
  const j = judge(env, L, task);
  return { epochsToOK: rec, ok: j.ok, ratio: j.ratio, rate: mean(rates.slice(-20)) };
}

function summarise(rows) {
  const ok = rows.filter(r => r.ok), rec = rows.filter(r => r.epochsToOK !== null).map(r => r.epochsToOK);
  return { worlds: rows.length, final_route_ok: ok.length, median_cost_over_oracle: med(ok.map(r => r.ratio)),
           median_epochs_to_ok: med(rec), mean_walker_window_rate_last20: mean(rows.map(r => r.rate)) };
}

function runTask(task) {
  const out = {};
  const names = task === 'window' ? ['static', 'flow', 'timing', 'tero'] : ['static', 'flow', 'tero'];
  for (const name of names) {
    const learnRows = [], cutRows = [], retargetRows = [];
    for (const seed of SEEDS) {
      const { env, first, second } = world(seed);
      const L = METHODS[name](env, seed);
      learnRows.push(learn(env, L, task, EPOCHS));
      // cut: remove the strongest rail on the learned route, learn again
      const r = L.route(env);
      if (r.edges.length) {
        const Lc = L.clone(env), ec = cloneEnv(env);
        const victim = r.edges.reduce((b, e) => (L.w[e] > L.w[b] ? e : b), r.edges[0]);
        ec.edges[victim].alive = false; Lc.cut(victim);
        cutRows.push({ ...learn(ec, Lc, task, EPOCHS), had_route: true });
      } else cutRows.push({ ok: false, epochsToOK: null, ratio: null, rate: 0, had_route: false });
      // retarget: new target and new window phase, same learned state
      const Lr = L.clone(env), er = cloneEnv(env); er.T = second.T; er.phi = second.phi;
      retargetRows.push(learn(er, Lr, task, EPOCHS));
    }
    out[name] = { learn: summarise(learnRows), after_cut: summarise(cutRows), after_retarget: summarise(retargetRows) };
  }
  return out;
}

/* a worse in-window route: the first random self-avoiding walk to the target that arrives in the window and costs 1.5-2.5x the best */
function detour(env, best, seed) {
  const R = K.rng(seed * 31 + 5);
  for (let k = 0; k < 200000; k++) {
    const seen = new Uint8Array(env.n); seen[env.S] = 1; let u = env.S, len = 0, delay = 0; const es = [];
    for (let hop = 0; hop < 30 && u !== env.T; hop++) {
      const c = env.adj[u].filter(e => env.edges[e].alive && !seen[K.other(env.edges[e], u)]); if (!c.length) break;
      const e = c[Math.floor(R() * c.length)], ed = env.edges[e]; es.push(e); len += ed.len; delay += ed.delay; u = K.other(ed, u); seen[u] = 1;
    }
    if (u === env.T && K.inWindow(delay, env.phi) && len >= 1.5 * best.len && len <= 2.5 * best.len) return { len, edges: es };
  }
  return null;
}

/* the trap: preload a worse in-window route at full strength; does the learner leave it? */
function trap() {
  const configs = { 'gamma1_w0.02': { gamma: 1, w0: 0.02 }, 'gamma2_w0.02': { gamma: 2, w0: 0.02 }, 'gamma2_w0.002': { gamma: 2, w0: 0.002 }, 'gamma3_w0.002_rho0.01': { gamma: 3, w0: 0.002, rho: 0.01 } };
  const out = {};
  for (const [name, o] of Object.entries(configs)) {
    const ratios = []; let locked = 0, n = 0, badOverBest = [];
    for (const seed of SEEDS) {
      const { env } = world(seed), best = K.oracleWindow(env), bad = detour(env, best, seed);
      if (!bad) continue;
      n++; badOverBest.push(bad.len / best.len);
      const L = new K.Walker(env, 'timing', { seed, ...o });
      bad.edges.forEach(e => { L.w[e] = 1; }); K.scaleToBudget(env, L.w);
      for (let k = 0; k < 300; k++) L.epoch(env);
      const j = judge(env, L, 'window');
      if (j.ok) ratios.push(j.ratio);
      if (!j.ok || j.ratio >= 0.98 * bad.len / best.len) locked++;
    }
    out[name] = { worlds: n, median_head_start_route_cost_over_oracle: med(badOverBest), final_route_ok: ratios.length,
                  median_final_cost_over_oracle: med(ratios), still_on_head_start_route_or_failed: locked };
  }
  return out;
}

function main() {
  const out = { setup: { period: K.PERIOD, window_half_width: K.HALF, budget: K.BUDGET, epochs_per_phase: EPOCHS, walkers_per_epoch: 100, seeds: `${SEEDS[0]}..${SEEDS[SEEDS.length - 1]}`,
                         note: 'window task: a train counts only if its total delay lands in the target window; plain task: any arrival counts' } };
  out.window_task = runTask('window');
  out.plain_task = runTask('plain');
  out.trap = trap();
  const dir = path.join(__dirname, '..', 'results');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'results.json'), JSON.stringify(out, null, 1) + '\n');
  console.log(JSON.stringify(out, null, 1));
}

if (require.main === module) main();
module.exports = { world, runTask, trap, judge, cloneEnv };
