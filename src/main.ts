import "./style.css";
import { createAlgorithmRegistry, congestionAware, dijkstra } from "./routing";
import { bottleneckGraph } from "./scenario";
import { connectionPressure, graphConnections } from "./graphView";
import { travelerBob, travelerFace } from "./visuals";
import {
  averageTripTime,
  createDemandSchedule,
  createSimulationState,
  DEFAULT_CONFIG,
  isComplete,
  stepSimulation,
} from "./simulation";
import type { ExperimentConfig, RoutingAlgorithm, SimulationState } from "./model";

const algorithms = createAlgorithmRegistry([dijkstra, congestionAware(DEFAULT_CONFIG.congestionPenalty)]);
const demand = createDemandSchedule(DEFAULT_CONFIG);
const graph = bottleneckGraph;
const connections = graphConnections(graph);
const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
const edges = new Map(graph.edges.map((edge) => [edge.id, edge]));

interface PaneState {
  algorithm: RoutingAlgorithm;
  simulation: SimulationState;
}

let panes: PaneState[] = [];
let running = false;
let lastFrame = 0;
let accumulated = 0;
let motionSeconds = 0;
let frameRequest = 0;
const tickMilliseconds = 600;
const config: ExperimentConfig = DEFAULT_CONFIG;

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root element is missing.");

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div><div class="eyebrow">ROUTING EXPERIMENT · BOTTLENECK</div><h1>Traffic Lab</h1></div>
      <div class="topbar-note">Same demand · two strategies</div>
    </header>
    <section class="workspace" aria-label="Traffic routing experiment">
      <div class="toolbar">
        <div class="ramp-box">
          <div class="ramp-title"><strong>Shared demand ramp</strong><span id="ramp-status" aria-live="polite">Ready to run</span></div>
          <div class="ramp" role="progressbar" aria-label="Demand ramp progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="ramp-marker" class="ramp-marker"></span></div>
          <div class="ramp-labels"><span>Light arrivals</span><span>Heavy arrivals</span></div>
        </div>
        <div class="controls" aria-label="Experiment controls">
          <button id="run-button" class="primary" type="button">▶ Run</button>
          <button id="reset-button" type="button">↻ Reset</button>
        </div>
      </div>
      <div id="panes" class="panes" aria-label="Routing strategies"></div>
      <div class="legend" aria-label="Congestion and face legend">
        <span class="legend-item"><i class="swatch idle"></i>Empty</span>
        <span class="legend-item"><i class="swatch cool"></i>Low crowding</span>
        <span class="legend-item"><i class="swatch warm"></i>Building</span>
        <span class="legend-item"><i class="swatch hot"></i>Congested</span>
        <span class="footer-note">Line color shows the busier direction</span>
      </div>
    </section>
  </main>`;

const panesRoot = app.querySelector<HTMLDivElement>("#panes")!;
const statusText = app.querySelector<HTMLSpanElement>("#ramp-status")!;
const ramp = app.querySelector<HTMLDivElement>(".ramp")!;
const marker = app.querySelector<HTMLSpanElement>("#ramp-marker")!;
const runButton = app.querySelector<HTMLButtonElement>("#run-button")!;

function reset(): void {
  running = false;
  cancelAnimationFrame(frameRequest);
  accumulated = 0;
  motionSeconds = 0;
  lastFrame = 0;
  panes = algorithms.map((algorithm) => ({ algorithm, simulation: createSimulationState(graph) }));
  render();
}

function heatColor(pressure: number): string {
  if (pressure < 0) return "var(--heat-idle)";
  if (pressure >= 0.75) return "var(--orange)";
  if (pressure >= 0.35) return "var(--yellow)";
  return "var(--green)";
}

function travelerPosition(edgeId: string, progress: number, bob: number): [number, number] {
  const edge = edges.get(edgeId)!;
  const from = nodes.get(edge.from)!;
  const to = nodes.get(edge.to)!;
  return [from.x + (to.x - from.x) * progress, from.y + (to.y - from.y) * progress - bob];
}

function drawPane(pane: PaneState, index: number, elapsedSeconds: number, tickFraction: number): string {
  const state = pane.simulation;
  const links = connections.map((connection) => {
    const [from, to] = connection.nodes;
    const pressure = connectionPressure(connection, state);
    return `<line class="graph-link" x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="${heatColor(pressure)}"/>`;
  }).join("");
  const vertices = graph.nodes.map((node) => `<circle class="graph-node" cx="${node.x}" cy="${node.y}" r="8"/>`).join("");
  const labels = graph.nodes.filter((node) => node.label).map((node) => `<text class="node-label" x="${node.x}" y="${node.y + 42}" text-anchor="middle">${node.label}</text>`).join("");
  const queuedByNode = new Map(graph.nodes.map((node) => [node.id, [] as string[]]));
  for (const edge of graph.edges) {
    const waiting = queuedByNode.get(edge.from)!;
    for (const traveler of state.occupancy.get(edge.id)!.queue) waiting.push(traveler.id);
  }
  const queueDisplayIndex = new Map([...queuedByNode.values()].flatMap((ids) => ids.map((id, index) => [id, index] as const)));
  const travelers = [...state.travelers.values()].map((traveler) => {
    const edgeId = traveler.edgeIds[traveler.edgeIndex];
    if (!edgeId) return "";
    const edge = edges.get(edgeId)!;
    const occupancy = state.occupancy.get(edgeId)!;
    const queueIndex = occupancy.queue.indexOf(traveler);
    const displayIndex = queueDisplayIndex.get(traveler.id);
    if (displayIndex !== undefined && displayIndex >= 2) return "";
    const bob = travelerBob(traveler.id, elapsedSeconds, queueIndex < 0 ? 1 : 0.25);
    const position = queueIndex < 0
      ? travelerPosition(edgeId, Math.min(traveler.progress + tickFraction / edge.travelTicks, 1), bob)
      : travelerPosition(edgeId, 0, bob);
    if (displayIndex !== undefined) {
      position[0] += displayIndex === 0 ? -10 : 10;
      position[1] -= 16;
    }
    const load = occupancy.active.length + occupancy.queue.length;
    return `<text class="face" x="${position[0]}" y="${position[1]}" aria-label="Traveler queued or moving on ${edgeId}">${travelerFace(traveler, load, edge.capacity)}</text>`;
  }).join("");
  const waiting = graph.nodes.map((node) => {
    const count = queuedByNode.get(node.id)!.length;
    return count > 2 ? `<text class="queue-count" x="${node.x}" y="${node.y - 26}" text-anchor="middle">+${count - 2} waiting</text>` : "";
  }).join("");

  const average = averageTripTime(state);
  const title = index === 0 ? "Fixed shortest path" : "Congestion-aware";
  const detail = index === 0 ? "Dijkstra" : "Load-aware shortest path";
  return `<article class="pane">
    <div class="pane-heading"><h2>${title}</h2><span class="algorithm-label">${detail}</span></div>
    <svg class="scene" viewBox="0 0 600 300" role="img" aria-label="${title} graph showing congestion on each connection and traveler faces">
      ${links}${vertices}${travelers}${waiting}${labels}
      <text class="route-label" x="300" y="274" text-anchor="middle">SHORT · BOTTLENECK</text>
      <text class="route-label" x="300" y="105" text-anchor="middle">LONGER · OPEN</text>
    </svg>
    <div class="metrics"><span><strong>${average === null ? "—" : `${average.toFixed(1)} s`}</strong>avg trip time</span><span><strong>${state.metrics.completedDuringDemand}</strong>completed during demand</span></div>
  </article>`;
}

function render(elapsedSeconds = motionSeconds): void {
  const tickFraction = Math.min(accumulated / tickMilliseconds, 1);
  panesRoot.innerHTML = panes.map((pane, index) => drawPane(pane, index, elapsedSeconds, tickFraction)).join("");
  const rampProgress = Math.min((Math.min(panes[0]?.simulation.tick ?? 0, config.rampTicks) / config.rampTicks) * 100, 100);
  marker.style.left = `${rampProgress}%`;
  ramp.setAttribute("aria-valuenow", `${Math.round(rampProgress)}`);
  const phase = panes[0]?.simulation.phase ?? "ramp";
  statusText.textContent = !running && phase === "ramp" && (panes[0]?.simulation.tick ?? 0) === 0
    ? "Ready to run"
    : phase === "ramp"
      ? `Ramping up · ${Math.round(rampProgress)}%`
      : phase === "hold"
        ? "Holding at heavy demand"
        : phase === "drain"
          ? "Demand stopped · finishing trips"
          : "Run complete";
  runButton.textContent = running ? "Ⅱ Pause" : phase === "complete" ? "▶ Run again" : "▶ Run";
}

function advanceFrame(timestamp: number): void {
  if (!running) return;
  const frameDelta = lastFrame ? Math.min(timestamp - lastFrame, 250) : 0;
  motionSeconds += frameDelta / 1000;
  accumulated += frameDelta;
  lastFrame = timestamp;
  while (accumulated >= tickMilliseconds) {
    for (const pane of panes) {
      stepSimulation(pane.simulation, graph, demand, pane.algorithm, config);
    }
    accumulated -= tickMilliseconds;
  }
  if (panes.every((pane) => isComplete(pane.simulation))) {
    running = false;
  }
  render(motionSeconds);
  if (running) frameRequest = requestAnimationFrame(advanceFrame);
}

runButton.addEventListener("click", () => {
  if (running) {
    running = false;
    cancelAnimationFrame(frameRequest);
    render();
    return;
  }
  if (panes.every((pane) => pane.simulation.phase === "complete")) reset();
  running = true;
  lastFrame = 0;
  for (const pane of panes) {
    stepSimulation(pane.simulation, graph, demand, pane.algorithm, config);
  }
  render();
  frameRequest = requestAnimationFrame(advanceFrame);
});

app.querySelector<HTMLButtonElement>("#reset-button")!.addEventListener("click", reset);
reset();
