import type { EdgeId, RoutingAlgorithm, RoutingContext, RoadEdge } from "./model";

export const DEFAULT_CONGESTION_PENALTY = 1.5;

function reconstructRoute(
  previous: ReadonlyMap<string, RoadEdge>,
  origin: string,
  destination: string,
): readonly EdgeId[] | null {
  if (origin === destination) return [];
  if (!previous.has(destination)) return null;
  const route: EdgeId[] = [];
  let cursor = destination;
  while (cursor !== origin) {
    const edge = previous.get(cursor);
    if (!edge) return null;
    route.unshift(edge.id);
    cursor = edge.from;
  }
  return route;
}

function shortestPath(context: RoutingContext, edgeCost: (edge: RoadEdge) => number): readonly EdgeId[] | null {
  const { graph, request } = context;
  const distances = new Map<string, number>([[request.origin, 0]]);
  const previous = new Map<string, RoadEdge>();
  const pending = new Set(graph.nodes.map((node) => node.id));

  while (pending.size > 0) {
    let current: string | undefined;
    let best = Number.POSITIVE_INFINITY;
    for (const nodeId of pending) {
      const distance = distances.get(nodeId) ?? Number.POSITIVE_INFINITY;
      if (distance < best) {
        best = distance;
        current = nodeId;
      }
    }
    if (current === undefined || !Number.isFinite(best)) break;
    if (current === request.destination) break;
    pending.delete(current);

    for (const edge of graph.edges) {
      if (edge.from !== current || !pending.has(edge.to)) continue;
      const candidate = best + edgeCost(edge);
      if (candidate < (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(edge.to, candidate);
        previous.set(edge.to, edge);
      }
    }
  }

  return reconstructRoute(previous, request.origin, request.destination);
}

export const dijkstra: RoutingAlgorithm = {
  id: "dijkstra",
  label: "Fixed shortest path",
  summary: "Least total base cost; ignores current traffic.",
  findRoute: (context) => shortestPath(context, (edge) => edge.baseCost),
};

export function congestionAware(penalty: number): RoutingAlgorithm {
  return {
    id: "congestion-aware",
    label: "Congestion-aware",
    summary: "Raises route cost where traffic is building at departure.",
    findRoute: (context) =>
      shortestPath(context, (edge) => {
        const load = context.traffic.get(edge.id) ?? 0;
        return edge.baseCost * (1 + penalty * (load / edge.capacity));
      }),
  };
}

/** Prefer the route with the highest minimum edge capacity; use base cost to break ties. */
export const capacityFirst: RoutingAlgorithm = {
  id: "capacity-first",
  label: "Capacity-first",
  summary: "Chooses a roomier route without checking current traffic.",
  findRoute: (context) => {
    const { graph, request } = context;
    if (request.origin === request.destination) return [];
    const widths = new Map<string, number>([[request.origin, Number.POSITIVE_INFINITY]]);
    const pending = new Set(graph.nodes.map((node) => node.id));

    while (pending.size > 0) {
      let current: string | undefined;
      for (const nodeId of pending) {
        if (!widths.has(nodeId)) continue;
        if (current === undefined || widths.get(nodeId)! > widths.get(current)!) {
          current = nodeId;
        }
      }
      if (current === undefined || current === request.destination) break;
      pending.delete(current);

      for (const edge of graph.edges) {
        if (edge.from !== current || !pending.has(edge.to)) continue;
        const width = Math.min(widths.get(current)!, edge.capacity);
        if (width > (widths.get(edge.to) ?? Number.NEGATIVE_INFINITY)) widths.set(edge.to, width);
      }
    }
    const widest = widths.get(request.destination);
    if (widest === undefined) return null;
    // Once the best bottleneck width is known, shortest path gives a genuine
    // minimum-cost tie-break among all routes that meet that width.
    return shortestPath(context,
      (edge) => edge.capacity >= widest ? edge.baseCost : Number.POSITIVE_INFINITY);
  },
};

/** Minimize the busiest observed edge on a route, then prefer the shorter route. */
export const hotspotAvoidance: RoutingAlgorithm = {
  id: "hotspot-avoidance",
  label: "Worst-hotspot avoidance",
  summary: "Avoids the most crowded edge on a route at departure; base cost breaks ties.",
  findRoute: (context) => {
    const { graph, request, traffic } = context;
    if (request.origin === request.destination) return [];
    const pressure = (edge: RoadEdge) => (traffic.get(edge.id) ?? 0) / edge.capacity;
    const worst = new Map<string, number>([[request.origin, 0]]);
    const pending = new Set(graph.nodes.map((node) => node.id));

    while (pending.size > 0) {
      let current: string | undefined;
      for (const nodeId of pending) {
        if (worst.has(nodeId) && (current === undefined || worst.get(nodeId)! < worst.get(current)!)) {
          current = nodeId;
        }
      }
      if (current === undefined || current === request.destination) break;
      pending.delete(current);

      for (const edge of graph.edges) {
        if (edge.from !== current || !pending.has(edge.to)) continue;
        const candidate = Math.max(worst.get(current)!, pressure(edge));
        if (candidate < (worst.get(edge.to) ?? Number.POSITIVE_INFINITY)) worst.set(edge.to, candidate);
      }
    }
    const limit = worst.get(request.destination);
    if (limit === undefined) return null;
    // A single lexicographic label per node is unsafe: a later shared hotspot
    // can equalize two paths' maxima, making the cheaper prefix preferable.
    return shortestPath(context, (edge) => pressure(edge) <= limit ? edge.baseCost : Number.POSITIVE_INFINITY);
  },
};

export function createAlgorithmRegistry(algorithms: readonly RoutingAlgorithm[]): readonly RoutingAlgorithm[] {
  const ids = new Set<string>();
  for (const algorithm of algorithms) {
    if (ids.has(algorithm.id)) throw new Error(`Duplicate routing algorithm id: ${algorithm.id}`);
    ids.add(algorithm.id);
  }
  return algorithms;
}
