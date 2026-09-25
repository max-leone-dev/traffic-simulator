import { describe, expect, it } from "vitest";
import { travelerBob, travelerFace } from "../src/visuals";
import type { Traveler } from "../src/model";

const traveler: Traveler = {
  id: "traveler-1",
  edgeIds: ["street"],
  edgeIndex: 0,
  progress: 0,
  enteredAt: 0,
  neutralAt: 0.3,
  upsetAt: 0.7,
};

describe("traveler presentation", () => {
  it("keeps a lone traveler happy and lets surrounding load change their mood", () => {
    expect(travelerFace(traveler, 1, 1)).toBe("🙂");
    expect(travelerFace(traveler, 2, 1)).toBe("😠");
    expect(travelerFace(traveler, 5, 10)).toBe("😐");
  });

  it("gives each traveler a repeatable floaty bob", () => {
    const firstPose = travelerBob("traveler-1", 1.25);
    expect(travelerBob("traveler-1", 1.25)).toBe(firstPose);
    expect(Math.abs(firstPose)).toBeLessThanOrEqual(6.2);
    expect(travelerBob("traveler-2", 1.25)).not.toBe(firstPose);
  });

  it("keeps queued travelers' bob subtle", () => {
    expect(Math.abs(travelerBob("traveler-1", 1.25, 0.25))).toBeLessThanOrEqual(1.55);
  });
});
