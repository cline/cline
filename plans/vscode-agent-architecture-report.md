# VS Code AI Agent Extension with Dependency Graph Analysis
## Comprehensive Technical Review & Implementation Plan

**Date:** January 28, 2026  
**Project:** Cline Fork + Ralph Wiggum Loop + DAG Analysis Integration  
**Status:** Pre-Implementation Technical Analysis

---

## EXECUTIVE SUMMARY

You're proposing an ambitious, technically sound VS Code extension that merges three powerful concepts:

1. **Cline** - An open-source AI coding agent framework with local execution and MCP integration [web:16, web:28]
2. **Ralph Wiggum Loop** - An iterative feedback pattern that keeps agents working until defined success criteria are met [web:51, web:60, web:54]
3. **Dynamic Code Dependency Analysis (DAG)** - A generated graph showing file-to-file dependencies, function relationships, and change impact analysis

The combination creates what we'll call **"Cline+ with DAG Awareness"** - an agent that understands the full architectural implications of code changes before making them, dramatically reducing hidden errors and brittleness.

**Verdict:** Technically feasible. Well-grounded in current AI agent patterns. The DAG component is the novel/complex element; dependency analysis is mature technology, but integrating it into real-time agent decision-making is non-trivial.

---

## SECTION 1: TECHNOLOGY LANDSCAPE ANALYSIS

### 1.1 Cline: Architecture & Extensibility

**What it is:**
Cline is a VS Code extension (TypeScript/React) that runs AI agents locally with zero server-side components [web:16, web:28]. The agent can:
- Read and edit files
- Execute terminal commands
- Use a browser
- Integrate Model Context Protocol (MCP) tools
- Connect to multiple LLM providers (Anthropic, OpenAI, Google, AWS Bedrock, local models via Ollama/LM Studio)

**Key Architecture:**
```
┌─────────────────────────────────────┐
│   VS Code Extension (TypeScript)    │
├─────────────────────────────────────┤
│  Backend                │  Frontend  │
│  • Command handlers     │ React      │
│  • File operations      │ Webview UI │
│  • Terminal exec        │ Chat view  │
├─────────────────────────────────────┤
│ MCP Client (Stdio/SSE)              │
├─────────────────────────────────────┤
│ LLM Provider (API calls)            │
│ • Anthropic Claude                  │
│ • OpenAI                            │
│ • Local (Ollama/LM Studio)          │
└─────────────────────────────────────┘
```

**Why it's good for forking:**
- Open source (MIT license) [web:28]
- Modular architecture - extensions can be built on top
- Already supports multiple LLM providers
- MCP system allows adding custom tools
- Active development + growing ecosystem

**Fork complexity:** Medium. You're not modifying core agent logic heavily; you're adding a new "reasoning module" (DAG analysis) and controlling loop behaviour via the Ralph pattern.

---

### 1.2 Ralph Wiggum Loop: Implementation Pattern

**What it is:**
Named after the Simpsons character (tongue-in-cheek), Ralph is a concrete pattern for autonomous agent loops [web:51, web:60, web:54]:

1. **Agent receives task** → works on it
2. **Agent signals completion** → but loop doesn't exit yet
3. **Stop hook intercepts** → checks for success criteria (tests pass, "DONE" tag, etc.)
4. **If not complete:** Re-feed prompt with updated context (new errors, logs, changed files)
5. **Loop again** until success criterion is met

**Key insight:** Rather than the *same session* getting bloated context (context compaction, hallucination amplification), Ralph spawns fresh processes: each iteration reads spec from disk, picks ONE task, implements it, commits, exits. New iteration starts clean.

**Why this matters for your use case:**
- Prevents context explosion when reviewing large codebases
- Forces discrete, testable changes ("beads")
- Gives clear recovery points between iterations
- Aligns perfectly with your desire for "progress review + git diffs after every bead"

**Implementation in your fork:**
```bash
# Pseudocode for extension-level Ralph loop
while not_done:
    context = read_task_spec()
    dag = generate_dependency_graph()
    
    prompt = build_prompt(context, dag)
    result = send_to_claude(prompt)
    
    # Execute changes (respecting user approval)
    apply_changes(result)
    
    # Check success criterion
    if test_passes() and has_done_tag():
        break
    
    # Otherwise, loop with fresh context
    commit_partial_work()
    log_iteration()
```

---

### 1.3 Dependency Graph Analysis (DAG)

**The Novel Component:**

Your requirement: A DAG that shows:
- Which files depend on which files
- Which functions call which functions
- Change impact: "If I modify function X, what else breaks?"
- Works for non-compiled languages (Python, JS, TypeScript, etc.)
- Handles edge cases (late binding, dynamic imports, circular deps)

**Existing tooling landscape:**

| Tool | Language | What it does | Limitations |
|------|----------|-------------|-------------|
| **it-depends** [web:24] | Python, JS | Build complete dependency graph recursively | Good for package-level deps; less good for intra-file function graphs |
| **Tangle Tools** [web:30] | Python | Full codebase import graph using AST + networkx | Strong for import analysis; requires custom work for function-level granularity |
| **Python AST** [web:52] | Python | Parse code structure into tree; analyze statically | Good foundation; must build function call analysis on top |
| **Webpack Bundle Analyzer** [web:18] | JavaScript | Visualize bundle dependencies | Build-time only; doesn't help at dev-time for uncompiled code |
| **D3.js / Plotly** [web:18, web:27] | Any (visualization) | Render graphs interactively | Visualization layer; not analysis layer |
| **NetworkX** [web:21, web:30] | Python | Graph algorithms (shortest path, clustering, influence) | Python-only; powerful for analysis once graph is built |
| **Tom Sawyer Perspectives** [web:18] | Any | Interactive graph visualization with real-time updates | Enterprise tool; may be overkill |

**Your approach should be a hybrid:**

```
┌─────────────────────────────────┐
│  Static Analysis Engine         │
├─────────────────────────────────┤
│ Language-Specific Parsers       │
│  • Python: ast module           │
│  • JavaScript: @babel/parser    │
│  • TypeScript: TypeScript API   │
├─────────────────────────────────┤
│ Symbol Resolution Layer         │
│  • Track function definitions   │
│  • Map call sites to targets    │
│  • Handle dynamic/late binding  │
├─────────────────────────────────┤
│ Graph Construction (NetworkX)   │
│  • Nodes: files + functions     │
│  • Edges: imports + calls       │
├─────────────────────────────────┤
│ Impact Analysis                 │
│  • Reverse reachability query   │
│  • Suggest affected tests       │
├─────────────────────────────────┤
│ Visualization (D3.js in webview)│
│  • Interactive DAG in sidebar   │
│  • Highlight change impacts     │
└─────────────────────────────────┘
```

---

### 1.4 Claude Local Models & Token Management

**Current state (Jan 2026):**
- Claude API supports token counting (free, rate-limited) [web:23, web:26]
- Token management is critical for cost + context awareness
- Claude Code (the subscription service) has `/model` and `/compact` commands for token optimization [web:17]

**Your requirement:** "Connect to Claude Code installed on the system"

**How this works:**
Claude Code is a separate service. Options for integration:

| Approach | Pros | Cons |
|----------|------|------|
| Use Anthropic API directly with user's API key | Full control, clear billing, no auth complexity | User manages API keys, per-token costs |
| OAuth to Claude Code subscription | Premium features, user's existing subscription | Requires OAuth implementation, Anthropic may not expose this in extensions |
| Local model via Ollama/LM Studio | Free, privacy-preserving | Slower, requires local setup, lower quality |

**Recommended:** Start with standard Anthropic API key management (like current Cline), then explore OAuth if Anthropic enables it.

---

## SECTION 2: ARCHITECTURAL DESIGN

### 2.1 Extension Architecture

```
┌────────────────────────────────────────────────────┐
│           VS Code Extension (Cline+)               │
├────────────────────────────────────────────────────┤
│                                                    │
│  ┌────────────────────────────────────────────┐   │
│  │   Extension Main (extension.ts)            │   │
│  │  • Register commands                       │   │
│  │  • Manage webviews                         │   │
│  │  • Orchestrate Ralph loop                  │   │
│  └────────────────────────────────────────────┘   │
│                                                    │
│  ┌──────────────────┐  ┌──────────────────────┐   │
│  │  Ralph Loop      │  │  DAG Analysis        │   │
│  │  Controller      │  │  Engine              │   │
│  │                  │  │                      │   │
│  │  • Task queue    │  │  • AST parsers       │   │
│  │  • Iteration mgmt│  │  • Symbol resolution │   │
│  │  • Git tracking  │  │  • Impact analysis   │   │
│  │  • Success check │  │  • Visualization     │   │
│  └──────────────────┘  └──────────────────────┘   │
│                                                    │
│  ┌────────────────────────────────────────────┐   │
│  │   Agent Core (Cline fork)                  │   │
│  │  • File operations                         │   │
│  │  • Terminal execution                      │   │
│  │  • MCP integration                         │   │
│  │  • LLM provider interface                  │   │
│  └────────────────────────────────────────────┘   │
│                                                    │
│  ┌───────────────────┬───────────────────────┐   │
│  │  Webview Backend  │  Webview Frontend     │   │
│  │  (Message API)    │  (React)              │   │
│  │                   │                       │   │
│  │  • Query DAG      │  • Chat interface     │   │
│  │  • Provide diffs  │  • DAG visualization  │   │
│  │  • Task mgmt UI   │  • Progress timeline  │   │
│  │  • Review beads   │  • Diff viewer        │   │
│  └───────────────────┴───────────────────────┘   │
│                                                    │
└────────────────────────────────────────────────────┘
         ↓                                    ↓
    File System                        LLM (Claude)
     Git Repos                    (via Anthropic API)
```

### 2.2 Data Flow: "Bead" Processing

A "bead" is one discrete chunk of work within the Ralph loop.

```
User specifies task + success criteria
            ↓
    [ITERATION START]
            ↓
Read task spec from disk
    ↓
Generate full project DAG
    ↓
Build prompt with:
    - Current task
    - Relevant files (from DAG)
    - Previous failures (if iteration > 1)
    - DAG context (dependencies of files being changed)
            ↓
Send to Claude
            ↓
Agent generates code changes
            ↓
[User approval checkpoint] ← Design choice: auto-apply or manual review?
            ↓
Apply changes to files
            ↓
Execute tests / build
            ↓
Collect output, errors, diffs
            ↓
Commit as "Bead #N" with:
    - Commit message
    - Changed files
    - Git diff
    - Impact analysis (DAG-driven)
            ↓
Check success criterion:
    - Tests pass?
    - All tasks complete?
    - "DONE" tag found?
            ↓
    ┌─ YES → [COMPLETE]
    └─ NO  → Loop back with fresh context
```

---

### 2.3 DAG Analysis in Detail

**Stage 1: Parse & Symbol Extraction**

```python
# Pseudocode: DAG builder module (TypeScript or Python microservice)

class DependencyAnalyzer:
    def analyze_project(self, root_path: str) -> ProjectGraph:
        graph = ProjectGraph()
        
        for file_path in find_source_files(root_path):
            lang = detect_language(file_path)
            
            if lang == "python":
                ast_tree = parse_with_ast(file_path)
                imports = extract_imports(ast_tree)
                functions = extract_functions(ast_tree)
                calls = extract_function_calls(ast_tree)
                
            elif lang == "javascript" or lang == "typescript":
                ast_tree = parse_with_babel(file_path)
                imports = extract_es6_imports(ast_tree)
                functions = extract_functions(ast_tree)
                calls = extract_function_calls(ast_tree)
            
            # Add to graph
            graph.add_file(file_path, functions, imports, calls)
        
        # Resolve cross-file references
        graph.resolve_symbols()
        
        return graph
```

**Stage 2: Symbol Resolution (the tricky part)**

Challenge: A call to `user.save()` could resolve to:
- `User.save()` method in class `User`
- An instance method on any class named `User`
- A dynamic method added at runtime
- A method from a mixin or base class

**Approaches:**
1. **Static conservative:** Only mark as "probable" deps where we're confident
2. **Dynamic conservative:** Mark all possible targets as "may affect"
3. **Hybrid:** Use type hints / JSDoc where available, fall back to conservative

**For your use case**, recommend **Hybrid** with clear uncertainty labelling in the graph:
```python
class SymbolResolution:
    def resolve_call(self, call_site, context):
        candidates = [
            ("high", matching_definitions),      # ~95% confident
            ("medium", similar_names),           # ~60% confident  
            ("low", any_possible_receiver)       # Could affect via duck typing
        ]
        return candidates
```

The DAG shows all edges but color-codes by confidence. The agent can weigh decisions accordingly.

**Stage 3: Impact Analysis**

```python
def compute_change_impact(graph: ProjectGraph, changed_file: str) -> ImpactReport:
    """
    If file X is modified, what else is affected?
    """
    affected = set()
    
    # Direct: files that import this file
    affected.update(graph.reverse_imports(changed_file))
    
    # Indirect: files that import files that import this file
    for affected_file in list(affected):
        affected.update(graph.reverse_imports(affected_file))
    
    # Function-level: if function X in this file changed, 
    # what functions call X?
    for func in graph.get_functions(changed_file):
        affected_funcs = graph.reverse_call_graph(func)
        affected.update(affected_funcs)
    
    # Suggest test files that should be re-run
    test_files = [f for f in affected if is_test_file(f)]
    
    return ImpactReport(
        affected_files=affected,
        affected_functions=affected_funcs,
        suggested_tests=test_files,
        confidence_by_edge=graph.edge_confidence
    )
```

**Stage 4: Visualization in VS Code Webview**

Use **D3.js** or **Vis.js** for interactive graph:
- Force-directed layout (nodes repel, edges attract)
- Hover to see function details
- Click to jump to code
- Highlight paths (e.g., "show all callers of function X")
- Toggle confidence levels (show only high-confidence edges)
- Animate change impact (flash nodes affected by edit)

---

## SECTION 3: EDGE CASES & BRITTLENESS MITIGATION

### 3.1 The Hidden Error Problem

Your concern: "The app works until a function is called and then it collapses"

**Common causes:**
1. **Late binding:** `obj[method_name]()` where method_name is a string
2. **Dynamic imports:** `import(`./${module_name}.js`)`
3. **Circular dependencies:** A → B → C → A (works if no circular call)
4. **Missing type guards:** `if (x) x.method()` - what if x is undefined?
5. **Mixin/inheritance chains:** Deep inheritance that static analysis misses
6. **Reflection/introspection:** Code that discovers methods at runtime

**Mitigation strategy:**

| Edge Case | Detection | Mitigation |
|-----------|-----------|-----------|
| Late binding | Pattern match string accessors (obj["foo"]) in AST | Mark as "dynamic call"; suggest type narrowing |
| Dynamic imports | Pattern match import() calls | Mark all potential modules as "could import"; require explicit handling |
| Circular deps | Graph cycle detection | Flag as warning; suggest refactor; don't break analysis (graphs can have cycles) |
| Missing guards | Dataflow analysis: track null checks | Suggest assertion/guard statements before use |
| Deep inheritance | Track `extends` + `super` chains | Build full MRO (method resolution order) |
| Reflection | Scan for eval, new Function, getOwnPropertyNames | Mark as "unsafe"; flag to developer; suggest alternatives |

**Implementation:**
Each edge case gets a **confidence score**. Edges tagged "high-confidence" vs "possible" vs "unsafe".

```typescript
type EdgeConfidence = "high" | "medium" | "low" | "unsafe";

interface GraphEdge {
    from: string;
    to: string;
    type: "import" | "call" | "inherit";
    confidence: EdgeConfidence;
    reason: string;
    line_number: number;
}
```

The agent sees this metadata and can decide: "I'll refactor this function carefully because there are unsafe dynamic calls to it."

---

### 3.2 Non-Compiled Language Challenges

Unlike compiled languages (Java, C++), Python/JS/TS have:
- **Dynamic typing:** Variables can change types at runtime
- **Monkey patching:** Code can add methods to existing classes after definition
- **Duck typing:** Any object with a method X can act as type X
- **Eval/exec:** Arbitrary code execution at runtime

**Approach:**

1. **Static analysis as approximation:** Parse AST to find obvious dependencies
2. **Type hints as hints:** Use Python type hints, TypeScript, JSDoc to improve accuracy
3. **Runtime fallback:** Run minimal test suite; let execution catch what static analysis missed
4. **Conservative marking:** If unsure, mark as "might affect" not "doesn't affect"

**Recommended implementation:**
```typescript
interface AnalysisConfig {
    use_type_hints: boolean;      // Use JSDoc/TypeScript if available
    include_test_suite: boolean;  // Run quick tests to validate graph
    conservative_mode: boolean;   // If unsure, assume dependency exists
    dynamic_threshold: number;    // % of code that's dynamic; warn if > this
}
```

---

## SECTION 4: IMPLEMENTATION ROADMAP

Legend: [x] done, [~] partial, [ ] not done, [?] not verified

### Phase 1: Foundation (Weeks 1-3)
**Goal:** Basic Cline fork with Ralph loop structure

- [x] Fork Cline repository; set up build pipeline
- [~] Implement Ralph loop controller (TypeScript):
  - Task queue management
  - Success criterion checker
  - Git commit/diff tracking
- [~] Wire in LLM token counting (use Anthropic API)
- [x] Build basic webview UI skeleton (task list, progress)
- [ ] Write unit tests for loop logic

**Deliverable:** Extension that can run a single "bead" to completion, then loop once.

---

### Phase 2: DAG Analysis Engine (Weeks 4-7)
**Goal:** Build dependency graph + impact analysis

- [x] Implement Python analyzer (ast-based)
  - Extract imports, function defs, calls
  - Symbol resolution for Python
  
- [x] Implement JavaScript/TypeScript analyzer (@babel/parser)
  - Extract ES6 imports, function defs, calls
  - TypeScript type resolution
  
- [x] Build NetworkX-based graph construction (Python microservice)
  - Merge per-file analysis into project graph
  - Compute reachability/closure
  
- [x] Implement impact analysis
  - Reverse dependency queries
  - Suggest affected test files
  
- [ ] Write comprehensive tests for edge cases
  - Late binding, dynamic imports, circular deps
  - Confidence scoring

**Deliverable:** Standalone Python microservice that ingests a codebase, outputs a JSON dependency graph with confidence labels.

---

### Phase 3: Webview Integration (Weeks 8-10)
**Goal:** Visualize graph + integrate into extension UI

- [x] Build D3.js graph visualization (React component)
  - Force-directed layout
  - Hover details, click-to-code navigation
  - Highlight impact of changes
  
- [~] Extend webview to show:
  - Current task + progress
  - Changed files + diffs
  - Affected functions (from DAG)
  - Suggested tests
  
- [x] Implement message passing (extension ↔ webview)
  - Query DAG for specific file/function
  - Subscribe to file changes
  - Trigger re-analysis on code changes
  
- [ ] Design multi-window layout (as per Cline pattern [web:53])
  - Main chat window
  - DAG sidebar/panel
  - Diff viewer panel

**Deliverable:** Beautiful, responsive graph visualization integrated into VS Code.

---

### Phase 4: Agent Awareness (Weeks 11-13)
**Goal:** Feed DAG insights into agent prompts

- [~] Build prompt engineering:
  - Include DAG in system prompt (as context)
  - Highlight dependencies of files being changed
  - Warn of high-impact changes
  
- [ ] Implement "smart context injection"
  - If changing function X, include all callers in context window
  - If adding field to class Y, include all instantiations
  - Prioritize high-confidence edges
  
- [~] Build approval workflow
  - Show agent's proposed changes
  - Highlight risky changes (high impact)
  - Allow user to override/review before commit
  
- [ ] Implement git workflow
  - Commit each bead with detailed message
  - Include impact analysis in commit
  - Generate "before/after" reports

**Deliverable:** Agent that uses DAG to make safer decisions; user can review impact before changes.

---

### Phase 5: Testing & Refinement (Weeks 14-16)
**Goal:** Real-world validation

- [ ] Test on reference codebases
  - Django project (Python)
  - React project (JavaScript)
  - Mixed monorepo
  
- [ ] Measure:
  - Graph accuracy (vs. runtime execution)
  - Agent decision quality (fewer surprises)
  - Context token efficiency (DAG reduces unnecessary includes)
  
- [ ] Refine edge case handling
  - Iterate on false positives/negatives
  - Improve confidence scoring
  
- [ ] Performance optimization
  - Cache graph across iterations
  - Incremental re-analysis (only changed files)
  - Lazy graph evaluation (only analyze on-demand)

**Deliverable:** Polished, battle-tested extension ready for public release.

---

## SECTION 5: TECHNICAL DECISIONS

### 5.1 Architecture Choices

| Decision | Options | Recommendation | Rationale |
|----------|---------|-----------------|-----------|
| **DAG Engine Location** | In-process (TypeScript) vs. Subprocess (Python) | Subprocess (Python) | Python's AST tooling is mature; subprocess keeps extension responsive |
| **Graph DB** | NetworkX (in-memory) vs. Neo4j (persistent) | NetworkX (with JSON export) | Simpler, faster for typical codebase size; can evolve to Neo4j if needed |
| **LLM Provider** | Anthropic API vs. OAuth to Claude Code | Anthropic API (start); OAuth future | More control, clearer billing; OAuth adds complexity but enables subscription users |
| **Loop Exit Strategy** | Time limit vs. Token budget vs. User signal | Token budget + user signal | Prevents runaway costs; respects user intent |
| **Webview Framework** | React vs. Vue vs. Svelte | React (matches Cline) | Consistency; Cline already uses React |
| **Graph Visualization** | D3.js vs. Vis.js vs. Cytoscape.js | D3.js + custom (or Vis.js if time-bound) | D3 is most flexible; Vis.js is simpler if you're rushed |

### 5.2 Security & Privacy Considerations

**Code never leaves the user's machine:**
- Extension runs locally (like Cline)
- DAG analysis is local
- Only API calls to Claude use network
- User's API key is local only

**But consider:**
1. **API key management:** Follow VS Code best practices (store in SecureStorage, never log)
2. **Workspace trust:** Respect VS Code's workspace trust model
3. **Subprocess isolation:** Python subprocess should run in workspace root only
4. **Git operations:** Verify git commands (sanitize user input)

---

## SECTION 6: RESOURCE ESTIMATES

### Development Team
- **1 Senior Backend Engineer** (DAG analysis, Python microservice) → 16 weeks @ 50% time
- **1 Full-stack Engineer** (VS Code extension, webview) → 16 weeks @ 50% time
- **1 QA/Test Engineer** → 12 weeks @ 30% time

### Skills Required
- **TypeScript** (VS Code extension)
- **Python** (DAG analysis, AST)
- **React** (webview UI)
- **Graph algorithms** (NetworkX, reachability)
- **D3.js or similar** (visualization)
- **Git scripting** (commit tracking)
- **Anthropic API** (token management, Claude integration)

### External Dependencies
- Cline (open source, MIT)
- NetworkX (open source, BSD)
- @babel/parser (open source, MIT)
- TypeScript compiler API (open source, Apache 2.0)
- D3.js (open source, ISC)
- python-ast (built-in to Python)

### Timeline
- **Weeks 1-3:** Foundation (Ralph loop, basic UI)
- **Weeks 4-7:** DAG analysis engine (core novel work)
- **Weeks 8-10:** Webview + visualization
- **Weeks 11-13:** Agent integration (smart prompts)
- **Weeks 14-16:** Testing + refinement
- **Buffer:** 2-3 weeks for unforeseen complexity

**Total: ~18 weeks (4.5 months) for a polished, production-ready 1.0**

---

## SECTION 7: RISKS & MITIGATIONS

| Risk | Severity | Mitigation |
|------|----------|-----------|
| DAG accuracy for dynamic code | HIGH | Invest in confidence scoring; extensive testing on reference codebases; clear UI labelling of uncertainty |
| Context explosion in agent prompts | MEDIUM | Implement smart context selection (only include relevant files); monitor token usage; set hard limits |
| Performance (large codebases) | MEDIUM | Incremental graph analysis; lazy evaluation; caching; potentially move to Neo4j if graph > 10k nodes |
| User approval bottleneck | MEDIUM | Default to auto-apply for low-risk changes (confidence > threshold); require approval for high-impact |
| Circular dependencies breaking graph | LOW | Graph algorithms handle cycles fine; cycle detection can flag architectural issues |
| Python microservice crashes | MEDIUM | Implement health checks; graceful fallback to basic Cline (no DAG); restart on failure |
| API key leakage | MEDIUM-HIGH | Follow VS Code SecureStorage API; never log keys; sanitize prompts (don't echo user code if sensitive) |
| Ralph loop infinite loops | MEDIUM | Token budget cap; iteration limit; require user signal if stuck |

---

## SECTION 8: FEATURE HIGHLIGHTS (USER-FACING)

### 8.1 The "Bead Review" Experience

User defines a task. Cline+ executes in discrete steps ("beads"):

```
┌─────────────────────────────────────────┐
│ Task: "Add user authentication"         │
│ Success Criteria: Tests pass + DONE tag │
└─────────────────────────────────────────┘

[BEAD 1] Create User model
  Files changed: models.py (25 lines)
  Functions added: User.hash_password, User.verify_password
  Impact: This will be used by 3 other files (LoginView, API, middleware)
  Tests suggested: test_auth.py, test_models.py
  Diff: [user can review]
  Status: ✓ Tests pass
  Commit: b7d3c42 - Bead 1: User model + password hashing

[BEAD 2] Add login endpoint
  Files changed: views.py (40 lines), routes.py (5 lines)
  Functions added: LoginView.post
  Impact: Calls User.verify_password (from Bead 1)
              Returns JSON (used by frontend)
  Tests suggested: test_views.py
  Diff: [user can review]
  Status: ✗ Tests failing
  Error: "KeyError: 'password'" in test
  
  [Agent re-attempts with error context]
  
  Status: ✓ Tests pass
  Commit: c9e4f51 - Bead 2: Login endpoint

[BEAD 3] Add JWT token generation
  Files changed: auth.py (30 lines), views.py (10 lines)
  ...

[COMPLETE] All tasks done
Summary:
  • 5 beads total
  • 3 failed iterations (caught by tests)
  • 120 lines added
  • 2 new files created
  • All suggested tests pass
  
  Diff summary: [user can browse all changes]
  DAG evolution: [show how dependencies changed]
```

### 8.2 The DAG Visualization

Sidebar panel shows:
- **Interactive graph** of file/function dependencies
- **Highlight current task:** Show files being modified
- **Show impact:** Flash all affected nodes when user changes code
- **Confidence levels:** Color edges by certainty (green=high, yellow=medium, red=uncertain)
- **Quick search:** Jump to file/function in graph
- **Change history:** Show how DAG evolved across beads

### 8.3 The Approval Workflow

Before each bead is committed:
1. Show diff
2. Show impact (from DAG)
3. Highlight risky changes (high-impact modifications)
4. Allow user to:
   - **Approve & commit** → proceed to next bead
   - **Request changes** → agent re-attempts with feedback
   - **Skip this bead** → mark as manual, move to next
   - **Inspect DAG** → drill into dependencies

---

## SECTION 9: COMPETITIVE LANDSCAPE

### 9.1 How This Differs from Existing Tools

**vs. Cursor + Claude Code:**
- Claude Code: Great for single files; doesn't understand project-wide impact
- Cline+: Understands dependencies; can make cross-file changes confidently

**vs. GitHub Copilot:**
- Copilot: Line-level completions; no project context
- Cline+: Full-project agent; understands ripple effects

**vs. Roo Code:**
- Roo Code: Good agentic loop; no explicit dependency analysis
- Cline+: Adds DAG awareness + Ralph loop structure

**vs. Manual code review tools (Gerrit, etc.):**
- Traditional review: Post-hoc; after code is written
- Cline+: Proactive; agent avoids bad designs because it sees dependencies

---

## SECTION 10: GLOSSARY & REFERENCES

**Ralph Wiggum:** Pattern where an AI agent loops until success criteria are met [web:51, web:60, web:54]

**DAG (Directed Acyclic Graph):** Graph representation of dependencies; vertices = files/functions, edges = dependencies. "Acyclic" typically desired but not required in practice.

**AST (Abstract Syntax Tree):** Tree representation of code structure; basis for static analysis.

**MCP (Model Context Protocol):** Standard for LLM agents to call external tools; used by Cline [web:19].

**Bead:** One discrete chunk of work in a Ralph loop; represents one commit.

**Confidence Score:** Metric (high/medium/low/unsafe) indicating how certain the dependency analysis is about an edge.

**Impact Analysis:** Reverse reachability query; "if I change X, what depends on X?"

**Token Budget:** Limit on total tokens (input + output) for an agent session; prevents cost explosion.

---

## SECTION 11: REFERENCES

[web:16] Tembo.io - "5 Best Cline Alternatives in 2025" - Overview of Cline architecture  
[web:17] YouTube - "How to Optimize Token Usage in Claude Code"  
[web:18] Tom Sawyer - "Dependency Graph Visualization" - Tools and patterns  
[web:19] Orate AI - "Harnessing the Power of Cline and MCP in VS Code"  
[web:21] PuppyGraph - "Software Dependency Graphs"  
[web:23] Anthropic - "Token Counting" - API documentation  
[web:24] PyPI - "it-depends" - Python/JS dependency analyzer  
[web:26] StackOverflow - Token counting best practices  
[web:27] Plotly - "Network Graphs in Python"  
[web:28] Latent Space - "Cline: The Open Source Code Agent"  
[web:30] Python - "Building a Dependency Graph of Our Python Codebase" - Tangle Tools case study  
[web:51] beuke.org - "Ralph Wiggum Loop" - Definitive overview  
[web:52] Rotem Tam - "Analyzing Python Code with Python" - AST fundamentals  
[web:53] Vogella - "Multiple Webviews in a Single VS Code Extension" - Architecture patterns  
[web:54] ISHIR - "Ralph Wiggum AI Coding Loops"  
[web:60] Ralph Wiggum AI - Official pattern documentation  

---

## FINAL RECOMMENDATION

**Go forward with this project.** Here's why:

1. **Well-grounded:** Each component (Cline, Ralph, DAG) is proven technology
2. **Novel combination:** The integration of DAG-aware agents is genuinely novel and valuable
3. **Solves a real problem:** Hidden errors from ignoring dependencies is a genuine pain point
4. **Technically feasible:** No moonshot physics; all pieces are built with current tools
5. **Clear roadmap:** 18-week timeline is realistic for a polished 1.0
6. **Growing market:** AI coding agents are hot; users will adopt this quickly

**Key success factors:**
- Get DAG accuracy right (extensive testing, confidence scoring)
- Keep the UI clean (don't overwhelm with graph visualization)
- Test thoroughly on real codebases (not toy projects)
- Build community early (open source encourages adoption)

**Next steps:**
1. Validate the DAG analysis approach on your target languages (Python, JS, TS)
2. Prototype the Ralph loop as a standalone script
3. Fork Cline and begin Phase 1 integration
4. Share early prototypes with AI engineer community

---

**Document prepared:** 28 January 2026  
**Confidence level:** HIGH (based on current tooling & patterns)  
**Recommendation:** PROCEED TO IMPLEMENTATION

---

## APPENDIX A: Sample DAG JSON Output

```json
{
  "version": "1.0",
  "project_root": "/path/to/project",
  "analysis_timestamp": "2026-01-28T14:30:00Z",
  "summary": {
    "files": 47,
    "functions": 312,
    "edges": 1203,
    "high_confidence_edges": 980,
    "medium_confidence_edges": 180,
    "low_confidence_edges": 40,
    "unsafe_edges": 3
  },
  "nodes": [
    {
      "id": "models.py:User",
      "type": "class",
      "file": "models.py",
      "line": 15,
      "confidence": "high"
    },
    {
      "id": "models.py:User.verify_password",
      "type": "function",
      "file": "models.py",
      "line": 28,
      "confidence": "high",
      "parameters": ["self", "password"],
      "return_type": "bool"
    }
  ],
  "edges": [
    {
      "from": "views.py:LoginView.post",
      "to": "models.py:User.verify_password",
      "type": "call",
      "confidence": "high",
      "line": 42,
      "label": "line 42: user.verify_password(pwd)"
    },
    {
      "from": "views.py",
      "to": "models.py",
      "type": "import",
      "confidence": "high",
      "line": 3,
      "label": "from models import User"
    }
  ],
  "warnings": [
    {
      "type": "dynamic_call",
      "file": "utils.py",
      "line": 87,
      "description": "Dynamic call via getattr; may call any method",
      "severity": "medium"
    }
  ]
}
```

---

**END OF REPORT**
