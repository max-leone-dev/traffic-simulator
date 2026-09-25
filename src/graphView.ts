import type { GraphNode, RoadEdge, RoadGraph, SimulationState } from "./model";
import { loadPressure } from "./visuals";

export interface GraphConnection {
  nodes: readonly [GraphNode, GraphNode];
  edges: RoadEdge[];
}

/** Two directed edges can share one visible connection without sharing traffic state. */
export function graphConnections(graph: RoadGraph): GraphConnection[] {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const connections = new Map<string, GraphConnection>();
  for (const edge of graph.edges) {
    const key = JSON.stringify([edge.from, edge.to].sort());
    let connection = connections.get(key);
    if (!connection) {
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      if (!from || !to) throw new Error(`Edge "${edge.id}" refers to a missing node.`);
      connection = { nodes: [from, to], edges: [] };
      connections.set(key, connection);
    }
    connection.edges.push(edge);
  }
  return [...connections.values()];
}

/** The displayed color reports the most crowded direction on this connection. */
export function connectionPressure(connection: GraphConnection, state: SimulationState): number {
  let pressure = -1;
  for (const edge of connection.edges) {
    const occupancy = state.occupancy.get(edge.id);
    if (!occupancy) continue;
    const load = occupancy.active.length + occupancy.queue.length;
    if (load > 0) pressure = Math.max(pressure, loadPressure(load, edge.capacity));
  }
  return pressure;
}
