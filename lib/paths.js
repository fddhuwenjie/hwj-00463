'use strict';

const parser = require('./parser');

function generatePaths(fsm, maxDepth = 10) {
  const initial = parser.getInitialState(fsm);
  if (!initial) return [];

  const paths = [];
  const pathStateSet = new Set();

  function dfs(currentState, path, depth) {
    if (depth > maxDepth) {
      if (path.length > 0) paths.push([...path]);
      return;
    }

    const state = parser.getStateByName(fsm, currentState);
    if (state && state.is_final && depth > 0) {
      paths.push([...path]);
      return;
    }

    const transitions = parser.getTransitionsFrom(fsm, currentState);
    if (transitions.length === 0) {
      if (path.length > 0) paths.push([...path]);
      return;
    }

    for (const t of transitions) {
      if (pathStateSet.has(t.to) && depth > 0) {
        path.push({ from: t.from, to: t.to, event: t.event, guard: t.guard, action: t.action });
        paths.push([...path]);
        path.pop();
        continue;
      }
      pathStateSet.add(t.to);
      path.push({ from: t.from, to: t.to, event: t.event, guard: t.guard, action: t.action });
      dfs(t.to, path, depth + 1);
      path.pop();
      pathStateSet.delete(t.to);
    }
  }

  pathStateSet.add(initial.name);
  dfs(initial.name, [], 0);
  return paths;
}

function formatPaths(paths) {
  const lines = [];
  lines.push(`Found ${paths.length} path(s):\n`);
  paths.forEach((path, i) => {
    const steps = path.map((s) => `${s.from} ──(${s.event})──▶ ${s.to}`);
    lines.push(`  Path ${i + 1}:`);
    steps.forEach((step) => lines.push(`    ${step}`));
    lines.push('');
  });
  return lines.join('\n');
}

function computeCoverage(fsm, eventSequence) {
  let currentState = parser.getInitialState(fsm);
  if (!currentState) return { coverage: 0, covered: [], total: fsm.transitions.length };

  currentState = currentState.name;
  const covered = new Set();

  for (const event of eventSequence) {
    const transitions = parser.getTransitionsFrom(fsm, currentState);
    const matching = transitions.filter((t) => t.event === event);
    if (matching.length > 0) {
      const t = matching[0];
      covered.add(`${t.from}->${t.to}:${t.event}`);
      currentState = t.to;
    }
  }

  const total = fsm.transitions.length;
  const coveragePercent = total > 0 ? Math.round((covered.size / total) * 100) : 0;

  return {
    coverage: coveragePercent,
    covered: Array.from(covered),
    total,
    uncovered: fsm.transitions
      .filter((t) => !covered.has(`${t.from}->${t.to}:${t.event}`))
      .map((t) => `${t.from}->${t.to}:${t.event}`),
  };
}

function formatCoverage(result) {
  const lines = [];
  lines.push(`Transition Coverage: ${result.coverage}%`);
  lines.push(`Covered: ${result.covered.length} / ${result.total} transitions\n`);
  lines.push('Covered transitions:');
  result.covered.forEach((c) => lines.push(`  ✓ ${c}`));
  if (result.uncovered.length > 0) {
    lines.push('\nUncovered transitions:');
    result.uncovered.forEach((u) => lines.push(`  ✗ ${u}`));
  }
  return lines.join('\n');
}

function minimalTestSet(fsm) {
  const transitions = fsm.transitions.map((t) => ({ from: t.from, to: t.to, event: t.event, guard: t.guard }));
  const initial = parser.getInitialState(fsm);
  if (!initial || transitions.length === 0) return { sequences: [], unguardedCoverage: 0, totalTransitions: transitions.length };

  const covered = new Set();
  const sequences = [];

  for (const target of transitions) {
    const targetKey = `${target.from}->${target.to}:${target.event}`;
    if (covered.has(targetKey)) continue;

    const pathToStart = findPath(fsm, initial.name, target.from);
    if (pathToStart.length === 0 && initial.name !== target.from) continue;

    const eventSeq = pathToStart.map((t) => t.event);
    eventSeq.push(target.event);

    let currentState = initial.name;
    for (const evt of eventSeq) {
      const transitionsFrom = parser.getTransitionsFrom(fsm, currentState);
      const match = transitionsFrom.find((t) => {
        if (t.event !== evt) return false;
        if (currentState === target.from && t.to === target.to) return true;
        return !t.guard;
      }) || transitionsFrom.find((t) => t.event === evt && !t.guard)
        || transitionsFrom.find((t) => t.event === evt);

      if (match) {
        covered.add(`${match.from}->${match.to}:${match.event}`);
        currentState = match.to;
      }
    }

    sequences.push(eventSeq);
  }

  const totalUnguarded = transitions.filter((t) => !t.guard).length;
  const coveredUnguarded = [...covered].filter((key) => {
    const t = transitions.find((tr) => `${tr.from}->${tr.to}:${tr.event}` === key);
    return t && !t.guard;
  }).length;

  return {
    sequences,
    unguardedCoverage: totalUnguarded > 0 ? Math.round((coveredUnguarded / totalUnguarded) * 100) : 0,
    totalTransitions: transitions.length,
    coveredTransitions: covered.size,
    guardNote: transitions.some((t) => t.guard)
      ? 'Some transitions have guard conditions and require specific context to trigger.'
      : null,
  };
}

function findPath(fsm, from, to) {
  if (from === to) return [];
  const queue = [[from, []]];
  const visited = new Set([from]);

  while (queue.length > 0) {
    const [current, path] = queue.shift();
    const transitions = parser.getTransitionsFrom(fsm, current);

    for (const t of transitions) {
      if (t.to === to) {
        return [...path, t];
      }
      if (!visited.has(t.to)) {
        visited.add(t.to);
        queue.push([t.to, [...path, t]]);
      }
    }
  }

  return [];
}

function formatMinimalTestSet(result) {
  const lines = [];
  lines.push(`Minimal Test Set\n`);
  lines.push(`  Transitions covered: ${result.coveredTransitions} / ${result.totalTransitions}`);
  lines.push(`  Unguarded coverage: ${result.unguardedCoverage}%\n`);
  result.sequences.forEach((seq, i) => {
    lines.push(`  Test ${i + 1}: ${seq.join(' -> ')}`);
  });
  if (result.guardNote) {
    lines.push(`\n  Note: ${result.guardNote}`);
  }
  return lines.join('\n');
}

module.exports = {
  generatePaths,
  formatPaths,
  computeCoverage,
  formatCoverage,
  minimalTestSet,
  formatMinimalTestSet,
};
