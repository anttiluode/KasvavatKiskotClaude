# Kasvavat Kiskot (growing rails)

*Antti's picture, 8 November 2026: the tracks themselves grow like a vine's feelers, compete, die back and remember where the trains went. Built by Claude (Opus 5.5 for the design, Sonnet 5.5 for the runs). Sister repo of [TurntableNeuron](https://github.com/anttiluode/TurntableNeuron) (v2-v5: what one yard computes) and [TurntableAISol](https://github.com/anttiluode/TurntableAISol) (Sol's nine yards).*

**Question.** Can a network discover a good route with no junction knowing the map, when *when* a train arrives matters and not only *whether* it arrives? And what does that buy over Physarum-style flow reinforcement?

Everything here is a toy on a 7×7 grid. It is a mechanism test, not evidence of anything about real tissue or general AI. Run: `node experiments/run.js` (~40 s, writes `results/results.json`), `node --test tests/kiskot.test.js` (7 tests).

## The model

- Junctions on a grid; a candidate rail joins every pair within distance 2 (226 rails). Each rail has a length and a delay = round(4·length/speed) ticks, with speed 1 or 2 at random (air versus glass).
- Each rail has a strength w ∈ [0,1]. **Construction budget:** Σ w·length ≤ 14. After every update the whole network is scaled back to the budget, so rails compete for it (van Ooyen & Willshaw 1999 modelled axon branches competing for a scarce growth factor the same way).
- **The target listens in a window.** A train counts only if its total delay lands within ±4 ticks of a phase φ on a 32-tick clock: TurntableNeuron's ±45° window.
- **Learner (local, no map).** Each epoch, 100 trains walk from S, never revisiting a junction and choosing a rail with probability ∝ (w + 0.02)^γ. A train that reaches T *inside the window* sends a reply back along its path; every rail on it gets a deposit 0.6/pathLength. All rails evaporate by 3% per epoch (forgetting). **This is ant-colony optimisation with a construction budget** (Dorigo et al.), and the reply is gated by arrival time.
- **Controls.** *flow*: the same learner rewarded for any arrival. *static*: no learning. *Physarum*: Tero et al. (*Science* 2010), Kirchhoff flows with dD/dt = f(|Q|) − D, same budget, conductance floor 0.01. *Oracle*: dynamic programme over (junction, total delay), giving the cheapest walk that lands in the window.
- **Worlds.** 20 random worlds (seeds 101–120; settings were tuned on seeds 1–3 only). Each is constructed so the interesting case holds: **the cheapest route misses the window**, and a costlier route inside it exists.

## Results (`results/results.json`)

Window task. "Route ok" = following the strongest rail from S reaches T inside the window. Cost is the route's length over the oracle's (1.0 = optimal).

| Learner | Route ok after 250 epochs | Median cost / oracle | After cutting the strongest rail on the learned route | After moving the target and window |
|---|---|---|---|---|
| static | 4 / 20 | 8.2 | 5 / 20 | 3 / 20 |
| flow-only (time-blind) | 5 / 20 | 2.8 | 7 / 20 | 6 / 20 |
| Physarum | 1 / 20 | | 3 / 20 | 5 / 20 |
| **timing-gated rails** | **14 / 20** | **1.49** | **13 / 20** | **19 / 20** |

- **Phase does something flow can't.** Flow reinforcement, Physarum included, reinforces the cheap road, and the cheap road misses the window. Only the learner whose reward depends on arrival time finds the costlier road that counts. This is the one thing the experiment was built to show, and it follows directly from how the worlds were built, so read it as a demonstration and not as a discovery.
- **It is not optimal.** The found route costs about 1.5× the oracle's, and 6 of 20 worlds still fail.
- **Where time does not matter, Physarum wins outright.** Plain task (any arrival counts): Physarum finds the exact shortest route in 20/20 worlds, also after a cut and after a retarget (cost 1.0). The walker learner is also ok in 19–20/20, but at about 3× the optimal cost. Timing earns its keep only when timing is the task.
- **Recovery is mostly redundancy.** After a cut, the median number of epochs to a working route is 5, which is my first checkpoint. A dense grid usually has an equal-cost neighbour for any single rail. A harsher cut (a bridge) is not tested.
- **Moving the target** takes the timing learner about 10 epochs; the time-blind walker 35.

**The trap (positive feedback).** A worse in-window route (1.5–2.5× the oracle's cost, median 1.88×) is preloaded at full strength, and the learner runs 300 epochs. Count of worlds (of 20) where it is still on that route's cost class or failed:

| γ, exploration floor, evaporation | Stuck or failed | Median final cost / oracle |
|---|---|---|
| 1, 0.02, 3% | 12 | 1.16 |
| 2, 0.02, 3% | 15 | 2.14 |
| 2, 0.002, 3% | 20 | 2.06 |
| 3, 0.002, 1% | 20 | 1.88 |

Strong positive feedback with little exploration locks in whatever road came first. The main experiment uses γ = 2, which is in the lock-in range, and it only worked because it started from nothing. A gentler γ = 1 escapes the trap in 8 of 20 worlds, and that is the same setting that delivers far less reliably. Exploration and forgetting are the whole game, as the Physarum literature says.

## What this does not show

- **The goal is still mine.** S, T and the window come from the experimenter. A target the network keeps and can rewrite itself is the separate Levin step and is not attempted.
- **Timing is a gate, not a code.** Only the arrival delay is used. The rails do not carry TurntableNeuron's phase-coded addresses, and there are no yards, tufts, baskets or chandeliers here yet.
- **The ant-colony reply is a trail memory.** The reply retraces the exact path, which a real axon does not obviously do. An honest local version would reinforce only rails where forward and reply trains meet in the same window (the t_A(x) + t_B(x) = T_min idea). That is the next experiment.
- **One graph family, one window width, one budget.** No sweep over them was done.

## Next

1. Replace the path-memory reply with the local coincidence rule (forward and reply trains in the same window at a junction) and see what survives.
2. A harsher cut (a bridge rail) and a moving window (φ drifts).
3. Grow rails where none exist (feeler tips into empty space) instead of choosing among 226 candidates.
4. Plug TurntableNeuron yards in as junctions, so the trains carry phase and the junctions are listeners.

Prior art: ant colony optimisation (Dorigo 1990s), Physarum network models (Tero, Kobayashi, Nakagaki 2007, 2010), axon competition for growth factor (van Ooyen & Willshaw 1999).
