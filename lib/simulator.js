'use strict';

const readline = require('readline');
const parser = require('./parser');

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';

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

function executeAction(action, context) {
  if (!action) return;
  try {
    const keys = Object.keys(context);
    const values = Object.values(context);
    const fn = new Function(...keys, `${action};`);
    fn(...values);
  } catch (e) {
  }
}

class BreakpointManager {
  constructor() {
    this.stateBreakpoints = new Set();
    this.eventBreakpoints = new Set();
    this.enabled = true;
  }

  addState(stateName) {
    this.stateBreakpoints.add(stateName);
  }

  removeState(stateName) {
    this.stateBreakpoints.delete(stateName);
  }

  addEvent(eventName) {
    this.eventBreakpoints.add(eventName);
  }

  removeEvent(eventName) {
    this.eventBreakpoints.delete(eventName);
  }

  clear() {
    this.stateBreakpoints.clear();
    this.eventBreakpoints.clear();
  }

  shouldBreakOnState(stateName) {
    return this.enabled && this.stateBreakpoints.has(stateName);
  }

  shouldBreakOnEvent(eventName) {
    return this.enabled && this.eventBreakpoints.has(eventName);
  }

  list() {
    return {
      states: Array.from(this.stateBreakpoints),
      events: Array.from(this.eventBreakpoints),
    };
  }
}

async function simulate(fsm, options = {}) {
  const initial = parser.getInitialState(fsm);
  if (!initial) {
    console.error('Error: No initial state found. Cannot simulate.');
    return;
  }

  let currentState = initial.name;
  const context = { ...(options.context || {}) };
  const history = [];
  const breakpoints = new BreakpointManager();
  let paused = false;

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const prompt = (q) => new Promise((resolve) => rl.question(q, resolve));

  console.log(`\n${BOLD}=== FSM Simulator: ${fsm.name} ===${RESET}`);
  console.log(`Type event name to trigger transition, or use commands:`);
  console.log(`  status    - Show current state details`);
  console.log(`  context   - View context variables`);
  console.log(`  set k=v   - Set context variable`);
  console.log(`  history   - Show transition history`);
  console.log(`  break     - List breakpoints`);
  console.log(`  break state <name>  - Set breakpoint on entering state`);
  console.log(`  break event <name>  - Set breakpoint on event`);
  console.log(`  clear state <name>  - Clear state breakpoint`);
  console.log(`  clear event <name>  - Clear event breakpoint`);
  console.log(`  clear all - Clear all breakpoints`);
  console.log(`  continue  - Continue from breakpoint`);
  console.log(`  step      - Step to next transition (same as continue)`);
  console.log(`  quit      - Exit simulation\n`);

  function checkBreakpoint(state, event) {
    if (breakpoints.shouldBreakOnState(state)) {
      console.log(`\n${YELLOW}⛔ Breakpoint hit: entering state "${state}"${RESET}`);
      return true;
    }
    if (event && breakpoints.shouldBreakOnEvent(event)) {
      console.log(`\n${YELLOW}⛔ Breakpoint hit: event "${event}"${RESET}`);
      return true;
    }
    return false;
  }

  while (true) {
    const available = parser.getTransitionsFrom(fsm, currentState);
    const eventNames = [...new Set(available.map((t) => t.event))];
    console.log(`\n${CYAN}Current state:${RESET} ${currentState}`);
    console.log(`${CYAN}Available events:${RESET} ${eventNames.length > 0 ? eventNames.join(', ') : '(none)'}`);

    if (paused) {
      console.log(`${YELLOW}Paused at breakpoint. Use "continue" or "step" to resume.${RESET}`);
    }

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
      if (state && state.is_initial) console.log(`  is_initial: true`);
      if (state && state.is_final) console.log(`  is_final: true`);
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

    if (input === 'break' || input.startsWith('break ')) {
      const parts = input.split(/\s+/);
      if (parts.length === 1) {
        const bp = breakpoints.list();
        console.log('Breakpoints:');
        if (bp.states.length === 0 && bp.events.length === 0) {
          console.log('  (none)');
        } else {
          bp.states.forEach((s) => console.log(`  state: ${s}`));
          bp.events.forEach((e) => console.log(`  event: ${e}`));
        }
      } else if (parts[1] === 'state' && parts[2]) {
        breakpoints.addState(parts[2]);
        console.log(`${GREEN}Breakpoint set on state: ${parts[2]}${RESET}`);
      } else if (parts[1] === 'event' && parts[2]) {
        breakpoints.addEvent(parts[2]);
        console.log(`${GREEN}Breakpoint set on event: ${parts[2]}${RESET}`);
      } else {
        console.log('Usage: break state <name> | break event <name>');
      }
      continue;
    }

    if (input.startsWith('clear ')) {
      const parts = input.split(/\s+/);
      if (parts[1] === 'state' && parts[2]) {
        breakpoints.removeState(parts[2]);
        console.log(`Cleared breakpoint on state: ${parts[2]}`);
      } else if (parts[1] === 'event' && parts[2]) {
        breakpoints.removeEvent(parts[2]);
        console.log(`Cleared breakpoint on event: ${parts[2]}`);
      } else if (parts[1] === 'all') {
        breakpoints.clear();
        console.log('Cleared all breakpoints.');
      } else {
        console.log('Usage: clear state <name> | clear event <name> | clear all');
      }
      continue;
    }

    if (input === 'continue' || input === 'step' || input === 'c' || input === 's') {
      if (!paused) {
        console.log('Not paused at a breakpoint.');
      }
      paused = false;
      continue;
    }

    if (paused) {
      console.log(`${YELLOW}Paused at breakpoint. Use "continue" to resume.${RESET}`);
      continue;
    }

    const matching = available.filter((t) => t.event === input);
    if (matching.length === 0) {
      console.log(`No transition for event "${input}" from state "${currentState}".`);
      continue;
    }

    if (checkBreakpoint(null, input)) {
      paused = true;
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
      executeAction(fired.action, context);
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
      context: { ...context },
      timestamp: Date.now(),
    });

    console.log(`  ${GREEN}${prevState} ──(${fired.event})──▶ ${currentState}${RESET}`);

    if (checkBreakpoint(currentState, null)) {
      paused = true;
    }

    if (nextState && nextState.is_final) {
      console.log(`\n${GREEN}Reached final state: ${currentState}${RESET}`);
      const cont = (await prompt('Continue? (y/n) ')).trim().toLowerCase();
      if (cont !== 'y') {
        console.log('Simulation ended.');
        break;
      }
    }
  }

  rl.close();
  return { history, context, finalState: currentState };
}

module.exports = { simulate, evaluateGuard, executeAction, BreakpointManager };
