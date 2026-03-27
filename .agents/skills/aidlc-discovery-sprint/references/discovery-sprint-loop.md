# Discovery Sprint Loop

## Sprint Modes

### `sprint-0`

Use for foundation work:

- screen inventory
- user-flow framing
- low-fidelity wireframes
- state coverage
- source-of-truth correction

### `refinement`

Use when the screen set already exists but needs stronger structure, consistency, or state handling.

### `validation`

Use when the goal is to verify an existing discovery outcome rather than generate new structure.

## Standard Loop

### 1. Resume And Gap Scan

- Load AIDLC state and audit history
- Identify contradictions between docs and the actual UI
- Determine whether the sprint is new or resumed

### 1a. Check Screen-Interaction-Design Outputs

**Mandatory check** before starting any validation. Load and review these outputs from `aidlc-docs/discovery/screen-design/`:

| Artifact | Purpose | Validation Scope |
|----------|---------|------------------|
| `screen-inventory.md` | Screen list + states | Implementation Coverage |
| `interaction-flows/*.md` | Happy path + error flows | Flow Coverage |
| `screen-story-matrix.md` | Screen-to-story mapping | Gap Analysis |
| `prototypes/*.html` | HTML mockups (if exists) | Optional reference |

Use these outputs to:
- Identify which screens/states are already designed
- Compare implementation against design specifications
- Prioritize validation targets

### 2. Scope The Sprint

Define:

- target screens
- target user flows
- required states: empty, loading, error, success, edge cases
- expected artifacts
- persistence boundary assumptions per target screen or flow
- which artifact is the source of truth for UI mapping

### 3. Capture Current Evidence

- Use `playwright-interactive` for exploratory inspection
- Use `screenshot` for baseline captures
- Note gaps between actual pages and documented intent

### 3a. Generate Screen Prototypes (Optional)

If the sprint scope includes screen design work:

- Invoke `screen-interaction-design` to produce HTML prototypes and interaction flow documents
- The skill runs its own 5-phase workflow (inventory → design → flow → validation → traceability)
- Requires user approval on the screen inventory before generating prototypes
- Outputs land in `aidlc-docs/discovery/screen-design/`

Skip this step when the sprint focuses only on existing UI inspection or wireframe refinement without prototype generation.

### 4. Update Discovery Artifacts

Update the relevant documents under `aidlc-docs/discovery/`.

Typical updates:

- screen planning
- wireframes
- sprint brief
- sprint review
- flow notes
- unresolved questions
- boundary mode notes and replacement seams
- **screen-design artifacts** (if validated):
  - Update `screen-inventory.md` with new coverage %
  - Update `screen-story-matrix.md` with verified/uncovered gaps

### 4a. Verify Test Separation (Before Playwright Validation)

**Purpose**: Ensure test infrastructure is properly isolated before running validation

**When to run**: Before Step 5 (Validate The Sprint) if Playwright validation is planned

**Verification**:

1. **Run validation script**:
   ```bash
   python3 .agents/skills/webapp-testing/scripts/validate_test_separation.py .
   ```

2. **If validation fails**:
   - **STOP**: Do not proceed to Playwright validation
   - Create `tests/` directory structure
   - Set up test-only auth API (`tests/test-api/auth/route.ts`)
   - Configure Next.js build exclusion (`next.config.js`)
   - Move any test code from `app/` to `tests/`
   - Re-run validation script

3. **If validation passes**:
   - Proceed to Step 5 (Validate The Sprint)
   - Use test-only auth API for Playwright authentication
   - Record validation results

**Rationale**: Ensures that Playwright tests use proper test infrastructure and don't rely on production code contamination (demo buttons, mock APIs).

**Audit requirement**: Log validation results in audit.md with:
- Validation script output
- Any contamination found and fixed
- Confirmation that test separation is verified

### 5. Validate The Sprint

**Purpose**: Verify implementation against ALL screen-interaction-design outputs using Playwright

**Test output convention**: All validation artifacts for this sprint MUST be saved under:
```
aidlc-docs/test/aidlc-discovery-sprint/<sprint-number>/
```
Where `<sprint-number>` matches the current sprint (e.g., `sprint-0`, `sprint-5`). Use standard subdirectories:
- `screenshots/` — captured screen evidence
- `playwright-results/` — Playwright test outputs (pass/fail/blocked)

**Mandatory validation against each artifact**:

| Artifact | Validation Method | What to Check |
|----------|-------------------|---------------|
| `screen-inventory.md` | Code + Playwright | States implemented vs defined |
| `interaction-flows/*.md` | Code + Playwright | Happy path + error flows work as documented |
| `screen-story-matrix.md` | Code review | Stories covered/uncovered |
| `prototypes/*.html` | Visual comparison | If exists, compare UI structure |

**Three-layer validation**:

1. **Implementation Coverage**: screen-inventory.md states vs actual code (X/Y states, Z%)
2. **Flow Coverage**: interaction-flows/*.md paths vs actual behavior (N/M flows verified)
3. **Validation Coverage**: Playwright/browser verification (runnable UI tested)
4. **Boundary Coverage**: adapter mode, source-of-truth reference, and contract-preservation notes are recorded for the validated scope

If the UI is runnable:

- run `playwright` (or playwright-interactive for exploration)
- capture pass, fail, and blocked results

If the UI is not runnable:

- record the blocker explicitly
- treat validation as blocked, not skipped

**Report requirement**: Sprint review must include all three coverage metrics:
- **Implementation Coverage**: X/Y states (Z%) — from screen-inventory.md
- **Flow Coverage**: N/M interaction flows verified — from interaction-flows/*.md
- **Validation Coverage**: K/L GAPs verified — Playwright/browser tested

### Security Review for Test Features

**When implementing test helpers or demo features during discovery**:

1. **Enforce test separation**:
   - All test code MUST go in `tests/` directory
   - NO test code in `app/` directory
   - NO demo buttons in production UI
   - NO mock APIs in production routes

2. **Validate separation**:
   - Run `validate_test_separation.py` before sprint completion
   - Fix any production contamination found
   - Document test infrastructure in sprint review

3. **Document test-only features**:
   - List all test APIs created (e.g., `/api/test/auth`)
   - List all test fixtures created
   - Confirm all are in `tests/` directory

4. **Add to CONSTRUCTION cleanup checklist**:
   - Verify `tests/` directory is excluded from production builds
   - Verify `/api/test/*` routes return 404 in production
   - Run production build and inspect output

**Completion Gate**: Sprint cannot be marked complete if production contamination is detected.

**Screenshot capture requirement**:
- Use `screenshot` helper skill to capture evidence during validation
- Save to `aidlc-docs/test/aidlc-discovery-sprint/<sprint-number>/screenshots/`
- Capture: key screens, error states, GAP implementations
- List all captured screenshots in sprint review with:
  - Filename/path
  - Description (what it shows)
  - Related GAP or flow

### 6. Write Review And Backlog

Every sprint should end with:

- what changed
- what was verified
- what failed or stayed blocked
- what the next sprint should improve
- whether the persistence boundary is safe enough for later implementation handoff

### 7. Route Reusable Lessons To Meta Knowledge

If the sprint produced reusable workflow lessons, invoke `$meta-knowledge`.

Use it to decide whether the lesson should improve:

- `aidlc-discovery-sprint`
- another skill
- a project rule
- a template or helper script
- the meta workflow itself

### 8. Assess INCEPTION Feedback

If discovery exposed missing scope, weak acceptance criteria, missing actor needs, or component boundary problems, route the finding back to INCEPTION.

## Completion Gate

A sprint is complete only when all applicable items are true:

- audit updated
- **screen-interaction-design outputs checked** (Step 1a)
- discovery artifacts updated
- validation status recorded
- next sprint backlog recorded
- meta-knowledge handoff assessed
- inception feedback assessed
