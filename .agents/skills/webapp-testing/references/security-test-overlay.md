# Security Test Overlay Reference

## Purpose

`webapp-testing`는 기본적으로 screen state, interaction flow, persistence boundary를 검증한다. 프로젝트에 보안 misuse story나 `aidlc-docs/test/security/*.md` 자산이 존재하면, 같은 테스트 워크플로우 안에서 security overlay를 추가로 수행한다.

이 overlay의 목적은 보안 테스트를 별도 메모나 chat 설명으로 남기지 않고, 실행 가능한 테스트 또는 명시적 manual-review gate로 내리는 것이다.

## When To Enable

다음 중 하나라도 참이면 security overlay를 켠다.

- `aidlc-docs/test/security/` 아래에 테스트 케이스 문서가 있다
- app이 protected data, contract-boundary validation, auth-sensitive flow, release/update integrity를 다룬다
- `security-review` 또는 architecture review가 adversarial misuse story를 남겼다

## Read Order

Security overlay를 켰다면 아래 순서로 입력을 읽는다.

1. screen-design 산출물
2. `references/persistence-boundary-checklist.md`
3. `aidlc-docs/test/security/*.md`
4. 관련 functional-design / business-rules 문서
5. recent audit entries 중 테스트 가능한 misuse story

## Output Buckets

### 1. Vitest unit or contract

대상:
- enum/required field rejection
- exact-version mismatch rejection
- sanitizer provenance check
- classification relabel rejection
- response envelope validator

형태:
- deterministic pure function test
- contract validator test
- serializer / mapper negative test

### 2. Playwright integration

대상:
- blocked 또는 error가 UI에 드러나는 경로
- stale install / update-required flow
- auth-sensitive route rejection
- 사용자-visible fallback behavior

형태:
- page flow test
- cross-screen journey
- expected blocked state assertion

### 3. Adversarial integration

대상:
- forged `Green` payload carrying protected content
- `Amber -> Green` relabel attempt without sanitizer provenance
- jailbreak prompt requesting raw protected output
- retrieved-document prompt injection

형태:
- mock seam 또는 harness seam을 통한 malicious input injection
- blocked/fail-closed assertion
- sanitized-result-only assertion

### 4. Manual review

대상:
- raw payload가 log/stdout/temp file/resume state에 남는지
- release manifest checksum/signature integrity
- crash dump / transcript leakage
- automation하기엔 cost가 큰 운영 경계

형태:
- review checklist
- evidence capture note
- readiness gap or residual-risk statement

## Mapping Rules

- Security misuse case를 generic edge case로 분류하지 않는다.
- 자동화 가능한 케이스는 Vitest 또는 Playwright로 먼저 내린다.
- harness 또는 runtime seam이 아직 없으면 adversarial automation을 억지로 만들지 말고 manual-review 또는 readiness gap으로 남긴다.
- `Red/Amber/Green` 분류 체계가 있다면, test artifact 자체도 protected payload를 저장하지 않도록 설계한다.

## Artifact Hygiene

- protected excerpt를 fixture, snapshot, stdout, temp file에 그대로 저장하지 않는다
- 필요한 경우 placeholder, hashed token, synthetic sample로 대체한다
- 테스트 리포트는 correlation id, status, error code 중심으로 남긴다

## Example Categories For This Project

- unknown operation rejection
- missing correlation field rejection
- runtime-local exact version mismatch
- runtime-remote exact version mismatch
- forged `Green` request carrying protected raw excerpt
- shim relabels `Amber` as `Green`
- `Amber` reaches Kiro CLI stdio
- jailbreak prompt attempts raw protected output
- retrieved document prompt injection
- stale install under latest-version-enforced policy
- release artifact missing checksum or signature reference
