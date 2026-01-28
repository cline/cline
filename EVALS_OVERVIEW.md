# Cline Evals Overview

This document introduces the new evaluation system for Cline. It is designed for a mixed audience: technical team members, PMs, and anyone who needs a clear picture of how we test Cline in a modern AI setting.

## What this is

We now have a three-layer evaluation system plus a shared analysis framework. The goal is to measure both capability and reliability in a nondeterministic model environment, without slowing down everyday development.

The system answers three questions:
- Are individual tools working correctly?
- Can the agent solve small tasks quickly?
- How does the agent perform on real-world, production-style work?

## The three test layers

### 1) Tool Precision (seconds)

Tests individual tools in isolation. Today this focuses on `replace_in_file`, with more tools planned.

Why it matters:
- Fast feedback during development
- High signal to noise ratio
- Immediate regression detection for tool behavior

### 2) Coding Exercises (minutes)

Small programming exercises across multiple languages, sourced from Aider’s polyglot benchmark (based on Exercism).

Why it matters:
- Quick smoke tests before release
- Coverage across language ecosystems
- Useful for comparing model prompt changes

### 3) Real-World Tasks (20-30 min per task)

Production-style tasks pulled from real Cline sessions, curated in a separate repository called `cline-bench` and executed with Harbor.

Why it matters:
- Realistic workloads
- Captures flakiness and nondeterminism
- Represents actual user scenarios

## Shared analysis framework

All three layers feed into a single TypeScript analysis package. It produces metrics and reports that are consistent across test types.

Key features:
- **pass@k**: Measures “can the model solve this in k tries?”
- **pass^k**: Measures “can the model solve this reliably?”
- **Flakiness score**: Quantifies variability across repeated trials
- **Failure classification**: Tags failures as provider bugs, transient failures, or task failures
- **Schema versioning**: Stable JSON output for CI and reporting

## Why the metrics matter

AI systems are nondeterministic. A model can solve a task once and fail it the next time. Measuring only a single attempt hides that risk.

This system explicitly captures both:
- Solution-finding capability (pass@k)
- Reliability and consistency (pass^k)

This is the right lens for production AI systems, where repeatability matters.

## Technologies used

- **TypeScript** for the analysis framework and CLI
- **Harbor** for execution of real-world tasks
- **Git submodules** for `cline-bench` to keep benchmarks agent-agnostic
- **GitHub Actions** for regression checks

## How it fits our repo

- `evals/benchmarks/` contains the three test layers
- `evals/analysis/` contains the analysis framework and CLI
- `evals/baselines/` stores performance baselines for regression detection

The real-world tasks live in a separate repo to preserve independence and portability.

## Example workflows

Tool precision:
```bash
cd evals/benchmarks/tool-precision/replace-in-file
npm test
```

Coding exercises:
```bash
cd evals/benchmarks/coding-exercises
npm test -- --count 10 --attempts 3
```

Real-world tasks (Harbor + analysis):
```bash
cd evals/benchmarks/real-world/cline-bench
harbor run -p tasks -a cline-cli -m anthropic:claude-sonnet-4-5:1m --env docker -k 3

cd ../../analysis
npm start -- analyze ../benchmarks/real-world/cline-bench/jobs/LATEST/
```

## Summary

This eval system provides a balanced, scalable way to measure Cline’s performance. It combines fast unit-style checks, realistic coding exercises, and full production scenarios, all backed by a consistent analysis layer that accounts for nondeterminism.

If you want deeper details, see:
- `evals/README.md`
- `evals/benchmarks/*/README.md`