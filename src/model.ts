export type NodeId = string;
export type EdgeId = string;

export interface GraphNode {
  id: NodeId;
  x: number;
  y: number;
  label?: string;
}

export interface RoadEdge {
  id: EdgeId;
  from: NodeId;
  to: NodeId;
  baseCost: number;
  capacity: number;
  travelTicks: number;
}

export interface RoadGraph {
  nodes: readonly GraphNode[];
  edges: readonly RoadEdge[];
}

export interface TripRequest {
  id: string;
  origin: NodeId;
  destination: NodeId;
}

export type TrafficSnapshot = ReadonlyMap<EdgeId, number>;

export interface RoutingContext {
  request: TripRequest;
  graph: RoadGraph;
  traffic: TrafficSnapshot;
}

export interface RoutingAlgorithm {
  readonly id: string;
  readonly label: string;
  findRoute(context: RoutingContext): readonly EdgeId[] | null;
}

export interface DemandEvent extends TripRequest {
  tick: number;
  neutralAt: number;
  upsetAt: number;
}

export interface Traveler {
  id: string;
  edgeIds: readonly EdgeId[];
  edgeIndex: number;
  progress: number;
  enteredAt: number;
  neutralAt: number;
  upsetAt: number;
}

export interface EdgeOccupancy {
  active: Traveler[];
  queue: Traveler[];
}

export interface RunMetrics {
  completedDuringDemand: number;
  tripTimes: number[];
}

export type RunPhase = "ramp" | "hold" | "drain" | "complete";

export interface SimulationState {
  tick: number;
  phase: RunPhase;
  travelers: Map<string, Traveler>;
  occupancy: Map<EdgeId, EdgeOccupancy>;
  metrics: RunMetrics;
}

export interface ExperimentConfig {
  seed: number;
  rampTicks: number;
  holdTicks: number;
  /** Seeded Bernoulli profile used to choose the cohort size. */
  minArrivalChance: number;
  maxArrivalChance: number;
  /** Relative per-tick weights used to spread that cohort across the demand ramp. */
  minArrivalIntensity: number;
  maxArrivalIntensity: number;
  congestionPenalty: number;
}
