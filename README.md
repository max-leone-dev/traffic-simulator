# Traffic Lab

Traffic Lab is a small browser-based experiment for making routing behavior visible. It compares a fixed shortest-path baseline with a congestion-aware strategy on a deliberately simple graph. The goal is to explore the trade-offs through animation and metrics—not to model realistic traffic or claim a new routing result.

## Run locally

Requires Node.js and pnpm.

```sh
pnpm install
pnpm dev
```

Use `pnpm test` to run the automated tests and `pnpm build` to type-check and create the static production build in `dist/`.

## Experiment at a glance

- Both panes use the same seeded traveler arrivals and graph, with separate traffic state.
- Trips choose a route at departure and keep it while traveling.
- The fixed baseline uses edge base costs. The congestion-aware strategy adds a tunable penalty based on the traffic snapshot at departure.
- A single line represents each pair of directed edges. Its color shows the more crowded direction, while the two directions retain independent traffic state. A lone traveler reads as low crowding; additional travelers and queues raise the color. Faces react individually to that same pressure.
- The demand ramp is shared. Average trip time and completions during the demand window are reported per strategy.

The graph and all simulation constants are intentionally small and tuneable. The current version is an early experiment; its numbers are not calibrated to real-world roads.

## Structure

- `src/model.ts` — shared graph, routing, traveler, and run types
- `src/scenario.ts` — the first bottleneck graph
- `src/graphView.ts` — groups directed edges for the minimal graph view and selects each line's crowding color
- `src/routing.ts` — algorithm contract, registry, and initial algorithms
- `src/simulation.ts` — seeded demand, queue/capacity rules, run state, and metrics
- `src/main.ts` and `src/style.css` — experiment controls and SVG/HTML presentation
- `tests/` — deterministic routing and simulation checks

## Add a routing algorithm

Implement the `RoutingAlgorithm` contract in `src/model.ts`: give the strategy a stable `id` and display `label`, then implement `findRoute`. It receives a trip request, the directed graph, and a read-only map of current load by edge; return an ordered list of edge IDs from origin to destination, or `null` when no route exists. The simulation checks route continuity before accepting a result.

Register the new algorithm in the list in `src/main.ts`. Keep route selection in the algorithm; do not mutate simulation state or add strategy-specific cases to the simulation or renderer. Add tests for the behavior the new strategy is meant to demonstrate.

## AI-assisted development

This project is being developed with AI-assisted code generation and collaboration. Generated changes are reviewed and tested; the design and quality bar are not delegated to the generator.
