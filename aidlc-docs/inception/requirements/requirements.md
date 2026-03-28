# Requirements

## Intent Analysis Summary
- **User Request**: `claude code`를 현재 `cli`에 연결하고 있는 구조를 `persistence boundary pattern`과 `shim layer wrapper pattern`으로 재구성하여 확장 가능한 구조로 만들고, MVP 2단계 `kiro cli`, 3단계 `github cli`, 4단계 `custom langgraph` 확장이 가능하도록 구현 계획과 테스트 계획을 수립한다.
- **Request Type**: Enhancement + Refactoring + Architecture Planning
- **Scope Estimate**: System-wide
- **Complexity Estimate**: Complex
- **Requirements Depth**: Comprehensive

## User Decisions Captured
- **Primary deliverable**: 아키텍처 및 구현 계획 + 다음 코딩 단계에 바로 연결 가능한 부분 스캐폴딩 경계안 포함
- **MVP 1 outcome**: 목표 아키텍처와 함께 이후 코드 변경 시 반드시 지켜야 할 MVP 구현 경계 정의
- **MVP 3 `github cli` meaning**: GitHub 워크플로우 및 명령 중심의 `gh` CLI
- **MVP 4 `custom langgraph` meaning**: CLI에서 기동하는 out-of-process 런타임으로 취급
- **Standardized extensibility mechanisms**: persistence boundary + shim layer wrapper + adapter contract + translation boundary
- **Compatibility priority**: 외부 UX는 안정적으로 유지하되 내부 구조 변경은 허용
- **Rollout detail level**: 단계별 아키텍처 + 테스트 매트릭스 + acceptance criteria + rollout sequencing
- **Test strategy**: 단위 + 통합 + 계약 + golden stream parser + end-to-end runtime smoke 테스트 포함
- **Additional testing note**: 단위 테스트 케이스는 TDD 방법론으로 설계 시점에 함께 정의하고, skeleton code 단계까지 테스트 케이스 적용 범위를 포함
- **Capability validation source of truth**: capability matrix + future runtime별 spike/verification checklist
- **Security extension**: Enabled

## Problem Statement
현재 구조는 외부 CLI 기반 런타임을 확장 가능한 `runtime adapter` 체계로 추상화하지 않고, provider 중심으로 각 계층에 직접 배선하는 방식에 가깝다. 이 구조는 `claude-code`에는 동작하지만, `kiro cli`, `gh`, `custom langgraph` 같은 후속 런타임 확장을 반복적으로 수행할 때 구현비용과 회귀위험이 커진다.

## Goals
- `claude-code` 연동을 기준 사례로 삼아 확장 가능한 런타임 아키텍처를 정의한다.
- persistence boundary pattern을 통해 런타임 상태, 설정, 인증, 히스토리, 실행 결과의 소유 경계를 명확히 한다.
- shim layer wrapper pattern을 통해 외부 런타임별 호출 차이와 출력 포맷 차이를 격리한다.
- MVP 2 `kiro cli`, MVP 3 `gh`, MVP 4 `custom langgraph` 확장에 공통으로 적용 가능한 adapter contract를 정의한다.
- 다음 구현 단계에서 바로 코드화 가능한 수준의 모듈 분해, 인터페이스 경계, 마이그레이션 순서를 제공한다.
- 테스트 전략을 설계 시점부터 포함하여 TDD 기반 skeleton 단계까지 이어지도록 한다.

## Non-Goals
- 이번 단계에서 실제 코드 변경을 수행하지 않는다.
- 이번 단계에서 Kiro, GitHub, LangGraph의 실제 실행기 구현을 완료하지 않는다.
- MVP 3의 `gh`를 범용 에이전트 모델 런타임으로 확정하지 않는다. 이 단계에서는 GitHub 워크플로우/명령 중심 runtime integration으로 취급한다.

## Functional Requirements

### FR-01 Runtime Architecture Refactor Plan
문서는 현재 `claude-code` 통합 경로를 분석하고, 이를 기반으로 한 확장형 런타임 구조를 정의해야 한다.

세부 요구:
- 현재 `claude-code` 호출 경로와 설정 경로를 식별해야 한다.
- 목표 구조에서 runtime adapter layer, shim wrapper layer, persistence boundary를 분리해야 한다.
- 기존 `ApiProvider` 중심 구조와 새 runtime-oriented abstraction 사이의 관계를 설명해야 한다.

### FR-02 Persistence Boundary Definition
문서는 런타임 확장 시 지속성 관련 경계를 명시해야 한다.

세부 요구:
- 설정, 인증정보, task history, runtime capability cache, stream transcript, execution metadata의 소유권을 구분해야 한다.
- 어떤 데이터가 process-local인지, workspace-scoped인지, session-scoped인지 분류해야 한다.
- 외부 런타임이 boundary 밖에서 관리해야 하는 상태와 내부 control plane이 보유해야 하는 상태를 구분해야 한다.

### FR-03 Shim Layer Wrapper Definition
문서는 각 외부 런타임 앞단에 위치하는 shim layer wrapper의 책임을 정의해야 한다.

세부 요구:
- CLI path resolution
- command invocation
- environment shaping
- prompt and message marshalling
- output parsing
- tool event translation
- error normalization
- retry and timeout policy

### FR-04 Adapter Contract
문서는 후속 런타임 확장을 위한 공통 adapter contract를 정의해야 한다.

세부 요구:
- runtime identity
- capability declaration
- invocation contract
- stream translation contract
- auth/config contract
- health/probe contract
- test harness contract

### FR-05 MVP Stage Plan
문서는 아래 MVP 단계를 각각 정의해야 한다.

세부 요구:
- **MVP 1**: Claude Code를 새 구조의 첫 구현 대상으로 전환하는 설계
- **MVP 2**: `kiro cli` 확장 경로와 전제 capability 정의
- **MVP 3**: `gh` 기반 GitHub workflow/command runtime 확장 경로 정의
- **MVP 4**: out-of-process `custom langgraph` runtime 확장 경로 정의

각 단계는 반드시 포함해야 한다:
- architecture scope
- module ownership
- migration steps
- acceptance criteria
- rollout sequencing
- risks and unknowns

### FR-06 Test Planning
문서는 단계별 테스트 전략을 정의해야 한다.

세부 요구:
- unit tests
- integration tests
- contract tests
- golden stream parser tests
- end-to-end runtime smoke tests
- TDD 적용 지점과 skeleton code 단계에서의 테스트 적용 방식을 명시해야 한다.

### FR-07 Runtime Capability Validation
문서는 각 future runtime에 대해 capability matrix와 spike checklist를 정의해야 한다.

세부 요구:
- non-interactive execution
- prompt injection
- structured output
- tool observability
- auth handling
- retryability
- timeout control
- deterministic testability

## Non-Functional Requirements

### NFR-01 Backward UX Stability
- 기존 Claude Code 사용자 경험은 가능한 한 유지되어야 한다.
- 내부 구조 변경은 허용되지만 외부 설정 흐름과 UX는 급격히 변경되지 않아야 한다.

### NFR-02 Extensibility
- 새 구조는 최소 4개 런타임 시나리오를 수용할 수 있어야 한다: Claude Code, Kiro CLI, gh, custom LangGraph.
- 특정 런타임의 특수 로직은 shim 또는 adapter 내부로 국소화되어야 한다.

### NFR-03 Testability
- 핵심 경계는 모두 mockable 해야 한다.
- stream parser와 runtime invocation은 golden fixture로 회귀 검증 가능해야 한다.
- skeleton code 단계부터 테스트 케이스를 배치할 수 있는 설계여야 한다.

### NFR-04 Observability
- 런타임 invocation, parsing failure, adapter mismatch, capability probe 결과를 구조적으로 기록할 수 있어야 한다.
- future implementation에서는 correlation id, runtime id, session id 기준으로 추적 가능해야 한다.

### NFR-05 Security
- 외부 CLI 호출 시 인증정보는 source code에 하드코딩되지 않아야 한다.
- 런타임별 자격증명은 persistence boundary를 넘어 무분별하게 유출되지 않아야 한다.
- shim layer는 민감정보 마스킹, stderr/stdout 처리, 실행 경로 검증, timeout 및 retry 경계를 정의해야 한다.

### NFR-06 Maintainability
- provider-specific wiring 감소가 핵심 목표여야 한다.
- 후속 런타임 추가 시 수정 파일 수와 영향 범위를 줄일 수 있어야 한다.

## User Scenarios

### Scenario 1
아키텍트가 Claude Code 통합을 새 구조로 재편하기 위한 구현 계획을 검토한다.

### Scenario 2
개발자가 MVP 2에서 `kiro cli`를 추가할 때 어떤 adapter, shim, persistence 경계를 따라야 하는지 바로 이해한다.

### Scenario 3
개발자가 MVP 3에서 `gh` 기반 runtime을 추가할 때, 에이전트 모델 실행이 아닌 GitHub workflow/command orchestration 특성을 capability matrix로 검증한다.

### Scenario 4
개발자가 MVP 4에서 `custom langgraph`를 out-of-process runtime으로 붙일 때, 공통 contract를 재사용하면서 transport와 stream translation만 별도로 구현한다.

### Scenario 5
테스트 엔지니어가 각 runtime adapter에 대해 TDD 기반 skeleton 단계부터 unit, contract, smoke 테스트를 설계한다.

## Architecture Requirements

### AR-01 Target Layers
목표 구조는 최소 다음 레이어를 가져야 한다.
- Control plane orchestration layer
- Runtime registry or runtime resolution layer
- Shim wrapper layer
- Persistence boundary layer
- Stream translation layer
- Runtime capability validation layer

### AR-02 Claude Code as Reference Implementation
- Claude Code는 첫 reference runtime adapter로 정의되어야 한다.
- 현재 구현에서 추출 가능한 공통 책임과 Claude Code 전용 책임을 분리해야 한다.

### AR-03 Future Runtime Fit
- `kiro cli`, `gh`, `custom langgraph`는 동일 contract를 공유하되 capability matrix와 shim 구현은 다를 수 있음을 문서화해야 한다.

## Test Requirements

### TR-01 TDD-first design artifacts
- 설계 단계 산출물에는 테스트 대상 경계와 테스트 케이스 설계 원칙이 함께 포함되어야 한다.

### TR-02 Skeleton-stage test application
- skeleton code 단계에서 최소 다음 테스트 골격이 배치 가능해야 한다:
  - adapter contract tests
  - shim parser golden tests
  - persistence boundary ownership tests
  - runtime capability probe tests

### TR-03 Regression protection
- Claude Code는 기준 런타임이므로 회귀 테스트 우선순위가 가장 높아야 한다.

## Security Requirements
Security baseline is enabled. The following rules are applicable at requirements stage and must shape later designs.

### Applicable security constraints
- **SECURITY-03 Application-Level Logging**: 런타임 adapter와 shim은 구조화된 로깅과 민감정보 비노출 원칙을 따라야 한다.
- **SECURITY-05 Input Validation on All API Parameters**: 런타임 설정 입력, path, model, capability 선언은 검증되어야 한다.
- **SECURITY-08 Application-Level Access Control**: 런타임 실행/설정 변경/credential 사용 경계에 대한 권한 모델을 고려해야 한다.
- **SECURITY-09 Security Hardening and Misconfiguration Prevention**: 기본 경로, 기본 자격증명, debug leakage 방지 요구를 문서화해야 한다.
- **SECURITY-10 Software Supply Chain Security**: 외부 CLI runtime 의존성과 배포 경로는 신뢰 가능한 소스와 버전 관리 전략을 가져야 한다.
- **SECURITY-11 Secure Design Principles**: security-critical logic를 전용 boundary에 격리해야 한다.
- **SECURITY-12 Authentication and Credential Management**: 자격증명은 secrets manager 또는 적절한 보안 저장소/파일 경계에 위치해야 하며 하드코딩되면 안 된다.
- **SECURITY-13 Software and Data Integrity Verification**: 외부 런타임 바이너리 및 결과 파싱 경계에 대한 무결성 검증 고려가 필요하다.
- **SECURITY-14 Alerting and Monitoring**: future implementation 단계에서 runtime failures and auth failures에 대한 모니터링 포인트를 설계해야 한다.

### Not applicable at this phase
- **SECURITY-01**: 구체 데이터 저장소 설계 없음
- **SECURITY-02**: 네트워크 intermediary 설계 없음
- **SECURITY-04**: HTML endpoint 설계 없음
- **SECURITY-06**: 구체 IAM policy 설계 없음
- **SECURITY-07**: 구체 네트워크 구성 설계 없음

## Success Criteria
- 요구사항 문서가 MVP 1~4에 대해 명확한 구조 목표를 제시한다.
- future runtime 추가 시 필요한 공통 contract와 variant point가 드러난다.
- 테스트 계획이 구현 이전에 설계 가능한 수준으로 정리된다.
- security baseline이 later-stage design inputs로 반영된다.

## Out-of-Scope Risks and Unknowns
- `kiro cli`의 실제 structured output contract는 아직 검증되지 않았다.
- `gh`를 runtime으로 사용할 때 agent-like stream semantics를 제공할지 불명확하다.
- `custom langgraph`의 실제 transport와 lifecycle model은 아직 확정되지 않았다.
