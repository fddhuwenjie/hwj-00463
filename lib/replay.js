'use strict';

const fs = require('fs');
const readline = require('readline');
const parser = require('./parser');
const { evaluateGuard, executeAction } = require('./simulator');

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const GRAY = '\x1b[90m';

function parseEventSequenceFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));

  const events = [];
  for (const line of lines) {
    const trimmed = line.trim();
    const parts = trimmed.split(/\s+/);
    const event = parts[0];
    const contextAssignments = {};

    for (let i = 1; i < parts.length; i++) {
      const assignment = parts[i];
      const eqIdx = assignment.indexOf('=');
      if (eqIdx > 0) {
        const key = assignment.slice(0, eqIdx);
        let val = assignment.slice(eqIdx + 1);
        if (!isNaN(val)) val = Number(val);
        else if (val === 'true') val = true;
        else if (val === 'false') val = false;
        else if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
        contextAssignments[key] = val;
      }
    }

    events.push({ event, context: contextAssignments });
  }

  return events;
}

function buildTrace(history, fsm, initialContext) {
  return {
    fsmName: fsm.name,
    initialState: parser.getInitialState(fsm)?.name || null,
    initialContext: initialContext,
    steps: history.map((h, i) => ({
      step: i + 1,
      from: h.from,
      to: h.to,
      event: h.event,
      guard: h.guard,
      guardPassed: h.guardPassed,
      action: h.action,
      context: h.context,
    })),
    finalState: history.length > 0 ? history[history.length - 1].to : (parser.getInitialState(fsm)?.name || null),
    totalSteps: history.length,
  };
}

async function replay(fsm, events, options = {}) {
  const initial = parser.getInitialState(fsm);
  if (!initial) {
    throw new Error('No initial state found. Cannot replay.');
  }

  const stepMode = options.step || false;
  const untilState = options.untilState || null;
  const exportTrace = options.exportTrace || null;
  const initialContext = { ...(options.context || {}) };

  let currentState = initial.name;
  let context = { ...initialContext };
  const history = [];
  let stoppedReason = null;
  let stoppedStep = 0;

  const rl = stepMode
    ? readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      })
    : null;

  const prompt = stepMode ? (q) => new Promise((resolve) => rl.question(q, resolve)) : null;

  console.log(`\n${BOLD}=== FSM Replay: ${fsm.name} ===${RESET}`);
  console.log(`${CYAN}Event sequence:${RESET} ${events.length} events`);
  if (stepMode) console.log(`${YELLOW}Mode: step (press Enter to continue)${RESET}`);
  if (untilState) console.log(`${YELLOW}Stop at state: ${untilState}${RESET}`);
  console.log(`\n${GRAY}--- Step 0 ---${RESET}`);
  console.log(`  ${CYAN}State:${RESET} ${currentState}`);
  console.log(`  ${CYAN}Context:${RESET} ${JSON.stringify(context)}`);

  for (let i = 0; i < events.length; i++) {
    const { event, context: eventContext } = events[i];

    if (stepMode) {
      await prompt(`\nPress Enter to execute event "${event}"...`);
    }

    console.log(`\n${GRAY}--- Step ${i + 1} ---${RESET}`);
    console.log(`  ${CYAN}Event:${RESET} ${event}`);

    if (Object.keys(eventContext).length > 0) {
      console.log(`  ${CYAN}Context updates:${RESET} ${JSON.stringify(eventContext)}`);
      Object.assign(context, eventContext);
    }

    const available = parser.getTransitionsFrom(fsm, currentState);
    const matching = available.filter((t) => t.event === event);

    if (matching.length === 0) {
      console.log(`  ${RED}✗ No transition for event "${event}" from state "${currentState}"${RESET}`);
      history.push({
        from: currentState,
        to: currentState,
        event,
        guard: null,
        guardPassed: false,
        action: null,
        context: { ...context },
        error: `No transition for event "${event}"`,
      });
      stoppedReason = `No transition for event "${event}"`;
      stoppedStep = i + 1;
      break;
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
      console.log(`  ${RED}✗ All guards failed: ${guards.join(', ')}${RESET}`);
      history.push({
        from: currentState,
        to: currentState,
        event,
        guard: guards.join(', '),
        guardPassed: false,
        action: null,
        context: { ...context },
        error: 'All guards failed',
      });
      stoppedReason = 'All guards failed';
      stoppedStep = i + 1;
      break;
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
    });

    console.log(`  ${GREEN}✓ ${prevState} ──(${fired.event})──▶ ${currentState}${RESET}`);
    console.log(`  ${CYAN}Context:${RESET} ${JSON.stringify(context)}`);

    if (untilState && currentState === untilState) {
      console.log(`\n${YELLOW}Reached target state: ${untilState}${RESET}`);
      stoppedReason = `Reached target state: ${untilState}`;
      stoppedStep = i + 1;
      break;
    }

    if (nextState && nextState.is_final) {
      console.log(`\n${GREEN}Reached final state: ${currentState}${RESET}`);
    }
  }

  if (rl) rl.close();

  const trace = buildTrace(history, fsm, initialContext);
  trace.stoppedReason = stoppedReason;
  trace.stoppedStep = stoppedStep;

  if (exportTrace) {
    fs.writeFileSync(exportTrace, JSON.stringify(trace, null, 2), 'utf-8');
    console.log(`\n${GREEN}Trace exported to: ${exportTrace}${RESET}`);
  }

  console.log(`\n${BOLD}=== Replay Summary ===${RESET}`);
  console.log(`  Total steps executed: ${history.length} / ${events.length}`);
  console.log(`  Final state: ${currentState}`);
  console.log(`  Final context: ${JSON.stringify(context)}`);
  if (stoppedReason) {
    console.log(`  Stopped at step ${stoppedStep}: ${stoppedReason}`);
  }

  return { history, trace, finalState: currentState, context, stoppedReason, stoppedStep };
}

module.exports = {
  replay,
  parseEventSequenceFile,
  buildTrace,
};
