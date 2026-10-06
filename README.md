# Traffic Lab

Traffic Lab is a playful visual test app for exploring how route choices shape traffic on small graphs. Pick a graph and two strategies, then watch the same travelers move through independent simulations side by side. Congestion colors, expressive travelers, and a few post-run numbers make the behavior easier to inspect without requiring a deep understanding of the algorithms.

This is an explorable toy model, not a realistic traffic simulator, a rigorous benchmark, or a claim that one strategy is generally best.

## Try an experiment

1. Choose a graph and two strategies. Both panes receive the same seeded arrivals; each has its own traffic state.
2. Press **Run**. The shared meter shows the demand ramp from lighter to heavier arrivals. You can pause or reset at any time.
3. Watch where routes spread out, where queues form, and how the edge colors and faces respond. After **both** panes drain, compare the lighter- and heavier-departure trip times.
4. Change a strategy or graph to restart with a fresh, matched comparison. Choosing the same strategy twice is a useful repeatability check.

The three graphs pose different visual questions:

- **Bottleneck:** When does a short, narrow route stop looking attractive?
- **Ladder grid:** Do cross-links offer useful ways around a crowded segment?
- **District grid:** How do route choices spread across a larger connected network?

## Run locally

Requires Node.js and pnpm.

```sh
pnpm install
pnpm dev
```

Use `pnpm test` to run the automated tests and `pnpm build` to type-check and create the static production build in `dist/`.

## How the experiment works

- **Fixed shortest path** minimizes total edge base cost without observing traffic.
- **Congestion-aware** adds a configurable cost penalty based on the traffic snapshot at departure.
- **Capacity-first** maximizes the route's narrowest edge capacity, breaking ties by base cost; it does not observe live traffic.
- **Worst-hotspot avoidance** minimizes the highest observed load-to-capacity ratio on a route at departure, then breaks ties by total base cost. It may choose a longer detour to avoid one crowded edge.

Trips choose a route once, at departure, and do not reroute while moving. The simulation gives each directed edge its own capacity and queue; the two strategy panes do not share traffic state.

## Reading the display

- A single line represents each pair of directed edges. Its color shows the more crowded direction, while the two directions retain independent traffic state. A lone traveler reads as low crowding; additional travelers and queues raise the color. Faces react individually to that same pressure. The visual pressure excludes the first traveler on an edge; congestion-aware routing instead considers the full occupancy when a new trip chooses its route, so a green line can still affect that decision.
- The demand ramp is shared. Average trip time and completions during the demand window are reported per strategy. One simulation tick represents one simulated second; playback takes 600 milliseconds per tick so the motion is easier to watch.
- After both panes finish draining, each pane shows a compact split by departure time: the first half of the ramp (lighter demand) versus the second half plus hold (heavier demand). Each group shows its trip count and average simulated trip time. Trips that finish during drain remain in the group in which they departed; an empty group shows no average.

Edge `baseCost` is an abstract routing preference (like distance), not travel duration. Edge `travelTicks` is a positive integer that determines its free-flow traversal time; queues can increase measured trip time. Playback speed does not change simulated trip times.

## Model boundaries

These are deliberately small, synthetic graphs with one pair of trip endpoints per scenario, not street maps. The demand schedule favors a clear, repeatable visual ramp rather than a statistically calibrated arrival model. There are no signals, driving physics, or predictions of real travel time. Worst-hotspot avoidance is an illustrative per-trip policy, not a globally optimal traffic-engineering solver. Compare strategies under the same selected graph and demand; trip times from different graphs are not a direct ranking.

## Structure

- `src/model.ts` — shared graph, routing, traveler, and run types
- `src/scenario.ts` — scenario presets, including graph, terminals, demand settings, and short visual labels
- `src/experiment.ts` — one shared demand schedule and independent strategy runs
- `src/graphView.ts` — groups directed edges for the minimal graph view and selects each line's crowding color
- `src/routing.ts` — algorithm contract, registry, and initial algorithms
- `src/simulation.ts` — seeded demand, queue/capacity rules, run state, and metrics
- `src/main.ts` and `src/style.css` — experiment controls and SVG/HTML presentation
- `tests/` — deterministic routing and simulation checks

## Add a routing algorithm

Implement the `RoutingAlgorithm` contract in `src/model.ts`: give the strategy a stable `id`, display `label`, and optional short `summary`, then implement `findRoute`. It receives a trip request, the directed graph, and a read-only map of current load by edge; return an ordered list of edge IDs from origin to destination, or `null` when no route exists. The simulation checks route continuity before accepting a result.

Register the new algorithm in the list in `src/main.ts`. Keep route selection in the algorithm; do not mutate simulation state or add strategy-specific cases to the simulation or renderer. Add tests for the behavior the new strategy is meant to demonstrate.

## Add a graph scenario

Add a `Scenario` entry in `src/scenario.ts` with a stable ID, graph, two terminal nodes, run settings, and any short labels that help explain the drawing. The current view draws one line for each pair of connected vertices, while the simulation keeps a directed edge in each direction. Keep node coordinates within the 600 × 300 SVG view, and give each visible connection one reciprocal edge pair. Parallel connections between the same vertices would need an explicit visual identity before they could be drawn separately. Add a test for the new graph's routes and a complete seeded run.

## AI-assisted development

This project is being developed with AI-assisted code generation and collaboration. Generated changes are reviewed and tested; the design and quality bar are not delegated to the generator.

## License

Traffic Lab is available under the [MIT License](LICENSE).
