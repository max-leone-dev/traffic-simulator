import "./style.css";
import { capacityFirst, createAlgorithmRegistry, congestionAware, DEFAULT_CONGESTION_PENALTY, dijkstra, hotspotAvoidance } from "./routing";
import { scenarios } from "./scenario";
import type { Scenario } from "./scenario";
import { connectionPressure, graphConnections } from "./graphView";
import { createExperiment, experimentPhase, stepExperiment } from "./experiment";
import type { ExperimentPane } from "./experiment";
import { travelerBob, travelerFace } from "./visuals";
import { averageTripTime, departurePeriodResults, isComplete } from "./simulation";
import type { RoadGraph, RoutingAlgorithm } from "./model";

const algorithms = createAlgorithmRegistry([dijkstra, congestionAware(DEFAULT_CONGESTION_PENALTY), capacityFirst, hotspotAvoidance]);
const selectedAlgorithms: RoutingAlgorithm[] = [algorithms[0], algorithms[1]];
let selectedScenario: Scenario = scenarios[0];
let experiment = createExperiment(selectedScenario, selectedAlgorithms);
let graph: RoadGraph = selectedScenario.graph;
let connections = graphConnections(graph);
let nodes = new Map(graph.nodes.map((node) => [node.id, node]));
let edges = new Map(graph.edges.map((edge) => [edge.id, edge]));

let running = false;
let lastFrame = 0;
let accumulated = 0;
let motionSeconds = 0;
let frameRequest = 0;
const tickMilliseconds = 600;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("App root element is missing.");

app.innerHTML = `
  <main class="app-shell">
    <header class="topbar">
      <div><div id="scenario-eyebrow" class="eyebrow">ROUTING EXPERIMENT · ${selectedScenario.label.toUpperCase()}</div><h1>Traffic Lab</h1></div>
      <div class="topbar-note">Same demand · two strategies</div>
    </header>
    <section class="workspace" aria-label="Traffic routing experiment">
      <div class="scenario-bar">
        <label for="scenario-select">Graph</label>
        <select id="scenario-select" aria-label="Graph scenario">
          ${scenarios.map((scenario) => `<option value="${scenario.id}">${scenario.label}</option>`).join("")}
        </select>
        <span id="scenario-description" class="scenario-description"></span>
      </div>
      <div class="toolbar">
        <div class="ramp-box">
          <div class="ramp-title"><strong>Shared demand ramp</strong><span id="ramp-status">Ready to run</span></div>
          <span id="phase-announcement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></span>
          <div class="ramp" role="progressbar" aria-label="Demand ramp progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="ramp-marker" class="ramp-marker"></span></div>
          <div class="ramp-labels"><span>Light arrivals</span><span>Heavy arrivals</span></div>
        </div>
        <div class="controls" aria-label="Experiment controls">
          <button id="run-button" class="primary" type="button">▶ Run</button>
          <button id="reset-button" type="button">↻ Reset</button>
        </div>
      </div>
      <div id="panes" class="panes" aria-label="Routing strategies"></div>
      <p id="phase-note" class="phase-note" hidden>First half of the ramp versus second half plus hold; trips completed during drain remain in their departure group.</p>
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
const phaseNote = app.querySelector<HTMLParagraphElement>("#phase-note")!;
const statusText = app.querySelector<HTMLSpanElement>("#ramp-status")!;
const phaseAnnouncement = app.querySelector<HTMLSpanElement>("#phase-announcement")!;
const ramp = app.querySelector<HTMLDivElement>(".ramp")!;
const marker = app.querySelector<HTMLSpanElement>("#ramp-marker")!;
const runButton = app.querySelector<HTMLButtonElement>("#run-button")!;
const scenarioSelect = app.querySelector<HTMLSelectElement>("#scenario-select")!;
const scenarioDescription = app.querySelector<HTMLSpanElement>("#scenario-description")!;
const scenarioEyebrow = app.querySelector<HTMLDivElement>("#scenario-eyebrow")!;
panesRoot.innerHTML = selectedAlgorithms.map((_, index) => `
  <article class="pane">
    <div class="pane-heading">
      <label for="algorithm-${index}">Strategy ${index === 0 ? "A" : "B"}</label>
      <select id="algorithm-${index}" aria-label="Strategy ${index === 0 ? "A" : "B"} algorithm">
        ${algorithms.map((algorithm) => `<option value="${algorithm.id}">${algorithm.label}</option>`).join("")}
      </select>
    </div>
    <p class="strategy-summary"></p>
    <div class="pane-content"></div>
  </article>`).join("");
const algorithmSelects = [...panesRoot.querySelectorAll<HTMLSelectElement>(".pane-heading select")];
const paneSummaries = [...panesRoot.querySelectorAll<HTMLParagraphElement>(".strategy-summary")];
const paneContents = [...panesRoot.querySelectorAll<HTMLDivElement>(".pane-content")];
algorithmSelects.forEach((select, index) => {
  select.value = selectedAlgorithms[index].id;
  paneSummaries[index].textContent = selectedAlgorithms[index].summary ?? "";
  select.addEventListener("change", () => {
    const algorithm = algorithms.find(({ id }) => id === select.value);
    if (!algorithm || algorithm === selectedAlgorithms[index]) return;
    selectedAlgorithms[index] = algorithm;
    paneSummaries[index].textContent = algorithm.summary ?? "";
    reset();
  });
});

function reset(): void {
  running = false;
  cancelAnimationFrame(frameRequest);
  accumulated = 0;
  motionSeconds = 0;
  lastFrame = 0;
  experiment = createExperiment(selectedScenario, selectedAlgorithms);
  render();
}

function selectScenario(scenario: Scenario): void {
  selectedScenario = scenario;
  graph = scenario.graph;
  connections = graphConnections(graph);
  nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  edges = new Map(graph.edges.map((edge) => [edge.id, edge]));
  scenarioEyebrow.textContent = `ROUTING EXPERIMENT · ${scenario.label.toUpperCase()}`;
  scenarioDescription.textContent = scenario.description;
  reset();
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

function drawPane(pane: ExperimentPane, elapsedSeconds: number, tickFraction: number, showPeriodResults: boolean): string {
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
    const bob = reducedMotion.matches ? 0 : travelerBob(traveler.id, elapsedSeconds, queueIndex < 0 ? 1 : 0.25);
    const position = queueIndex < 0
      ? travelerPosition(edgeId, Math.min((traveler.edgeTicks + tickFraction) / edge.travelTicks, 1), bob)
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
  const title = pane.algorithm.label;
  const annotations = selectedScenario.annotations.map(({ text, x, y }) =>
    `<text class="route-label" x="${x}" y="${y}" text-anchor="middle">${text}</text>`,
  ).join("");
  const periodResults = showPeriodResults ? departurePeriodResults(state, selectedScenario.config) : null;
  const periodCard = (label: string, result: { count: number; averageTripTime: number | null }) => `
    <div class="period-card">
      <span class="period-label">${label}</span>
      <span class="period-value">${result.averageTripTime === null ? "—" : `${result.averageTripTime.toFixed(1)} s`}</span>
      <span class="period-count">${result.count} ${result.count === 1 ? "trip" : "trips"}</span>
    </div>`;
  return `<svg class="scene" viewBox="0 0 600 300" role="img" aria-label="${title} on the ${selectedScenario.label} graph, showing congestion and traveler faces">
      ${links}${vertices}${travelers}${waiting}${labels}
      ${annotations}
    </svg>
    <div class="metrics"><span><strong>${average === null ? "—" : average.toFixed(1)}</strong>avg trip time (sim s)</span><span><strong>${state.metrics.completedDuringDemand}</strong>completed during demand</span></div>
    ${periodResults ? `<div class="phase-breakdown" aria-label="Trip time by departure period">
      <div class="phase-breakdown-title">Avg trip time by departure</div>
      ${periodCard("Lighter departures", periodResults.lighter)}
      ${periodCard("Heavier departures", periodResults.heavier)}
    </div>` : ""}`;
}

function render(elapsedSeconds = motionSeconds): void {
  const tickFraction = reducedMotion.matches ? 0 : Math.min(accumulated / tickMilliseconds, 1);
  const phase = experimentPhase(experiment);
  experiment.panes.forEach((pane, index) => {
    paneContents[index].innerHTML = drawPane(pane, elapsedSeconds, tickFraction, phase === "complete");
  });
  phaseNote.hidden = phase !== "complete";
  const config = selectedScenario.config;
  const rampProgress = Math.min((Math.min(experiment.panes[0]?.simulation.tick ?? 0, config.rampTicks) / config.rampTicks) * 100, 100);
  marker.style.left = `${rampProgress}%`;
  ramp.setAttribute("aria-valuenow", `${Math.round(rampProgress)}`);
  statusText.textContent = !running && phase === "ramp" && (experiment.panes[0]?.simulation.tick ?? 0) === 0
    ? "Ready to run"
    : phase === "ramp"
      ? `Ramping up · ${Math.round(rampProgress)}%`
      : phase === "hold"
        ? "Holding at heavy demand"
        : phase === "drain"
          ? "Demand stopped · finishing trips"
          : "Run complete";
  const announcement = phase === "complete"
    ? "Run complete"
    : !running && (experiment.panes[0]?.simulation.tick ?? 0) === 0
      ? "Ready to run"
      : !running
        ? "Paused"
        : phase === "ramp"
          ? "Ramping up"
          : phase === "hold"
            ? "Holding at heavy demand"
            : "Demand stopped; finishing trips";
  if (phaseAnnouncement.textContent !== announcement) phaseAnnouncement.textContent = announcement;
  runButton.textContent = running ? "Ⅱ Pause" : phase === "complete" ? "▶ Run again" : "▶ Run";
}

function advanceFrame(timestamp: number): void {
  if (!running) return;
  const frameDelta = lastFrame ? Math.min(timestamp - lastFrame, 250) : 0;
  motionSeconds += frameDelta / 1000;
  accumulated += frameDelta;
  lastFrame = timestamp;
  while (accumulated >= tickMilliseconds) {
    stepExperiment(experiment);
    accumulated -= tickMilliseconds;
  }
  if (experiment.panes.every((pane) => isComplete(pane.simulation))) {
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
  if (experiment.panes.every((pane) => pane.simulation.phase === "complete")) reset();
  running = true;
  lastFrame = 0;
  if (experiment.panes[0].simulation.tick === 0) stepExperiment(experiment);
  render();
  frameRequest = requestAnimationFrame(advanceFrame);
});

scenarioSelect.addEventListener("change", () => {
  const scenario = scenarios.find(({ id }) => id === scenarioSelect.value);
  if (scenario) selectScenario(scenario);
});
app.querySelector<HTMLButtonElement>("#reset-button")!.addEventListener("click", reset);
selectScenario(selectedScenario);
