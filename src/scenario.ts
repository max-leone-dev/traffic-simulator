import type { ExperimentConfig, NodeId, RoadEdge, RoadGraph } from "./model";
import { DEFAULT_CONFIG } from "./simulation";

export interface Scenario {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly graph: RoadGraph;
  readonly terminals: readonly [NodeId, NodeId];
  readonly config: ExperimentConfig;
  readonly annotations: readonly { text: string; x: number; y: number }[];
}

const bottleneckNodes = [
  { id: "start", x: 58, y: 205, label: "START" },
  { id: "short", x: 300, y: 205 },
  { id: "upper-a", x: 175, y: 62 },
  { id: "upper-b", x: 425, y: 62 },
  { id: "finish", x: 542, y: 205, label: "FINISH" },
] as const;

const bottleneckEdges: RoadEdge[] = [];

function addConnection(
  edges: RoadEdge[],
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

addConnection(bottleneckEdges, "short-a", "start", "short", 1, 1, 4);
addConnection(bottleneckEdges, "short-b", "short", "finish", 1, 1, 4);
addConnection(bottleneckEdges, "long-a", "start", "upper-a", 1.4, 5, 5);
addConnection(bottleneckEdges, "long-b", "upper-a", "upper-b", 1.4, 5, 5);
addConnection(bottleneckEdges, "long-c", "upper-b", "finish", 1.4, 5, 5);

export const bottleneckGraph: RoadGraph = { nodes: bottleneckNodes, edges: bottleneckEdges };

const ladderNodes = [
  { id: "left", x: 48, y: 150, label: "START" },
  { id: "top-left", x: 170, y: 60 },
  { id: "top-mid", x: 300, y: 60 },
  { id: "top-right", x: 430, y: 60 },
  { id: "bottom-left", x: 170, y: 240 },
  { id: "bottom-mid", x: 300, y: 240 },
  { id: "bottom-right", x: 430, y: 240 },
  { id: "right", x: 552, y: 150, label: "FINISH" },
] as const;

const ladderEdges: RoadEdge[] = [];
addConnection(ladderEdges, "top-entry", "left", "top-left", 1, 2, 4);
addConnection(ladderEdges, "top-one", "top-left", "top-mid", 0.9, 2, 4);
addConnection(ladderEdges, "top-two", "top-mid", "top-right", 0.9, 1, 4);
addConnection(ladderEdges, "top-exit", "top-right", "right", 1, 2, 4);
addConnection(ladderEdges, "bottom-entry", "left", "bottom-left", 1.15, 3, 4);
addConnection(ladderEdges, "bottom-one", "bottom-left", "bottom-mid", 1, 3, 4);
addConnection(ladderEdges, "bottom-two", "bottom-mid", "bottom-right", 1, 3, 4);
addConnection(ladderEdges, "bottom-exit", "bottom-right", "right", 1.15, 3, 4);
addConnection(ladderEdges, "left-rung", "top-left", "bottom-left", 0.8, 2, 4);
addConnection(ladderEdges, "middle-rung", "top-mid", "bottom-mid", 0.7, 2, 4);
addConnection(ladderEdges, "right-rung", "top-right", "bottom-right", 0.8, 2, 4);

export const ladderGraph: RoadGraph = { nodes: ladderNodes, edges: ladderEdges };

// A larger but still drawable network: the inner rows are short, while the
// outer rows offer roomier detours and vertical links allow route changes.
const districtNodes = [
  { id: "district-start", x: 42, y: 150, label: "START" },
  ...Array.from({ length: 4 }, (_, row) =>
    Array.from({ length: 4 }, (_, column) => ({
      id: `district-${row}-${column}`,
      x: 150 + column * 100,
      y: 42 + row * 72,
    }))).flat(),
  { id: "district-finish", x: 558, y: 150, label: "FINISH" },
];

const districtEdges: RoadEdge[] = [];
for (let row = 0; row < 4; row += 1) {
  for (let column = 0; column < 4; column += 1) {
    const here = `district-${row}-${column}`;
    if (column < 3) {
      const inner = row === 1 || row === 2;
      const capacity = row === 1 && column === 1 ? 1 : row === 2 && column === 1 ? 2 : inner ? 3 : 4;
      const baseCost = row === 1 ? 0.9 : row === 2 ? 1 : 1.2;
      addConnection(districtEdges, `district-row-${row}-${column}`, here,
        `district-${row}-${column + 1}`, baseCost, capacity, 3);
    }
    if (row < 3) {
      addConnection(districtEdges, `district-column-${row}-${column}`, here,
        `district-${row + 1}-${column}`, 0.8, 3, 2);
    }
  }
}
for (const row of [1, 2]) {
  addConnection(districtEdges, `district-entry-${row}`, "district-start", `district-${row}-0`, 1, 4, 3);
  addConnection(districtEdges, `district-exit-${row}`, `district-${row}-3`, "district-finish", 1, 4, 3);
}

export const districtGraph: RoadGraph = { nodes: districtNodes, edges: districtEdges };

export const scenarios: readonly Scenario[] = [
  {
    id: "bottleneck",
    label: "Bottleneck",
    description: "A quick shortcut competes with a longer route that has room to breathe.",
    graph: bottleneckGraph,
    terminals: ["start", "finish"],
    config: DEFAULT_CONFIG,
    annotations: [
      { text: "LONGER · OPEN", x: 300, y: 105 },
      { text: "SHORT · BOTTLENECK", x: 300, y: 274 },
    ],
  },
  {
    id: "ladder",
    label: "Ladder grid",
    description: "Two routes and three cross-links offer more ways around a narrow upper segment.",
    graph: ladderGraph,
    terminals: ["left", "right"],
    config: DEFAULT_CONFIG,
    annotations: [
      { text: "UPPER · NARROW", x: 300, y: 17 },
      { text: "LOWER · ROOMIER", x: 300, y: 278 },
    ],
  },
  {
    id: "district",
    label: "District grid",
    description: "A larger grid offers short inner routes and roomier outer detours without a single required bottleneck.",
    graph: districtGraph,
    terminals: ["district-start", "district-finish"],
    config: DEFAULT_CONFIG,
    annotations: [],
  },
];

export function edgeById(graph: RoadGraph, id: string): RoadEdge | undefined {
  return graph.edges.find((edge) => edge.id === id);
}
