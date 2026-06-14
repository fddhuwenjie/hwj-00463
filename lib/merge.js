'use strict';

const parser = require('./parser');

function prefixStateName(prefix, name) {
  return prefix + name;
}

function mergeStates(fsm1, fsm2, prefix1, prefix2) {
  const stateMap = new Map();
  const states = [];

  for (const s of fsm1.states) {
    const newName = prefixStateName(prefix1, s.name);
    const newState = { ...s, name: newName, _originalName: s.name, _source: 'fsm1' };
    stateMap.set(`fsm1:${s.name}`, newName);
    states.push(newState);
  }

  for (const s of fsm2.states) {
    const newName = prefixStateName(prefix2, s.name);
    const newState = { ...s, name: newName, _originalName: s.name, _source: 'fsm2' };
    stateMap.set(`fsm2:${s.name}`, newName);
    states.push(newState);
  }

  return { states, stateMap };
}

function mergeTransitions(fsm1, fsm2, stateMap, prefix1, prefix2) {
  const transitions = [];
  const seen = new Set();

  function addTransition(t, sourcePrefix, sourceFsm) {
    const fromKey = `${sourceFsm}:${t.from}`;
    const toKey = `${sourceFsm}:${t.to}`;
    const newFrom = stateMap.get(fromKey) || t.from;
    const newTo = stateMap.get(toKey) || t.to;
    const key = `${newFrom}->${newTo}:${t.event}${t.guard ? `[${t.guard}]` : ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      transitions.push({ ...t, from: newFrom, to: newTo, _source: sourceFsm });
    }
  }

  for (const t of fsm1.transitions) {
    addTransition(t, prefix1, 'fsm1');
  }

  for (const t of fsm2.transitions) {
    addTransition(t, prefix2, 'fsm2');
  }

  return transitions;
}

function mergeUnion(fsm1, fsm2, options = {}) {
  const prefix1 = options.prefix1 || (fsm1.name + '_');
  const prefix2 = options.prefix2 || (fsm2.name + '_');

  const { states, stateMap } = mergeStates(fsm1, fsm2, prefix1, prefix2);
  const transitions = mergeTransitions(fsm1, fsm2, stateMap, prefix1, prefix2);

  const initial1 = parser.getInitialState(fsm1);
  const initial2 = parser.getInitialState(fsm2);

  const result = {
    name: `${fsm1.name}_union_${fsm2.name}`,
    states,
    transitions,
    _mergeInfo: {
      strategy: 'union',
      prefix1,
      prefix2,
      originalStateCount: { fsm1: fsm1.states.length, fsm2: fsm2.states.length },
      originalTransitionCount: { fsm1: fsm1.transitions.length, fsm2: fsm2.transitions.length },
    },
  };

  return result;
}

function mergeIntersection(fsm1, fsm2, options = {}) {
  const prefix1 = options.prefix1 || (fsm1.name + '_');
  const prefix2 = options.prefix2 || (fsm2.name + '_');

  const stateNames1 = new Set(fsm1.states.map((s) => s.name));
  const stateNames2 = new Set(fsm2.states.map((s) => s.name));

  const commonStateNames = [...stateNames1].filter((n) => stateNames2.has(n));

  const states = [];
  const stateMap = new Map();

  for (const name of commonStateNames) {
    const s1 = fsm1.states.find((s) => s.name === name);
    const s2 = fsm2.states.find((s) => s.name === name);
    const merged = {
      name,
      is_initial: s1.is_initial || s2.is_initial,
      is_final: s1.is_final || s2.is_final,
      entry_action: s1.entry_action || s2.entry_action,
      exit_action: s1.exit_action || s2.exit_action,
      _merged: true,
    };
    states.push(merged);
    stateMap.set(`fsm1:${name}`, name);
    stateMap.set(`fsm2:${name}`, name);
  }

  const commonStateSet = new Set(commonStateNames);
  const transitions = [];
  const seen = new Set();

  function addIfCommon(t, sourceFsm) {
    if (!commonStateSet.has(t.from) || !commonStateSet.has(t.to)) return;
    const key = `${t.from}->${t.to}:${t.event}${t.guard ? `[${t.guard}]` : ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      transitions.push({ ...t, _source: sourceFsm });
    }
  }

  for (const t of fsm1.transitions) {
    addIfCommon(t, 'fsm1');
  }
  for (const t of fsm2.transitions) {
    addIfCommon(t, 'fsm2');
  }

  const result = {
    name: `${fsm1.name}_intersection_${fsm2.name}`,
    states,
    transitions,
    _mergeInfo: {
      strategy: 'intersection',
      commonStateCount: commonStateNames.length,
      commonTransitionCount: transitions.length,
    },
  };

  return result;
}

function mergeCompose(fsm1, fsm2, options = {}) {
  const prefix1 = options.prefix1 || (fsm1.name + '_');
  const prefix2 = options.prefix2 || (fsm2.name + '_');

  const { states, stateMap } = mergeStates(fsm1, fsm2, prefix1, prefix2);
  const transitions = mergeTransitions(fsm1, fsm2, stateMap, prefix1, prefix2);

  const finalStates1 = parser.getFinalStates(fsm1);
  const initial2 = parser.getInitialState(fsm2);

  const bridgeTransitions = [];
  const bridgeEvents = options.bridgeEvent || 'continue';

  if (initial2) {
    const initial2Name = stateMap.get(`fsm2:${initial2.name}`);
    for (const fs of finalStates1) {
      const fsName = stateMap.get(`fsm1:${fs.name}`);
      const bridge = {
        from: fsName,
        to: initial2Name,
        event: bridgeEvents,
        guard: null,
        action: null,
        _source: 'bridge',
      };
      bridgeTransitions.push(bridge);
      transitions.push(bridge);
    }
  }

  const initial1 = parser.getInitialState(fsm1);
  const initial1Name = initial1 ? stateMap.get(`fsm1:${initial1.name}`) : null;

  const result = {
    name: `${fsm1.name}_compose_${fsm2.name}`,
    states,
    transitions,
    _mergeInfo: {
      strategy: 'compose',
      prefix1,
      prefix2,
      bridgeEvent: bridgeEvents,
      bridgeCount: bridgeTransitions.length,
      initialState: initial1Name,
    },
  };

  return result;
}

function mergeFSMs(fsm1, fsm2, strategy = 'union', options = {}) {
  switch (strategy) {
    case 'union':
      return mergeUnion(fsm1, fsm2, options);
    case 'intersection':
      return mergeIntersection(fsm1, fsm2, options);
    case 'compose':
      return mergeCompose(fsm1, fsm2, options);
    default:
      throw new Error(`Unknown merge strategy: ${strategy}. Use: union, intersection, compose`);
  }
}

function formatMergeResult(merged, strategy) {
  const lines = [];
  lines.push(`Merged FSM: ${merged.name}`);
  lines.push(`Strategy: ${strategy}\n`);

  lines.push(`States: ${merged.states.length}`);
  const initials = merged.states.filter((s) => s.is_initial);
  const finals = merged.states.filter((s) => s.is_final);
  lines.push(`  Initial: ${initials.map((s) => s.name).join(', ') || '(none)'}`);
  lines.push(`  Final: ${finals.map((s) => s.name).join(', ') || '(none)'}\n`);

  lines.push(`Transitions: ${merged.transitions.length}\n`);

  if (merged._mergeInfo) {
    lines.push('Merge details:');
    const info = merged._mergeInfo;
    for (const [key, value] of Object.entries(info)) {
      if (typeof value === 'object') {
        lines.push(`  ${key}:`);
        for (const [k, v] of Object.entries(value)) {
          lines.push(`    ${k}: ${v}`);
        }
      } else {
        lines.push(`  ${key}: ${value}`);
      }
    }
  }

  return lines.join('\n');
}

module.exports = {
  mergeFSMs,
  mergeUnion,
  mergeIntersection,
  mergeCompose,
  formatMergeResult,
};
