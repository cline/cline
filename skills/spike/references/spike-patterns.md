# Spike Patterns

## Purpose

Use this reference to classify spikes and keep their order coherent.

## Common Spike Types

### 1. Boundary Spike

Use when the question is about:
- call paths
- trust boundaries
- local-vs-remote ownership
- public-vs-protected artifact scope

Typical output:
- invocation boundary note
- ownership matrix
- structured request/result contract

### 2. Runtime Spike

Use when the question is about:
- CLI or service harness behavior
- inheritance, workspace visibility, or tool exposure
- process isolation
- memory and transcript risk

Typical output:
- harness validation note
- runtime control requirements
- fail-closed rules

### 3. Protected Data-Handling Spike

Use when the question is about:
- data classification
- local vs remote exposure
- decryption location
- output shaping

Typical output:
- classification matrix
- response contract
- local memory / eviction rules

### 4. Compatibility Spike

Use when the question is about:
- model/API contract
- external service readiness
- vector dimension or chunking assumptions
- cross-platform feasibility

Typical output:
- compatibility note
- live validation evidence
- pinned baseline decision

### 5. Data-Pipeline Spike

Use when the question is about:
- ingestion pipeline fit
- chunking strategy
- vector store fit
- framework adoption boundary

Typical output:
- framework-fit note
- chunking and storage decision
- bounded adoption or deferral decision

### 6. Control-Plane Spike

Use when the question is about:
- installation
- update flow
- packaging
- version markers
- improvement-request contracts

Typical output:
- control-plane contract
- package/update semantics
- installer and version-marker decision

### 7. End-to-End Spike

Use only after earlier spikes are stable.

Typical output:
- end-to-end sequence narrative
- trust-boundary matrix
- final blocker list
- readiness recommendation

## Default Ordering Rule

Prefer this order unless there is strong evidence to change it:

1. boundary
2. runtime
3. protected data handling
4. compatibility
5. data pipeline
6. control plane
7. end-to-end
8. readiness decision

Why:
- later spikes depend on the earlier boundary decisions being explicit
- end-to-end validation is only meaningful after the component contracts are stable

## Split Rule

Split a spike when:
- it would require multiple unrelated validation modes
- it mixes tooling choice with boundary definition
- it cannot finish with one clear completion gate

## Closure Rule

A spike is closed only when:
- the decision is documented
- the next step is explicit
- remaining risks are named

It is acceptable for the closure decision to be `defer`, `reject`, or `rerun later`.
