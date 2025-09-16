<div align="center">
<sub>

[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Bahasa Indonesia](../id/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [日本語](../ja/CONTRIBUTING.md)

</sub>
<sub>

<b>한국어</b> • [Nederlands](../nl/CONTRIBUTING.md) • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

</sub>
</div>

# Roo Code에 기여하기

Roo Code는 커뮤니티 기반 프로젝트이며 모든 기여를 소중하게 생각합니다. 협업을 간소화하기 위해 [이슈 우선 접근 방식](#이슈-우선-접근-방식)으로 운영됩니다. 즉, 모든 [풀 리퀘스트(PR)](#풀-리퀘스트-제출)는 먼저 GitHub 이슈에 연결되어야 합니다. 이 가이드를 주의 깊게 검토해 주세요.

## 목차

- [기여하기 전에](#기여하기-전에)
- [기여 찾기 및 계획하기](#기여-찾기-및-계획하기)
- [개발 및 제출 절차](#개발-및-제출-절차)
- [법률](#법률)

## 기여하기 전에

### 1. 행동 강령

모든 기여자는 [행동 강령](./CODE_OF_CONDUCT.md)을 준수해야 합니다.

### 2. 프로젝트 로드맵

로드맵은 프로젝트의 방향을 안내합니다. 기여를 다음 주요 목표에 맞게 조정하세요.

### 안정성 우선

- diff 편집 및 명령어 실행이 일관되게 안정적인지 확인합니다.
- 정기적인 사용을 방해하는 마찰 지점을 줄입니다.
- 모든 로케일 및 플랫폼에서 원활한 작동을 보장합니다.
- 다양한 AI 제공업체 및 모델에 대한 강력한 지원을 확대합니다.

### 향상된 사용자 경험

- 명확하고 직관적인 UI/UX를 위해 간소화합니다.
- 개발자가 매일 사용하는 도구에 대해 기대하는 높은 수준을 충족하도록 워크플로를 지속적으로 개선합니다.

### 에이전트 성능 선도

- 실제 생산성을 측정하기 위한 포괄적인 평가 벤치마크(evals)를 수립합니다.
- 누구나 이러한 평가를 쉽게 실행하고 해석할 수 있도록 합니다.
- 평가 점수의 명확한 증가를 보여주는 개선 사항을 제공합니다.

PR에 이러한 영역과의 연관성을 언급하세요.

### 3. Roo Code 커뮤니티에 참여하세요

- **기본:** [Discord](https://discord.gg/roocode)에 참여하여 **Hannes Rudolph (`hrudolph`)**에게 DM을 보내세요.
- **대안:** 숙련된 기여자는 [GitHub 프로젝트](https://github.com/orgs/RooCodeInc/projects/1)를 통해 직접 참여할 수 있습니다.

## 기여 찾기 및 계획하기

### 기여 유형

- **버그 수정:** 코드 문제 해결.
- **새로운 기능:** 기능 추가.
- **문서:** 가이드 및 명확성 향상.

### 이슈 우선 접근 방식

모든 기여는 간소화된 템플릿을 사용하여 GitHub 이슈에서 시작됩니다.

- **기존 이슈 확인**: [GitHub 이슈](https://github.com/RooCodeInc/Roo-Code/issues)에서 검색합니다.
- **이슈 생성**:
    - **개선 사항:** "개선 요청" 템플릿 (사용자 혜택에 초점을 맞춘 평이한 언어).
    - **버그:** "버그 보고" 템플릿 (최소한의 재현 + 예상 대 실제 + 버전).
- **작업하고 싶으신가요?** 이슈에 "Claiming"이라고 댓글을 달고 [Discord](https://discord.gg/roocode)에서 **Hannes Rudolph (`hrudolph`)**에게 DM을 보내 할당을 받으세요. 할당은 스레드에서 확인됩니다.
- **PR은 이슈에 연결되어야 합니다.** 연결되지 않은 PR은 종료될 수 있습니다.

### 작업할 내용 결정하기

- "이슈 [할당되지 않음]" 이슈는 [GitHub 프로젝트](https://github.com/orgs/RooCodeInc/projects/1)를 확인하세요.
- 문서는 [Roo Code 문서](https://github.com/RooCodeInc/Roo-Code-Docs)를 방문하세요.

### 버그 신고하기

- 먼저 기존 보고서가 있는지 확인하세요.
- ["버그 보고" 템플릿](https://github.com/RooCodeInc/Roo-Code/issues/new/choose)을 사용하여 새 버그를 생성하세요.
    - 명확하고 번호가 매겨진 재현 단계
    - 예상 결과 대 실제 결과
    - Roo Code 버전 (필수), 관련이 있는 경우 API 제공업체/모델
- **보안 문제**: [보안 권고](https://github.com/RooCodeInc/Roo-Code/security/advisories/new)를 통해 비공개로 보고하세요.

## 개발 및 제출 절차

### 개발 설정

1. **포크 및 클론:**

```
git clone https://github.com/사용자이름/Roo-Code.git
```

2. **의존성 설치:**

```
pnpm install
```

3. **디버깅:** VS Code로 엽니다 (`F5`).

### 코드 작성 가이드라인

- 기능 또는 수정당 하나의 집중된 PR.
- ESLint 및 TypeScript 모범 사례를 따릅니다.
- 이슈를 참조하는 명확하고 설명적인 커밋을 작성합니다 (예: `Fixes #123`).
- 철저한 테스트를 제공합니다 (`npm test`).
- 제출하기 전에 최신 `main` 브랜치로 리베이스합니다.

### 풀 리퀘스트 제출

- 초기 피드백을 원하면 **초안 PR**로 시작하세요.
- 풀 리퀘스트 템플릿에 따라 변경 사항을 명확하게 설명하세요.
- PR 설명/제목에 이슈를 연결하세요 (예: "Fixes #123").
- UI 변경 사항에 대한 스크린샷/동영상을 제공하세요.
- 문서 업데이트가 필요한지 표시하세요.

### 풀 리퀘스트 정책

- 할당된 GitHub 이슈를 참조해야 합니다. 할당을 받으려면: 이슈에 "Claiming"이라고 댓글을 달고 [Discord](https://discord.gg/roocode)에서 **Hannes Rudolph (`hrudolph`)**에게 DM을 보내세요. 할당은 스레드에서 확인됩니다.
- 연결되지 않은 PR은 종료될 수 있습니다.
- PR은 CI 테스트를 통과하고 로드맵과 일치하며 명확한 문서를 포함해야 합니다.

### 검토 절차

- **매일 분류:** 유지 관리자의 빠른 확인.
- **매주 심층 검토:** 포괄적인 평가.
- 피드백을 바탕으로 **신속하게 반복**합니다.

## 법률

기여함으로써 귀하는 귀하의 기여가 Roo Code의 라이선스와 일치하는 Apache 2.0 라이선스에 따라 라이선스가 부여된다는 데 동의합니다.
