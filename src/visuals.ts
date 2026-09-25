import type { Traveler } from "./model";

function stableUnit(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

/** Give each traveler a repeatable, floaty bob instead of a fresh random pose each frame. */
export function travelerBob(travelerId: string, elapsedSeconds: number, amplitudeScale = 1): number {
  const amplitude = (5 + stableUnit(`${travelerId}:bob-amplitude`) * 1.2) * amplitudeScale;
  const cyclesPerSecond = 0.5 + stableUnit(`${travelerId}:bob-rate`) * 0.17;
  const phase = stableUnit(`${travelerId}:bob-phase`) * Math.PI * 2;
  return Math.sin(elapsedSeconds * cyclesPerSecond * Math.PI * 2 + phase) * amplitude;
}

/** Crowd pressure ignores the traveler who first occupies an otherwise empty edge. */
export function loadPressure(load: number, capacity: number): number {
  return Math.max(0, load - 1) / capacity;
}

/** A traveler doesn't count themself as surrounding traffic when expressing frustration. */
export function travelerFace(traveler: Traveler, laneLoad: number, capacity: number): string {
  const surroundingLoadRatio = loadPressure(laneLoad, capacity);
  if (surroundingLoadRatio >= traveler.upsetAt) return "😠";
  if (surroundingLoadRatio >= traveler.neutralAt) return "😐";
  return "🙂";
}
