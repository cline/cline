---
name: bead-workflow
description: Implement the beads (Ralph Wiggum loop) pattern for iterative task execution. Use when working on BeadManager, success criteria, task state, approval flow, iterative agent loops, or task completion logic. Triggers on "bead", "Ralph loop", "iteration", "success criteria", "task approval".
---

# Bead Workflow Development

Beads are discrete, reviewable units of work. The Ralph Wiggum loop executes beads iteratively until success criteria are met.

## Core Concepts

| Concept | Definition |
|---------|------------|
| **Bead** | One atomic chunk of work with a commit |
| **Ralph Loop** | Iterative execution: bead → check → retry or complete |
| **Success Criteria** | Conditions for task completion (tests pass, DONE tag) |
| **Token Budget** | Maximum tokens for entire task |

## State Machine

```
     ┌─────────┐
     │  IDLE   │
     └────┬────┘
          │ startTask()
          ▼
     ┌─────────┐
┌────│ RUNNING │◄───────────┐
│    └────┬────┘            │
│         │                 │
│   ┌─────┴─────┐           │
│   ▼           ▼           │
│ ┌────┐    ┌──────┐        │
│ │WAIT│    │CHECK │        │
│ │USER│    │PASS? │        │
│ └─┬──┘    └──┬───┘        │
│   │          │            │
│   │     ┌────┴────┐       │
│   │     ▼         ▼       │
│   │   Pass      Fail──────┘
│   │     │       (retry)
│   ▼     ▼
│ ┌────────┐   ┌────────┐
└►│COMPLETE│   │ FAILED │
  └────────┘   └────────┘
```

## Key Files to Create/Modify

| File | Purpose |
|------|---------|
| `src/core/beads/BeadManager.ts` | Orchestrates bead execution |
| `src/core/beads/SuccessCriteria.ts` | Evaluates completion conditions |
| `src/shared/beads.ts` | Type definitions |
| `src/core/task/TaskState.ts` | Add bead tracking fields |
| `src/shared/ExtensionMessage.ts` | Add `ClineAsk`/`ClineSay` types |

## Quick Implementation Guide

### 1. Add Bead Types

In `src/shared/beads.ts`:

```typescript
export interface Bead {
  id: string;
  taskId: string;
  beadNumber: number;
  status: 'running' | 'awaiting_approval' | 'approved' | 'rejected' | 'skipped';
  filesChanged: string[];
  tokensUsed: number;
  commitHash?: string;
}

export interface SuccessCriterion {
  type: 'tests_pass' | 'done_tag' | 'no_errors' | 'custom';
  config?: Record<string, unknown>;
}
```

### 2. Add Message Types

In `src/shared/ExtensionMessage.ts`:

```typescript
export type ClineAsk = "bead_review" | /* existing */ ;
export type ClineSay = "bead_started" | "bead_completed" | /* existing */ ;
```

### 3. Implement Success Criteria

See [references/success-criteria.md](references/success-criteria.md) for full implementation.

Key checks:
- **tests_pass**: Run test command, check exit code
- **done_tag**: Scan response for `/\bDONE\b/i`
- **no_errors**: Check `errors.length === 0`

### 4. Wire Approval Flow

```typescript
// In BeadManager
async finishBead(result: BeadResult) {
  this.status = 'awaiting_approval';
  this.emit('awaitingApproval', result);
}

// In Controller, handle user response
case 'bead:approve':
  await this.beadManager.approveCurrentBead();
  break;
case 'bead:reject':
  await this.beadManager.rejectCurrentBead(payload.feedback);
  break;
```

## Common Issues

| Issue | Check |
|-------|-------|
| Bead never completes | Success criteria evaluation running? |
| Infinite retry loop | `maxIterations` enforced? Error context passed? |
| State not persisting | Proto regenerated? State helpers updated? |

## Additional Resources

- [references/success-criteria.md](references/success-criteria.md) - Full evaluator implementation
- [references/bead-data-model.md](references/bead-data-model.md) - Complete type definitions
- `plans/cline-beads-integration-findings.md` - Integration points
- `plans/cline-dag-llm-integration.md` - Executor implementation
