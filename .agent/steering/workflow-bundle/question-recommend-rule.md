---
inclusion: always
---

# Layer2 보충 규칙: 질문 생성 시 Recommend 표시

> 이 규칙은 Layer1 `common/question-format-guide.md`를 보충합니다. Layer1 규칙과 충돌 시 Layer1이 우선합니다.

## 적용 범위

AIDLC 워크플로우의 모든 단계에서 사용자에게 선택지(A/B/C/D/E)를 제시하는 질문을 생성할 때 적용한다.

## 규칙

### 1. Recommend 표시 의무
선택지를 포함하는 질문을 생성할 때, AI는 분석 결과를 바탕으로 가장 적합한 선택지 하나에 `**(Recommend)**` 표시를 추가해야 한다.

### 2. 표시 형식
```markdown
- B) 선택지 설명 **(Recommend)** — 추천 근거 한 줄
```

- `**(Recommend)**`는 선택지 설명 바로 뒤에 위치
- `—` (em dash) 뒤에 추천 근거를 한 줄로 작성
- 하나의 질문에 하나의 Recommend만 표시

### 3. 추천 가능 조건 (추천 O)
다음 중 하나 이상에 해당하면 AI가 추천할 수 있다:
- 기존 코드베이스 패턴과의 일관성을 분석할 수 있는 경우
- 아키텍처 설계 문서(application-design, requirements)와의 정합성을 판단할 수 있는 경우
- 기술적 trade-off를 객관적으로 비교할 수 있는 경우
- 업계 best practice가 명확한 경우
- 프로젝트 요구사항(FR/NFR)과의 부합도를 평가할 수 있는 경우

### 4. 추천 불가 조건 (추천 X)
다음에 해당하면 추천하지 않고 선택지만 제시한다:
- 비즈니스 도메인 지식이 필요한 판단 (사용자만 알 수 있는 비즈니스 규칙)
- 프로젝트 전략/우선순위에 관한 의사결정
- 조직 구조나 팀 역할에 관한 질문
- AI가 판단 근거를 제시할 수 없는 경우

추천 불가 시 다음과 같이 표시:
```markdown
> ℹ️ 이 질문은 비즈니스 도메인 판단이 필요하여 AI 추천을 제공하지 않습니다.
```

### 5. 추천 근거 유형
추천 근거는 다음 중 하나 이상을 명시해야 한다:
- 기존 코드 패턴과의 일관성
- 설계 문서와의 정합성
- 기술적 trade-off 분석 결과
- 업계 best practice
- 프로젝트 요구사항(FR/NFR)과의 부합도
- 향후 확장성/유지보수성 고려

### 6. 사용자 결정권 존중
- Recommend는 참고 사항이며, 최종 결정은 사용자에게 있다
- 사용자가 추천과 다른 선택을 해도 추가 확인을 요구하지 않는다
- 추천 근거에 "반드시", "꼭" 등 강제성 표현을 사용하지 않는다

## 예시

### 기술 선택 질문 (추천 O)
```markdown
### Q1: LangGraph checkpoint persistence

- A) 단일 request-response만 처리 (checkpoint 없이 graph.invoke())
- B) checkpoint 포함하여 multi-turn 지원 (MemorySaver 사용)
- C) 단일 invoke로 시작하되, checkpoint interface는 미리 준비 **(Recommend)** — human-in-the-loop 확장 요구사항(MK-015)을 고려하면 interface 준비가 향후 비용을 최소화함

[Answer]:
```

### 비즈니스 판단 질문 (추천 X)
```markdown
### Q3: 사용자 인증 방식

> ℹ️ 이 질문은 비즈니스 도메인 판단이 필요하여 AI 추천을 제공하지 않습니다.

- A) Username/Password
- B) SSO (Single Sign-On)
- C) OAuth 2.0
- D) Other (please describe after [Answer]: tag below)

[Answer]:
```
