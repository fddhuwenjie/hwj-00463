#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const parser = require('./lib/parser');
const validator = require('./lib/validator');
const visualizer = require('./lib/visualizer');
const simulator = require('./lib/simulator');
const generator = require('./lib/generator');
const pathsLib = require('./lib/paths');
const composite = require('./lib/composite');
const diffLib = require('./lib/diff');
const mergeLib = require('./lib/merge');
const replayLib = require('./lib/replay');
const minimizationLib = require('./lib/minimization');

function printUsage() {
  console.log(`
FSM CLI - Finite State Machine Definition, Visualization & Code Generation

Usage:
  node fsm.js <command> <yaml-file> [options]

Basic Commands:
  validate <file>              Validate FSM definition
  visualize <file>             Visualize FSM (default: ASCII)
    --format <format>          Output format: ascii, dot, mermaid
    --simple                   Simplified output (omit actions)
  simulate <file>              Interactive simulation (with breakpoints)
  generate <file>              Generate state machine code
    --lang <language>          Target: javascript, python, typescript
    -o, --output <file>        Output file path
  paths <file>                 Generate all transition paths
    --max-depth <n>            Maximum DFS depth (default: 10)
  coverage <file>              Calculate test coverage
    --events <e1,e2,...>       Event sequence for coverage
  minimal-test <file>          Generate minimal test set
  flatten <file>               Flatten hierarchical FSM

Diff & Merge Commands:
  diff <file1> <file2>         Show differences between two FSMs
  merge <file1> <file2>        Merge two FSMs
    --strategy <strategy>      Merge strategy: union, intersection, compose
    --prefix1 <prefix>         Prefix for states from first FSM
    --prefix2 <prefix>         Prefix for states from second FSM
    --bridge-event <event>     Event name for compose strategy bridge
    -o, --output <file>        Output merged YAML file

Debug & Replay Commands:
  replay <file> <events-file>  Replay event sequence
    --step                     Step-by-step mode (press Enter to continue)
    --until-state <state>      Stop when reaching specified state
    --export-trace <file>      Export execution trace to JSON file

Analysis Commands:
  minimize <file>              Minimize FSM (merge equivalent states)
    -o, --output <file>        Output minimized YAML file
  equivalence <file1> <file2>  Check if two FSMs are behaviorally equivalent

Simulation Breakpoint Commands (interactive):
  break state <name>           Set breakpoint on entering state
  break event <name>           Set breakpoint on event
  clear state|event|all        Clear breakpoints
  continue / step              Resume from breakpoint

Examples:
  node fsm.js validate examples/traffic_light.yaml
  node fsm.js visualize examples/tcp_connection.yaml --format dot
  node fsm.js simulate examples/vending_machine.yaml
  node fsm.js diff examples/traffic_light.yaml examples/vending_machine.yaml
  node fsm.js merge examples/traffic_light.yaml examples/vending_machine.yaml --strategy union
  node fsm.js replay examples/vending_machine.yaml events.txt --step
  node fsm.js minimize examples/traffic_light.yaml -o minimized.yaml
  node fsm.js equivalence examples/traffic_light.yaml examples/vending_machine.yaml
`);
}

function parseArgs(argv) {
  const args = { command: null, file: null, file2: null, options: {} };
  const rest = argv.slice(2);

  if (rest.length === 0 || rest[0] === 'help' || rest[0] === '--help' || rest[0] === '-h') {
    args.command = 'help';
    return args;
  }

  args.command = rest[0];

  const twoFileCommands = new Set(['diff', 'merge', 'equivalence']);
  const isTwoFileCmd = twoFileCommands.has(args.command);

  let pos = 1;
  if (rest.length > pos && !rest[pos].startsWith('-')) {
    args.file = rest[pos++];
  }

  if (isTwoFileCmd && rest.length > pos && !rest[pos].startsWith('-')) {
    args.file2 = rest[pos++];
  }

  if (args.command === 'replay' && rest.length > pos && !rest[pos].startsWith('-')) {
    args.file2 = rest[pos++];
  }

  for (let i = pos; i < rest.length; i++) {
    if (rest[i] === '--format' && i + 1 < rest.length) {
      args.options.format = rest[++i];
    } else if (rest[i] === '--simple') {
      args.options.simple = true;
    } else if (rest[i] === '--lang' && i + 1 < rest.length) {
      args.options.lang = rest[++i];
    } else if ((rest[i] === '-o' || rest[i] === '--output') && i + 1 < rest.length) {
      args.options.output = rest[++i];
    } else if (rest[i] === '--max-depth' && i + 1 < rest.length) {
      args.options.maxDepth = parseInt(rest[++i], 10);
    } else if (rest[i] === '--events' && i + 1 < rest.length) {
      args.options.events = rest[++i].split(',');
    } else if (rest[i] === '--strategy' && i + 1 < rest.length) {
      args.options.strategy = rest[++i];
    } else if (rest[i] === '--prefix1' && i + 1 < rest.length) {
      args.options.prefix1 = rest[++i];
    } else if (rest[i] === '--prefix2' && i + 1 < rest.length) {
      args.options.prefix2 = rest[++i];
    } else if (rest[i] === '--bridge-event' && i + 1 < rest.length) {
      args.options.bridgeEvent = rest[++i];
    } else if (rest[i] === '--step') {
      args.options.step = true;
    } else if (rest[i] === '--until-state' && i + 1 < rest.length) {
      args.options.untilState = rest[++i];
    } else if (rest[i] === '--export-trace' && i + 1 < rest.length) {
      args.options.exportTrace = rest[++i];
    }
  }

  return args;
}

function cmdValidate(args) {
  if (!args.file) {
    console.error('Error: YAML file path required.');
    process.exit(1);
  }
  const fsm = parser.parseFSM(args.file);
  const result = validator.validate(fsm);

  console.log(`Validating: ${fsm.name}`);
  console.log(`  States: ${fsm.states.length}`);
  console.log(`  Transitions: ${fsm.transitions.length}`);
  console.log('');

  if (result.errors.length > 0) {
    console.log('Errors:');
    result.errors.forEach((e) => console.log(`  ✗ ${e}`));
  }

  if (result.warnings.length > 0) {
    console.log('Warnings:');
    result.warnings.forEach((w) => console.log(`  ⚠ ${w}`));
  }

  if (result.valid) {
    console.log('\n✓ FSM is valid.');
  } else {
    console.log('\n✗ FSM is invalid.');
    process.exit(1);
  }
}

function cmdVisualize(args) {
  if (!args.file) {
    console.error('Error: YAML file path required.');
    process.exit(1);
  }
  const fsm = parser.parseFSM(args.file);
  const fmt = args.options.format || 'ascii';
  const simple = args.options.simple || false;

  let output;
  switch (fmt) {
    case 'dot':
      output = visualizer.visualizeDOT(fsm, simple);
      break;
    case 'mermaid':
      output = visualizer.visualizeMermaid(fsm, simple);
      break;
    case 'ascii':
      output = visualizer.visualizeASCII(fsm, simple);
      break;
    default:
      console.error(`Error: Unknown format "${fmt}". Use: ascii, dot, mermaid`);
      process.exit(1);
  }

  if (args.options.output) {
    fs.writeFileSync(args.options.output, output, 'utf-8');
    console.log(`Output written to: ${args.options.output}`);
  } else {
    console.log(output);
  }
}

async function cmdSimulate(args) {
  if (!args.file) {
    console.error('Error: YAML file path required.');
    process.exit(1);
  }
  const fsm = parser.parseFSM(args.file);
  const result = validator.validate(fsm);
  if (!result.valid) {
    console.error('Error: FSM is invalid. Fix errors before simulating.');
    result.errors.forEach((e) => console.error(`  ✗ ${e}`));
    process.exit(1);
  }
  await simulator.simulate(fsm, args.options);
}

function cmdGenerate(args) {
  if (!args.file) {
    console.error('Error: YAML file path required.');
    process.exit(1);
  }
  const fsm = parser.parseFSM(args.file);
  const lang = args.options.lang || 'javascript';

  let output;
  switch (lang) {
    case 'javascript':
    case 'js':
      output = generator.generateJavaScript(fsm);
      break;
    case 'typescript':
    case 'ts':
      output = generator.generateTypeScript(fsm);
      break;
    case 'python':
    case 'py':
      output = generator.generatePython(fsm);
      break;
    default:
      console.error(`Error: Unknown language "${lang}". Use: javascript, python, typescript`);
      process.exit(1);
  }

  if (args.options.output) {
    fs.writeFileSync(args.options.output, output, 'utf-8');
    console.log(`Code generated: ${args.options.output}`);
  } else {
    console.log(output);
  }
}

function cmdPaths(args) {
  if (!args.file) {
    console.error('Error: YAML file path required.');
    process.exit(1);
  }
  const fsm = parser.parseFSM(args.file);
  const maxDepth = args.options.maxDepth || 10;
  const allPaths = pathsLib.generatePaths(fsm, maxDepth);
  console.log(pathsLib.formatPaths(allPaths));
}

function cmdCoverage(args) {
  if (!args.file) {
    console.error('Error: YAML file path required.');
    process.exit(1);
  }
  const fsm = parser.parseFSM(args.file);

  if (!args.options.events) {
    console.error('Error: --events <e1,e2,...> is required for coverage calculation.');
    process.exit(1);
  }

  const result = pathsLib.computeCoverage(fsm, args.options.events);
  console.log(pathsLib.formatCoverage(result));
}

function cmdMinimalTest(args) {
  if (!args.file) {
    console.error('Error: YAML file path required.');
    process.exit(1);
  }
  const fsm = parser.parseFSM(args.file);
  const result = pathsLib.minimalTestSet(fsm);
  console.log(pathsLib.formatMinimalTestSet(result));
}

function cmdFlatten(args) {
  if (!args.file) {
    console.error('Error: YAML file path required.');
    process.exit(1);
  }
  const fsm = parser.parseFSM(args.file);

  let flatFSM;
  if (fsm.parallel && fsm.parallel.length > 0) {
    flatFSM = composite.flattenParallel(fsm);
  } else {
    flatFSM = composite.flattenFSM(fsm);
  }

  console.log(composite.formatFlattenResult(flatFSM));

  if (args.options.output) {
    const yaml = require('js-yaml');
    const yamlContent = yaml.dump(flatFSM, { lineWidth: -1 });
    fs.writeFileSync(args.options.output, yamlContent, 'utf-8');
    console.log(`\nFlattened YAML written to: ${args.options.output}`);
  }
}

function cmdDiff(args) {
  if (!args.file || !args.file2) {
    console.error('Error: Two YAML file paths required for diff.');
    console.error('Usage: node fsm.js diff <file1> <file2>');
    process.exit(1);
  }
  const fsm1 = parser.parseFSM(args.file);
  const fsm2 = parser.parseFSM(args.file2);
  const diff = diffLib.computeDiff(fsm1, fsm2);
  console.log(diffLib.formatDiff(diff, args.file, args.file2));
}

function cmdMerge(args) {
  if (!args.file || !args.file2) {
    console.error('Error: Two YAML file paths required for merge.');
    console.error('Usage: node fsm.js merge <file1> <file2> [options]');
    process.exit(1);
  }
  const fsm1 = parser.parseFSM(args.file);
  const fsm2 = parser.parseFSM(args.file2);
  const strategy = args.options.strategy || 'union';

  const mergeOptions = {};
  if (args.options.prefix1) mergeOptions.prefix1 = args.options.prefix1;
  if (args.options.prefix2) mergeOptions.prefix2 = args.options.prefix2;
  if (args.options.bridgeEvent) mergeOptions.bridgeEvent = args.options.bridgeEvent;

  try {
    const merged = mergeLib.mergeFSMs(fsm1, fsm2, strategy, mergeOptions);
    console.log(mergeLib.formatMergeResult(merged, strategy));

    if (args.options.output) {
      const yaml = require('js-yaml');
      const cleanFSM = {
        name: merged.name,
        states: merged.states.map((s) => {
          const clean = {
            name: s.name,
            is_initial: s.is_initial,
            is_final: s.is_final,
          };
          if (s.entry_action) clean.entry_action = s.entry_action;
          if (s.exit_action) clean.exit_action = s.exit_action;
          return clean;
        }),
        transitions: merged.transitions.map((t) => {
          const clean = {
            from: t.from,
            to: t.to,
            event: t.event,
          };
          if (t.guard) clean.guard = t.guard;
          if (t.action) clean.action = t.action;
          return clean;
        }),
      };
      const yamlContent = yaml.dump(cleanFSM, { lineWidth: -1 });
      fs.writeFileSync(args.options.output, yamlContent, 'utf-8');
      console.log(`\nMerged YAML written to: ${args.options.output}`);
    }
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

async function cmdReplay(args) {
  if (!args.file) {
    console.error('Error: FSM YAML file path required.');
    process.exit(1);
  }
  if (!args.file2) {
    console.error('Error: Event sequence file path required.');
    console.error('Usage: node fsm.js replay <fsm-file> <events-file> [options]');
    process.exit(1);
  }

  const fsm = parser.parseFSM(args.file);
  const validation = validator.validate(fsm);
  if (!validation.valid) {
    console.error('Error: FSM is invalid. Fix errors before replaying.');
    validation.errors.forEach((e) => console.error(`  ✗ ${e}`));
    process.exit(1);
  }

  const events = replayLib.parseEventSequenceFile(args.file2);
  const options = {
    step: args.options.step || false,
    untilState: args.options.untilState || null,
    exportTrace: args.options.exportTrace || null,
  };

  try {
    await replayLib.replay(fsm, events, options);
  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

function cmdMinimize(args) {
  if (!args.file) {
    console.error('Error: YAML file path required.');
    process.exit(1);
  }
  const fsm = parser.parseFSM(args.file);

  const minResult = minimizationLib.hopcroftMinimize(fsm);
  const minimizedFSM = minimizationLib.buildMinimizedFSM(fsm, minResult);

  console.log(minimizationLib.formatMinimizationResult(minimizedFSM));

  if (args.options.output) {
    const yaml = require('js-yaml');
    const cleanFSM = {
      name: minimizedFSM.name,
      states: minimizedFSM.states.map((s) => {
        const clean = {
          name: s.name,
          is_initial: s.is_initial,
          is_final: s.is_final,
        };
        if (s.entry_action) clean.entry_action = s.entry_action;
        if (s.exit_action) clean.exit_action = s.exit_action;
        return clean;
      }),
      transitions: minimizedFSM.transitions.map((t) => {
        const clean = {
          from: t.from,
          to: t.to,
          event: t.event,
        };
        if (t.guard) clean.guard = t.guard;
        if (t.action) clean.action = t.action;
        return clean;
      }),
    };
    const yamlContent = yaml.dump(cleanFSM, { lineWidth: -1 });
    fs.writeFileSync(args.options.output, yamlContent, 'utf-8');
    console.log(`\nMinimized YAML written to: ${args.options.output}`);
  }
}

function cmdEquivalence(args) {
  if (!args.file || !args.file2) {
    console.error('Error: Two YAML file paths required for equivalence check.');
    console.error('Usage: node fsm.js equivalence <file1> <file2>');
    process.exit(1);
  }
  const fsm1 = parser.parseFSM(args.file);
  const fsm2 = parser.parseFSM(args.file2);

  const result = minimizationLib.checkEquivalence(fsm1, fsm2);
  console.log(minimizationLib.formatEquivalenceResult(result, fsm1.name, fsm2.name));
}

const args = parseArgs(process.argv);

async function main() {
  switch (args.command) {
    case 'help':
      printUsage();
      break;
    case 'validate':
      cmdValidate(args);
      break;
    case 'visualize':
      cmdVisualize(args);
      break;
    case 'simulate':
      await cmdSimulate(args);
      break;
    case 'generate':
      cmdGenerate(args);
      break;
    case 'paths':
      cmdPaths(args);
      break;
    case 'coverage':
      cmdCoverage(args);
      break;
    case 'minimal-test':
      cmdMinimalTest(args);
      break;
    case 'flatten':
      cmdFlatten(args);
      break;
    case 'diff':
      cmdDiff(args);
      break;
    case 'merge':
      cmdMerge(args);
      break;
    case 'replay':
      await cmdReplay(args);
      break;
    case 'minimize':
      cmdMinimize(args);
      break;
    case 'equivalence':
      cmdEquivalence(args);
      break;
    default:
      console.error(`Unknown command: ${args.command}`);
      printUsage();
      process.exit(1);
  }
}

main().catch((e) => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
