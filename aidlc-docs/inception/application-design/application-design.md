# Application Design

## Summary
This design establishes a target runtime architecture that separates:
- control-plane orchestration
- runtime adapter identity and capabilities
- shim-based runtime execution
- persistence ownership
- stream translation
- validation and test harness support

The design uses Claude Code as the first reference runtime and creates extension slots for:
- Kiro CLI
- gh
- custom LangGraph

## Design Decisions
- The architecture remains compatible with current UX expectations while allowing internal refactoring.
- Runtime integration should not be implemented as ad-hoc provider wiring scattered across the stack.
- Process invocation and output translation must be isolated behind shim and translator boundaries.
- Persistent settings and credentials must be mediated through a dedicated persistence boundary.
- Future runtime onboarding must be testable from skeleton stage using TDD-first artifacts.

## Artifact Index
- `components.md`
- `component-methods.md`
- `services.md`
- `component-dependency.md`

## MVP Mapping
- **MVP 1**: Implement the target contract around Claude Code as the reference runtime.
- **MVP 2**: Introduce Kiro CLI as the second runtime adapter and validate capability fit.
- **MVP 3**: Introduce gh-oriented runtime integration with explicit capability divergence notes.
- **MVP 4**: Introduce out-of-process LangGraph runtime integration using the same orchestration contract.

## Security Alignment
- Credentials and runtime execution metadata cross only through the persistence boundary.
- Path, runtime identity, and capability declarations must be validated before invocation.
- Shim wrappers must normalize failures and avoid leaking sensitive stdout/stderr content.

## Completeness Check
- Components defined: Yes
- Component methods defined: Yes
- Services defined: Yes
- Dependencies and communication patterns defined: Yes
- Consistent with requirements and workflow plan: Yes
