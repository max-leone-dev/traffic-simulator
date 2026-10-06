import type { DemandEvent, RoutingAlgorithm, RunPhase, SimulationState } from "./model";
import type { Scenario } from "./scenario";
import { createDemandSchedule, createSimulationState, stepSimulation } from "./simulation";

export interface ExperimentPane {
  algorithm: RoutingAlgorithm;
  simulation: SimulationState;
}

export interface Experiment {
  scenario: Scenario;
  demand: readonly DemandEvent[];
  panes: ExperimentPane[];
}

/** One demand schedule is shared by independently simulated strategies. */
export function createExperiment(scenario: Scenario, algorithms: readonly RoutingAlgorithm[]): Experiment {
  return {
    scenario,
    demand: createDemandSchedule(scenario.config, scenario.terminals),
    panes: algorithms.map((algorithm) => ({ algorithm, simulation: createSimulationState(scenario.graph) })),
  };
}

export function stepExperiment(experiment: Experiment): void {
  const { scenario, demand, panes } = experiment;
  for (const pane of panes) {
    if (pane.simulation.phase !== "complete") {
      stepSimulation(pane.simulation, scenario.graph, demand, pane.algorithm, scenario.config);
    }
  }
}

/** The comparison ends only when every independent strategy has drained. */
export function experimentPhase(experiment: Experiment): RunPhase {
  const phases = experiment.panes.map(({ simulation }) => simulation.phase);
  if (phases.length === 0) return "ramp";
  if (phases.every((phase) => phase === "complete")) return "complete";
  if (phases.some((phase) => phase === "drain" || phase === "complete")) return "drain";
  return phases[0];
}
