import { describe, expect, it } from "vitest";
import { averageTripTime, createDemandSchedule, createSimulationState, DEFAULT_CONFIG, departurePeriodResults, isComplete, stepSimulation } from "../src/simulation";
import { bottleneckGraph } from "../src/scenario";
import { congestionAware, DEFAULT_CONGESTION_PENALTY, dijkstra } from "../src/routing";
import type { DemandEvent, RoutingAlgorithm, RoadGraph } from "../src/model";

const oneEdgeGraph: RoadGraph = {
  nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 }],
  edges: [{ id: "a-b", from: "a", to: "b", baseCost: 1, capacity: 1, travelTicks: 10 }],
};

const oneEdgeRouter: RoutingAlgorithm = {
  id: "one-edge",
  label: "One edge",
  findRoute: () => ["a-b"],
};
const bottleneckTerminals = ["start", "finish"] as const;

describe("simulation inputs and capacity", () => {
  it("creates the same arrivals from the same seed", () => {
    expect(createDemandSchedule(DEFAULT_CONFIG, bottleneckTerminals)).toEqual(createDemandSchedule(DEFAULT_CONFIG, bottleneckTerminals));
  });

  it("starts the original first seeded arrival at tick zero without adding arrivals", () => {
    const events = createDemandSchedule(DEFAULT_CONFIG, bottleneckTerminals);
    expect(events).toHaveLength(75);
    expect(events[0]).toMatchObject({ id: "traveler-1", tick: 0 });
    expect(events[1].tick).toBeGreaterThanOrEqual(2);
    expect(events[1].tick).toBeLessThanOrEqual(3);
    expect(new Set(events.map((event) => event.id)).size).toBe(events.length);
    expect(events.slice(1, 9).every((event, index) => index === 0 || event.tick - events[index].tick <= 3)).toBe(true);
    expect(events.every((event, index) => index === 0 || event.tick > events[index - 1].tick)).toBe(true);
  });

  it("makes the shared kickoff visible in both strategy simulations on their first step", () => {
    const events = createDemandSchedule(DEFAULT_CONFIG, bottleneckTerminals);
    const strategies = [dijkstra, congestionAware(DEFAULT_CONGESTION_PENALTY)];
    const states = strategies.map(() => createSimulationState(bottleneckGraph));
    states.forEach((state, index) => stepSimulation(state, bottleneckGraph, events, strategies[index], DEFAULT_CONFIG));
    expect(states.map((state) => [...state.travelers.keys()])).toEqual([["traveler-1"], ["traveler-1"]]);
  });

  it("keeps travelers waiting when the edge capacity is full", () => {
    const state = createSimulationState(oneEdgeGraph);
    const arrivals: DemandEvent[] = [0, 1].map((number) => ({
      id: `t${number}`,
      tick: 0,
      origin: "a",
      destination: "b",
      neutralAt: 0.4,
      upsetAt: 0.8,
    }));
    const config = { ...DEFAULT_CONFIG, rampTicks: 10, holdTicks: 0 };

    stepSimulation(state, oneEdgeGraph, arrivals, oneEdgeRouter, config);

    expect(state.occupancy.get("a-b")?.active).toHaveLength(1);
    expect(state.occupancy.get("a-b")?.queue).toHaveLength(1);
  });

  it("requires whole positive traversal ticks", () => {
    const invalidGraph: RoadGraph = {
      ...oneEdgeGraph,
      edges: [{ ...oneEdgeGraph.edges[0], travelTicks: 1.5 }],
    };
    expect(() => createSimulationState(invalidGraph)).toThrow(/positive integer travelTicks/);
  });

  it("traverses every edge of a route before completing the trip", () => {
    const state = createSimulationState(bottleneckGraph);
    const trip: DemandEvent = {
      id: "two-edge-trip", tick: 0, origin: "start", destination: "finish", neutralAt: 0.4, upsetAt: 0.8,
    };
    const config = { ...DEFAULT_CONFIG, rampTicks: 20, holdTicks: 0 };

    for (let step = 0; step < 5; step += 1) stepSimulation(state, bottleneckGraph, [trip], dijkstra, config);
    expect(state.travelers.get(trip.id)).toMatchObject({ edgeIndex: 1, edgeTicks: 0 });
    expect(state.occupancy.get("short-b-forward")?.active.map((traveler) => traveler.id)).toEqual([trip.id]);

    stepSimulation(state, bottleneckGraph, [trip], dijkstra, config);
    expect(state.travelers.get(trip.id)).toMatchObject({ edgeIndex: 1, edgeTicks: 1 });
    expect(state.metrics.completedTrips).toEqual([]);

    for (let step = 0; step < 3; step += 1) stepSimulation(state, bottleneckGraph, [trip], dijkstra, config);
    expect(state.travelers.has(trip.id)).toBe(false);
    expect(state.metrics.completedTrips).toEqual([{ id: trip.id, departedAt: 0, completedAt: 8 }]);
    expect(averageTripTime(state)).toBe(8);
  });

  it("holds progress at zero while a trip waits to enter its next edge", () => {
    const graph: RoadGraph = {
      nodes: [{ id: "a", x: 0, y: 0 }, { id: "b", x: 10, y: 0 }, { id: "c", x: 20, y: 0 }],
      edges: [
        { id: "a-b", from: "a", to: "b", baseCost: 1, capacity: 1, travelTicks: 2 },
        { id: "b-c", from: "b", to: "c", baseCost: 1, capacity: 1, travelTicks: 4 },
      ],
    };
    const router: RoutingAlgorithm = {
      id: "test-route", label: "Test route",
      findRoute: ({ request }) => request.origin === "a" ? ["a-b", "b-c"] : ["b-c"],
    };
    const events: DemandEvent[] = [
      { id: "blocker", tick: 0, origin: "b", destination: "c", neutralAt: 0.4, upsetAt: 0.8 },
      { id: "waiting", tick: 0, origin: "a", destination: "c", neutralAt: 0.4, upsetAt: 0.8 },
    ];
    const state = createSimulationState(graph);
    const config = { ...DEFAULT_CONFIG, rampTicks: 20, holdTicks: 0 };
    for (let step = 0; step < 3; step += 1) stepSimulation(state, graph, events, router, config);
    expect(state.occupancy.get("b-c")?.queue.map((traveler) => traveler.id)).toEqual(["waiting"]);
    expect(state.travelers.get("waiting")).toMatchObject({ edgeIndex: 1, edgeTicks: 0 });

    stepSimulation(state, graph, events, router, config);
    expect(state.travelers.get("waiting")).toMatchObject({ edgeIndex: 1, edgeTicks: 0 });
    stepSimulation(state, graph, events, router, config);
    expect(state.occupancy.get("b-c")?.active.map((traveler) => traveler.id)).toEqual(["waiting"]);
    expect(state.travelers.get("waiting")).toMatchObject({ edgeIndex: 1, edgeTicks: 0 });
  });

  it("counts demand-window completions and records trip duration through the drain", () => {
    const state = createSimulationState(oneEdgeGraph);
    const arrivals: DemandEvent[] = [{
      id: "trip",
      tick: 0,
      origin: "a",
      destination: "b",
      neutralAt: 0.4,
      upsetAt: 0.8,
    }];
    const config = { ...DEFAULT_CONFIG, rampTicks: 1, holdTicks: 0 };

    for (let index = 0; index < 12 && state.phase !== "complete"; index += 1) {
      stepSimulation(state, oneEdgeGraph, arrivals, oneEdgeRouter, config);
    }

    expect(state.phase).toBe("complete");
    expect(state.metrics.completedDuringDemand).toBe(0);
    expect(state.metrics.completedTrips).toEqual([{ id: "trip", departedAt: 0, completedAt: 10 }]);
    expect(departurePeriodResults(state, config)).toEqual({
      splitTick: 1,
      lighter: { count: 1, averageTripTime: 10 },
      heavier: { count: 0, averageTripTime: null },
    });
  });

  it("groups finished trips by departure tick across the ramp midpoint", () => {
    const state = createSimulationState(oneEdgeGraph);
    state.metrics.completedTrips = [
      { id: "early", departedAt: 0, completedAt: 4 },
      { id: "early-drain", departedAt: 2, completedAt: 10 },
      { id: "boundary", departedAt: 3, completedAt: 8 },
      { id: "hold", departedAt: 6, completedAt: 16 },
    ];
    const config = { ...DEFAULT_CONFIG, rampTicks: 6, holdTicks: 2 };
    expect(departurePeriodResults(state, config)).toEqual({
      splitTick: 3,
      lighter: { count: 2, averageTripTime: 6 },
      heavier: { count: 2, averageTripTime: 7.5 },
    });
    expect(averageTripTime(state)).toBe(6.75);
  });

  it("rejects a route that does not connect the requested endpoints", () => {
    const state = createSimulationState(oneEdgeGraph);
    const invalidRouter: RoutingAlgorithm = { ...oneEdgeRouter, findRoute: () => ["missing-edge"] };
    const arrivals: DemandEvent[] = [{
      id: "bad-trip",
      tick: 0,
      origin: "a",
      destination: "b",
      neutralAt: 0.4,
      upsetAt: 0.8,
    }];

    expect(() => stepSimulation(state, oneEdgeGraph, arrivals, invalidRouter, DEFAULT_CONFIG)).toThrow(/invalid route/);
  });

  it("replays a seeded two-strategy experiment deterministically", () => {
    const config = { ...DEFAULT_CONFIG, rampTicks: 24, holdTicks: 8 };
    const events = createDemandSchedule(config, bottleneckTerminals);
    const strategies = [dijkstra, congestionAware(DEFAULT_CONGESTION_PENALTY)];
    const runOnce = (algorithm: RoutingAlgorithm) => {
      const state = createSimulationState(bottleneckGraph);
      for (let tick = 0; tick < 1000 && !isComplete(state); tick += 1) {
        stepSimulation(state, bottleneckGraph, events, algorithm, config);
      }
      return { tick: state.tick, phase: state.phase, travelerCount: state.travelers.size, metrics: state.metrics };
    };

    const results = strategies.map(runOnce);
    expect(results.map((result) => result.phase)).toEqual(["complete", "complete"]);
    expect(results.map((result) => result.travelerCount)).toEqual([0, 0]);
    expect(strategies.map(runOnce)).toEqual(results);
  });

  it("sends some new trips to the longer route as the default scenario congests", () => {
    const events = createDemandSchedule(DEFAULT_CONFIG, bottleneckTerminals);
    const base = congestionAware(DEFAULT_CONGESTION_PENALTY);
    let longerRouteSelections = 0;
    const observedRouter: RoutingAlgorithm = {
      ...base,
      findRoute: (context) => {
        const route = base.findRoute(context);
        if (route?.some((edgeId) => edgeId.startsWith("long-"))) longerRouteSelections += 1;
        return route;
      },
    };
    const state = createSimulationState(bottleneckGraph);
    for (let tick = 0; tick < 2000 && !isComplete(state); tick += 1) {
      stepSimulation(state, bottleneckGraph, events, observedRouter, DEFAULT_CONFIG);
    }

    expect(longerRouteSelections).toBeGreaterThan(0);
  });
});
