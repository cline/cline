# Cline Evaluation System

This directory contains the evaluation system for benchmarking Cline against various coding evaluation frameworks.

## Overview

The Cline Evaluation System allows you to:

1. Run Cline against standardized coding benchmarks
2. Collect comprehensive metrics on performance
3. Generate detailed reports on evaluation results
4. Compare performance across different models and benchmarks

## Architecture

The evaluation system consists of two main components:

1. **Test Server**: Enhanced HTTP server in `src/services/test/TestServer.ts` that provides detailed task results
2. **CLI Tool**: Command-line interface in `evals/cli/` for orchestrating evaluations

## Directory Structure

```
cline-repo/
├── src/
│   ├── services/
│   │   ├── test/
│   │   │   ├── TestServer.ts         # Enhanced HTTP server for task execution
│   │   │   ├── GitHelper.ts          # Git utilities for file tracking
│   │   │   └── ...
│   │   └── ...
│   └── ...
├── evals/                            # Main directory for evaluation system
│   ├── cli/                          # CLI tool for orchestrating evaluations
│   │   ├── src/
│   │   │   ├── index.ts              # CLI entry point
│   │   │   ├── commands/             # CLI commands (setup, run, report)
│   │   │   ├── adapters/             # Benchmark adapters
│   │   │   ├── db/                   # Database management
│   │   │   └── utils/                # Utility functions
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── repositories/                 # Cloned benchmark repositories
│   │   ├── exercism/                 # Modified Exercism (from pashpashpash/evals)
│   │   ├── swe-bench/                # SWE-Bench repository
│   │   ├── swelancer/                # SWELancer repository
│   │   └── multi-swe/                # Multi-SWE-Bench repository
│   ├── results/                      # Evaluation results storage
│   │   ├── runs/                     # Individual run results
│   │   └── reports/                  # Generated reports
│   └── README.md                     # This file
└── ...
```

## Getting Started

### Prerequisites

- Node.js 16+
- VSCode with Cline extension installed
- Git

### Installation

1. Build the CLI tool:

```bash
cd evals/cli
npm install
npm run build
```

### Usage

#### Setting Up Benchmarks

```bash
cd evals/cli
node dist/index.js setup
```

This will clone and set up all benchmark repositories. You can specify specific benchmarks:

```bash
node dist/index.js setup --benchmarks exercism
```

#### Running Evaluations

```bash
node dist/index.js run --model claude-3-opus-20240229 --benchmark exercism
```

Options:
- `--model`: The model to evaluate (default: claude-3-opus-20240229)
- `--benchmark`: Specific benchmark to run (default: all)
- `--count`: Number of tasks to run (default: all)

#### Generating Reports

```bash
node dist/index.js report
```

Options:
- `--format`: Report format (json, markdown) (default: markdown)
- `--output`: Output path for the report

## Benchmarks

### Exercism

Modified Exercism exercises from the [pashpashpash/evals](https://github.com/pashpashpash/evals) repository. These are small, focused programming exercises in various languages.

### SWE-Bench (Coming Soon)

Real-world software engineering tasks from the [SWE-bench](https://github.com/SWE-bench/SWE-bench) repository.

### SWELancer (Coming Soon)

Freelance-style programming tasks from the SWELancer benchmark.

### Multi-SWE-Bench (Coming Soon)

Multi-file software engineering tasks from the Multi-SWE-Bench repository.

## Metrics

The evaluation system collects the following metrics:

- **Token Usage**: Input and output tokens
- **Cost**: Estimated cost of API calls
- **Duration**: Time taken to complete tasks
- **Tool Usage**: Number of tool calls and failures
- **Success Rate**: Percentage of tasks completed successfully
- **Functional Correctness**: Percentage of tests passed

## Reports

Reports are generated in Markdown or JSON format and include:

- Overall summary
- Benchmark-specific results
- Model-specific results
- Tool usage statistics
- Charts and visualizations

## Development

### Adding a New Benchmark

1. Create a new adapter in `evals/cli/src/adapters/`
2. Implement the `BenchmarkAdapter` interface
3. Register the adapter in `evals/cli/src/adapters/index.ts`

### Extending Metrics

To add new metrics:

1. Update the database schema in `evals/cli/src/db/schema.ts`
2. Add collection logic in `evals/cli/src/utils/results.ts`
3. Update report generation in `evals/cli/src/commands/report.ts`
