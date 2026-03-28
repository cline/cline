# NFR Design Patterns

- `Shim Wrapper Pattern`
  - isolate process launch, stdio wiring, exit observation, and normalized failures
- `Translation Boundary Pattern`
  - isolate runtime-native stdout parsing from execution control
- `Fail-Closed Runtime Error Pattern`
  - expose non-zero exit, spawn failure, and process error through one shared contract
- `Golden Translator Fixture Pattern`
  - keep translator behavior testable with fixed stream fragments
- `Reference Runtime Migration Pattern`
  - use Claude Code as the first consumer of the new generic wrapper
