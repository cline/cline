# Cline+ DAG-Aware Agent — Project Scope

## Overview

Cline+ is a VS Code extension that combines three proven technologies into a novel AI coding agent: the open-source Cline framework for local AI agent execution, the Ralph Wiggum loop pattern for iterative task completion, and dynamic code dependency analysis (DAG) for understanding cross-file impact before making changes.

The extension enables developers to delegate complex, multi-file coding tasks to an AI agent that understands the architectural implications of its changes, dramatically reducing hidden errors and brittleness in AI-generated code.

## Implementation Status (Beadsmith)

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

- [~] FR-1 Ralph Loop Controller (beads implemented; per-bead commit still missing)
- [~] FR-2 Dependency Graph Analysis Engine (core engine + JS/TS parser done; ignore rules/incremental wiring missing)
- [~] FR-3 Agent Context Injection (prompt component exists; dagImpact not wired)
- [~] FR-4 Interactive DAG Visualisation (panel exists; not wired into main UI, limited impact highlighting)
- [~] FR-5 Bead Review Workflow (review UI exists; diff + commit integration missing)
- [x] FR-6 Multi-Provider LLM Support (multi-provider support present in Beadsmith)

## Objectives

### Primary Objective
Build a production-ready VS Code extension that provides DAG-aware AI coding assistance, where the agent understands file and function dependencies before making changes, and works iteratively until defined success criteria are met.

### Secondary Objectives
- Reduce hidden errors caused by AI agents ignoring cross-file dependencies
- Provide clear visibility into change impact through interactive dependency visualisation
- Enable discrete, reviewable "beads" of work with git integration
- Support multiple LLM providers (Anthropic Claude, OpenAI, local models)
- Deliver a polished, open-source tool that the AI engineering community will adopt

## Functional Requirements

### Core Features

#### FR-1: Ralph Loop Controller
The extension must implement the Ralph Wiggum iterative loop pattern:
- Accept task definitions with explicit success criteria
- Execute work in discrete "beads" (atomic commits)
- Check success criteria after each bead (tests pass, DONE tag, etc.)
- Re-attempt with fresh context and error information if criteria not met
- Prevent context explosion by starting each iteration with clean state
- Enforce token budget and iteration limits to prevent runaway costs

**Acceptance Criteria:**
- Agent completes multi-step tasks without manual intervention
- Each bead produces a reviewable git commit
- Failed iterations are retried with error context automatically
- Loop terminates cleanly on success or budget exhaustion

#### FR-2: Dependency Graph Analysis Engine
The extension must generate and maintain a project-wide dependency graph:
- Parse Python files using AST to extract imports, function definitions, and call sites
- Parse JavaScript/TypeScript files using Babel to extract ES6 imports, function definitions, and call sites
- Resolve symbols across files with confidence scoring (high/medium/low/unsafe)
- Detect and flag edge cases: dynamic imports, late binding, circular dependencies, reflection
- Compute reverse reachability (impact analysis) for any file or function
- Suggest affected test files based on change impact
- Cache graph and support incremental re-analysis on file changes

**Acceptance Criteria:**
- Graph accurately represents 95%+ of static dependencies in test codebases
- Confidence scores correctly identify uncertain edges
- Impact analysis correctly identifies affected callers
- Re-analysis completes within 2 seconds for incremental changes

#### FR-3: Agent Context Injection
The extension must use DAG insights to improve agent prompts:
- Include relevant dependency context when the agent modifies files
- Automatically include caller/callee files in context window
- Warn of high-impact changes in the prompt
- Prioritise high-confidence edges when selecting context
- Respect token budget when selecting files to include

**Acceptance Criteria:**
- Agent receives accurate dependency context for changed files
- Context selection stays within token budget
- High-impact changes are flagged in prompts

#### FR-4: Interactive DAG Visualisation
The extension must provide a webview-based dependency graph viewer:
- Force-directed graph layout using D3.js or Vis.js
- Hover to see function details and edge metadata
- Click to navigate to source code location
- Highlight impact paths (show all callers of selected function)
- Toggle confidence level visibility (show only high-confidence edges)
- Animate change impact (flash affected nodes when code changes)
- Show graph evolution across beads

**Acceptance Criteria:**
- Graph renders within 1 second for projects up to 500 files
- Navigation to source works reliably
- Visual feedback accurately reflects change impact

#### FR-5: Bead Review Workflow
The extension must provide a structured approval workflow:
- Show diff for each proposed change
- Display impact analysis from DAG
- Highlight risky changes (high-impact modifications)
- Support user actions: approve & commit, request changes, skip bead, inspect DAG
- Generate detailed commit messages including impact summary

**Acceptance Criteria:**
- User can review all changes before commit
- Impact analysis is accurate and actionable
- Skipped beads are tracked for manual completion

#### FR-6: Multi-Provider LLM Support
The extension must support multiple LLM providers:
- Anthropic Claude (via API key)
- OpenAI (via API key)
- Local models via Ollama/LM Studio
- Token counting and budget management for all providers
- Configurable provider selection per workspace

**Acceptance Criteria:**
- All supported providers function correctly
- Token usage is accurately tracked and enforced
- API keys are stored securely

### Integration Points

#### VS Code Extension API
- Register commands for starting/stopping agent
- Provide webview panels for chat, DAG visualisation, and diff review
- Integrate with VS Code's SCM (Source Control Management) API for git operations
- Respect workspace trust model

#### Git Integration
- Create atomic commits for each bead
- Include structured commit messages with impact metadata
- Support viewing git diff in extension UI
- Track iteration history for rollback

#### MCP (Model Context Protocol)
- Support MCP tools from the Cline ecosystem
- Enable custom tool registration
- Maintain compatibility with existing Cline MCP servers

## Non-Functional Requirements

### Performance
- Initial DAG generation: < 30 seconds for 1000-file projects
- Incremental re-analysis: < 2 seconds for single file changes
- Graph visualisation: < 1 second to render 500 nodes
- Extension activation: < 500ms
- Memory usage: < 500MB for typical projects

### Scalability
- Support projects up to 5000 source files
- Support dependency graphs up to 50,000 edges
- Graceful degradation for larger projects (lazy loading, sampling)

### Security
- All code analysis runs locally; no source code sent to external services except LLM prompts
- API keys stored using VS Code SecretStorage API
- Subprocess isolation for Python DAG microservice
- Git command sanitisation to prevent injection
- Respect VS Code workspace trust

### Reliability
- Python microservice health checks and automatic restart on failure
- Graceful fallback to basic Cline functionality if DAG analysis fails
- State persistence across VS Code restarts
- Crash recovery with minimal work loss

### Maintainability
- Comprehensive test coverage (>80% for core logic)
- TypeScript strict mode throughout
- Documented public APIs
- Modular architecture enabling independent component updates

## Constraints & Assumptions

### Constraints

#### Technical Constraints
- Must run as a VS Code extension (no standalone application)
- DAG analysis limited to statically analysable code patterns
- Token budgets constrained by LLM provider limits
- Graph visualisation limited by browser rendering capabilities

#### Business Constraints
- Open-source (MIT license) to encourage adoption
- Must not require paid infrastructure for core functionality
- Must work offline except for LLM API calls

### Assumptions

#### Technical Assumptions
- Users have Python 3.12+ installed for DAG microservice
- Users have Node.js 20+ installed for extension development
- Target codebases are predominantly Python, JavaScript, or TypeScript
- Users have git initialised in their workspace
- LLM providers maintain current API compatibility

#### User Assumptions
- Users are developers familiar with VS Code
- Users understand basic git workflows
- Users have access to at least one supported LLM provider

## Out of Scope

The following are explicitly excluded from this phase:

### Language Support
- Languages other than Python, JavaScript, and TypeScript (future phases)
- Framework-specific analysis (Django ORM, React hooks, etc.)

### Infrastructure
- Cloud-hosted DAG analysis service
- Shared/collaborative editing features
- Enterprise authentication (SSO, SAML)

### Advanced Features
- Automatic test generation based on DAG
- AI-driven refactoring suggestions
- Cross-repository dependency analysis
- Real-time collaborative agent sessions

### Integrations
- IDE support beyond VS Code
- OAuth integration with Claude Code subscription
- Integration with external CI/CD systems

## Success Metrics

### Adoption Metrics
- GitHub stars within 6 months: 1,000+
- Weekly active users within 6 months: 500+
- Marketplace installs within 6 months: 5,000+

### Quality Metrics
- DAG accuracy on reference codebases: >95%
- Agent task completion rate: >80%
- User-reported hidden errors reduced by: >50% vs baseline Cline

### Performance Metrics
- P95 DAG generation time: <30 seconds
- P95 incremental analysis time: <2 seconds
- Extension crash rate: <0.1%

---

**Document Version:** 1.0  
**Last Updated:** 28 January 2026  
**Status:** Approved for Implementation
