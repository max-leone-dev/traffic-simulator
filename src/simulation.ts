import type {
  CompletedTrip,
  DemandEvent,
  EdgeId,
  EdgeOccupancy,
  ExperimentConfig,
  NodeId,
  RoutingAlgorithm,
  RoadGraph,
  SimulationState,
  Traveler,
  TripRequest,
} from "./model";

export const DEFAULT_CONFIG: ExperimentConfig = {
  seed: 42,
  rampTicks: 96,
  holdTicks: 24,
  minArrivalChance: 0.08,
  maxArrivalChance: 0.95,
  minArrivalIntensity: 0.4,
  maxArrivalIntensity: 1,
};

function randomSource(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function createDemandSchedule(config: ExperimentConfig, terminals: readonly [NodeId, NodeId]): DemandEvent[] {
  const random = randomSource(config.seed);
  const events: DemandEvent[] = [];
  const totalTicks = config.rampTicks + config.holdTicks;
  let travelerNumber = 0;
  for (let tick = 0; tick < totalTicks; tick += 1) {
    const progress = Math.min(tick / Math.max(1, config.rampTicks - 1), 1);
    const chance = config.minArrivalChance + (config.maxArrivalChance - config.minArrivalChance) * progress;
    if (random() >= chance) continue;
    const reverse = random() < 0.5;
    const travelerRoll = random();
    travelerNumber += 1;
    events.push({
      id: `traveler-${travelerNumber}`,
      tick,
      origin: reverse ? terminals[1] : terminals[0],
      destination: reverse ? terminals[0] : terminals[1],
      neutralAt: 0.28 + travelerRoll * 0.25,
      upsetAt: 0.62 + travelerRoll * 0.3,
    });
  }

  // Keep the seeded cohort and its count, then place arrivals as quantiles of a
  // ramped intensity profile so a random run of empty Bernoulli ticks cannot
  // leave a conspicuous gap after the immediate kickoff.
  if (events.length > 0) {
    events[0] = { ...events[0], tick: 0 };
    if (events.length > 1) {
      const intensity = (tick: number) => {
        const progress = Math.min(tick / Math.max(1, config.rampTicks - 1), 1);
        return config.minArrivalIntensity + (config.maxArrivalIntensity - config.minArrivalIntensity) * progress;
      };
      const lastTick = Math.max(0, totalTicks - 1);
      const intensityTotal = Array.from({ length: lastTick }, (_, index) => intensity(index + 1))
        .reduce((sum, value) => sum + value, 0);
      let tick = Math.min(1, lastTick);
      let cumulativeIntensity = lastTick > 0 ? intensity(tick) : 0;
      for (let index = 1; index < events.length; index += 1) {
        const targetIntensity = intensityTotal * index / (events.length - 1);
        while (tick < lastTick && cumulativeIntensity < targetIntensity) {
          tick += 1;
          cumulativeIntensity += intensity(tick);
        }
        events[index] = { ...events[index], tick };
      }
    }
  }
  return events;
}

export function createSimulationState(graph: RoadGraph): SimulationState {
  const occupancy = new Map<string, EdgeOccupancy>();
  for (const edge of graph.edges) {
    if (!Number.isInteger(edge.travelTicks) || edge.travelTicks < 1) {
      throw new Error(`Edge "${edge.id}" must have a positive integer travelTicks value.`);
    }
    occupancy.set(edge.id, { active: [], queue: [] });
  }
  return {
    tick: 0,
    phase: "ramp",
    travelers: new Map(),
    occupancy,
    metrics: { completedDuringDemand: 0, completedTrips: [] },
  };
}

function trafficSnapshot(state: SimulationState): ReadonlyMap<string, number> {
  return new Map(
    [...state.occupancy].map(([edgeId, occupancy]) => [edgeId, occupancy.active.length + occupancy.queue.length]),
  );
}

function isValidRoute(graph: RoadGraph, route: readonly EdgeId[], request: TripRequest): boolean {
  if (route.length === 0) return request.origin === request.destination;
  const edgesById = new Map(graph.edges.map((edge) => [edge.id, edge]));
  let currentNode = request.origin;
  for (const edgeId of route) {
    const edge = edgesById.get(edgeId);
    if (!edge || edge.from !== currentNode) return false;
    currentNode = edge.to;
  }
  return currentNode === request.destination;
}

function finishTraveler(state: SimulationState, traveler: Traveler, demandEnd: number): void {
  state.metrics.completedTrips.push({ id: traveler.id, departedAt: traveler.enteredAt, completedAt: state.tick });
  if (state.tick < demandEnd) state.metrics.completedDuringDemand += 1;
  state.travelers.delete(traveler.id);
}

export function stepSimulation(
  state: SimulationState,
  graph: RoadGraph,
  events: readonly DemandEvent[],
  algorithm: RoutingAlgorithm,
  config: ExperimentConfig,
): void {
  const demandEnd = config.rampTicks + config.holdTicks;

  for (const edge of graph.edges) {
    const occupancy = state.occupancy.get(edge.id)!;
    const remaining: Traveler[] = [];
    for (const traveler of occupancy.active) {
      traveler.edgeTicks += 1;
      if (traveler.edgeTicks < edge.travelTicks) {
        remaining.push(traveler);
        continue;
      }
      traveler.edgeIndex += 1;
      if (traveler.edgeIndex >= traveler.edgeIds.length) {
        finishTraveler(state, traveler, demandEnd);
      } else {
        // Traversal ticks belong to one edge; the next edge starts at its origin.
        traveler.edgeTicks = 0;
        const nextEdge = state.occupancy.get(traveler.edgeIds[traveler.edgeIndex]);
        nextEdge?.queue.push(traveler);
      }
    }
    occupancy.active = remaining;
  }

  const traffic = trafficSnapshot(state);
  for (const event of events) {
    if (event.tick !== state.tick) continue;
    const route = algorithm.findRoute({ request: event, graph, traffic });
    if (!route || !isValidRoute(graph, route, event)) {
      throw new Error(`Routing algorithm "${algorithm.id}" returned an invalid route for ${event.id}.`);
    }
    const traveler: Traveler = {
      id: event.id,
      edgeIds: route,
      edgeIndex: 0,
      edgeTicks: 0,
      enteredAt: state.tick,
      neutralAt: event.neutralAt,
      upsetAt: event.upsetAt,
    };
    state.travelers.set(traveler.id, traveler);
    state.occupancy.get(route[0])?.queue.push(traveler);
  }

  for (const edge of graph.edges) {
    const occupancy = state.occupancy.get(edge.id)!;
    while (occupancy.active.length < edge.capacity && occupancy.queue.length > 0) {
      const traveler = occupancy.queue.shift()!;
      occupancy.active.push(traveler);
    }
  }

  state.tick += 1;
  if (state.tick >= demandEnd) state.phase = state.travelers.size > 0 ? "drain" : "complete";
  else if (state.tick >= config.rampTicks) state.phase = "hold";
  else state.phase = "ramp";
}

function meanTripTime(trips: readonly CompletedTrip[]): number | null {
  if (trips.length === 0) return null;
  return trips.reduce((sum, trip) => sum + trip.completedAt - trip.departedAt, 0) / trips.length;
}

export function averageTripTime(state: SimulationState): number | null {
  return meanTripTime(state.metrics.completedTrips);
}

export interface DeparturePeriodResult {
  count: number;
  averageTripTime: number | null;
}

export interface DeparturePeriodResults {
  splitTick: number;
  lighter: DeparturePeriodResult;
  heavier: DeparturePeriodResult;
}

/** Group by departure, not completion, so queued trips remain in their original demand cohort. */
export function departurePeriodResults(state: SimulationState, config: ExperimentConfig): DeparturePeriodResults {
  const splitTick = Math.ceil(config.rampTicks / 2);
  const lighter = state.metrics.completedTrips.filter((trip) => trip.departedAt < splitTick);
  const heavier = state.metrics.completedTrips.filter((trip) => trip.departedAt >= splitTick);
  return {
    splitTick,
    lighter: { count: lighter.length, averageTripTime: meanTripTime(lighter) },
    heavier: { count: heavier.length, averageTripTime: meanTripTime(heavier) },
  };
}

export function isComplete(state: SimulationState): boolean {
  return state.phase === "complete";
}
