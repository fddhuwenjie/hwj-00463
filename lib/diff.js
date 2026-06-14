'use strict';

const parser = require('./parser');

const RESET = '\x1b[0m';
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';

function stateKey(s) {
  return s.name;
}

function transitionKey(t) {
  return `${t.from}->${t.to}:${t.event}${t.guard ? `[${t.guard}]` : ''}`;
}

function statesEqual(a, b) {
  return (
    a.name === b.name &&
    a.is_initial === b.is_initial &&
    a.is_final === b.is_final &&
    a.entry_action === b.entry_action &&
    a.exit_action === b.exit_action
  );
}

function transitionsEqual(a, b) {
  return (
    a.from === b.from &&
    a.to === b.to &&
    a.event === b.event &&
    a.guard === b.guard &&
    a.action === b.action
  );
}

function computeDiff(fsm1, fsm2) {
  const result = {
    states: { added: [], removed: [], modified: [], unchanged: [] },
    transitions: { added: [], removed: [], modified: [], unchanged: [] },
    metadata: { nameChanged: false, oldName: fsm1.name, newName: fsm2.name },
  };

  const states1 = new Map(fsm1.states.map((s) => [s.name, s]));
  const states2 = new Map(fsm2.states.map((s) => [s.name, s]));

  for (const s of fsm1.states) {
    if (!states2.has(s.name)) {
      result.states.removed.push(s);
    } else if (!statesEqual(s, states2.get(s.name))) {
      result.states.modified.push({ old: s, new: states2.get(s.name) });
    } else {
      result.states.unchanged.push(s);
    }
  }

  for (const s of fsm2.states) {
    if (!states1.has(s.name)) {
      result.states.added.push(s);
    }
  }

  const trans1 = new Map(fsm1.transitions.map((t) => [transitionKey(t), t]));
  const trans2 = new Map(fsm2.transitions.map((t) => [transitionKey(t), t]));

  for (const t of fsm1.transitions) {
    const key = transitionKey(t);
    if (!trans2.has(key)) {
      const similar = fsm2.transitions.find(
        (t2) => t2.from === t.from && t2.event === t.event && t2.guard === t.guard
      );
      if (similar) {
        result.transitions.modified.push({ old: t, new: similar });
      } else {
        result.transitions.removed.push(t);
      }
    } else if (!transitionsEqual(t, trans2.get(key))) {
      result.transitions.modified.push({ old: t, new: trans2.get(key) });
    } else {
      result.transitions.unchanged.push(t);
    }
  }

  for (const t of fsm2.transitions) {
    const key = transitionKey(t);
    if (!trans1.has(key)) {
      const similar = result.transitions.modified.find(
        (m) => m.new.from === t.from && m.new.event === t.event && m.new.guard === t.guard && m.new.to === t.to
      );
      if (!similar) {
        const oldSimilar = result.transitions.modified.find(
          (m) => m.new === t
        );
        if (!oldSimilar) {
          result.transitions.added.push(t);
        }
      }
    }
  }

  const addedKeys = new Set(result.transitions.added.map(transitionKey));
  const modifiedNewKeys = new Set(result.transitions.modified.map((m) => transitionKey(m.new)));
  result.transitions.added = result.transitions.added.filter(
    (t) => !modifiedNewKeys.has(transitionKey(t))
  );

  result.metadata.nameChanged = fsm1.name !== fsm2.name;

  return result;
}

function formatDiff(diff, file1, file2) {
  const lines = [];

  lines.push(`${BOLD}=== FSM Diff: ${file1} vs ${file2} ===${RESET}\n`);

  if (diff.metadata.nameChanged) {
    lines.push(`${YELLOW}Name: ${diff.metadata.oldName} → ${diff.metadata.newName}${RESET}\n`);
  }

  lines.push(`${BOLD}States:${RESET}`);
  const totalStates = diff.states.added.length + diff.states.removed.length + diff.states.modified.length + diff.states.unchanged.length;
  lines.push(`  Total: ${totalStates} (${GREEN}+${diff.states.added.length}${RESET} ${RED}-${diff.states.removed.length}${RESET} ${YELLOW}~${diff.states.modified.length}${RESET} unchanged: ${diff.states.unchanged.length})\n`);

  if (diff.states.added.length > 0) {
    lines.push(`${GREEN}  Added states:${RESET}`);
    diff.states.added.forEach((s) => {
      const tags = [];
      if (s.is_initial) tags.push('initial');
      if (s.is_final) tags.push('final');
      lines.push(`    ${GREEN}+ ${s.name}${tags.length > 0 ? ` (${tags.join(', ')})` : ''}${RESET}`);
      if (s.entry_action) lines.push(`    ${GREEN}    entry_action: ${s.entry_action}${RESET}`);
      if (s.exit_action) lines.push(`    ${GREEN}    exit_action: ${s.exit_action}${RESET}`);
    });
    lines.push('');
  }

  if (diff.states.removed.length > 0) {
    lines.push(`${RED}  Removed states:${RESET}`);
    diff.states.removed.forEach((s) => {
      const tags = [];
      if (s.is_initial) tags.push('initial');
      if (s.is_final) tags.push('final');
      lines.push(`    ${RED}- ${s.name}${tags.length > 0 ? ` (${tags.join(', ')})` : ''}${RESET}`);
      if (s.entry_action) lines.push(`    ${RED}    entry_action: ${s.entry_action}${RESET}`);
      if (s.exit_action) lines.push(`    ${RED}    exit_action: ${s.exit_action}${RESET}`);
    });
    lines.push('');
  }

  if (diff.states.modified.length > 0) {
    lines.push(`${YELLOW}  Modified states:${RESET}`);
    diff.states.modified.forEach(({ old: s1, new: s2 }) => {
      lines.push(`    ${YELLOW}~ ${s1.name}${RESET}`);
      if (s1.is_initial !== s2.is_initial) {
        lines.push(`      initial: ${RED}${s1.is_initial}${RESET} → ${GREEN}${s2.is_initial}${RESET}`);
      }
      if (s1.is_final !== s2.is_final) {
        lines.push(`      final: ${RED}${s1.is_final}${RESET} → ${GREEN}${s2.is_final}${RESET}`);
      }
      if (s1.entry_action !== s2.entry_action) {
        lines.push(`      entry_action: ${RED}${s1.entry_action || '(none)'}${RESET} → ${GREEN}${s2.entry_action || '(none)'}${RESET}`);
      }
      if (s1.exit_action !== s2.exit_action) {
        lines.push(`      exit_action: ${RED}${s1.exit_action || '(none)'}${RESET} → ${GREEN}${s2.exit_action || '(none)'}${RESET}`);
      }
    });
    lines.push('');
  }

  lines.push(`${BOLD}Transitions:${RESET}`);
  const totalTrans = diff.transitions.added.length + diff.transitions.removed.length + diff.transitions.modified.length + diff.transitions.unchanged.length;
  lines.push(`  Total: ${totalTrans} (${GREEN}+${diff.transitions.added.length}${RESET} ${RED}-${diff.transitions.removed.length}${RESET} ${YELLOW}~${diff.transitions.modified.length}${RESET} unchanged: ${diff.transitions.unchanged.length})\n`);

  if (diff.transitions.added.length > 0) {
    lines.push(`${GREEN}  Added transitions:${RESET}`);
    diff.transitions.added.forEach((t) => {
      const guardStr = t.guard ? ` [guard: ${t.guard}]` : '';
      const actionStr = t.action ? ` [action: ${t.action}]` : '';
      lines.push(`    ${GREEN}+ ${t.from} ──(${t.event})──▶ ${t.to}${guardStr}${actionStr}${RESET}`);
    });
    lines.push('');
  }

  if (diff.transitions.removed.length > 0) {
    lines.push(`${RED}  Removed transitions:${RESET}`);
    diff.transitions.removed.forEach((t) => {
      const guardStr = t.guard ? ` [guard: ${t.guard}]` : '';
      const actionStr = t.action ? ` [action: ${t.action}]` : '';
      lines.push(`    ${RED}- ${t.from} ──(${t.event})──▶ ${t.to}${guardStr}${actionStr}${RESET}`);
    });
    lines.push('');
  }

  if (diff.transitions.modified.length > 0) {
    lines.push(`${YELLOW}  Modified transitions:${RESET}`);
    diff.transitions.modified.forEach(({ old: t1, new: t2 }) => {
      lines.push(`    ${YELLOW}~ ${t1.from} ──(${t1.event})──▶ ${t1.to}${RESET}`);
      if (t1.from !== t2.from) lines.push(`      from: ${RED}${t1.from}${RESET} → ${GREEN}${t2.from}${RESET}`);
      if (t1.to !== t2.to) lines.push(`      to: ${RED}${t1.to}${RESET} → ${GREEN}${t2.to}${RESET}`);
      if (t1.guard !== t2.guard) lines.push(`      guard: ${RED}${t1.guard || '(none)'}${RESET} → ${GREEN}${t2.guard || '(none)'}${RESET}`);
      if (t1.action !== t2.action) lines.push(`      action: ${RED}${t1.action || '(none)'}${RESET} → ${GREEN}${t2.action || '(none)'}${RESET}`);
    });
    lines.push('');
  }

  const hasChanges =
    diff.states.added.length > 0 ||
    diff.states.removed.length > 0 ||
    diff.states.modified.length > 0 ||
    diff.transitions.added.length > 0 ||
    diff.transitions.removed.length > 0 ||
    diff.transitions.modified.length > 0 ||
    diff.metadata.nameChanged;

  if (!hasChanges) {
    lines.push(`${GREEN}No differences found. FSMs are identical.${RESET}`);
  }

  return lines.join('\n');
}

module.exports = {
  computeDiff,
  formatDiff,
};
