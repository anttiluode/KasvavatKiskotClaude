/* Kasvavat Kiskot (growing rails): core.
   A graph of junctions on a grid. Every candidate rail has a length and a delay (length / speed, in ticks).
   Rails carry a strength w in [0,1]. Construction costs sum(w * length) <= BUDGET: rails compete for it.
   The target listens in a window: a train counts only if its total delay lands within +-HALF ticks of phase phi
   on a clock of PERIOD ticks (the same window idea as TurntableNeuron v5: +-45 deg = +-4 of 32).

   Learners (all local, none sees the map):
     Walker('timing')  trains walk self-avoiding, choosing a rail with probability ~ (w + w0)^gamma. A train that
                       reaches the target INSIDE the window sends a reply back along its path; every rail on the
                       path gets a deposit eta / pathLength. All rails evaporate (forgetting) and the whole
                       network is scaled back to the budget. This is ant-colony optimisation with a construction
                       budget; the new part is that the reply is gated by arrival time.
     Walker('flow')    identical, but any arrival at the target is rewarded, window or not (time-blind control).
     Walker('static')  no learning; uniform strength (control).
     Tero              Physarum flow reinforcement (Tero et al., Science 2010): solve Kirchhoff flows, dD = f(|Q|) - D.
   Oracle: dynamic programme over (junction, total delay): cheapest walk by length that lands in the window. */
(function (root, factory) {
  const m = factory();
  if (typeof module === 'object' && module.exports) module.exports = m; else root.Kiskot = m;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const PERIOD = 32, HALF = 4, BUDGET = 14, GW = 7, GH = 7, DMAX = 160;

  function rng(seed) {                              // mulberry32
    return () => {
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* env: grid junctions, rails between every pair within distance 2; rail speed 1 or 2 (like glass vs air). */
  function makeEnv(seed, gw = GW, gh = GH) {
    const R = rng(seed), n = gw * gh, edges = [], adj = Array.from({ length: n }, () => []);
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      const dx = (a % gw) - (b % gw), dy = Math.floor(a / gw) - Math.floor(b / gw), d2 = dx * dx + dy * dy;
      if (d2 > 4) continue;
      const len = Math.sqrt(d2), speed = R() < 0.5 ? 1 : 2, e = edges.length;
      edges.push({ a, b, len, delay: Math.max(1, Math.round(4 * len / speed)), alive: true });
      adj[a].push(e); adj[b].push(e);
    }
    return { n, gw, gh, edges, adj, S: 0, T: n - 1, phi: 0, windowOn: true, R };
  }

  const inWindow = (d, phi) => { const m = (((d - phi) % PERIOD) + PERIOD) % PERIOD; return Math.min(m, PERIOD - m) <= HALF; };
  const other = (e, u) => (e.a === u ? e.b : e.a);

  /* cheapest walk (by length) from S to T whose total delay is accepted. */
  function oracle(env, accept) {
    const { n, edges, adj, S, T } = env, INF = Infinity;
    const best = Array.from({ length: DMAX + 1 }, () => new Float64Array(n).fill(INF)), par = Array.from({ length: DMAX + 1 }, () => new Int32Array(n).fill(-1));
    best[0][S] = 0;
    for (let d = 0; d <= DMAX; d++) for (let u = 0; u < n; u++) {
      const c = best[d][u]; if (c === INF) continue;
      for (const ei of adj[u]) {
        const e = edges[ei]; if (!e.alive) continue;
        const v = other(e, u), nd = d + e.delay; if (nd > DMAX) continue;
        if (c + e.len < best[nd][v]) { best[nd][v] = c + e.len; par[nd][v] = ei; }
      }
    }
    let bd = -1, bc = INF;
    for (let d = 0; d <= DMAX; d++) if (best[d][T] < bc && accept(d)) { bc = best[d][T]; bd = d; }
    if (bd < 0) return null;
    const nodes = [T], es = []; let d = bd, u = T;
    while (!(d === 0 && u === S)) { const ei = par[d][u]; es.push(ei); d -= edges[ei].delay; u = other(edges[ei], u); nodes.push(u); }
    return { len: bc, delay: bd, edges: es.reverse(), simple: new Set(nodes).size === nodes.length };
  }
  const oracleWindow = env => oracle(env, d => inWindow(d, env.phi));
  const oraclePlain = env => oracle(env, () => true);

  /* greedy route: follow the strongest unvisited live rail from S. */
  function greedyRoute(env, w) {
    const { edges, adj, S, T } = env, seen = new Set([S]); let u = S, len = 0, delay = 0; const es = [];
    for (let hop = 0; hop < 60 && u !== T; hop++) {
      let bi = -1, bw = 1e-6;
      for (const ei of adj[u]) { const e = edges[ei]; if (!e.alive || seen.has(other(e, u))) continue; if (w[ei] > bw) { bw = w[ei]; bi = ei; } }
      if (bi < 0) return { reached: false, edges: es, len, delay };
      const e = edges[bi]; es.push(bi); len += e.len; delay += e.delay; u = other(e, u); seen.add(u);
    }
    return { reached: u === T, edges: es, len, delay, inWindow: u === T && inWindow(delay, env.phi) };
  }

  function scaleToBudget(env, w) {
    let cost = 0; for (let i = 0; i < w.length; i++) cost += w[i] * env.edges[i].len;
    if (cost > BUDGET) { const k = BUDGET / cost; for (let i = 0; i < w.length; i++) w[i] *= k; }
  }

  class Walker {
    constructor(env, mode, o = {}) {
      this.mode = mode; this.o = { gamma: 1, w0: 0.02, eta: 0.6, rho: 0.03, N: 100, hops: 30, ...o };
      this.w = new Float64Array(env.edges.length);
      if (mode === 'static') { let tot = 0; env.edges.forEach(e => { tot += e.len; }); this.w.fill(Math.min(1, BUDGET / tot)); }
      this.R = rng((o.seed || 1) * 7919 + 13);
    }
    clone(env) { const c = new Walker(env, this.mode, this.o); c.w.set(this.w); c.R = this.R; return c; }
    cut(ei) { this.w[ei] = 0; }
    epoch(env) {
      const { edges, adj, S, T, phi } = env, o = this.o, w = this.w, R = this.R, E = edges.length;
      const dep = new Float64Array(E); let arrive = 0, inwin = 0;
      for (let k = 0; k < o.N; k++) {
        const seen = new Uint8Array(env.n); seen[S] = 1; let u = S, len = 0, delay = 0; const path = [];
        for (let hop = 0; hop < o.hops && u !== T; hop++) {
          let tot = 0; const cand = [];
          for (const ei of adj[u]) { const e = edges[ei]; if (!e.alive || seen[other(e, u)]) continue; const p = Math.pow(w[ei] + o.w0, o.gamma); cand.push([ei, p]); tot += p; }
          if (!cand.length) break;
          let r = R() * tot, pick = cand[cand.length - 1][0];
          for (const [ei, p] of cand) { r -= p; if (r <= 0) { pick = ei; break; } }
          const e = edges[pick]; path.push(pick); len += e.len; delay += e.delay; u = other(e, u); seen[u] = 1;
        }
        if (u !== T) continue;
        arrive++;
        const ok = inWindow(delay, phi); if (ok) inwin++;
        if (this.mode === 'static') continue;
        if (this.mode === 'flow' || ok) for (const ei of path) dep[ei] += o.eta / len;
      }
      if (this.mode !== 'static') {
        for (let i = 0; i < E; i++) w[i] = edges[i].alive ? Math.min(1, w[i] * (1 - o.rho) + dep[i]) : 0;
        scaleToBudget(env, w);
      }
      return { arrive: arrive / o.N, inwin: inwin / o.N };
    }
    route(env) { return greedyRoute(env, this.w); }
  }

  /* Physarum (Tero et al. 2010): conductance D, flow Q = D/L (p_a - p_b); dD/dt = |Q|^mu/(1+|Q|^mu) - D. */
  class Tero {
    constructor(env, o = {}) { this.o = { mu: 1.4, dt: 0.4, ...o }; this.w = new Float64Array(env.edges.length).fill(0.5); scaleToBudget(env, this.w); }
    clone(env) { const c = new Tero(env, this.o); c.w.set(this.w); return c; }
    cut(ei) { this.w[ei] = 0; }
    epoch(env) { return this._solve(env); }
    _solve(env) {
      const { n, edges, S, T } = env, D = this.w, M = Array.from({ length: n }, () => new Float64Array(n + 1));
      edges.forEach((e, i) => { if (!e.alive) return; const c = (D[i] + 1e-9) / e.len; M[e.a][e.a] += c; M[e.b][e.b] += c; M[e.a][e.b] -= c; M[e.b][e.a] -= c; });
      for (let i = 0; i < n; i++) M[i][i] += 1e-9;
      M[S][n] = 1;
      for (let j = 0; j <= n; j++) M[T][j] = 0; M[T][T] = 1;          // ground the target: p_T = 0
      for (let c = 0; c < n; c++) {                                   // Gauss-Jordan with partial pivoting
        let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
        [M[c], M[p]] = [M[p], M[c]];
        const d = M[c][c]; for (let j = c; j <= n; j++) M[c][j] /= d;
        for (let r = 0; r < n; r++) if (r !== c && M[r][c] !== 0) { const f = M[r][c]; for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]; }
      }
      const pr = M.map(r => r[n]), { mu, dt } = this.o;
      edges.forEach((e, i) => {
        if (!e.alive) { D[i] = 0; return; }
        const q = Math.abs(D[i] / e.len * (pr[e.a] - pr[e.b])), f = Math.pow(q, mu);
        D[i] = Math.max(0.01, D[i] + dt * (f / (1 + f) - D[i]));   // floor: tubes never fully vanish (numerical standard)
      });
      scaleToBudget(env, D);
      return { arrive: 1, inwin: 0 };
    }
    route(env) { return greedyRoute(env, this.w); }
  }
  return { PERIOD, HALF, BUDGET, rng, makeEnv, inWindow, oracle, oracleWindow, oraclePlain, greedyRoute, Walker, Tero, scaleToBudget, other };
});
