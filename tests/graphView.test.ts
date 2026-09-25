import { describe, expect, it } from "vitest";
import { connectionPressure, graphConnections } from "../src/graphView";
import { createSimulationState } from "../src/simulation";
import { bottleneckGraph } from "../src/scenario";
import type { Traveler } from "../src/model";

function traveler(id: string): Traveler {
  return { id, edgeIds: [], edgeIndex: 0, progress: 0, enteredAt: 0, neutralAt: 0.4, upsetAt: 0.8 };
}

describe("graph projection", () => {
  it("shows the more crowded direction on a shared visible line", () => {
    const connection = graphConnections(bottleneckGraph).find(({ edges }) => edges[0].id === "short-a-forward")!;
    const state = createSimulationState(bottleneckGraph);
    const forward = state.occupancy.get("short-a-forward")!;
    const reverse = state.occupancy.get("short-a-reverse")!;

    expect(connectionPressure(connection, state)).toBe(-1);
    forward.active.push(traveler("forward"));
    expect(connectionPressure(connection, state)).toBe(0);
    reverse.active.push(traveler("reverse"));
    reverse.queue.push(traveler("waiting"));
    expect(connectionPressure(connection, state)).toBe(1);
    expect(forward.queue).toHaveLength(0);
  });
});
