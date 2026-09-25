import type { RoadEdge, RoadGraph } from "./model";

const nodes = [
  { id: "start", x: 58, y: 205, label: "START" },
  { id: "short", x: 300, y: 205 },
  { id: "upper-a", x: 175, y: 62 },
  { id: "upper-b", x: 425, y: 62 },
  { id: "finish", x: 542, y: 205, label: "FINISH" },
] as const;

const edges: RoadEdge[] = [];

function addConnection(
  id: string,
  from: string,
  to: string,
  baseCost: number,
  capacity: number,
  travelTicks: number,
): void {
  edges.push(
    { id: `${id}-forward`, from, to, baseCost, capacity, travelTicks },
    { id: `${id}-reverse`, from: to, to: from, baseCost, capacity, travelTicks },
  );
}

addConnection("short-a", "start", "short", 1, 1, 4);
addConnection("short-b", "short", "finish", 1, 1, 4);
addConnection("long-a", "start", "upper-a", 1.4, 5, 5);
addConnection("long-b", "upper-a", "upper-b", 1.4, 5, 5);
addConnection("long-c", "upper-b", "finish", 1.4, 5, 5);

export const bottleneckGraph: RoadGraph = { nodes, edges };

export function edgeById(graph: RoadGraph, id: string): RoadEdge | undefined {
  return graph.edges.find((edge) => edge.id === id);
}
