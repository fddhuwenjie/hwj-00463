'use strict';

const parser = require('./parser');
const validator = require('./validator');

function flattenFSM(fsm) {
  const result = {
    name: fsm.name + '_flat',
    states: [],
    transitions: [],
  };

  const submachineMap = new Map();

  for (const s of fsm.states) {
    if (s.submachine) {
      const sub = resolveSubmachine(s.submachine, fsm);
      if (sub) {
        const prefix = s.name + '.';
        const subInitial = parser.getInitialState(sub);

        for (const ss of sub.states) {
          const fullName = prefix + ss.name;
          result.states.push({
            name: fullName,
            is_initial: s.is_initial && ss.is_initial,
            is_final: ss.is_final,
            entry_action: ss.entry_action,
            exit_action: ss.exit_action,
          });
        }

        for (const st of sub.transitions) {
          result.transitions.push({
            from: prefix + st.from,
            to: prefix + st.to,
            event: st.event,
            guard: st.guard,
            action: st.action,
          });
        }

        submachineMap.set(s.name, { prefix, sub, subInitial });
      }
    } else {
      result.states.push({ ...s });
    }
  }

  for (const t of fsm.transitions) {
    const fromInfo = submachineMap.get(t.from);
    const toInfo = submachineMap.get(t.to);

    if (fromInfo && toInfo) {
      for (const sf of fromInfo.sub.states) {
        if (toInfo.subInitial) {
          result.transitions.push({
            from: fromInfo.prefix + sf.name,
            to: toInfo.prefix + toInfo.subInitial.name,
            event: t.event,
            guard: t.guard,
            action: t.action,
          });
        }
      }
    } else if (fromInfo) {
      for (const sf of fromInfo.sub.states) {
        result.transitions.push({
          from: fromInfo.prefix + sf.name,
          to: t.to,
          event: t.event,
          guard: t.guard,
          action: t.action,
        });
      }
    } else if (toInfo) {
      if (toInfo.subInitial) {
        result.transitions.push({
          from: t.from,
          to: toInfo.prefix + toInfo.subInitial.name,
          event: t.event,
          guard: t.guard,
          action: t.action,
        });
      }
    } else {
      result.transitions.push({ ...t });
    }
  }

  return result;
}

function resolveSubmachine(submachineRef, fsm) {
  if (typeof submachineRef === 'object' && submachineRef.states) {
    return parser.normalizeFSM(submachineRef);
  }
  if (fsm.substates && Array.isArray(fsm.substates)) {
    const found = fsm.substates.find((s) => s.name === submachineRef);
    if (found) return found;
  }
  return null;
}

function flattenParallel(fsm) {
  if (!fsm.parallel || fsm.parallel.length === 0) {
    return flattenFSM(fsm);
  }

  const result = {
    name: fsm.name + '_flat',
    states: [],
    transitions: [],
  };

  const regions = fsm.parallel;
  const regionStates = regions.map((r) => r.states);
  const regionInitials = regions.map((r) => parser.getInitialState(r));

  const combinations = cartesianProduct(regionStates);
  for (const combo of combinations) {
    const name = combo.map((s) => s.name).join('+');
    result.states.push({
      name,
      is_initial: combo.every((s) => s.is_initial),
      is_final: combo.every((s) => s.is_final),
      entry_action: combo.map((s) => s.entry_action).filter(Boolean).join('; ') || null,
      exit_action: combo.map((s) => s.exit_action).filter(Boolean).join('; ') || null,
    });
  }

  for (const combo of combinations) {
    const comboName = combo.map((s) => s.name).join('+');

    for (let ri = 0; ri < regions.length; ri++) {
      const region = regions[ri];
      const currentState = combo[ri];
      const transitions = region.transitions.filter((t) => t.from === currentState.name);

      for (const t of transitions) {
        const newCombo = [...combo];
        const targetState = region.states.find((s) => s.name === t.to);
        if (targetState) {
          newCombo[ri] = targetState;
          const targetName = newCombo.map((s) => s.name).join('+');
          result.transitions.push({
            from: comboName,
            to: targetName,
            event: t.event,
            guard: t.guard,
            action: t.action,
          });
        }
      }
    }
  }

  return result;
}

function cartesianProduct(arrays) {
  return arrays.reduce(
    (acc, arr) => acc.flatMap((combo) => arr.map((item) => [...combo, item])),
    [[]]
  );
}

function formatFlattenResult(flatFSM) {
  const lines = [];
  lines.push(`Flattened FSM: ${flatFSM.name}\n`);
  lines.push('States:');
  for (const s of flatFSM.states) {
    const tags = [];
    if (s.is_initial) tags.push('initial');
    if (s.is_final) tags.push('final');
    lines.push(`  ${s.name}${tags.length > 0 ? ` (${tags.join(', ')})` : ''}`);
  }
  lines.push('\nTransitions:');
  for (const t of flatFSM.transitions) {
    lines.push(`  ${t.from} ──(${t.event})──▶ ${t.to}`);
  }
  return lines.join('\n');
}

module.exports = {
  flattenFSM,
  flattenParallel,
  formatFlattenResult,
};
