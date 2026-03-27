# Code Generation - Detailed Steps

## Overview
This stage generates code for each unit of work through two integrated parts:
- **Part 1 - Planning**: Create detailed code generation plan with explicit steps
- **Part 2 - Generation**: Execute approved plan to generate code, tests, and artifacts

**Note**: For brownfield projects, "generate" means modify existing files when appropriate, not create duplicates.

## Prerequisites
- Unit Design Generation must be complete for the unit
- NFR Implementation (if executed) must be complete for the unit
- All unit design artifacts must be available
- Unit is ready for code generation

---

# PART 1: PLANNING

## Step 1: Analyze Unit Context
- [ ] Read unit design artifacts from Unit Design Generation
- [ ] Read unit story map to understand assigned stories
- [ ] Identify unit dependencies and interfaces
- [ ] Validate unit is ready for code generation

## Step 2: Create Detailed Unit Code Generation Plan
- [ ] Read workspace root and project type from `aidlc-docs/aidlc-state.md`
- [ ] Determine code location (see Critical Rules for structure patterns)
- [ ] **Brownfield only**: Review reverse engineering code-structure.md for existing files to modify
- [ ] Document exact paths (never aidlc-docs/)
- [ ] Create explicit steps for unit generation:
  - Project Structure Setup (greenfield only)
  - Business Logic Generation
  - Business Logic Unit Testing
  - Business Logic Summary
  - API Layer Generation
  - API Layer Unit Testing
  - API Layer Summary
  - Repository Layer Generation
  - Repository Layer Unit Testing
  - Repository Layer Summary
  - Frontend Components Generation (if applicable)
  - Frontend Components Unit Testing (if applicable)
  - Frontend Components Summary (if applicable)
  - Database Migration Scripts (if data models exist)
  - Documentation Generation (API docs, README updates)
  - Deployment Artifacts Generation
- [ ] Number each step sequentially
- [ ] Include story mapping references
- [ ] Add checkboxes [ ] for each step

## Step 3: Include Unit Generation Context
- [ ] For this unit, include:
  - Stories implemented by this unit
  - Dependencies on other units/services
  - Expected interfaces and contracts
  - Database entities owned by this unit
  - Service boundaries and responsibilities

## Step 4: Create Unit Plan Document
- [ ] Save complete plan as `aidlc-docs/construction/plans/{unit-name}-code-generation-plan.md`
- [ ] Include step numbering (Step 1, Step 2, etc.)
- [ ] Include unit context and dependencies
- [ ] Include story traceability
- [ ] Ensure plan is executable step-by-step
- [ ] Emphasize that this plan is the single source of truth for Code Generation

## Step 5: Summarize Unit Plan
- [ ] Provide summary of the unit code generation plan to the user
- [ ] Highlight unit generation approach
- [ ] Explain step sequence and story coverage
- [ ] Note total number of steps and estimated scope

## Step 6: Log Approval Prompt
- [ ] Before asking for approval, log the prompt with timestamp in `aidlc-docs/audit.md`
- [ ] Include reference to the complete unit code generation plan
- [ ] Use ISO 8601 timestamp format

## Step 7: Wait for Explicit Approval
- [ ] Do not proceed until the user explicitly approves the unit code generation plan
- [ ] Approval must cover the entire plan and generation sequence
- [ ] If user requests changes, update the plan and repeat approval process

## Step 8: Record Approval Response
- [ ] Log the user's approval response with timestamp in `aidlc-docs/audit.md`
- [ ] Include the exact user response text
- [ ] Mark the approval status clearly

## Step 9: Update Progress
- [ ] Mark Code Planning complete in `aidlc-state.md`
- [ ] Update the "Current Status" section
- [ ] Prepare for transition to Code Generation

---

# PART 2: GENERATION

## Step 10: Load Unit Code Generation Plan
- [ ] Read the complete plan from `aidlc-docs/construction/plans/{unit-name}-code-generation-plan.md`
- [ ] Identify the next uncompleted step (first [ ] checkbox)
- [ ] Load the context for that step (unit, dependencies, stories)

## Step 11: Execute Current Step
- [ ] Verify target directory from plan (never aidlc-docs/)
- [ ] **Brownfield only**: Check if target file exists
- [ ] Generate exactly what the current step describes:
  - **If file exists**: Modify it in-place (never create `ClassName_modified.java`, `ClassName_new.java`, etc.)
  - **If file doesn't exist**: Create new file
- [ ] Write to correct locations:
  - **Application Code**: Workspace root per project structure
  - **Documentation**: `aidlc-docs/construction/{unit-name}/code/` (markdown only)
  - **Build/Config Files**: Workspace root
- [ ] Follow unit story requirements
- [ ] Respect dependencies and interfaces

## Step 12: Update Progress
- [ ] Mark the completed step as [x] in the unit code generation plan
- [ ] Mark associated unit stories as [x] when their generation is finished
- [ ] Update `aidlc-docs/aidlc-state.md` current status
- [ ] **Brownfield only**: Verify no duplicate files created (e.g., no `ClassName_modified.java` alongside `ClassName.java`)
- [ ] Save all generated artifacts

## Step 13: Continue or Complete Generation
- [ ] If more steps remain, return to Step 10
- [ ] If all steps complete, proceed to present completion message

## Step 14: Present Completion Message
- Present completion message in this structure:
     1. **Completion Announcement** (mandatory): Always start with this:

```markdown
# 💻 Code Generation Complete - [unit-name]
```

     2. **AI Summary** (optional): Provide structured bullet-point summary
        - **Brownfield**: Distinguish modified vs created files (e.g., "• Modified: `src/services/user-service.ts`", "• Created: `src/services/auth-service.ts`")
        - **Greenfield**: List created files with paths (e.g., "• Created: `src/services/user-service.ts`")
        - List tests, documentation, deployment artifacts with paths
        - Keep factual, no workflow instructions
     3. **Formatted Workflow Message** (mandatory): Always end with this exact format:

```markdown
> **📋 <u>**REVIEW REQUIRED:**</u>**  
> Please examine the generated code at:
> - **Application Code**: `[actual-workspace-path]`
> - **Documentation**: `aidlc-docs/construction/[unit-name]/code/`



> **🚀 <u>**WHAT'S NEXT?**</u>**
>
> **You may:**
>
> 🔧 **Request Changes** - Ask for modifications to the generated code based on your review  
> ✅ **Continue to Next Stage** - Approve code generation and proceed to **[next-unit/Build & Test]**

---
```

## Step 15: Wait for Explicit Approval
- Do not proceed until the user explicitly approves the generated code
- Approval must be clear and unambiguous
- If user requests changes, update the code and repeat the approval process

## Step 16: Record Approval and Update Progress
- Log approval in audit.md with timestamp
- Record the user's approval response with timestamp
- Mark Code Generation stage as complete for this unit in aidlc-state.md

---

## Critical Rules

### Code Location Rules
- **Application code**: Workspace root only (NEVER aidlc-docs/)
- **Documentation**: aidlc-docs/ only (markdown summaries)
- **Read workspace root** from aidlc-state.md before generating code

**Structure patterns by project type**:
- **Brownfield**: Use existing structure (e.g., `src/main/java/`, `lib/`, `pkg/`)
- **Greenfield single unit**: `src/`, `tests/`, `config/` in workspace root
- **Greenfield multi-unit (microservices)**: `{unit-name}/src/`, `{unit-name}/tests/`
- **Greenfield multi-unit (monolith)**: `src/{unit-name}/`, `tests/{unit-name}/`

### Brownfield File Modification Rules
- Check if file exists before generating
- If exists: Modify in-place (never create copies like `ClassName_modified.java`)
- If doesn't exist: Create new file
- Verify no duplicate files after generation (Step 12)

### Planning Phase Rules
- Create explicit, numbered steps for all generation activities
- Include story traceability in the plan
- Document unit context and dependencies
- Get explicit user approval before generation

### Generation Phase Rules
- **NO HARDCODED LOGIC**: Only execute what's written in the unit plan
- **FOLLOW PLAN EXACTLY**: Do not deviate from the step sequence
- **UPDATE CHECKBOXES**: Mark [x] immediately after completing each step
- **STORY TRACEABILITY**: Mark unit stories [x] when functionality is implemented
- **RESPECT DEPENDENCIES**: Only implement when unit dependencies are satisfied

### Automation Friendly Code Rules
When generating UI code (web, mobile, desktop), ensure elements are automation-friendly:
- Add `data-testid` attributes to interactive elements (buttons, inputs, links, forms)
- Use consistent naming: `{component}-{element-role}` (e.g., `login-form-submit-button`, `user-list-search-input`)
- Avoid dynamic or auto-generated IDs that change between renders
- Keep `data-testid` values stable across code changes (only change when element purpose changes)

## Completion Criteria
- Complete unit code generation plan created and approved
- All steps in unit code generation plan marked [x]
- All unit stories implemented according to plan
- All code and tests generated (tests will be executed in Build & Test phase)
- Deployment artifacts generated
- Complete unit ready for build and verification
