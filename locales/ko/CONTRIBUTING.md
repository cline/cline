[English](../../CONTRIBUTING.md) • [Català](../ca/CONTRIBUTING.md) • [Deutsch](../de/CONTRIBUTING.md) • [Español](../es/CONTRIBUTING.md) • [Français](../fr/CONTRIBUTING.md) • [हिंदी](../hi/CONTRIBUTING.md) • [Italiano](../it/CONTRIBUTING.md) • [Nederlands](../nl/CONTRIBUTING.md) • [Русский](../ru/CONTRIBUTING.md)

[日本語](../ja/CONTRIBUTING.md) • <b>한국어</b> • [Polski](../pl/CONTRIBUTING.md) • [Português (BR)](../pt-BR/CONTRIBUTING.md) • [Türkçe](../tr/CONTRIBUTING.md) • [Tiếng Việt](../vi/CONTRIBUTING.md) • [简体中文](../zh-CN/CONTRIBUTING.md) • [繁體中文](../zh-TW/CONTRIBUTING.md)

# Roo Code 기여 가이드

Roo Code는 커뮤니티 주도의 프로젝트이며, 모든 기여를 소중하게 생각합니다. 모두를 위한 원활하고 효과적인 프로세스를 위해 **"[Issue-First](#2-핵심-원칙-issue-first-접근법)" 원칙**을 따릅니다. 즉, 모든 작업은 Pull Request를 제출하기 _전에_ 반드시 GitHub Issue와 연결되어야 합니다(자세한 내용은 [PR 정책](#pull-request-pr-정책) 참고). 이 가이드를 꼼꼼히 읽고 기여 방법을 이해해 주세요.
이 가이드는 Roo Code에 버그 수정, 기능 추가, 문서 개선 등 다양한 방식으로 기여하는 방법을 안내합니다.

## 목차

- [I. 기여 전 준비](#i-기여-전-준비)
    - [1. 행동 강령](#1-행동-강령)
    - [2. 프로젝트 로드맵 이해](#2-프로젝트-로드맵-이해)
        - [프로바이더 지원](#프로바이더-지원)
        - [모델 지원](#모델-지원)
        - [시스템 지원](#시스템-지원)
        - [문서화](#문서화)
        - [안정성](#안정성)
        - [국제화](#국제화)
    - [3. Roo Code 커뮤니티 참여](#3-roo-code-커뮤니티-참여)
- [II. 기여 내용 찾기 및 계획 세우기](#ii-기여-내용-찾기-및-계획-세우기)
    - [1. 기여 유형](#1-기여-유형)
    - [2. 핵심 원칙: Issue-First 접근법](#2-핵심-원칙-issue-first-접근법)
    - [3. 작업 선택하기](#3-작업-선택하기)
    - [4. 버그 및 이슈 신고](#4-버그-및-이슈-신고)
- [III. 개발 및 제출 프로세스](#iii-개발-및-제출-프로세스)
    - [1. 개발 환경 설정](#1-개발-환경-설정)
    - [2. 코드 작성 가이드라인](#2-코드-작성-가이드라인)
    - [3. 코드 제출: Pull Request (PR) 프로세스](#3-코드-제출-pull-request-pr-프로세스)
        - [드래프트 Pull Request](#드래프트-pull-request)
        - [Pull Request 설명](#pull-request-설명)
        - [Pull Request (PR) 정책](#pull-request-pr-정책)
            - [목표](#목표)
            - [Issue-First 접근법](#issue-first-접근법)
            - [오픈 PR 조건](#오픈-pr-조건)
            - [절차](#절차)
            - [책임](#책임)
- [IV. 법적 안내](#iv-법적-안내)
    - [기여 동의서](#기여-동의서)

## I. 기여 전 준비

먼저, 커뮤니티 기준과 프로젝트 방향을 숙지하세요.

### 1. 행동 강령

모든 기여자는 [행동 강령](https://github.com/RooVetGit/Roo-Code/blob/main/CODE_OF_CONDUCT.md)을 준수해야 합니다. 기여 전 반드시 읽어주세요.

### 2. 프로젝트 로드맵 이해

Roo Code는 명확한 개발 로드맵을 가지고 있으며, 우리의 우선순위와 미래 방향을 제시합니다. 로드맵을 이해하면 다음과 같은 도움이 됩니다:

- 기여를 프로젝트 목표에 맞출 수 있음
- 본인의 전문성이 가장 필요한 영역을 찾을 수 있음
- 특정 설계 결정의 배경을 이해할 수 있음
- 비전을 지원하는 새로운 기능에 대한 영감을 얻을 수 있음

현재 로드맵은 6가지 핵심 기둥에 중점을 둡니다:

#### 프로바이더 지원

더 많은 프로바이더를 잘 지원하는 것이 목표입니다:

- 더 다양한 "OpenAI Compatible" 지원
- xAI, Microsoft Azure AI, Alibaba Cloud Qwen, IBM Watsonx, Together AI, DeepInfra, Fireworks AI, Cohere, Perplexity AI, FriendliAI, Replicate
- Ollama 및 LM Studio 지원 강화

#### 모델 지원

Roo가 더 많은 모델(로컬 모델 포함)에서 잘 동작하도록 하고 싶습니다:

- 커스텀 시스템 프롬프트 및 워크플로우를 통한 로컬 모델 지원
- 벤치마킹, 평가, 테스트 케이스

#### 시스템 지원

Roo가 모든 컴퓨터에서 잘 동작하도록 하고 싶습니다:

- 크로스플랫폼 터미널 통합
- Mac, Windows, Linux에서 강력하고 일관된 지원

#### 문서화

모든 사용자와 기여자를 위한 포괄적이고 접근성 높은 문서를 지향합니다:

- 확장된 사용자 가이드 및 튜토리얼
- 명확한 API 문서
- 더 나은 기여자 가이드
- 다국어 문서 리소스
- 인터랙티브 예제 및 코드 샘플

#### 안정성

버그를 크게 줄이고 자동화된 테스트를 늘리고자 합니다:

- 디버그 로깅 스위치
- 버그/지원 요청용 "머신/작업 정보" 복사 버튼

#### 국제화

Roo가 모두의 언어를 사용할 수 있도록 하고 싶습니다:

- 我们希望 Roo Code 说每个人的语言
- Queremos que Roo Code hable el idioma de todos
- हम चाहते हैं कि Roo Code हर किसी की भाषा बोले
- نريد أن يتحدث Roo Code لغة الجميع

로드맵 목표를 앞당기는 기여는 특히 환영합니다. 위 기둥과 관련된 작업을 한다면 PR 설명에 꼭 언급해 주세요.

### 3. Roo Code 커뮤니티 참여

Roo Code 커뮤니티와 소통하는 것은 시작하기에 좋은 방법입니다:

- **주요 방법**:
    1.  [Roo Code Discord 커뮤니티](https://discord.gg/roocode)에 가입하세요.
    2.  가입 후 **Hannes Rudolph**(Discord: `hrudolph`)에게 DM을 보내 관심을 알리고 안내를 받으세요.
- **경험자용 대안**: Issue-First 접근법에 익숙하다면 [Kanban 보드](https://github.com/orgs/RooVetGit/projects/1)를 따라가며 GitHub에서 Issue 및 Pull Request로 직접 참여할 수 있습니다.

## II. 기여 내용 찾기 및 계획 세우기

무엇을 할지, 어떻게 할지 결정하세요.

### 1. 기여 유형

다양한 기여를 환영합니다:

- **버그 수정**: 기존 코드의 문제 해결
- **새 기능**: 새로운 기능 추가
- **문서화**: 가이드, 예제 개선 또는 오타 수정

### 2. 핵심 원칙: Issue-First 접근법

**모든 기여는 GitHub Issue에서 시작해야 합니다.** 이는 방향성 일치와 불필요한 노력을 방지하기 위해 중요합니다.

- **Issue 찾기/생성**:
    - 시작 전 [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues)에서 관련 Issue가 있는지 확인하세요.
    - 있다면, 할당되지 않은 경우 댓글로 참여 의사를 밝히세요. 메인테이너가 할당합니다.
    - 없다면, [Issues 페이지](https://github.com/RooVetGit/Roo-Code/issues/new/choose)에서 적절한 템플릿으로 새 Issue를 만드세요:
        - 버그는 "Bug Report" 템플릿
        - 새 기능은 "Detailed Feature Proposal" 템플릿. 구현 전 메인테이너(특히 @hannesrudolph) 승인 필요
        - **참고**: 기능 아이디어나 초기 논의는 [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests)에서 시작할 수 있습니다. 구체화되면 "Detailed Feature Proposal" Issue를 만드세요.
- **담당 표명 및 할당**:
    - Issue에 댓글로 작업 의사를 명확히 밝히세요.
    - 메인테이너가 공식적으로 GitHub에서 할당할 때까지 기다리세요. 중복 작업을 방지합니다.
- **지키지 않을 경우**:
    - 관련 Issue가 없거나 승인·할당되지 않은 PR은 전체 리뷰 없이 닫힐 수 있습니다. 이는 프로젝트 우선순위와 모두의 시간을 존중하기 위함입니다.

이 접근법은 작업 추적, 변경 필요성 확인, 효과적인 협업에 도움이 됩니다.

### 3. 작업 선택하기

- **Good First Issues**: GitHub의 [Issue [Unassigned] 섹션](https://github.com/orgs/RooVetGit/projects/1) 참고
- **문서화**: 이 `CONTRIBUTING.md`는 코드 기여의 주요 가이드지만, 다른 문서(사용자 가이드, API 문서 등)에 기여하고 싶다면 [Roo Code Docs 저장소](https://github.com/RooVetGit/Roo-Code-Docs)를 참고하거나 Discord 커뮤니티에 문의하세요.
- **새 기능 제안**:
    1.  **초기 아이디어/논의**: 큰 틀의 아이디어나 초기 제안은 [GitHub Discussions](https://github.com/RooVetGit/Roo-Code/discussions/categories/feature-requests)에서 시작하세요.
    2.  **공식 제안**: 구체적이고 실행 가능한 제안은 [Issues 페이지](https://github.com/RooVetGit/Roo-Code/issues/new/choose)에서 "Detailed Feature Proposal" 템플릿으로 Issue를 만드세요. 이는 **Issue-First 접근법**의 핵심입니다.

### 4. 버그 및 이슈 신고

버그를 발견했다면:

1.  **기존 Issue 검색**: [GitHub Issues](https://github.com/RooVetGit/Roo-Code/issues)에서 중복 여부 확인
2.  **새 Issue 생성**: 고유하다면 [Issues 페이지](https://github.com/RooVetGit/Roo-Code/issues/new/choose)에서 "Bug Report" 템플릿 사용

> 🔐 **보안 취약점**: 보안 취약점을 발견하면 [GitHub Security Advisory Tool](https://github.com/RooVetGit/Roo-Code/security/advisories/new)로 비공개 신고하세요. 공개 Issue는 만들지 마세요.

## III. 개발 및 제출 프로세스

아래 단계에 따라 코딩하고 제출하세요.

### 1. 개발 환경 설정

1.  **Fork & Clone**:
    - GitHub에서 저장소를 포크하세요.
    - 포크한 저장소를 로컬에 클론: `git clone https://github.com/당신의_아이디/Roo-Code.git`
2.  **의존성 설치**: `npm run install:all`
3.  **Webview(개발 모드) 실행**: `npm run dev` (Vite/React 앱의 HMR용)
4.  **확장 디버깅**: VS Code에서 `F5`(또는 **Run** → **Start Debugging**)를 눌러 Roo Code가 로드된 Extension Development Host 창을 엽니다.

webview(`webview-ui`) 변경은 Hot Module Replacement로 즉시 반영됩니다. 코어 확장(`src`) 변경은 Extension Development Host 재시작 필요.

또는 `.vsix` 패키지 빌드 및 설치:

```sh
npm run build
code --install-extension bin/roo-cline-<version>.vsix
```

(`<version>`은 빌드된 파일의 실제 버전 번호로 대체)

### 2. 코드 작성 가이드라인

- **집중된 PR**: 기능/버그 수정별로 하나의 PR
- **코드 품질**:
    - CI 체크(린트, 포맷) 통과
    - ESLint 경고/오류 수정(`npm run lint`)
    - 자동 코드 리뷰 도구 피드백 반영
    - TypeScript 베스트 프랙티스 준수 및 타입 안전성 유지
- **테스트**:
    - 새 기능에는 테스트 추가
    - `npm test`로 모든 테스트 통과 확인
    - 기존 테스트에 영향이 있으면 업데이트
- **커밋 메시지**:
    - 명확하고 설명적인 메시지 작성
    - 관련 Issue를 `#issue-number`(예: `Fixes #123`)로 참조
- **PR 제출 전 체크리스트**:
    - 브랜치를 최신 upstream `main`에 리베이스
    - 코드 빌드 확인(`npm run build`)
    - 모든 테스트 통과 확인(`npm test`)
    - 디버깅 코드나 `console.log` 삭제

### 3. 코드 제출: Pull Request (PR) 프로세스

#### 드래프트 Pull Request

아직 전체 리뷰 준비가 안 된 작업에는 드래프트 PR을 사용하세요:

- 자동 체크(CI) 실행
- 메인테이너나 다른 기여자에게 조기 피드백 요청
- 작업 진행 중임을 표시

모든 체크를 통과하고 "코드 작성 가이드라인"과 "Pull Request 설명" 기준을 충족한다고 생각되면 "Ready for Review"로 전환하세요.

#### Pull Request 설명

PR 설명은 충분히 상세해야 하며, [Pull Request 템플릿](.github/pull_request_template.md) 구조를 따라야 합니다. 주요 포인트:

- 승인된 GitHub Issue 링크
- 변경 내용 및 목적의 명확한 설명
- 변경 테스트 방법의 상세 단계
- 주요 변경점(breaking changes) 목록
- **UI 변경 시, 전후 스크린샷 또는 동영상**
- **PR로 사용자 문서 업데이트가 필요한 경우, 어떤 문서/섹션인지 명시**

#### Pull Request (PR) 정책

##### 목표

깔끔하고 집중된, 관리하기 쉬운 PR 백로그 유지

##### Issue-First 접근법

- **필수**: 작업 시작 전, 승인·할당된 GitHub Issue("Bug Report" 또는 "Detailed Feature Proposal")가 있어야 함
- **승인**: 특히 큰 변경의 경우, 메인테이너(특히 @hannesrudolph) 사전 승인 필요
- **참조**: PR 설명에 해당 Issue를 명확히 참조
- **미준수 시**: 이 과정을 따르지 않으면 PR이 전체 리뷰 없이 닫힐 수 있음

##### 오픈 PR 조건

- **머지 준비 완료**: 모든 CI 테스트 통과, (해당 시) 로드맵과 일치, 승인·할당된 Issue와 연결, 명확한 문서/주석, UI 변경 시 전후 이미지/동영상 포함
- **닫힘 대상**: CI 실패, 큰 머지 충돌, 프로젝트 목표 불일치, 장기간(30일 이상) 피드백 후 미업데이트

##### 절차

1.  **Issue 확인 및 할당**: @hannesrudolph(또는 다른 메인테이너)이 신규/기존 Issue를 검토·할당
2.  **초기 PR 트리아지(매일)**: 메인테이너가 신규 PR을 빠르게 검토, 긴급/중요 이슈 분류
3.  **상세 PR 리뷰(주간)**: 메인테이너가 PR 준비 상태, Issue 일치, 전체 품질을 상세 검토
4.  **상세 피드백 및 반복**: 리뷰 후 Approve/Request Changes/Reject 피드백 제공, 기여자는 대응·수정
5.  **결정 단계**: 승인된 PR은 머지, 부적합/해결불가 PR은 사유 명시 후 닫힘
6.  **후속 조치**: 닫힌 PR 작성자는 문제 해결·방향 전환 후 새 PR 제출 가능

##### 책임

- **Issue 확인 및 프로세스 준수(@hannesrudolph & 메인테이너)**: 모든 기여가 Issue-First 접근법을 따르도록 확인, 기여자 안내
- **메인테이너(개발팀)**: PR 초기/상세 리뷰, 기술 피드백, 승인/거부 결정, 머지
- **기여자**: 승인·할당된 Issue와 연결, 품질 가이드라인 준수, 신속한 피드백 대응

이 정책은 명확성과 효율적 통합을 보장합니다.

## IV. 법적 안내

### 기여 동의서

Pull Request를 제출함으로써, 귀하의 기여가 [Apache 2.0 라이선스](LICENSE)(또는 프로젝트의 현행 라이선스)로 제공됨에 동의하는 것입니다. 프로젝트와 동일하게 적용됩니다.
