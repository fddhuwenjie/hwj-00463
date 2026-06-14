'use strict';

function validate(fsm) {
  const errors = [];
  const warnings = [];

  const initialStates = fsm.states.filter((s) => s.is_initial);
  if (initialStates.length === 0) {
    errors.push('No initial state defined. FSM must have exactly one initial state.');
  } else if (initialStates.length > 1) {
    errors.push(
      `Multiple initial states found: ${initialStates.map((s) => s.name).join(', ')}. FSM must have exactly one initial state.`
    );
  }

  const stateNames = new Set(fsm.states.map((s) => s.name));
  const duplicates = fsm.states
    .map((s) => s.name)
    .filter((name, idx, arr) => arr.indexOf(name) !== idx);
  if (duplicates.length > 0) {
    errors.push(`Duplicate state names: ${[...new Set(duplicates)].join(', ')}`);
  }

  for (const t of fsm.transitions) {
    if (!stateNames.has(t.from)) {
      errors.push(`Transition references non-existent source state: "${t.from}" (event: "${t.event}")`);
    }
    if (!stateNames.has(t.to)) {
      errors.push(`Transition references non-existent target state: "${t.to}" (event: "${t.event}")`);
    }
    if (!t.event) {
      errors.push(`Transition from "${t.from}" to "${t.to}" has no event defined.`);
    }
  }

  const reachable = new Set();
  const queue = [initialStates.length > 0 ? initialStates[0].name : null];
  if (queue[0]) {
    reachable.add(queue[0]);
    while (queue.length > 0) {
      const current = queue.shift();
      for (const t of fsm.transitions) {
        if (t.from === current && !reachable.has(t.to)) {
          reachable.add(t.to);
          queue.push(t.to);
        }
      }
    }
  }

  for (const s of fsm.states) {
    if (!reachable.has(s.name)) {
      warnings.push(`State "${s.name}" is unreachable from the initial state.`);
    }
  }

  const finalStates = fsm.states.filter((s) => s.is_final);
  if (finalStates.length === 0) {
    warnings.push('No final state defined. Consider adding at least one final state.');
  }

  for (const fs of finalStates) {
    const outgoing = fsm.transitions.filter((t) => t.from === fs.name);
    if (outgoing.length > 0) {
      warnings.push(
        `Final state "${fs.name}" has outgoing transitions: ${outgoing.map((t) => `"${t.event}"`).join(', ')}`
      );
    }
  }

  for (const t of fsm.transitions) {
    const same = fsm.transitions.filter(
      (t2) => t2.from === t.from && t2.to === t.to && t2.event === t.event && t2.guard === t.guard
    );
    if (same.length > 1) {
      errors.push(
        `Duplicate transition: "${t.from}" -> "${t.to}" on event "${t.event}"${t.guard ? ` [${t.guard}]` : ''}`
      );
      break;
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

module.exports = { validate };
