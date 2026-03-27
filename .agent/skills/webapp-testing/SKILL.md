---
name: webapp-testing
description: "Screen-design 산출물(screen-inventory.md, screen-story-matrix.md, interaction-flows) 기반으로 Vitest 단위테스트와 Playwright 통합테스트를 자동 생성하고 실행합니다. Reconnaissance, Coverage 리포트, Test Runner도 포함합니다."
---

# Webapp Testing

screen-design 산출물 기반 테스트 자동 생성 및 실행 skill.

## Test Strategy

```
┌─────────────────────────────────────────────────────────────────┐
│                    Test Strategy                                │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────┐   │
│  │ Vitest (Unit)│────▶│   Coverage   │────▶│ Playwright   │   │
│  │              │     │   Report     │     │(Integration) │   │
│  └──────────────┘     └──────────────┘     └──────────────┘   │
│                                                                 │
│  Sources:                                                       │
│  - screen-inventory.md  → Screen State Tests (76 states)       │
│  - interaction-flows/   → Flow Tests (happy + error + edge)    │
│  - screen-story-matrix  → Coverage Gap Tests (12 gaps)         │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

```bash
# 1. Reconnaissance: 서버가 실행 중일 때 전체 화면 정찰
python3 .agent/skills/webapp-testing/scripts/test_reconnaissance.py .

# 2. Generate: screen-design 산출물에서 테스트 자동 생성
python3 .agent/skills/webapp-testing/scripts/test_generator.py . --mode all

# 3. Run: Vitest 단위테스트 실행
cd nextjs && npm run test:run

# 4. Report: Coverage 리포트 생성
python3 .agent/skills/webapp-testing/scripts/coverage_reporter.py .
```

---

## Scripts (재사용 가능한 내부 자원)

| Script | Purpose | 재사용 |
|--------|---------|--------|
| `scripts/test_generator.py` | screen-design 산출물 → 테스트 자동 생성 | O |
| `scripts/coverage_reporter.py` | Coverage 리포트 생성 (aidlc-docs/test/webapp-testing/coverage/) | O |
| `scripts/test_reconnaissance.py` | 전체 화면 DOM 정찰 + 스크린샷 (aidlc-docs/test/webapp-testing/reconnaissance/) | O |
| `scripts/test_runner_base.py` | 구조화된 테스트 실행기 (결과 JSON + MD 리포트) | O |
| `scripts/with_server.py` | 서버 생명주기 관리 (자동 시작/종료) | O |
| `scripts/wireframe_buttons.py` | 테스트 버튼 추가/제거 (wireframe 단계용) | O |

### 일시 스크립트 생성 규칙

프로젝트 고유 테스트나 일회성 검증 스크립트를 생성할 때는 **반드시 `scripts/` 디렉토리 하위**에 생성합니다.

```
scripts/                        # 일시 스크립트 생성 위치
├── test_pages.py              # 프로젝트 고유 페이지 검증
├── test_theme.py              # 프로젝트 고유 테마 검증
├── test_fix.py                # 버그 수정 회귀 테스트
└── test_complete.py           # 전체 스모크 테스트
```

- 재사용 가능한 스크립트 → `.agent/skills/webapp-testing/scripts/`에 배치
- 프로젝트 고유/일시 스크립트 → `scripts/`에 배치 (정리 용이)
- 자동 생성 테스트 코드(tsx/ts) → `nextjs/__tests__/` 또는 `nextjs/tests/`

---

## Test Separation Setup

Before generating tests, verify test separation architecture:

### Verification Steps

1. **Check for `tests/` directory**:
   ```bash
   python3 .agent/skills/webapp-testing/scripts/validate_test_separation.py .
   ```

2. **If validation fails**:
   - Create `tests/` directory structure
   - Set up test-only auth API
   - Configure Next.js build exclusion
   - Move any test code from `app/` to `tests/`

3. **If validation passes**:
   - Proceed with test generation
   - Use test-only auth API for Playwright authentication

### Architecture Reference

See `references/test-separation-architecture.md` for complete architecture details.

### Security Principle

**Zero Contamination Rule**: Production code (`app/`) must NEVER contain:
- Demo login buttons
- Mock API endpoints
- TEST-ONLY tags or comments
- Environment-dependent test bypasses

All test infrastructure MUST live in `tests/` directory and be automatically excluded from production builds.

## Runtime Readiness Preflight

Before generation or execution, confirm the test inputs are ready:

- validation targets exist
- executable testcase/spec exists or is about to be generated
- selector contract exists
- fixture or mock-state strategy exists
- runtime constraints are recorded
- persistence boundary is documented when the UI depends on mock or adapter-swappable data

For persistence-aware screens, also confirm:

- current adapter mode is recorded (`demo/mock`, `api-backed mock`, `live`)
- mock adapter / live adapter or planned seam is identified
- demo dataset coverage is sufficient for declared screen states
- selector and testcase contracts are expected to survive adapter replacement

See `references/persistence-boundary-checklist.md`.

---

## Test Generation Modes

### 1. Screen State Tests (`--mode screen-states`)

```bash
python3 .agent/skills/webapp-testing/scripts/test_generator.py . --mode screen-states
```

**Source**: `aidlc-docs/discovery/screen-design/screen-inventory.md`

Parses Per-Screen State Coverage tables and generates:
- **Vitest**: `nextjs/__tests__/screens/scr-{id}.test.tsx` (11 files, ~76 tests)
- **Playwright**: `nextjs/tests/screens/scr-{id}.spec.ts` (11 files)

Test type by implementation status:
- `Yes` → `it('should render ...')` with assertion
- `No` → `it.todo('should render ...')` — skipped
- `Partial` → `it('should partially render ...')`
- `Implicit` → `it('should handle ...')`

### 2. Interaction Flow Tests (`--mode flows`)

```bash
python3 .agent/skills/webapp-testing/scripts/test_generator.py . --mode flows
```

**Source**: `aidlc-docs/discovery/screen-design/interaction-flows/*.md`

Parses Happy Path, Error Flow, Edge Case sections.

### 3. Coverage Gap Tests (`--mode coverage-gaps`)

```bash
python3 .agent/skills/webapp-testing/scripts/test_generator.py . --mode coverage-gaps
```

**Source**: `aidlc-docs/discovery/screen-design/screen-story-matrix.md`

### 4. All Tests (`--mode all`)

```bash
python3 .agent/skills/webapp-testing/scripts/test_generator.py . --mode all
```

---

## Persistence Boundary Validation

When a screen is backed by a persistence boundary, extend the validation scope beyond rendering:

- verify mock mode and live mode use the same user-visible state vocabulary when both exist
- verify approval, rework, and stage-continuity flows do not depend on storage implementation details
- verify selector contracts remain stable across adapter changes
- verify curated seed/demo data covers empty, loading, populated, and error states

If only a mock adapter exists today, treat live-adapter parity as a readiness item and record the planned seam instead of guessing.

## Reconnaissance

서버가 실행 중일 때 전체 화면을 자동 정찰합니다.

```bash
# 전체 화면 정찰
python3 .agent/skills/webapp-testing/scripts/test_reconnaissance.py .

# 특정 화면만 정찰
python3 .agent/skills/webapp-testing/scripts/test_reconnaissance.py . --screens SCR-AUTH-01,SCR-APP-01

# 다른 포트
python3 .agent/skills/webapp-testing/scripts/test_reconnaissance.py . --base-url http://localhost:5173
```

**산출물**:
- `aidlc-docs/test/webapp-testing/reconnaissance/summary.json` — 전체 정찰 결과
- `aidlc-docs/test/webapp-testing/reconnaissance/{screen-id}.json` — 화면별 상세 (buttons, links, inputs, headings)
- `aidlc-docs/test/webapp-testing/reconnaissance/screenshots/{screen-id}.png` — 화면별 스크린샷
- `aidlc-docs/test/webapp-testing/reconnaissance-report.md` — 마크다운 리포트

---

## Test Runner Base

구조화된 테스트 실행기. 프로젝트 고유 테스트 스크립트에서 import하여 사용합니다.

```python
from skills.webapp_testing.scripts.test_runner_base import TestRunner

runner = TestRunner(base_url="http://localhost:3000", project_root=".")
runner.start()

runner.section("Login Flow")
runner.log_test("Login page loads", "PASS")
runner.log_test("Demo login works", "PASS")

result = runner.finish()  # JSON + MD 리포트 자동 저장
```

**산출물**: `aidlc-docs/test/webapp-testing/results/test-results.json`, `test-results.md`

---

## Coverage Reporting

```bash
# 기본: aidlc-docs/test/webapp-testing/coverage/coverage-report.md 에 저장
python3 .agent/skills/webapp-testing/scripts/coverage_reporter.py .

# 지정 경로
python3 .agent/skills/webapp-testing/scripts/coverage_reporter.py . /tmp/coverage.md
```

**산출물**: `aidlc-docs/test/webapp-testing/coverage/coverage-report.md`

---

## 산출물 구조 (aidlc-docs/test/webapp-testing/)

```
aidlc-docs/test/
└── webapp-testing/                        # skill-scoped 디렉토리
    ├── generation-summary.md              # 테스트 생성 요약
    ├── reconnaissance-report.md           # 화면 정찰 리포트
    ├── reconnaissance/                    # 정찰 상세 데이터
    │   ├── summary.json
    │   ├── scr-auth-01.json ... scr-adm-04.json
    │   └── screenshots/
    │       ├── scr-auth-01.png ... scr-adm-04.png
    ├── coverage/                          # Coverage 리포트
    │   └── coverage-report.md
    └── results/                           # 테스트 실행 결과
        ├── test-results.json
        └── test-results.md
```

---

## Generated Test Structure (nextjs/)

```
nextjs/
├── __tests__/                          # Vitest unit tests
│   ├── components/                     # Manual component tests
│   ├── flows/                          # Auto: interaction flow tests
│   ├── screens/                        # Auto: screen state tests (11 files)
│   └── coverage-gaps/                  # Auto: gap tests
├── tests/                              # Playwright integration tests
│   ├── flows/                          # Auto: flow E2E tests
│   ├── screens/                        # Auto: screen E2E tests
│   └── *.spec.ts                       # Manual E2E tests
├── vitest.config.ts
├── vitest.setup.ts
└── playwright.config.ts
```

---

## Wireframe Testing

```bash
python3 .agent/skills/webapp-testing/scripts/wireframe_buttons.py add <page.tsx>
python3 .agent/skills/webapp-testing/scripts/wireframe_buttons.py remove <page.tsx>
```

---

## Best Practices

- **Test separation first**: Run `validate_test_separation.py` before test generation
- **Zero contamination**: Never add test code to `app/` directory
- **Vitest for unit tests**: Components, hooks, utilities in isolation
- **Playwright for E2E**: Screen states, navigation, user flows
- **Reconnaissance first**: 서버 실행 후 정찰 → 셀렉터 파악 → 테스트 작성
- **Generate before sprint**: Run `--mode all` at sprint start to baseline
- **Replace skeletons incrementally**: `expect(true).toBe(true)` → real assertions
- **Track coverage**: `coverage_reporter.py` after each sprint
- **Test naming**: `*.test.ts(x)` for unit, `*.spec.ts` for integration
- **일시 스크립트**: 항상 `scripts/` 디렉토리에 생성 (정리 용이)
