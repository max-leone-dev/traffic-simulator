import { describe, expect, it } from "vitest";
import { bottleneckGraph } from "../src/scenario";
import { congestionAware, dijkstra } from "../src/routing";
import { graphConnections } from "../src/graphView";

describe("routing algorithms", () => {
  it("draws one connection for each pair of directed edges", () => {
    const connections = graphConnections(bottleneckGraph);
    expect(connections).toHaveLength(5);
    expect(connections.every(({ edges }) => edges.length === 2
      && edges[0].from === edges[1].to
      && edges[0].to === edges[1].from)).toBe(true);
  });

  it("uses the shorter route when fixed edge costs are used", () => {
    const route = dijkstra.findRoute({
      request: { id: "test", origin: "start", destination: "finish" },
      graph: bottleneckGraph,
      traffic: new Map(),
    });
    expect(route).toEqual(["short-a-forward", "short-b-forward"]);
  });

  it("can choose the longer alternative when the short route is congested", () => {
    const traffic = new Map<string, number>([
      ["short-a-forward", 8],
      ["short-b-forward", 8],
    ]);
    const route = congestionAware(1.25).findRoute({
      request: { id: "test", origin: "start", destination: "finish" },
      graph: bottleneckGraph,
      traffic,
    });
    expect(route).toEqual(["long-a-forward", "long-b-forward", "long-c-forward"]);
  });

  it("finds routes in either direction without inventing reverse edge access", () => {
    const route = dijkstra.findRoute({
      request: { id: "test", origin: "finish", destination: "start" },
      graph: bottleneckGraph,
      traffic: new Map(),
    });
    expect(route).toEqual(["short-b-reverse", "short-a-reverse"]);
  });
});
