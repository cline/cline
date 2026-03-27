---
name: consistency
description: AIDLC 산출물 정합성 검토 및 유지. 설계 결정 변경 시 전체 산출물(설계 문서, 코드, 시각화, plan, flow)을 Ground Truth 기준으로 스캔하여 충돌을 식별하고 일괄 수정한다. 사용자가 정합성 검토를 요청하거나, 설계 결정이 변경되었을 때, 또는 hook에서 정합성 리마인더가 트리거될 때 활용한다.
---

# Consistency — AIDLC 산출물 정합성 검토 Skill

## Overview

AIDLC 워크플로우에서 설계 결정이 변경될 때 관련 산출물 전체의 정합성을 검토하고 유지하는 skill이다.

설계 결정 하나가 바뀌면 여러 산출물에 파급 효과가 발생한다. 이 skill은 그 파급 효과를 체계적으로 추적하여 산출물 간 모순을 방지한다.

## When To Use

- 사용자가 설계 결정을 변경하는 피드백을 제공했을 때
- AIDLC stage 전환 시 이전 stage 산출물과 현재 stage 산출물의 정합성 확인이 필요할 때
- `aidlc-consistency` hook에서 정합성 검토 리마인더가 트리거될 때
- 사용자가 명시적으로 "정합성 검토", "consistency check", "일관성 검토"를 요청할 때
- 여러 산출물을 일괄 수정한 후 누락된 수정이 없는지 확인할 때

## Core Workflow

### Phase 1: Ground Truth 식별

변경된 결정의 근거가 되는 기준 문서를 식별한다.

Ground Truth 후보:
- `aidlc-docs/inception/requirements/` — 요구사항 문서 (FR, NFR)
- `aidlc-docs/inception/application-design/` — 설계 문서
- `aidlc-docs/construction/*/functional-design/business-rules.md` — 비즈니스 규칙
- `aidlc-docs/construction/*/nfr-requirements/` — NFR 요구사항
- Spike decision artifacts — 기술 검증 결정
- `system-context.md` — 아키텍처 경계 및 원칙

Ground Truth는 "이미 확정된 결정"이다. 변경 요청이 Ground Truth 자체를 수정하는 경우, 먼저 Ground Truth를 업데이트한 후 정합성 검토를 수행한다.

### Phase 2: 전수 스캔

Ground Truth 기준으로 모든 관련 산출물을 스캔한다.

스캔 대상 카테고리:
1. **설계 문서**: application-design, functional-design, nfr-design, infrastructure-design
2. **코드**: 소스 코드 파일 (`.py`, `.ts`, `.toml`, `.json` 등)
3. **시각화**: `.excalidraw`, Mermaid diagram, ASCII art
4. **Plan 문서**: execution-plan, code-generation-plan, functional-design-plan
5. **Flow 문서**: interaction flow, sample flow, sequence diagram
6. **질문 파일**: 이전 질문 파일의 전제 조건이 변경되었는지

스캔 방법:
- `grepSearch`로 변경된 키워드/개념을 전체 산출물에서 검색
- 관련 파일을 읽어 Ground Truth와의 정합성 확인
- 코드와 문서 양쪽을 모두 검토

### Phase 3: 충돌 분류

발견된 충돌을 구조화된 테이블로 정리한다.

```markdown
| # | 충돌 | 심각도 | 관련 Unit | 해결 방향 |
|---|---|---|---|---|
| 1 | [충돌 설명] | High/Medium/Low | Unit N | [해결 방향] |
```

심각도 기준:
- **High**: Ground Truth와 직접 모순. 코드 동작이나 설계 구조에 영향.
- **Medium**: 간접 모순. 문서 설명이 오래되었지만 코드 동작에는 영향 없음.
- **Low**: 표현 불일치. 의미는 동일하지만 용어나 수치가 다름.

### Phase 4: 질문 파일 생성

해결 방향이 불명확한 충돌에 대해 AIDLC question format으로 질문 파일을 생성한다.

질문 파일 위치: `aidlc-docs/construction/plans/`
파일명 패턴: `{unit-name}-consistency-review-plan.md`

질문 규칙:
- 선택지에 `**(Recommend)**` 표시 포함 (Layer2 steering rule)
- Ground Truth 기준으로 추천 근거 명시
- 비즈니스 도메인 판단이 필요한 경우 추천하지 않음

### Phase 5: 일괄 수정

답변 기반으로 모든 충돌 산출물을 일괄 수정한다.

수정 원칙:
- 한 번의 pass에서 모든 관련 파일을 수정 (부분 수정 금지)
- 수정 후 plan 파일의 checkbox를 즉시 업데이트
- audit.md에 수정 내역을 append

### Phase 6: 검증

수정 후 Ground Truth와의 정합성을 재확인한다.

- `grepSearch`로 변경된 키워드가 올바르게 반영되었는지 확인
- 수정 누락이 없는지 전수 확인
- 정합 확인 결과를 충돌 테이블에 ✅ 표시

## AIDLC Rule 리마인더 통합

이 skill은 `aidlc-consistency` hook과 연동된다. Hook이 매 prompt마다 다음을 리마인드한다:

1. AIDLC 핵심 rule 준수 (질문은 md 파일, 승인은 명시적, audit append only 등)
2. 현재 진행 중인 작업에서 정합성 검토가 필요한지 자가 점검
3. 설계 결정 변경이 감지되면 이 skill의 Phase 1부터 실행

## Trigger Keywords

- 정합성, consistency, 일관성, 충돌, conflict, 모순
- Ground Truth, 기준 문서, 정합성 검토, 전수 스캔
- 산출물 수정, 일괄 수정, 파급 효과

## Integration

- **meta-knowledge**: 정합성 검토 과정에서 발견된 교훈은 meta-knowledge로 routing
- **code-reviewer**: 코드 수정 후 코드 품질 리뷰는 code-reviewer로 위임
- **security-review**: 보안 관련 정합성은 security-review와 협력

## Completion Gates

정합성 검토가 완료되려면:

- [ ] Ground Truth 기준 문서가 식별되었다
- [ ] 전수 스캔이 수행되었다 (설계 문서, 코드, 시각화, plan, flow)
- [ ] 충돌 목록이 구조화된 테이블로 정리되었다
- [ ] 해결 방향이 불명확한 충돌에 대해 질문 파일이 생성되었다
- [ ] 모든 질문에 대한 답변이 수집되었다
- [ ] 일괄 수정이 완료되었다 (부분 수정 없음)
- [ ] 수정 후 검증이 완료되었다
- [ ] plan checkbox가 업데이트되었다
- [ ] audit.md에 수정 내역이 기록되었다
