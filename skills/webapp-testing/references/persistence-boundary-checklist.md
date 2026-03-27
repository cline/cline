# Persistence Boundary Checklist

Use this reference when a screen or flow depends on a mock dataset today but is expected to move behind a real API or repository later.

## Readiness Questions

- Does the screen document its current adapter mode (`demo/mock`, `api-backed mock`, `live`)?
- Is there a named seam or boundary where the adapter can be swapped?
- Is the source-of-truth shape for the screen documented?
- Does the demo dataset or fixture set cover the declared screen states?
- Are selectors and UI state names expected to remain stable when the adapter changes?

## Testing Expectations

- Unit and integration tests should verify the same user-visible state vocabulary across adapter modes.
- Test cases should prefer stable selectors and visible state labels over storage-specific implementation details.
- Mock fixtures should be curated for wireframe intent, not copied blindly from production data.
- If the project cannot provide a live adapter yet, document the planned seam and treat parity checks as readiness gates instead of failing implementation tests.

## Typical Evidence

- readiness document entries for adapter mode and seed dataset coverage
- API contract or DTO note referenced by the screen spec
- tests that still pass after swapping mock-backed and API-backed data sources
