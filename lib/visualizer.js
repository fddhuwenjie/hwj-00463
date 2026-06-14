'use strict';

const parser = require('./parser');

function visualizeASCII(fsm, simple) {
  const lines = [];
  const boxWidth = 20;

  lines.push(`FSM: ${fsm.name}`);
  lines.push('');

  for (const s of fsm.states) {
    const tag = s.is_initial ? '[initial]' : s.is_final ? '[final]' : '';
    const box = buildStateBox(s.name, tag, boxWidth, simple ? null : s);
    lines.push(box);
    lines.push('');
  }

  lines.push('Transitions:');
  lines.push('');
  for (const t of fsm.transitions) {
    let line = `  ${t.from} ──(${t.event})──▶ ${t.to}`;
    if (!simple) {
      const parts = [];
      if (t.guard) parts.push(`guard: ${t.guard}`);
      if (t.action) parts.push(`action: ${t.action}`);
      if (parts.length > 0) line += `  [${parts.join(', ')}]`;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

function buildStateBox(name, tag, width, state) {
  let innerWidth = Math.max(width, name.length + 4);
  if (tag) innerWidth = Math.max(innerWidth, tag.length + 4);
  if (state && state.entry_action) innerWidth = Math.max(innerWidth, (`entry: ${state.entry_action}`).length + 4);
  if (state && state.exit_action) innerWidth = Math.max(innerWidth, (`exit: ${state.exit_action}`).length + 4);
  const top = '┌' + '─'.repeat(innerWidth) + '┐';
  const bottom = '└' + '─'.repeat(innerWidth) + '┘';
  const nameLine = '│' + center(name, innerWidth) + '│';
  const lines = [top, nameLine];
  if (tag) {
    lines.push('│' + center(tag, innerWidth) + '│');
  }
  if (state && state.entry_action) {
    lines.push('│' + center(`entry: ${state.entry_action}`, innerWidth) + '│');
  }
  if (state && state.exit_action) {
    lines.push('│' + center(`exit: ${state.exit_action}`, innerWidth) + '│');
  }
  lines.push(bottom);
  return lines.join('\n');
}

function center(text, width) {
  if (text.length >= width) return text;
  const pad = width - text.length;
  const left = Math.floor(pad / 2);
  const right = pad - left;
  return ' '.repeat(Math.max(0, left)) + text + ' '.repeat(Math.max(0, right));
}

function visualizeDOT(fsm, simple) {
  const lines = [];
  lines.push('digraph FSM {');
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=record];');
  lines.push('');

  lines.push('  // States');
  for (const s of fsm.states) {
    let label = s.name;
    const decorators = [];
    if (s.is_initial) decorators.push('initial');
    if (s.is_final) decorators.push('final');
    if (decorators.length > 0) label = `${decorators.join('/')}\\n${label}`;
    if (!simple) {
      const actions = [];
      if (s.entry_action) actions.push(`entry: ${s.entry_action}`);
      if (s.exit_action) actions.push(`exit: ${s.exit_action}`);
      if (actions.length > 0) label += `\\n${actions.join('\\n')}`;
    }

    let shape = 'ellipse';
    if (s.is_initial && s.is_final) shape = 'doubleoctagon';
    else if (s.is_final) shape = 'doublecircle';
    else if (s.is_initial) shape = 'circle';

    lines.push(`  "${s.name}" [label="${label}", shape=${shape}];`);
  }

  lines.push('');
  lines.push('  // Initial state marker');
  const initial = parser.getInitialState(fsm);
  if (initial) {
    lines.push('  "__start" [shape=point, style=invis];');
    lines.push(`  "__start" -> "${initial.name}";`);
  }

  lines.push('');
  lines.push('  // Transitions');
  for (const t of fsm.transitions) {
    let label = t.event;
    if (!simple) {
      const parts = [];
      if (t.guard) parts.push(`[${t.guard}]`);
      if (t.action) parts.push(`/${t.action}`);
      if (parts.length > 0) label += '\\n' + parts.join(' ');
    }
    lines.push(`  "${t.from}" -> "${t.to}" [label="${label}"];`);
  }

  lines.push('}');
  return lines.join('\n');
}

function visualizeMermaid(fsm, simple) {
  const lines = [];
  lines.push('stateDiagram-v2');
  lines.push(`  direction LR`);

  const initial = parser.getInitialState(fsm);
  if (initial) {
    lines.push(`  [*] --> ${initial.name}`);
  }

  for (const t of fsm.transitions) {
    let label = t.event;
    if (!simple) {
      const parts = [];
      if (t.guard) parts.push(`[${t.guard}]`);
      if (t.action) parts.push(`/${t.action}`);
      if (parts.length > 0) label += ' ' + parts.join(' ');
    }
    lines.push(`  ${t.from} --> ${t.to} : ${label}`);
  }

  for (const s of fsm.states) {
    if (s.is_final) {
      lines.push(`  ${s.name} --> [*]`);
    }
    if (!simple && (s.entry_action || s.exit_action)) {
      const notes = [];
      if (s.entry_action) notes.push(`entry / ${s.entry_action}`);
      if (s.exit_action) notes.push(`exit / ${s.exit_action}`);
      lines.push(`  state ${s.name} {`);
      for (const n of notes) {
        lines.push(`    note "${n}"`);
      }
      lines.push(`  }`);
    }
  }

  return lines.join('\n');
}

module.exports = {
  visualizeASCII,
  visualizeDOT,
  visualizeMermaid,
};
