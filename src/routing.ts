import type { EdgeId, RoutingAlgorithm, RoutingContext, RoadEdge } from "./model";

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

  if (request.origin === request.destination) return [];
  if (!previous.has(request.destination)) return null;
  const route: EdgeId[] = [];
  let cursor = request.destination;
  while (cursor !== request.origin) {
    const edge = previous.get(cursor);
    if (!edge) return null;
    route.unshift(edge.id);
    cursor = edge.from;
  }
  return route;
}

export const dijkstra: RoutingAlgorithm = {
  id: "dijkstra",
  label: "Fixed shortest path",
  findRoute: (context) => shortestPath(context, (edge) => edge.baseCost),
};

export function congestionAware(penalty: number): RoutingAlgorithm {
  return {
    id: "congestion-aware",
    label: "Congestion-aware",
    findRoute: (context) =>
      shortestPath(context, (edge) => {
        const load = context.traffic.get(edge.id) ?? 0;
        return edge.baseCost * (1 + penalty * (load / edge.capacity));
      }),
  };
}

export function createAlgorithmRegistry(algorithms: readonly RoutingAlgorithm[]): readonly RoutingAlgorithm[] {
  const ids = new Set<string>();
  for (const algorithm of algorithms) {
    if (ids.has(algorithm.id)) throw new Error(`Duplicate routing algorithm id: ${algorithm.id}`);
    ids.add(algorithm.id);
  }
  return algorithms;
}
