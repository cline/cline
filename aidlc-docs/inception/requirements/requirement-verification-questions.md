# 요구사항 확인 질문서

아래 각 질문의 `[Answer]:` 항목에 선택한 답변의 문자를 적어주세요.  
보기 중 맞는 답이 없으면 `X`를 선택하고 `[Answer]:` 뒤에 직접 설명을 적어주세요.

## 질문 1
이번 AIDLC 단계의 1차 산출물은 무엇이어야 하나요?

질문 의도:
- 이번 단계가 "문서화 중심"인지, 아니면 "다음 구현 단계로 바로 이어질 설계안"까지 포함해야 하는지 확정하기 위함입니다.
- 이후 Requirements, Workflow Planning, Application Design의 깊이를 결정합니다.

추천 답변: C **recommand**
근거:
- 현재 요청은 단순 아이디어 정리가 아니라 `Claude Code -> Kiro CLI -> GitHub CLI -> custom LangGraph`까지 이어지는 단계형 확장 전략입니다.
- 따라서 아키텍처 문서만으로는 부족하고, 다음 코딩 단계로 바로 연결될 수 있는 구체적 스캐폴딩 경계까지 정의하는 편이 적절합니다.

A) 코드 변경 없이 아키텍처 및 구현 계획만 작성
B) 아키텍처 및 구현 계획 + 목표 파일/모듈 설계안 포함
C) 아키텍처 및 구현 계획 + 다음 코딩 단계에 바로 연결 가능한 부분 스캐폴딩 경계안 포함
X) 기타 (아래 [Answer]: 뒤에 직접 설명)

[Answer]: C

## 질문 2
MVP 1단계에서 Claude Code 연동에 대해 기대하는 기술적 결과는 무엇인가요?

질문 의도:
- 1단계를 "구조 리팩터링 계획"으로 볼지, "구현 경계가 명시된 실전 설계"로 볼지 고정하기 위함입니다.
- 이후 persistence boundary, shim layer wrapper, adapter contract의 상세화 수준을 결정합니다.

추천 답변: C **recommand**
근거:
- 이후 2, 3, 4단계 확장을 안전하게 수행하려면 1단계에서 목표 구조뿐 아니라 "어디까지를 MVP 구현 경계로 삼을지"가 명확해야 합니다.
- 그래야 테스트 전략과 마이그레이션 순서를 설계할 수 있습니다.

A) 현재 Claude Code 연동을 확장 가능한 구조로 바꾸기 위한 계획만 수립
B) Claude Code를 먼저 리팩터링하기 위한 목표 아키텍처와 정확한 마이그레이션 순서 정의
C) 목표 아키텍처와 함께 이후 코드 변경 시 반드시 지켜야 할 MVP 구현 경계 정의
X) 기타 (아래 [Answer]: 뒤에 직접 설명)

[Answer]: C

## 질문 3
MVP 3단계의 `github cli`는 정확히 무엇을 의미하나요?

질문 의도:
- `gh`인지, GitHub가 제공하는 다른 에이전트 런타임인지, 또는 GitHub Copilot CLI 성격인지 구분하기 위함입니다.
- 런타임 어댑터 설계와 테스트 방식이 완전히 달라질 수 있습니다.

추천 답변: X **recommand**
근거:
- 현재 코드베이스만으로는 `github cli`가 어떤 런타임을 의미하는지 단정할 수 없습니다.
- 이 부분을 잘못 고정하면 이후 아키텍처가 잘못 설계될 가능성이 높습니다.

A) GitHub 워크플로우/명령 중심의 `gh` CLI
B) GitHub Copilot CLI 스타일의 런타임 연동
C) GitHub가 제공하는 다른 CLI 기반 에이전트 런타임
X) 기타 (아래 [Answer]: 뒤에 직접 설명)

[Answer]: A

## 질문 4
MVP 4단계의 `custom langgraph`는 어떤 방식으로 취급해야 하나요?

질문 의도:
- LangGraph를 외부 런타임으로 볼지, 내부 어댑터로 볼지, 또는 참조 아키텍처 수준으로만 정의할지 결정하기 위함입니다.
- 이 판단이 shim layer 경계와 persistence boundary 경계를 직접 좌우합니다.

추천 답변: C **recommand**
근거:
- 현재는 LangGraph 실행 모델이 확정되지 않았습니다.
- 섣불리 in-process 또는 out-of-process로 고정하면 앞선 1~3단계 구조를 불필요하게 제약할 수 있습니다.

A) 동일 런타임 계약을 따르는 로컬 in-process 어댑터로 취급
B) 외부 에이전트 CLI처럼 CLI에서 기동하는 out-of-process 런타임으로 취급
C) 실행 모델을 아직 고정하지 않고 참조 아키텍처 수준으로 정의
X) 기타 (아래 [Answer]: 뒤에 직접 설명)

[Answer]: B

## 질문 5
이번 계획에서 명시적으로 표준화할 확장 메커니즘은 무엇인가요?

질문 의도:
- persistence boundary pattern과 shim layer wrapper pattern 중 어느 수준까지 공식 구조로 채택할지 확인하기 위함입니다.
- 추후 adapter contract, translation boundary, storage ownership 설계를 결정합니다.

추천 답변: C **recommand**
근거:
- 요청에서 이미 두 패턴을 모두 언급했고, 실제 확장 가능한 구조를 만들려면 둘 다 필요합니다.
- persistence boundary만으로는 런타임 호출 차이를 흡수하기 어렵고, shim wrapper만으로는 상태/이력/자격증명 경계가 불명확해집니다.

A) persistence boundary pattern만 표준화
B) shim layer wrapper pattern만 표준화
C) persistence boundary + shim layer wrapper + adapter contract + translation boundary까지 함께 표준화
X) 기타 (아래 [Answer]: 뒤에 직접 설명)

[Answer]: C

## 질문 6
새 런타임 아키텍처에서 가장 중요한 호환성 요구는 무엇인가요?

질문 의도:
- 기존 사용자 설정과 UX를 얼마나 보존해야 하는지 정하기 위함입니다.
- 마이그레이션 전략, 설정 키 변경 가능 여부, 테스트 기준에 직접 영향을 줍니다.

추천 답변: B **recommand**
근거:
- 구조 개선은 필요하지만, 사용자 입장에서 Claude Code 연동 경험이 깨지면 리팩터링 가치가 떨어집니다.
- 다만 내부 구조는 충분히 재편해야 하므로, 외부 UX 안정성과 내부 리팩터링 허용을 동시에 만족하는 B가 가장 현실적입니다.

A) 사용자 설정과 동작을 완전한 하위호환으로 유지
B) 외부 UX는 안정적으로 유지하되 내부 구조 변경은 허용
C) 향후 런타임 확장성을 위해 일부 설정 마이그레이션도 허용
X) 기타 (아래 [Answer]: 뒤에 직접 설명)

[Answer]: B

## 질문 7
MVP 2~4단계 롤아웃 계획은 어느 정도 상세해야 하나요?

질문 의도:
- 로드맵 수준 문서인지, 실제 구현에 바로 착수 가능한 수준의 설계 문서인지 확정하기 위함입니다.
- Workflow Planning과 이후 Units Generation 필요 여부를 판단하는 기준이 됩니다.

추천 답변: C **recommand**
근거:
- 요청은 단순 아이디어 나열이 아니라 "구현계획과 테스트 계획 수립"입니다.
- 따라서 단계별 아키텍처, 테스트 매트릭스, 수용 기준, 롤아웃 순서까지 포함해야 실무적으로 유효합니다.

A) 단계별 상위 로드맵만 작성
B) 단계별 아키텍처, 모듈 책임, 인터페이스, 마이그레이션, 리스크까지 작성
C) 단계별 아키텍처 + 테스트 매트릭스 + acceptance criteria + 롤아웃 시퀀스까지 작성
X) 기타 (아래 [Answer]: 뒤에 직접 설명)

[Answer]: C

## 질문 8
어떤 테스트 전략을 포함해야 하나요?

질문 의도:
- 새 구조가 단순 설계가 아니라 실제 확장 가능한 기반이 되려면 어떤 수준의 검증이 필요한지 확정하기 위함입니다.
- 특히 stream parser, runtime adapter, contract boundary에 대한 검증 범위를 정합니다.

추천 답변: C **recommand**
근거:
- 외부 CLI 런타임 통합은 단위 테스트만으로는 부족합니다.
- 계약 테스트, golden stream parser 테스트, E2E smoke 테스트까지 있어야 Claude Code 회귀와 Kiro 확장 가능성을 모두 검증할 수 있습니다.

A) 단위 테스트와 통합 테스트만 포함
B) 단위 + 통합 + 계약 테스트 + golden stream parser 테스트 포함
C) 단위 + 통합 + 계약 + golden stream parser + end-to-end runtime smoke 테스트 포함
X) 기타 (아래 [Answer]: 뒤에 직접 설명)

[Answer]: C
추가 메모: 단위 테스트 케이스는 TDD 방법론에 따라 설계 시점에 함께 설계하고, skeleton code 단계에서 테스트 케이스 적용까지 진행합니다.

## 질문 9
런타임 capability 검증의 source of truth는 무엇이어야 하나요?

질문 의도:
- Kiro CLI, GitHub CLI, custom LangGraph가 실제로 요구 계약을 만족하는지 어떤 기준으로 판단할지 정하기 위함입니다.
- 문서 기반 가정만 둘지, capability matrix와 spike checklist까지 둘지 결정합니다.

추천 답변: C **recommand**
근거:
- 향후 2~4단계는 모두 외부 불확실성이 큽니다.
- capability matrix만으로는 부족하고, 각 런타임별 검증 체크리스트까지 있어야 실제 착수 전에 리스크를 줄일 수 있습니다.

A) 문서화된 가정만 source of truth로 사용
B) 현재 코드 기준 capability matrix와 명시적 unknown만 정리
C) capability matrix + 각 future runtime별 spike/verification checklist까지 포함
X) 기타 (아래 [Answer]: 뒤에 직접 설명)

[Answer]: C

## 질문 10
이 프로젝트에 Security 확장 규칙을 적용해야 하나요?

질문 의도:
- Requirements 이후 단계에서 보안 규칙을 강제할지 결정하기 위함입니다.
- 특히 외부 CLI 런타임, 자격증명, 로컬 실행, persistence boundary 관련 설계에 영향을 줍니다.

추천 답변: A **recommand**
근거:
- 외부 CLI 런타임을 여러 개 연결하는 구조는 인증정보, 실행경계, 로컬 프로세스 호출, 결과 파싱 등 보안 고려가 필수입니다.
- 따라서 production-grade 관점으로 설계를 하려면 보안 규칙을 켜는 편이 적절합니다.

A) Yes — 모든 SECURITY 규칙을 blocking constraint로 적용
B) No — SECURITY 규칙을 적용하지 않음
X) 기타 (아래 [Answer]: 뒤에 직접 설명)

[Answer]: A
