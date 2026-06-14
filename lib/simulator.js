'use strict';

const readline = require('readline');
const parser = require('./parser');

function evaluateGuard(guard, context) {
  if (!guard) return true;
  try {
    const keys = Object.keys(context);
    const values = Object.values(context);
    const fn = new Function(...keys, `return (${guard});`);
    return !!fn(...values);
  } catch (e) {
    return false;
  }
}

async function simulate(fsm, options) {
  const initial = parser.getInitialState(fsm);
  if (!initial) {
    console.error('Error: No initial state found. Cannot simulate.');
    return;
  }

  let currentState = initial.name;
  const context = { ...(options.context || {}) };
  const history = [];
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log(`\n=== FSM Simulator: ${fsm.name} ===`);
  console.log(`Type event name to trigger transition, "status" for current state,`);
  console.log(`"context" to view context, "history" for transition log, "quit" to exit.\n`);

  while (true) {
    const available = parser.getTransitionsFrom(fsm, currentState);
    const eventNames = [...new Set(available.map((t) => t.event))];
    console.log(`Current state: ${currentState}`);
    console.log(`Available events: ${eventNames.length > 0 ? eventNames.join(', ') : '(none)'}`);

    const input = (await prompt('> ')).trim();
    if (input === 'quit' || input === 'exit') {
      console.log('Simulation ended.');
      break;
    }
    if (input === 'status') {
      const state = parser.getStateByName(fsm, currentState);
      console.log(`State: ${currentState}`);
      if (state && state.entry_action) console.log(`  entry_action: ${state.entry_action}`);
      if (state && state.exit_action) console.log(`  exit_action: ${state.exit_action}`);
      continue;
    }
    if (input === 'context') {
      console.log('Context:', JSON.stringify(context, null, 2));
      continue;
    }
    if (input === 'history') {
      if (history.length === 0) {
        console.log('No transitions yet.');
      } else {
        history.forEach((h, i) => {
          console.log(
            `  ${i + 1}. ${h.from} ──(${h.event})──▶ ${h.to}${h.action ? ` [action: ${h.action}]` : ''}${h.guard ? ` [guard: ${h.guard} ${h.guardPassed ? '✓' : '✗'}]` : ''}`
          );
        });
      }
      continue;
    }
    if (input.startsWith('set ')) {
      const parts = input.slice(4).split('=');
      if (parts.length === 2) {
        const key = parts[0].trim();
        let val = parts[1].trim();
        if (!isNaN(val)) val = Number(val);
        else if (val === 'true') val = true;
        else if (val === 'false') val = false;
        context[key] = val;
        console.log(`Context updated: ${key} = ${val}`);
      } else {
        console.log('Usage: set <key>=<value>');
      }
      continue;
    }

    const matching = available.filter((t) => t.event === input);
    if (matching.length === 0) {
      console.log(`No transition for event "${input}" from state "${currentState}".`);
      continue;
    }

    let fired = null;
    let guardPassed = false;
    for (const t of matching) {
      const guardResult = evaluateGuard(t.guard, context);
      if (guardResult) {
        fired = t;
        guardPassed = true;
        break;
      }
    }

    if (!fired) {
      const guards = matching.map((t) => t.guard).filter(Boolean);
      if (guards.length > 0) {
        console.log(`Event "${input}" available but all guards failed: ${guards.join(', ')}`);
      }
      continue;
    }

    const prevState = currentState;
    const prevExit = parser.getStateByName(fsm, prevState);
    if (prevExit && prevExit.exit_action) {
      console.log(`  Exit action: ${prevExit.exit_action}`);
    }

    currentState = fired.to;

    if (fired.action) {
      console.log(`  Action: ${fired.action}`);
    }

    const nextState = parser.getStateByName(fsm, currentState);
    if (nextState && nextState.entry_action) {
      console.log(`  Entry action: ${nextState.entry_action}`);
    }

    history.push({
      from: prevState,
      to: currentState,
      event: fired.event,
      guard: fired.guard,
      guardPassed,
      action: fired.action,
    });

    console.log(`  ${prevState} ──(${fired.event})──▶ ${currentState}`);

    if (nextState && nextState.is_final) {
      console.log(`\nReached final state: ${currentState}`);
      const cont = (await prompt('Continue? (y/n) ')).trim().toLowerCase();
      if (cont !== 'y') {
        console.log('Simulation ended.');
        break;
      }
    }
  }

  rl.close();
  return history;
}

module.exports = { simulate, evaluateGuard };
