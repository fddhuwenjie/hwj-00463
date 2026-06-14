'use strict';

const parser = require('./parser');

const RESET = '\x1b[0m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BOLD = '\x1b[1m';

function transitionSymbol(t) {
  return t.guard ? `${t.event}[${t.guard}]` : t.event;
}

function buildTransitionTable(fsm) {
  const table = new Map();
  const symbols = new Set();
  const stateNames = fsm.states.map((s) => s.name);

  for (const stateName of stateNames) {
    const transitions = parser.getTransitionsFrom(fsm, stateName);
    const stateTransitions = new Map();

    for (const t of transitions) {
      const sym = transitionSymbol(t);
      symbols.add(sym);
      stateTransitions.set(sym, t.to);
    }

    table.set(stateName, stateTransitions);
  }

  return { table, symbols: Array.from(symbols), stateNames };
}

function hopcroftMinimize(fsm) {
  const { table, symbols, stateNames } = buildTransitionTable(fsm);
  const finalStates = new Set(parser.getFinalStates(fsm).map((s) => s.name));
  const nonFinalStates = new Set(stateNames.filter((s) => !finalStates.has(s)));

  let partitions = [];
  if (finalStates.size > 0) partitions.push(new Set(finalStates));
  if (nonFinalStates.size > 0) partitions.push(new Set(nonFinalStates));

  const partitionMap = new Map();
  for (let i = 0; i < partitions.length; i++) {
    for (const state of partitions[i]) {
      partitionMap.set(state, i);
    }
  }

  let worklist = [];
  if (finalStates.size > 0 && finalStates.size <= stateNames.length / 2) {
    worklist.push(finalStates);
  } else if (nonFinalStates.size > 0) {
    worklist.push(nonFinalStates);
  } else if (finalStates.size > 0) {
    worklist.push(finalStates);
  }

  while (worklist.length > 0) {
    const splitter = worklist.pop();

    for (const sym of symbols) {
      const predecessors = new Set();
      for (const state of stateNames) {
        const transitions = table.get(state);
        if (transitions && transitions.has(sym) && splitter.has(transitions.get(sym))) {
          predecessors.add(state);
        }
      }

      if (predecessors.size === 0) continue;

      const newPartitions = [];
      for (const partition of partitions) {
        const intersection = new Set();
        const difference = new Set();

        for (const state of partition) {
          if (predecessors.has(state)) {
            intersection.add(state);
          } else {
            difference.add(state);
          }
        }

        if (intersection.size > 0 && difference.size > 0) {
          newPartitions.push(intersection);
          newPartitions.push(difference);

          const inWorklist = worklist.some((w) => setsEqual(w, partition));
          if (inWorklist) {
            worklist = worklist.filter((w) => !setsEqual(w, partition));
            worklist.push(intersection);
            worklist.push(difference);
          } else {
            if (intersection.size <= difference.size) {
              worklist.push(intersection);
            } else {
              worklist.push(difference);
            }
          }

          for (const state of intersection) {
            partitionMap.set(state, newPartitions.length - 2);
          }
          for (const state of difference) {
            partitionMap.set(state, newPartitions.length - 1);
          }
        } else {
          newPartitions.push(partition);
        }
      }

      partitions = newPartitions;
    }
  }

  const equivalenceClasses = [];
  for (let i = 0; i < partitions.length; i++) {
    equivalenceClasses.push(Array.from(partitions[i]).sort());
  }
  equivalenceClasses.sort((a, b) => a[0].localeCompare(b[0]));

  const stateToClass = new Map();
  for (let i = 0; i < equivalenceClasses.length; i++) {
    for (const state of equivalenceClasses[i]) {
      stateToClass.set(state, i);
    }
  }

  return {
    equivalenceClasses,
    stateToClass,
    originalStateCount: stateNames.length,
    minimizedStateCount: equivalenceClasses.length,
  };
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) {
    if (!b.has(x)) return false;
  }
  return true;
}

function buildMinimizedFSM(fsm, minimizationResult) {
  const { equivalenceClasses, stateToClass } = minimizationResult;
  const { table, symbols } = buildTransitionTable(fsm);

  const classRepresentatives = equivalenceClasses.map((cls) => cls[0]);

  const states = [];
  for (let i = 0; i < equivalenceClasses.length; i++) {
    const repName = classRepresentatives[i];
    const repState = parser.getStateByName(fsm, repName);
    const mergedNames = equivalenceClasses[i];

    states.push({
      name: repName,
      is_initial: equivalenceClasses[i].some((s) => parser.getStateByName(fsm, s)?.is_initial),
      is_final: equivalenceClasses[i].some((s) => parser.getStateByName(fsm, s)?.is_final),
      entry_action: repState?.entry_action || null,
      exit_action: repState?.exit_action || null,
      _mergedStates: mergedNames,
    });
  }

  const transitions = [];
  const seen = new Set();

  for (let i = 0; i < equivalenceClasses.length; i++) {
    const fromClass = classRepresentatives[i];
    const fromTransitions = table.get(fromClass);

    if (!fromTransitions) continue;

    for (const [sym, toState] of fromTransitions.entries()) {
      const toClassIdx = stateToClass.get(toState);
      const toClass = classRepresentatives[toClassIdx];

      const event = sym.includes('[') ? sym.slice(0, sym.indexOf('[')) : sym;
      const guardMatch = sym.match(/\[(.*)\]$/);
      const guard = guardMatch ? guardMatch[1] : null;

      const key = `${fromClass}->${toClass}:${sym}`;
      if (!seen.has(key)) {
        seen.add(key);

        const origTransition = fsm.transitions.find(
          (t) => transitionSymbol(t) === sym && t.from === fromClass
        );

        transitions.push({
          from: fromClass,
          to: toClass,
          event,
          guard,
          action: origTransition?.action || null,
        });
      }
    }
  }

  return {
    name: fsm.name + '_minimized',
    states,
    transitions,
    _minimizationInfo: {
      originalStates: minimizationResult.originalStateCount,
      minimizedStates: minimizationResult.minimizedStateCount,
      mergedStateCount: minimizationResult.originalStateCount - minimizationResult.minimizedStateCount,
      equivalenceClasses: equivalenceClasses.map((cls) => ({
        representative: cls[0],
        merged: cls,
      })),
    },
  };
}

function canonicalForm(fsm) {
  const minimized = buildMinimizedFSM(fsm, hopcroftMinimize(fsm));

  const stateToIndex = new Map();
  const queue = [];
  const visited = new Set();
  const initial = minimized.states.find((s) => s.is_initial);

  if (initial) {
    queue.push(initial.name);
    visited.add(initial.name);
  }

  let idx = 0;
  while (queue.length > 0) {
    const state = queue.shift();
    stateToIndex.set(state, `q${idx++}`);

    const transitions = minimized.transitions
      .filter((t) => t.from === state)
      .sort((a, b) => transitionSymbol(a).localeCompare(transitionSymbol(b)));

    for (const t of transitions) {
      if (!visited.has(t.to)) {
        visited.add(t.to);
        queue.push(t.to);
      }
    }
  }

  for (const s of minimized.states) {
    if (!stateToIndex.has(s.name)) {
      stateToIndex.set(s.name, `q${idx++}`);
    }
  }

  const canonicalStates = minimized.states
    .map((s) => ({
      ...s,
      name: stateToIndex.get(s.name),
      _originalName: s.name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  const canonicalTransitions = minimized.transitions.map((t) => ({
    ...t,
    from: stateToIndex.get(t.from),
    to: stateToIndex.get(t.to),
  }));

  canonicalTransitions.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    return transitionSymbol(a).localeCompare(transitionSymbol(b));
  });

  return {
    name: minimized.name,
    states: canonicalStates,
    transitions: canonicalTransitions,
    stateMapping: stateToIndex,
  };
}

function checkEquivalence(fsm1, fsm2) {
  const canon1 = canonicalForm(fsm1);
  const canon2 = canonicalForm(fsm2);

  if (canon1.states.length !== canon2.states.length) {
    return {
      equivalent: false,
      reason: `Different number of states in minimized form: ${canon1.states.length} vs ${canon2.states.length}`,
      canon1,
      canon2,
    };
  }

  const finalCount1 = canon1.states.filter((s) => s.is_final).length;
  const finalCount2 = canon2.states.filter((s) => s.is_final).length;
  if (finalCount1 !== finalCount2) {
    return {
      equivalent: false,
      reason: `Different number of final states: ${finalCount1} vs ${finalCount2}`,
      canon1,
      canon2,
    };
  }

  if (canon1.transitions.length !== canon2.transitions.length) {
    return {
      equivalent: false,
      reason: `Different number of transitions: ${canon1.transitions.length} vs ${canon2.transitions.length}`,
      canon1,
      canon2,
    };
  }

  for (let i = 0; i < canon1.transitions.length; i++) {
    const t1 = canon1.transitions[i];
    const t2 = canon2.transitions[i];
    if (
      t1.from !== t2.from ||
      t1.to !== t2.to ||
      transitionSymbol(t1) !== transitionSymbol(t2)
    ) {
      return {
        equivalent: false,
        reason: `Transition mismatch at position ${i}`,
        detail: { transition1: t1, transition2: t2 },
        canon1,
        canon2,
      };
    }
  }

  return {
    equivalent: true,
    reason: 'Minimized automata are identical up to state renaming',
    canon1,
    canon2,
  };
}

function formatMinimizationResult(minimizedFSM) {
  const lines = [];
  const info = minimizedFSM._minimizationInfo;

  lines.push(`${BOLD}=== FSM Minimization: ${minimizedFSM.name} ===${RESET}\n`);
  lines.push(`Original states: ${info.originalStates}`);
  lines.push(`Minimized states: ${info.minimizedStates}`);
  lines.push(`States merged: ${info.mergedStateCount}\n`);

  lines.push(`${BOLD}Equivalence Classes (merged states):${RESET}`);
  info.equivalenceClasses.forEach((cls, i) => {
    const tag = cls.merged.length > 1 ? `${YELLOW}(merged ${cls.merged.length} states)${RESET}` : '';
    lines.push(`  Class ${i + 1}: ${cls.representative} ${tag}`);
    if (cls.merged.length > 1) {
      cls.merged.forEach((s) => {
        if (s !== cls.representative) {
          lines.push(`    ${YELLOW}≡ ${s}${RESET}`);
        }
      });
    }
  });

  lines.push(`\n${BOLD}Minimized States:${RESET}`);
  minimizedFSM.states.forEach((s) => {
    const tags = [];
    if (s.is_initial) tags.push('initial');
    if (s.is_final) tags.push('final');
    lines.push(`  ${s.name}${tags.length > 0 ? ` (${tags.join(', ')})` : ''}`);
  });

  lines.push(`\n${BOLD}Minimized Transitions:${RESET}`);
  minimizedFSM.transitions.forEach((t) => {
    const guardStr = t.guard ? ` [guard: ${t.guard}]` : '';
    const actionStr = t.action ? ` [action: ${t.action}]` : '';
    lines.push(`  ${t.from} ──(${t.event})──▶ ${t.to}${guardStr}${actionStr}`);
  });

  return lines.join('\n');
}

function formatEquivalenceResult(result, fsm1Name, fsm2Name) {
  const lines = [];

  lines.push(`${BOLD}=== FSM Equivalence Check ===${RESET}\n`);
  lines.push(`FSM 1: ${fsm1Name}`);
  lines.push(`FSM 2: ${fsm2Name}\n`);

  if (result.equivalent) {
    lines.push(`${GREEN}✓ The two FSMs are behaviorally equivalent.${RESET}`);
    lines.push(`   ${result.reason}`);
    lines.push(`   Minimized state count: ${result.canon1.states.length}`);
  } else {
    lines.push(`${RED}✗ The two FSMs are NOT behaviorally equivalent.${RESET}`);
    lines.push(`   Reason: ${result.reason}`);
    if (result.detail) {
      lines.push(`   Details: ${JSON.stringify(result.detail, null, 2)}`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  hopcroftMinimize,
  buildMinimizedFSM,
  checkEquivalence,
  canonicalForm,
  formatMinimizationResult,
  formatEquivalenceResult,
  transitionSymbol,
  buildTransitionTable,
};
