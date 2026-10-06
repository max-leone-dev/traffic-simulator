import { describe, expect, it } from "vitest";
import { bottleneckGraph } from "../src/scenario";
import { capacityFirst, congestionAware, dijkstra, hotspotAvoidance } from "../src/routing";
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

  it("prefers the roomier bottleneck route even without live traffic", () => {
    const request = { id: "test", origin: "start", destination: "finish" };
    const context = { request, graph: bottleneckGraph, traffic: new Map<string, number>() };
    expect(capacityFirst.findRoute(context)).toEqual([
      "long-a-forward", "long-b-forward", "long-c-forward",
    ]);
    context.traffic.set("long-b-forward", 99);
    expect(capacityFirst.findRoute(context)).toEqual([
      "long-a-forward", "long-b-forward", "long-c-forward",
    ]);
  });

  it("breaks widest-route ties by total base cost, even after a shared narrow edge", () => {
    const graph = {
      nodes: ["a", "b", "c", "d"].map((id) => ({ id, x: 0, y: 0 })),
      edges: [
        { id: "expensive-wide", from: "a", to: "b", baseCost: 10, capacity: 10, travelTicks: 1 },
        { id: "cheap-one", from: "a", to: "c", baseCost: 1, capacity: 5, travelTicks: 1 },
        { id: "cheap-two", from: "c", to: "b", baseCost: 1, capacity: 5, travelTicks: 1 },
        { id: "shared-narrow", from: "b", to: "d", baseCost: 1, capacity: 1, travelTicks: 1 },
      ],
    };
    expect(capacityFirst.findRoute({
      request: { id: "test", origin: "a", destination: "d" }, graph, traffic: new Map(),
    })).toEqual(["cheap-one", "cheap-two", "shared-narrow"]);
  });

  it("starts on the shortest route, then avoids its worst observed hotspot", () => {
    const request = { id: "test", origin: "start", destination: "finish" };
    const traffic = new Map<string, number>();
    expect(hotspotAvoidance.findRoute({ request, graph: bottleneckGraph, traffic }))
      .toEqual(["short-a-forward", "short-b-forward"]);
    traffic.set("short-b-forward", 1);
    expect(hotspotAvoidance.findRoute({ request, graph: bottleneckGraph, traffic }))
      .toEqual(["long-a-forward", "long-b-forward", "long-c-forward"]);
    traffic.set("long-a-forward", 10);
    expect(hotspotAvoidance.findRoute({ request, graph: bottleneckGraph, traffic }))
      .toEqual(["short-a-forward", "short-b-forward"]);
    expect(hotspotAvoidance.findRoute({ request: { ...request, origin: "finish", destination: "start" },
      graph: bottleneckGraph, traffic })).toEqual(["short-b-reverse", "short-a-reverse"]);
  });

  it("minimizes the maximum pressure rather than the sum, breaking equal maxima by base cost", () => {
    const graph = {
      nodes: ["start", "a", "b", "finish"].map((id) => ({ id, x: 0, y: 0 })),
      edges: [
        { id: "a1", from: "start", to: "a", baseCost: 1, capacity: 10, travelTicks: 1 },
        { id: "a2", from: "a", to: "finish", baseCost: 1, capacity: 10, travelTicks: 1 },
        { id: "b1", from: "start", to: "b", baseCost: 1, capacity: 10, travelTicks: 1 },
        { id: "b2", from: "b", to: "finish", baseCost: 1, capacity: 10, travelTicks: 1 },
      ],
    };
    const request = { id: "test", origin: "start", destination: "finish" };
    const traffic = new Map([["a1", 6], ["a2", 6], ["b1", 8]]);
    expect(hotspotAvoidance.findRoute({ request, graph, traffic })).toEqual(["a1", "a2"]);
    expect(congestionAware(1).findRoute({ request, graph, traffic })).toEqual(["b1", "b2"]);
    traffic.set("b1", 6);
    graph.edges[1].baseCost = 2;
    expect(hotspotAvoidance.findRoute({ request, graph, traffic })).toEqual(["b1", "b2"]);
    expect(hotspotAvoidance.findRoute({ request: { ...request, destination: "missing" }, graph, traffic }))
      .toBeNull();
  });

  it("chooses the cheaper prefix when a later shared hotspot equalizes path pressure", () => {
    const graph = {
      nodes: ["start", "a", "b", "merge", "finish"].map((id) => ({ id, x: 0, y: 0 })),
      edges: [
        { id: "expensive", from: "start", to: "a", baseCost: 10, capacity: 10, travelTicks: 1 },
        { id: "expensive-join", from: "a", to: "merge", baseCost: 1, capacity: 10, travelTicks: 1 },
        { id: "cheap", from: "start", to: "b", baseCost: 1, capacity: 10, travelTicks: 1 },
        { id: "cheap-join", from: "b", to: "merge", baseCost: 1, capacity: 10, travelTicks: 1 },
        { id: "shared-hotspot", from: "merge", to: "finish", baseCost: 1, capacity: 10, travelTicks: 1 },
      ],
    };
    const traffic = new Map([["cheap", 4], ["cheap-join", 4], ["shared-hotspot", 8]]);
    expect(hotspotAvoidance.findRoute({
      request: { id: "test", origin: "start", destination: "finish" }, graph, traffic,
    })).toEqual(["cheap", "cheap-join", "shared-hotspot"]);
  });
});
