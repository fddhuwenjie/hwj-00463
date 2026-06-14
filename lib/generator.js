'use strict';

const parser = require('./parser');

function groupTransitionsByEvent(fsm) {
  const groups = new Map();
  for (const t of fsm.transitions) {
    if (!groups.has(t.event)) groups.set(t.event, []);
    groups.get(t.event).push(t);
  }
  return groups;
}

function generateJavaScript(fsm) {
  const className = sanitizeName(fsm.name);
  const statesEnum = fsm.states.map((s) => `  ${s.name}: '${s.name}'`).join(',\n');
  const initial = parser.getInitialState(fsm).name;

  let code = `'use strict';\n\n`;
  code += `const ${className}State = Object.freeze({\n${statesEnum}\n});\n\n`;
  code += `class ${className} {\n`;
  code += `  constructor() {\n`;
  code += `    this.state = ${className}State.${initial};\n`;
  code += `    this.context = {};\n`;
  code += `    this.history = [];\n`;
  code += `  }\n\n`;

  const eventGroups = groupTransitionsByEvent(fsm);
  for (const [event, transitions] of eventGroups) {
    const methodName = `on${capitalize(event)}`;
    code += `  ${methodName}() {\n`;
    code += `    switch (this.state) {\n`;

    const byFrom = new Map();
    for (const t of transitions) {
      if (!byFrom.has(t.from)) byFrom.set(t.from, []);
      byFrom.get(t.from).push(t);
    }

    for (const [fromState, fromTransitions] of byFrom) {
      code += `      case ${className}State.${fromState}:\n`;
      for (const t of fromTransitions) {
        if (t.guard) {
          code += `        if (this._checkGuard('${escapeStr(t.guard)}')) {\n`;
          code += generateTransitionBodyJS(className, fsm, t, '          ');
          code += `        }\n`;
        } else {
          code += generateTransitionBodyJS(className, fsm, t, '        ');
        }
      }
      code += `        break;\n`;
    }

    code += `      default:\n`;
    code += `        return false;\n`;
    code += `    }\n`;
    code += `    return false;\n`;
    code += `  }\n\n`;
  }

  code += `  _checkGuard(guardExpr) {\n`;
  code += `    try {\n`;
  code += `      const keys = Object.keys(this.context);\n`;
  code += `      const values = Object.values(this.context);\n`;
  code += `      const fn = new Function(...keys, 'return (' + guardExpr + ');');\n`;
  code += `      return !!fn(...values);\n`;
  code += `    } catch (e) {\n`;
  code += `      return false;\n`;
  code += `    }\n`;
  code += `  }\n\n`;

  code += `  _executeAction(actionName) {\n`;
  code += `    if (typeof this[actionName] === 'function') {\n`;
  code += `      this[actionName]();\n`;
  code += `    }\n`;
  code += `  }\n\n`;

  code += `  isFinalState() {\n`;
  const finals = fsm.states.filter((s) => s.is_final).map((s) => `${className}State.${s.name}`);
  code += `    return [${finals.join(', ')}].includes(this.state);\n`;
  code += `  }\n\n`;

  code += `  reset() {\n`;
  code += `    this.state = ${className}State.${initial};\n`;
  code += `    this.context = {};\n`;
  code += `    this.history = [];\n`;
  code += `  }\n`;

  code += `}\n\n`;
  code += `module.exports = { ${className}, ${className}State };\n`;
  return code;
}

function generateTransitionBodyJS(className, fsm, t, indent) {
  let code = '';
  const fromState = fsm.states.find((s) => s.name === t.from);
  if (fromState && fromState.exit_action) {
    code += `${indent}this._executeAction('${fromState.exit_action}');\n`;
  }
  if (t.action) {
    code += `${indent}this._executeAction('${t.action}');\n`;
  }
  code += `${indent}this.history.push({ from: this.state, to: ${className}State.${t.to}, event: '${escapeStr(t.event)}' });\n`;
  code += `${indent}this.state = ${className}State.${t.to};\n`;
  const toState = fsm.states.find((s) => s.name === t.to);
  if (toState && toState.entry_action) {
    code += `${indent}this._executeAction('${toState.entry_action}');\n`;
  }
  code += `${indent}return true;\n`;
  return code;
}

function generateTypeScript(fsm) {
  const className = sanitizeName(fsm.name);
  const stateType = `${className}State`;
  const stateValues = fsm.states.map((s) => `  ${s.name} = '${s.name}'`).join(',\n');
  const initial = parser.getInitialState(fsm).name;

  let code = `export enum ${stateType} {\n${stateValues}\n}\n\n`;

  code += `export interface ${className}HistoryEntry {\n`;
  code += `  from: ${stateType};\n`;
  code += `  to: ${stateType};\n`;
  code += `  event: string;\n`;
  code += `}\n\n`;

  code += `export interface ${className}Context {\n`;
  code += `  [key: string]: unknown;\n`;
  code += `}\n\n`;

  code += `export class ${className} {\n`;
  code += `  private _state: ${stateType};\n`;
  code += `  private _context: ${className}Context;\n`;
  code += `  private _history: ${className}HistoryEntry[];\n\n`;

  code += `  constructor() {\n`;
  code += `    this._state = ${stateType}.${initial};\n`;
  code += `    this._context = {};\n`;
  code += `    this._history = [];\n`;
  code += `  }\n\n`;

  code += `  get state(): ${stateType} {\n`;
  code += `    return this._state;\n`;
  code += `  }\n\n`;

  code += `  get context(): ${className}Context {\n`;
  code += `    return { ...this._context };\n`;
  code += `  }\n\n`;

  code += `  get history(): ReadonlyArray<${className}HistoryEntry> {\n`;
  code += `    return this._history;\n`;
  code += `  }\n\n`;

  const eventGroups = groupTransitionsByEvent(fsm);
  for (const [event, transitions] of eventGroups) {
    const methodName = `on${capitalize(event)}`;
    code += `  ${methodName}(): boolean {\n`;
    code += `    switch (this._state) {\n`;

    const byFrom = new Map();
    for (const t of transitions) {
      if (!byFrom.has(t.from)) byFrom.set(t.from, []);
      byFrom.get(t.from).push(t);
    }

    for (const [fromState, fromTransitions] of byFrom) {
      code += `      case ${stateType}.${fromState}:\n`;
      for (const t of fromTransitions) {
        if (t.guard) {
          code += `        if (this.checkGuard('${escapeStr(t.guard)}')) {\n`;
          code += generateTransitionBodyTS(stateType, fsm, t, '          ');
          code += `        }\n`;
        } else {
          code += generateTransitionBodyTS(stateType, fsm, t, '        ');
        }
      }
      code += `        break;\n`;
    }

    code += `      default:\n`;
    code += `        return false;\n`;
    code += `    }\n`;
    code += `    return false;\n`;
    code += `  }\n\n`;
  }

  code += `  private checkGuard(guardExpr: string): boolean {\n`;
  code += `    try {\n`;
  code += `      const keys = Object.keys(this._context);\n`;
  code += `      const values = Object.values(this._context);\n`;
  code += `      const fn = new Function(...keys, 'return (' + guardExpr + ');');\n`;
  code += `      return !!fn(...values);\n`;
  code += `    } catch {\n`;
  code += `      return false;\n`;
  code += `    }\n`;
  code += `  }\n\n`;

  code += `  private executeAction(actionName: string): void {\n`;
  code += `    if (typeof (this as any)[actionName] === 'function') {\n`;
  code += `      (this as any)[actionName]();\n`;
  code += `    }\n`;
  code += `  }\n\n`;

  code += `  isFinalState(): boolean {\n`;
  const finals = fsm.states.filter((s) => s.is_final).map((s) => `${stateType}.${s.name}`);
  code += `    return [${finals.join(', ')}].includes(this._state);\n`;
  code += `  }\n\n`;

  code += `  setContext(key: string, value: unknown): void {\n`;
  code += `    this._context[key] = value;\n`;
  code += `  }\n\n`;

  code += `  reset(): void {\n`;
  code += `    this._state = ${stateType}.${initial};\n`;
  code += `    this._context = {};\n`;
  code += `    this._history = [];\n`;
  code += `  }\n`;

  code += `}\n`;
  return code;
}

function generateTransitionBodyTS(stateType, fsm, t, indent) {
  let code = '';
  const fromState = fsm.states.find((s) => s.name === t.from);
  if (fromState && fromState.exit_action) {
    code += `${indent}this.executeAction('${fromState.exit_action}');\n`;
  }
  if (t.action) {
    code += `${indent}this.executeAction('${t.action}');\n`;
  }
  code += `${indent}this._history.push({ from: this._state, to: ${stateType}.${t.to}, event: '${escapeStr(t.event)}' });\n`;
  code += `${indent}this._state = ${stateType}.${t.to};\n`;
  const toState = fsm.states.find((s) => s.name === t.to);
  if (toState && toState.entry_action) {
    code += `${indent}this.executeAction('${toState.entry_action}');\n`;
  }
  code += `${indent}return true;\n`;
  return code;
}

function generatePython(fsm) {
  const className = sanitizeName(fsm.name);
  const initial = parser.getInitialState(fsm);

  let code = `from enum import Enum\n\n\n`;

  code += `class ${className}State(Enum):\n`;
  for (const s of fsm.states) {
    code += `    ${s.name} = '${s.name}'\n`;
  }
  code += `\n\n`;

  code += `class ${className}:\n`;
  code += `    def __init__(self):\n`;
  code += `        self.state = ${className}State.${initial.name}\n`;
  code += `        self.context = {}\n`;
  code += `        self.history = []\n\n`;

  const eventGroups = groupTransitionsByEvent(fsm);
  for (const [event, transitions] of eventGroups) {
    const methodName = `on_${snakeCase(event)}`;
    code += `    def ${methodName}(self) -> bool:\n`;

    const byFrom = new Map();
    for (const t of transitions) {
      if (!byFrom.has(t.from)) byFrom.set(t.from, []);
      byFrom.get(t.from).push(t);
    }

    for (const [fromState, fromTransitions] of byFrom) {
      for (const t of fromTransitions) {
        const condition = `self.state == ${className}State.${t.from}`;
        if (t.guard) {
          code += `        if ${condition} and self._check_guard('${escapeStr(t.guard)}'):\n`;
        } else {
          code += `        if ${condition}:\n`;
        }
        code += generateTransitionBodyPy(className, fsm, t, '            ');
      }
    }

    code += `        return False\n\n`;
  }

  code += `    def _check_guard(self, guard_expr: str) -> bool:\n`;
  code += `        try:\n`;
  code += `            return bool(eval(guard_expr, {}, self.context))\n`;
  code += `        except Exception:\n`;
  code += `            return False\n\n`;

  code += `    def _execute_action(self, action_name: str):\n`;
  code += `        method = getattr(self, action_name, None)\n`;
  code += `        if callable(method):\n`;
  code += `            method()\n\n`;

  code += `    def is_final_state(self) -> bool:\n`;
  const finals = fsm.states.filter((s) => s.is_final).map((s) => `${className}State.${s.name}`);
  code += `        return self.state in [${finals.join(', ')}]\n\n`;

  code += `    def reset(self):\n`;
  code += `        self.state = ${className}State.${initial.name}\n`;
  code += `        self.context = {}\n`;
  code += `        self.history = []\n`;

  return code;
}

function generateTransitionBodyPy(className, fsm, t, indent) {
  let code = '';
  const fromState = fsm.states.find((s) => s.name === t.from);
  if (fromState && fromState.exit_action) {
    code += `${indent}self._execute_action('${fromState.exit_action}')\n`;
  }
  if (t.action) {
    code += `${indent}self._execute_action('${t.action}')\n`;
  }
  code += `${indent}self.history.append({'from': self.state.value, 'to': ${className}State.${t.to}.value, 'event': '${escapeStr(t.event)}'})\n`;
  code += `${indent}self.state = ${className}State.${t.to}\n`;
  const toState = fsm.states.find((s) => s.name === t.to);
  if (toState && toState.entry_action) {
    code += `${indent}self._execute_action('${toState.entry_action}')\n`;
  }
  code += `${indent}return True\n`;
  return code;
}

function sanitizeName(name) {
  return name.replace(/[^a-zA-Z0-9]/g, '_').replace(/^(\d)/, '_$1');
}

function capitalize(str) {
  return str
    .split(/[_\s-]+/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function snakeCase(str) {
  return str.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '').replace(/[^a-z0-9_]/g, '_');
}

function escapeStr(str) {
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

module.exports = {
  generateJavaScript,
  generateTypeScript,
  generatePython,
};
