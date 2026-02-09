# Success Criteria Implementation

Complete implementation of the success criteria evaluator for the bead workflow.

## SuccessCriteria.ts

```typescript
// src/core/beads/SuccessCriteria.ts

import * as vscode from 'vscode';
import type { Bead, SuccessCriterion } from '@/shared/beads';

export interface BeadContext {
  bead: Bead;
  response: string;
  errors: string[];
  workspaceRoot: string;
  testCommand?: string;
}

export interface CriteriaResult {
  allPassed: boolean;
  results: Record<string, boolean>;
  details: Record<string, string>;
}

export class SuccessCriteriaEvaluator {
  /**
   * Evaluate all success criteria for a bead.
   */
  async evaluate(
    criteria: SuccessCriterion[],
    context: BeadContext
  ): Promise<CriteriaResult> {
    const results: Record<string, boolean> = {};
    const details: Record<string, string> = {};

    for (const criterion of criteria) {
      const key = criterion.type;

      switch (criterion.type) {
        case 'tests_pass': {
          const testResult = await this.evaluateTestsPass(context);
          results[key] = testResult.passed;
          details[key] = testResult.output;
          break;
        }

        case 'done_tag': {
          const found = this.evaluateDoneTag(context.response);
          results[key] = found;
          details[key] = found ? 'DONE tag found' : 'DONE tag not found';
          break;
        }

        case 'no_errors': {
          const hasErrors = context.errors.length > 0;
          results[key] = !hasErrors;
          details[key] = hasErrors
            ? `${context.errors.length} errors: ${context.errors[0]}`
            : 'No errors';
          break;
        }

        case 'custom': {
          const customResult = await this.evaluateCustom(criterion.config, context);
          results[key] = customResult.passed;
          details[key] = customResult.message;
          break;
        }

        default:
          results[key] = false;
          details[key] = `Unknown criterion type: ${criterion.type}`;
      }
    }

    return {
      allPassed: Object.values(results).every((v) => v),
      results,
      details,
    };
  }

  /**
   * Run tests and check if they pass.
   */
  private async evaluateTestsPass(
    context: BeadContext
  ): Promise<{ passed: boolean; output: string }> {
    const testCommand = context.testCommand || this.detectTestCommand(context.workspaceRoot);

    if (!testCommand) {
      return {
        passed: true, // No tests configured, pass by default
        output: 'No test command configured',
      };
    }

    try {
      const result = await this.executeCommand(testCommand, context.workspaceRoot);
      return {
        passed: result.exitCode === 0,
        output: result.output.slice(-500), // Last 500 chars
      };
    } catch (error) {
      return {
        passed: false,
        output: `Test execution failed: ${error}`,
      };
    }
  }

  /**
   * Check if the response contains a DONE marker.
   */
  private evaluateDoneTag(response: string): boolean {
    // Match "DONE" as a word boundary
    // Case insensitive, but must be standalone
    return /\bDONE\b/i.test(response);
  }

  /**
   * Evaluate a custom criterion.
   */
  private async evaluateCustom(
    config: Record<string, unknown> | undefined,
    context: BeadContext
  ): Promise<{ passed: boolean; message: string }> {
    if (!config) {
      return { passed: false, message: 'No custom config provided' };
    }

    // Custom command check
    if (config.command && typeof config.command === 'string') {
      const result = await this.executeCommand(config.command, context.workspaceRoot);
      return {
        passed: result.exitCode === 0,
        message: result.output.slice(-200),
      };
    }

    // Custom regex check on response
    if (config.responsePattern && typeof config.responsePattern === 'string') {
      const regex = new RegExp(config.responsePattern, 'i');
      const found = regex.test(context.response);
      return {
        passed: found,
        message: found ? 'Pattern matched' : 'Pattern not found',
      };
    }

    return { passed: false, message: 'Unknown custom criterion config' };
  }

  /**
   * Detect the appropriate test command for the project.
   */
  private detectTestCommand(workspaceRoot: string): string | null {
    const fs = require('fs');
    const path = require('path');

    // Check for package.json with test script
    const packageJson = path.join(workspaceRoot, 'package.json');
    if (fs.existsSync(packageJson)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJson, 'utf-8'));
        if (pkg.scripts?.test) {
          return 'npm test';
        }
      } catch {
        // Ignore parse errors
      }
    }

    // Check for pytest
    const pyprojectToml = path.join(workspaceRoot, 'pyproject.toml');
    const setupPy = path.join(workspaceRoot, 'setup.py');
    if (fs.existsSync(pyprojectToml) || fs.existsSync(setupPy)) {
      return 'pytest';
    }

    // Check for go.mod
    const goMod = path.join(workspaceRoot, 'go.mod');
    if (fs.existsSync(goMod)) {
      return 'go test ./...';
    }

    return null;
  }

  /**
   * Execute a shell command and return the result.
   */
  private async executeCommand(
    command: string,
    cwd: string
  ): Promise<{ exitCode: number; output: string }> {
    return new Promise((resolve) => {
      const { exec } = require('child_process');

      exec(
        command,
        {
          cwd,
          timeout: 60000, // 1 minute timeout
          maxBuffer: 1024 * 1024, // 1MB buffer
        },
        (error: Error | null, stdout: string, stderr: string) => {
          resolve({
            exitCode: error ? 1 : 0,
            output: stdout + stderr,
          });
        }
      );
    });
  }
}
```

## Usage Example

```typescript
import { SuccessCriteriaEvaluator } from './SuccessCriteria';

const evaluator = new SuccessCriteriaEvaluator();

const result = await evaluator.evaluate(
  [
    { type: 'tests_pass' },
    { type: 'done_tag' },
    { type: 'no_errors' },
  ],
  {
    bead: currentBead,
    response: llmResponse,
    errors: executionErrors,
    workspaceRoot: '/path/to/project',
    testCommand: 'npm test',
  }
);

if (result.allPassed) {
  console.log('Task complete!');
} else {
  console.log('Criteria not met:', result.details);
}
```

## Adding New Criteria Types

1. Add type to `SuccessCriterion.type` union in `src/shared/beads.ts`
2. Add case in `evaluate()` switch statement
3. Implement evaluation method
4. Add tests in `tests/beads/success-criteria.test.ts`
