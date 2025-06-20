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
3. **Diff Edit Benchmark**: Separate command using the CLI tool that runs a comprehensive diff editing benchmark suite on real world cases, along with a streamlit dashboard displaying the results. For more details, see the [Diff Edit Benchmark README](./diff-edits/README.md). Make sure you add a `evals/diff-edits/cases` folder with all the conversation jsons. 

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
│   ├── diff-edits/                   # Diff editing evaluation suite
│   │   ├── cases/                    # Test case JSON files
│   │   ├── results/                  # Evaluation results
│   │   ├── diff-apply/               # Diff application logic
│   │   ├── parsing/                  # Assistant message parsing
│   │   └── prompts/                  # System prompts
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

### Activation Mechanism

The evaluation system uses an `evals.env` file approach to activate test mode in the Cline extension. When an evaluation is run:

1. The CLI creates an `evals.env` file in the workspace directory
2. The Cline extension activates due to the `workspaceContains:evals.env` activation event
3. The extension detects this file and automatically enters test mode
4. After evaluation completes, the file is automatically removed

This approach eliminates the need for environment variables during the build process and allows for targeted activation only when needed for evaluations. The extension remains dormant during normal use, only activating when an evals.env file is present. For more details, see [Evals Env Activation](./docs/evals-env-activation.md).

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

#### Managing Test Mode Activation

The CLI provides a command to manually manage the evals.env file for test mode activation:

```bash
node dist/index.js evals-env create  # Create evals.env file in current directory
node dist/index.js evals-env remove  # Remove evals.env file from current directory
node dist/index.js evals-env check   # Check if evals.env file exists in current directory
```

Options:
- `--directory`: Specify a directory other than the current one

## Benchmarks

### Exercism

Modified Exercism exercises from the [pashpashpash/evals](https://github.com/pashpashpash/evals) repository. These are small, focused programming exercises in various languages.

### SWE-Bench (Coming Soon)

Real-world software engineering tasks from the [SWE-bench](https://github.com/SWE-bench/SWE-bench) repository.

### SWELancer (Coming Soon)

Freelance-style programming tasks from the SWELancer benchmark.

### Multi-SWE-Bench (Coming Soon)

Multi-file software engineering tasks from the Multi-SWE-Bench repository.

## Diff Edit Evaluations

The Cline Evaluation System includes a specialized suite for evaluating how well models can make precise edits to files using the `replace_in_file` tool.

### Overview

Diff edit evaluations test a model's ability to:

1. Understand file content and identify specific sections to modify
2. Generate correct SEARCH/REPLACE blocks for targeted edits
3. Successfully apply changes without introducing errors

### Directory Structure

```
diff-edits/
├── cases/                  # Test case JSON files
├── results/                # Evaluation results
├── ClineWrapper.ts         # Wrapper for model interaction
├── TestRunner.ts           # Main test execution logic
├── types.ts                # Type definitions
├── diff-apply/             # Diff application logic
├── parsing/                # Assistant message parsing
└── prompts/                # System prompts
```

### Creating Test Cases

Test cases are defined as JSON files in the `diff-edits/cases/` directory. Each test case should include:

```json
{
  "test_id": "example_test_1",
  "messages": [
    {
      "role": "user",
      "text": "Please fix the bug in this code...",
      "images": []
    },
    {
      "role": "assistant",
      "text": "I'll help you fix that bug..."
    }
  ],
  "file_contents": "// Original file content here\nfunction example() {\n  // Code with bug\n}",
  "file_path": "src/example.js",
  "system_prompt_details": {
    "mcp_string": "",
    "cwd_value": "/path/to/working/directory",
    "browser_use": false,
    "width": 900,
    "height": 600,
    "os_value": "macOS",
    "shell_value": "/bin/zsh",
    "home_value": "/Users/username",
    "user_custom_instructions": ""
  },
  "original_diff_edit_tool_call_message": ""
}
```

### Running Diff Edit Evaluations

#### Single Model Evaluation

```bash
cd evals/cli
node dist/index.js run-diff-eval --model-ids "anthropic/claude-3-5-sonnet-20241022"
```

#### Multi-Model Evaluation

Compare multiple models in a single evaluation run:

```bash
# Compare Claude and Grok models
node dist/index.js run-diff-eval \
  --model-ids "anthropic/claude-3-5-sonnet-20241022,x-ai/grok-beta" \
  --max-cases 10 \
  --valid-attempts-per-case 3 \
  --verbose

# Compare multiple Claude variants
node dist/index.js run-diff-eval \
  --model-ids "anthropic/claude-3-5-sonnet-20241022,anthropic/claude-3-5-haiku-20241022,anthropic/claude-3-opus-20240229" \
  --max-cases 5 \
  --valid-attempts-per-case 2 \
  --parallel
```

#### Options

- `--model-ids`: Comma-separated list of model IDs to evaluate (required)
- `--system-prompt-name`: System prompt to use (default: "basicSystemPrompt")
- `--valid-attempts-per-case`: Number of attempts per test case per model (default: 1)
- `--max-cases`: Maximum number of test cases to run (default: all available)
- `--parsing-function`: Function to parse assistant messages (default: "parseAssistantMessageV2")
- `--diff-edit-function`: Function to apply diffs (default: "constructNewFileContentV2")
- `--test-path`: Path to test cases (default: diff-edits/cases)
- `--thinking-budget`: Tokens allocated for thinking (default: 0)
- `--parallel`: Run tests in parallel (flag)
- `--replay`: Use pre-recorded LLM output (flag)
- `--verbose`: Enable detailed logging (flag)

#### Examples

```bash
# Quick test with 2 models, 4 cases, 2 attempts each
node dist/index.js run-diff-eval \
  --model-ids "anthropic/claude-3-5-sonnet-20241022,x-ai/grok-beta" \
  --max-cases 4 \
  --valid-attempts-per-case 2 \
  --verbose

# Comprehensive evaluation with parallel execution
node dist/index.js run-diff-eval \
  --model-ids "anthropic/claude-3-5-sonnet-20241022,anthropic/claude-3-5-haiku-20241022" \
  --system-prompt-name claude4SystemPrompt \
  --valid-attempts-per-case 5 \
  --max-cases 20 \
  --parallel \
  --verbose
```

### Database Storage & Analytics

All evaluation results are automatically stored in a SQLite database (`diff-edits/evals.db`) for advanced analytics and comparison. The database includes:

- **System Prompts**: Versioned system prompt content with hashing for deduplication
- **Processing Functions**: Versioned parsing and diff-edit function configurations
- **Files**: Original and edited file content with content-based hashing
- **Runs**: Evaluation run metadata and configuration
- **Cases**: Individual test case information with context tokens
- **Results**: Detailed results with timing, cost, and success metrics

### Interactive Dashboard

Launch the Streamlit dashboard to visualize and analyze evaluation results:

```bash
cd diff-edits/dashboard
streamlit run app.py
```

The dashboard provides:

- **Model Performance Comparison**: Side-by-side comparison of success rates, latency, and costs
- **Interactive Charts**: Success rate trends, latency vs cost analysis, and performance metrics
- **Detailed Drill-Down**: Individual result analysis with file content viewing
- **Run Selection**: Browse and compare different evaluation runs
- **Real-time Updates**: Automatically refreshes with new evaluation data

#### Dashboard Features

1. **Hero Section**: Overview of current run with key metrics
2. **Model Cards**: Performance cards with grades and detailed metrics
3. **Comparison Charts**: Interactive Plotly charts for visual analysis
4. **Result Explorer**: Detailed view of individual test results including:
   - Original and edited file content
   - Raw model output
   - Parsed tool calls
   - Timing and cost metrics
   - Error analysis

#### Quick Start Dashboard

```bash
# Run a quick evaluation
node cli/dist/index.js run-diff-eval \
  --model-ids "anthropic/claude-3-5-sonnet-20241022,x-ai/grok-beta" \
  --max-cases 4 \
  --valid-attempts-per-case 2 \
  --verbose

# Launch dashboard to view results
cd diff-edits/dashboard && streamlit run app.py
```

### Legacy Results

For backward compatibility, results are also saved as JSON files in the `diff-edits/results/` directory. The JSON results include:
- Success/failure status
- Extracted tool calls
- Diff edit content
- Token usage and cost metrics

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
