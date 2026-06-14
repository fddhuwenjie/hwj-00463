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

function printUsage() {
  console.log(`
FSM CLI - Finite State Machine Definition, Visualization & Code Generation

Usage:
  node fsm.js <command> <yaml-file> [options]

Commands:
  validate <file>              Validate FSM definition
  visualize <file>             Visualize FSM (default: ASCII)
    --format <format>          Output format: ascii, dot, mermaid
    --simple                   Simplified output (omit actions)
  simulate <file>              Interactive simulation
  generate <file>              Generate state machine code
    --lang <language>          Target: javascript, python, typescript
    -o, --output <file>        Output file path
  paths <file>                 Generate all transition paths
    --max-depth <n>            Maximum DFS depth (default: 10)
  coverage <file>              Calculate test coverage
    --events <e1,e2,...>       Event sequence for coverage
  minimal-test <file>          Generate minimal test set
  flatten <file>               Flatten hierarchical FSM
  help                         Show this help message

Examples:
  node fsm.js validate examples/traffic_light.yaml
  node fsm.js visualize examples/tcp_connection.yaml --format dot
  node fsm.js visualize examples/vending_machine.yaml --format mermaid --simple
  node fsm.js simulate examples/vending_machine.yaml
  node fsm.js generate examples/traffic_light.yaml --lang typescript -o output.ts
  node fsm.js paths examples/tcp_connection.yaml --max-depth 8
  node fsm.js coverage examples/traffic_light.yaml --events timer,timer,timer
  node fsm.js minimal-test examples/traffic_light.yaml
  node fsm.js flatten examples/parallel_example.yaml
`);
}

function parseArgs(argv) {
  const args = { command: null, file: null, options: {} };
  const rest = argv.slice(2);

  if (rest.length === 0 || rest[0] === 'help' || rest[0] === '--help' || rest[0] === '-h') {
    args.command = 'help';
    return args;
  }

  args.command = rest[0];
  if (rest.length > 1 && !rest[1].startsWith('-')) {
    args.file = rest[1];
  }

  for (let i = 2; i < rest.length; i++) {
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

function cmdSimulate(args) {
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
  simulator.simulate(fsm, args.options);
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

const args = parseArgs(process.argv);

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
    cmdSimulate(args);
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
  default:
    console.error(`Unknown command: ${args.command}`);
    printUsage();
    process.exit(1);
}
