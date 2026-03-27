# Project-Scoped Rule Source

This repository vendors the active AIDLC rule-details into a project-local source tree.

## Import Metadata

- Imported at: `2026-03-14T05:02:44Z`
- Imported from: `/Users/eastsea613gmail.com/.claude/.aidlc-rule-details`
- Import intent: make AIDLC rule resolution project-scoped and reproducible inside this workspace

## Operating Rule

- The active foundation source for this project is `./.aidlc-rule-details/`.
- Global rule copies may be used only as an upstream reference for intentional sync work.
- New workflow behavior should be added through project skills and integration notes, not by broad mutation of foundation flow.

## Sync Guidance

When upstream AIDLC rule-details change, review and import them intentionally. Do not assume machine-level global state is the runtime source of truth for this repository.

### Upstream Source

- **Repository**: `awslabs/aidlc-workflows`
- **Local clone**: `resource/aidlc-workflows/`
- **Last sync**: 2026-03-14 (HEAD, post-v0.1.6)

### Sync Procedure

자세한 절차는 `aidlc-docs/meta-knowledge/aidlc-change-management-principles.md` 섹션 2를 참조.

요약:
1. `resource/aidlc-workflows/`에서 `git pull`
2. `diff -rq resource/aidlc-workflows/aidlc-rules/aws-aidlc-rule-details/ .aidlc-rule-details/ --exclude=PROJECT_SOURCE.md`
3. 변경 파일별 영향 분석 (Layer 2 skills와의 충돌 확인)
4. `.aidlc-rule-details/`에 복사 후 본 파일의 Import Metadata 업데이트
