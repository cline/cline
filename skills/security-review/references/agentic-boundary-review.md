# Agentic Boundary Security Review

## Purpose

Use this reference when the system under review includes:
- local and remote agent runtimes
- MCP control-plane actions
- shared contract schemas between units
- classification boundaries such as `Red / Amber / Green`
- prompt-driven interaction with protected data

This reference complements generic web security checks by focusing on trust boundaries that are common in agentic architectures.

## What To Review

### 1. Contract Boundaries

Check:
- Is there a canonical schema source of truth?
- Does every producer/consumer ingress validate against it?
- Is validation fail closed?
- Are required unknown fields rejected?
- Is exact-version enforcement or another explicit compatibility policy defined?

Common failure modes:
- stale producer still runs through tolerant parsing
- internal shim skips validation because the boundary is considered "trusted"
- optional debug fields become permanent data-leak paths

### 2. Classification Integrity

Check:
- Is payload sensitivity modeled explicitly?
- Can callers self-label protected content as public?
- Does `Green` output require sanitizer provenance?
- Can `Red` ever escape the remote boundary?
- Can `Amber` reach stdio, logs, temp files, or resumable state?

Common failure modes:
- `Amber` or `Red` relabeled as `Green`
- local wrapper writes `Amber` to transcripts or temp files
- response-shaping logic is implicit instead of enforced

### 3. Prompt Injection and Jailbreak Resistance

Check:
- Can a valid-looking prompt still coerce raw protected output?
- Are retrieved documents treated as untrusted input?
- Does the system separate schema validation from policy enforcement?
- Is there a final response-shaping gate before results leave the protected boundary?

Common failure modes:
- "Ignore previous instructions" prompts pass because they are schema-valid strings
- retrieved evidence rewrites system intent
- raw evidence is emitted as part of a seemingly harmless summary

### 4. Control Plane and Update Integrity

Check:
- Can stale installs continue to run when latest-version enforcement is intended?
- Are release artifacts verified by checksum or signature?
- Is the local version marker authoritative but bounded?
- Can update metadata be forged locally without remote verification?

Common failure modes:
- edited local version file tricks `check`
- unsigned artifacts are treated as installable
- stale runtime executes after a failed update check

### 5. Logging and Diagnostic Surfaces

Check:
- Are raw protected payloads omitted from logs?
- Are correlation IDs present without leaking payloads?
- Are errors generic to callers but detailed enough in protected logs?
- Are debug and crash paths reviewed for sensitive-data exposure?

Common failure modes:
- `Amber` appears in logs during validation failure
- `apply-request` attaches raw protected content
- hook stdout leaks secrets or protected excerpts

## Reusable Misuse Stories

Review specifically for these patterns:
- unknown operation enum or unsupported action used to probe hidden capability
- missing correlation fields to bypass traceability
- exact version mismatch used to force tolerant parsing
- `Green` forgery for protected payloads
- shim relabels `Amber` as `Green` without sanitizer provenance
- remote runtime returns `Red` outside the protected boundary
- raw `Amber` reaches Kiro CLI stdio
- jailbreak prompt requests raw policy or protected excerpt
- retrieved-document prompt injection tries to override system rules
- stale local install continues despite latest-version enforcement

## Recommended Test Output

When these risks are present, generate or request:
- contract-unit negative tests
- exact-version mismatch integration tests
- classification forgery adversarial tests
- log and stdio leakage checks
- release-manifest integrity checks

If the project already has a durable security test-case artifact, link it and map findings to it rather than restating the risks informally.
