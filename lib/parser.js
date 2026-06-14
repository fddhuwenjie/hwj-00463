'use strict';

const fs = require('fs');
const yaml = require('js-yaml');

function parseFSM(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const raw = yaml.load(content);
  return normalizeFSM(raw);
}

function normalizeFSM(raw) {
  const fsm = {
    name: raw.name || 'UnnamedFSM',
    states: [],
    transitions: [],
    substates: raw.substates || [],
    parallel: raw.parallel || [],
  };

  if (raw.states && Array.isArray(raw.states)) {
    fsm.states = raw.states.map((s) => {
      if (typeof s === 'string') {
        return { name: s, is_initial: false, is_final: false, entry_action: null, exit_action: null };
      }
      return {
        name: s.name,
        is_initial: !!s.is_initial,
        is_final: !!s.is_final,
        entry_action: s.entry_action || null,
        exit_action: s.exit_action || null,
        submachine: s.submachine || null,
      };
    });
  }

  if (raw.transitions && Array.isArray(raw.transitions)) {
    fsm.transitions = raw.transitions.map((t) => ({
      from: t.from,
      to: t.to,
      event: t.event,
      guard: t.guard || null,
      action: t.action || null,
    }));
  }

  if (raw.substates && Array.isArray(raw.substates)) {
    fsm.substates = raw.substates.map(normalizeFSM);
  }

  if (raw.parallel && Array.isArray(raw.parallel)) {
    fsm.parallel = raw.parallel.map(normalizeFSM);
  }

  return fsm;
}

function getStateByName(fsm, name) {
  return fsm.states.find((s) => s.name === name) || null;
}

function getInitialState(fsm) {
  return fsm.states.find((s) => s.is_initial) || null;
}

function getFinalStates(fsm) {
  return fsm.states.filter((s) => s.is_final);
}

function getTransitionsFrom(fsm, stateName) {
  return fsm.transitions.filter((t) => t.from === stateName);
}

function getTransitionsTo(fsm, stateName) {
  return fsm.transitions.filter((t) => t.to === stateName);
}

function getEvents(fsm) {
  const events = new Set();
  fsm.transitions.forEach((t) => events.add(t.event));
  return Array.from(events);
}

module.exports = {
  parseFSM,
  normalizeFSM,
  getStateByName,
  getInitialState,
  getFinalStates,
  getTransitionsFrom,
  getTransitionsTo,
  getEvents,
};
