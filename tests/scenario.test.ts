import { describe, expect, it } from "vitest";
import { createExperiment, experimentPhase, stepExperiment } from "../src/experiment";
import { graphConnections } from "../src/graphView";
import { capacityFirst, congestionAware, DEFAULT_CONGESTION_PENALTY, dijkstra, hotspotAvoidance } from "../src/routing";
import { scenarios } from "../src/scenario";
import { averageTripTime, departurePeriodResults, isComplete } from "../src/simulation";
import type { RoutingAlgorithm } from "../src/model";

const strategies = [dijkstra, congestionAware(DEFAULT_CONGESTION_PENALTY)];

describe("scenario presets", () => {
  it("keeps every graph valid for the shared one-line connection view", () => {
    expect(scenarios.map(({ id }) => id)).toEqual(["bottleneck", "ladder", "district"]);
    for (const scenario of scenarios) {
      const nodeIds = new Set(scenario.graph.nodes.map(({ id }) => id));
      expect(nodeIds.size).toBe(scenario.graph.nodes.length);
      expect(scenario.terminals.every((id) => nodeIds.has(id))).toBe(true);
      expect(new Set(scenario.graph.edges.map(({ id }) => id)).size).toBe(scenario.graph.edges.length);
      expect(scenario.graph.edges.every(({ from, to, baseCost, capacity, travelTicks }) =>
        nodeIds.has(from) && nodeIds.has(to) && baseCost > 0 && capacity > 0
          && Number.isInteger(travelTicks) && travelTicks > 0,
      )).toBe(true);
      expect(graphConnections(scenario.graph).every(({ edges }) => edges.length === 2
        && edges[0].from === edges[1].to && edges[0].to === edges[1].from)).toBe(true);
      for (const [origin, destination] of [scenario.terminals, [...scenario.terminals].reverse()] as const) {
        expect(dijkstra.findRoute({ request: { id: "test", origin, destination }, graph: scenario.graph, traffic: new Map() }))
          .not.toBeNull();
      }
    }
  });

  it("offers a genuinely different route choice in the ladder grid", () => {
    const scenario = scenarios[1];
    const request = { id: "test", origin: "left", destination: "right" };
    const baseline = dijkstra.findRoute({ request, graph: scenario.graph, traffic: new Map() });
    expect(baseline).toEqual(["top-entry-forward", "top-one-forward", "top-two-forward", "top-exit-forward"]);
    expect(capacityFirst.findRoute({ request, graph: scenario.graph, traffic: new Map() }))
      .toEqual(["bottom-entry-forward", "bottom-one-forward", "bottom-two-forward", "bottom-exit-forward"]);

    const traffic = new Map([["top-two-forward", 8]]);
    const adaptive = strategies[1].findRoute({ request, graph: scenario.graph, traffic });
    expect(adaptive).not.toEqual(baseline);
    expect(adaptive?.some((edgeId) => edgeId.startsWith("bottom-"))).toBe(true);

    const crossLinkTraffic = new Map([
      ["bottom-entry-forward", 8],
      ["top-two-forward", 8],
    ]);
    const crossLinkRoute = strategies[1].findRoute({ request, graph: scenario.graph, traffic: crossLinkTraffic });
    expect(crossLinkRoute?.some((edgeId) => edgeId.includes("rung"))).toBe(true);
  });

  it("uses cross-links during the seeded ladder experiment", () => {
    const scenario = scenarios[1];
    let crossLinkTrips = 0;
    const base = strategies[1];
    const observed: RoutingAlgorithm = {
      ...base,
      findRoute: (context) => {
        const route = base.findRoute(context);
        if (route?.some((edgeId) => edgeId.includes("rung"))) crossLinkTrips += 1;
        return route;
      },
    };
    const experiment = createExperiment(scenario, [dijkstra, observed]);
    for (let tick = 0; tick < 1000 && experiment.panes.some(({ simulation }) => !isComplete(simulation)); tick += 1) {
      stepExperiment(experiment);
    }
    expect(crossLinkTrips).toBeGreaterThan(0);
  });

  it("gives the district grid multiple real alternatives around its narrow center", () => {
    const scenario = scenarios[2];
    expect(scenario.graph.nodes).toHaveLength(18);
    expect(graphConnections(scenario.graph)).toHaveLength(28);
    const request = { id: "test", origin: scenario.terminals[0], destination: scenario.terminals[1] };
    const context = { request, graph: scenario.graph, traffic: new Map<string, number>() };
    const shortest = dijkstra.findRoute(context);
    expect(shortest).toContain("district-row-1-1-forward");
    const wide = capacityFirst.findRoute(context);
    expect(wide).not.toEqual(shortest);
    expect(wide?.some((id) => id.startsWith("district-row-0-") || id.startsWith("district-row-3-")))
      .toBe(true);
    expect(hotspotAvoidance.findRoute(context)).toEqual(shortest);
    context.traffic.set("district-row-1-1-forward", 3);
    expect(hotspotAvoidance.findRoute(context)).not.toEqual(shortest);
    expect(congestionAware(DEFAULT_CONGESTION_PENALTY).findRoute(context)).not.toEqual(shortest);
  });

  it("uses more than one district route during the seeded hotspot-avoidance run", () => {
    const routes = new Set<string>();
    const observed: RoutingAlgorithm = {
      ...hotspotAvoidance,
      findRoute: (context) => {
        const route = hotspotAvoidance.findRoute(context);
        if (route) routes.add(route.join("|"));
        return route;
      },
    };
    const experiment = createExperiment(scenarios[2], [dijkstra, observed]);
    for (let tick = 0; tick < 1000 && experimentPhase(experiment) !== "complete"; tick += 1) {
      stepExperiment(experiment);
    }
    expect(experimentPhase(experiment)).toBe("complete");
    expect(routes.size).toBeGreaterThan(1);
    expect(experiment.panes.map(({ simulation }) => simulation.metrics.completedTrips.length))
      .toEqual([experiment.demand.length, experiment.demand.length]);
  });

  it("gives both panes the same seeded demand but independent state for either scenario", () => {
    for (const scenario of scenarios) {
      const experiment = createExperiment(scenario, strategies);
      expect(experiment.demand).toEqual(createExperiment(scenario, strategies).demand);
      expect(experiment.demand[0]).toMatchObject({ id: "traveler-1", tick: 0 });
      expect(experiment.demand.every(({ origin, destination }) =>
        scenario.terminals.includes(origin) && scenario.terminals.includes(destination) && origin !== destination,
      )).toBe(true);

      stepExperiment(experiment);
      expect(experiment.panes.map(({ simulation }) => [...simulation.travelers.keys()])).toEqual([
        ["traveler-1"], ["traveler-1"],
      ]);
      expect(experiment.panes[0].simulation).not.toBe(experiment.panes[1].simulation);
      expect(experiment.panes[0].simulation.travelers.get("traveler-1"))
        .not.toBe(experiment.panes[1].simulation.travelers.get("traveler-1"));

      for (let tick = 0; tick < 1000 && experiment.panes.some(({ simulation }) => !isComplete(simulation)); tick += 1) {
        stepExperiment(experiment);
      }
      expect(experiment.panes.every(({ simulation }) => isComplete(simulation))).toBe(true);
      expect(experiment.panes.map(({ simulation }) => simulation.metrics.completedTrips.length))
        .toEqual([experiment.demand.length, experiment.demand.length]);
      expect(experiment.panes.every(({ simulation }) => simulation.travelers.size === 0)).toBe(true);
      const departures = experiment.demand.map(({ id, tick }) => ({ id, departedAt: tick }))
        .sort((a, b) => a.id.localeCompare(b.id));
      for (const pane of experiment.panes) {
        expect(pane.simulation.metrics.completedTrips.map(({ id, departedAt }) => ({ id, departedAt }))
          .sort((a, b) => a.id.localeCompare(b.id))).toEqual(departures);
        const periods = departurePeriodResults(pane.simulation, scenario.config);
        expect(periods.lighter.count + periods.heavier.count).toBe(experiment.demand.length);
      }
      expect(departurePeriodResults(experiment.panes[0].simulation, scenario.config).lighter.count)
        .toBe(departurePeriodResults(experiment.panes[1].simulation, scenario.config).lighter.count);
    }
  });

  it("starts a new scenario with fresh panes and its own trip endpoints", () => {
    const first = createExperiment(scenarios[0], strategies);
    stepExperiment(first);
    const next = createExperiment(scenarios[1], strategies);
    expect(next.panes.map(({ simulation }) => simulation.tick)).toEqual([0, 0]);
    expect(next.panes.map(({ simulation }) => simulation.travelers.size)).toEqual([0, 0]);
    expect(first.demand[0].origin).not.toBe(next.demand[0].origin);
    expect(first.demand[0].tick).toBe(next.demand[0].tick);
  });

  it("supports any two selected strategies with shared demand and deterministic same-strategy parity", () => {
    for (const scenario of scenarios) {
      const experiment = createExperiment(scenario, [dijkstra, capacityFirst]);
      stepExperiment(experiment);
      expect(experiment.panes.map(({ simulation }) => [...simulation.travelers.keys()]))
        .toEqual([["traveler-1"], ["traveler-1"]]);
      const switched = createExperiment(scenario, [capacityFirst, capacityFirst]);
      expect(switched.demand).toEqual(experiment.demand);
      expect(switched.panes.map(({ simulation }) => simulation.tick)).toEqual([0, 0]);
      for (let tick = 0; tick < 1000 && switched.panes.some(({ simulation }) => !isComplete(simulation)); tick += 1) {
        stepExperiment(switched);
      }
      expect(switched.panes.every(({ simulation }) => isComplete(simulation))).toBe(true);
      expect(switched.panes[0].simulation.metrics).toEqual(switched.panes[1].simulation.metrics);
      expect(switched.panes[0].simulation.metrics.completedTrips).toHaveLength(switched.demand.length);
      expect(switched.panes[0].simulation).not.toBe(switched.panes[1].simulation);
      const hotspotPair = createExperiment(scenario, [hotspotAvoidance, hotspotAvoidance]);
      for (let tick = 0; tick < 1000 && hotspotPair.panes.some(({ simulation }) => !isComplete(simulation)); tick += 1) {
        stepExperiment(hotspotPair);
      }
      expect(hotspotPair.panes.every(({ simulation }) => isComplete(simulation))).toBe(true);
      expect(hotspotPair.panes[0].simulation.metrics).toEqual(hotspotPair.panes[1].simulation.metrics);
    }
  });

  it("keeps all four strategy runs complete on every preset", () => {
    for (const scenario of scenarios) {
      const experiment = createExperiment(scenario, [dijkstra, strategies[1], capacityFirst, hotspotAvoidance]);
      for (let tick = 0; tick < 1000 && experiment.panes.some(({ simulation }) => !isComplete(simulation)); tick += 1) {
        stepExperiment(experiment);
      }
      expect(experiment.panes.every(({ simulation }) => isComplete(simulation))).toBe(true);
      expect(experiment.panes.map(({ simulation }) => simulation.metrics.completedTrips.length))
        .toEqual(Array(4).fill(experiment.demand.length));
      expect(experiment.panes.every(({ simulation }) => simulation.travelers.size === 0)).toBe(true);
      expect(experiment.panes[2].simulation.metrics).not.toEqual(experiment.panes[0].simulation.metrics);
    }
  });

  it("preserves the established full-run metrics while adding departure records", () => {
    const expected = [
      { averages: [25.7, 11.4], duringDemand: [49, 66] },
      { averages: [33.7, 17.4], duringDemand: [45, 61] },
    ];
    scenarios.slice(0, 2).forEach((scenario, index) => {
      const experiment = createExperiment(scenario, strategies);
      for (let tick = 0; tick < 1000 && experimentPhase(experiment) !== "complete"; tick += 1) {
        stepExperiment(experiment);
      }
      expect(experiment.panes.map(({ simulation }) => Number(averageTripTime(simulation)?.toFixed(1))))
        .toEqual(expected[index].averages);
      expect(experiment.panes.map(({ simulation }) => simulation.metrics.completedDuringDemand))
        .toEqual(expected[index].duringDemand);
    });
  });

  it("keeps the shared phase in drain until the slower strategy finishes", () => {
    const experiment = createExperiment(scenarios[1], [capacityFirst, dijkstra]);
    let observedUnevenDrain = false;
    for (let tick = 0; tick < 1000 && experimentPhase(experiment) !== "complete"; tick += 1) {
      stepExperiment(experiment);
      if (experiment.panes[0].simulation.phase === "complete"
        && experiment.panes[1].simulation.phase === "drain") {
        observedUnevenDrain = true;
        expect(experimentPhase(experiment)).toBe("drain");
      }
    }
    expect(observedUnevenDrain).toBe(true);
    expect(experimentPhase(experiment)).toBe("complete");
  });
});
