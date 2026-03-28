# Reverse Engineering Plan

- [x] Discover the main packages, runtimes, and top-level responsibilities across the monorepo.
- [x] Identify the runtime path for `cline cli 2.0`, including ACP mode and standalone services.
- [x] Trace how sessions, controller instances, and per-session emitters are created and managed.
- [x] Trace how host bridge, ProtoBus, storage, and lock management support isolated agent execution.
- [x] Generate reverse engineering artifacts for business overview, architecture, code structure, APIs, inventory, stack, dependencies, and quality.
- [x] Update AI-DLC state tracking for reverse engineering completion.
- [x] Assess current Agent Runtime extensibility and the feasibility of adding a `kiro cli` runtime.
