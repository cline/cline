# Cline 시작하기 | 신규 코더

Cline에 오신 것을 환영합니다! 이 가이드는 Cline을 설정하고 첫 프로젝트를 구축하는 데 도움을 줄 것입니다.

## 필요한 것

시작하기 전에 다음 사항을 확인하세요:

-   **VS Code:** 무료이면서 강력한 코드 편집기입니다.
    -   [VS Code 다운로드](https://code.visualstudio.com/)
-   **개발 도구:** 코딩에 필수적인 소프트웨어(Homebrew, Node.js, Git 등).
    -   [필수 개발 도구 설치](installing-dev-essentials.md) 가이드를 따라 Cline의 도움으로 이를 설정하세요(여기서 설정 후).
    -   Cline이 필요한 모든 것을 설치하는 과정을 안내할 것입니다.
-   **Cline 프로젝트 폴더:** 모든 Cline 프로젝트를 위한 전용 폴더입니다.
    -   macOS에서: 문서 폴더에 "Cline"이라는 폴더를 생성하세요.
        -   경로: `/Users/[your-username]/Documents/Cline`
    -   Windows에서: 문서 폴더에 "Cline"이라는 폴더를 생성하세요.
        -   경로: `C:\Users\[your-username]\Documents\Cline`
    -   이 Cline 폴더 내에 각 프로젝트를 위한 별도의 폴더를 생성하세요.
        -   예: `Documents/Cline/workout-app` 운동 추적 앱용
        -   예: `Documents/Cline/portfolio-website` 포트폴리오용
-   **VS Code의 Cline 확장 프로그램:** VS Code에 설치된 Cline 확장 프로그램.

-   시작에 필요한 모든 것에 대한 [튜토리얼](https://www.youtube.com/watch?v=N4td-fKhsOQ)이 있습니다.

## 단계별 설정

Cline을 실행하기 위해 다음 단계를 따르세요:

1. **VS Code 열기:** VS Code 애플리케이션을 실행하세요. VS Code가 "Running extensions might..."를 표시하면 "허용"을 클릭하세요.

2. **Cline 폴더 열기:** VS Code에서 문서에 생성한 Cline 폴더를 엽니다.

3. **확장 프로그램으로 이동:** VS Code의 활동 바 측면에서 확장 프로그램 아이콘을 클릭하세요.

4. **'Cline' 검색:** 확장 프로그램 검색 창에 "Cline"을 입력하세요.

5. **확장 프로그램 설치:** Cline 확장 프로그램 옆의 "설치" 버튼을 클릭하세요.

6. **Cline 열기:** 설치가 완료되면 Cline을 다음과 같은 방법으로 열 수 있습니다:
    - 활동 바의 Cline 아이콘을 클릭하세요.
    - 명령 팔레트(`CMD/CTRL + Shift + P`)를 사용하고 "Cline: Open In New Tab"을 입력하여 편집기의 탭으로 Cline을 엽니다. 이는 더 나은 뷰를 위해 권장됩니다.
    - **문제 해결:** Cline 아이콘이 보이지 않으면 VS Code를 다시 시작해 보세요.
    - **보이는 것:** VS Code 편집기에 Cline 채팅 창이 나타나야 합니다.

![gettingStartedVsCodeCline](https://github.com/user-attachments/assets/622b4bb7-859b-4c2e-b87b-c12e3eabefb8)

## OpenRouter API 키 설정

이제 Cline이 설치되었으므로 Cline의 전체 기능을 사용하려면 OpenRouter API 키를 설정해야 합니다.
1. **OpenRouter API 키 획득:**
   - [OpenRouter API 키 획득](https://openrouter.ai/)
2. **OpenRouter API 키 입력:**
   - Cline 확장 프로그램의 설정 버튼으로 이동하세요.
   - OpenRouter API 키를 입력하세요.
   - 선호하는 API 모델을 선택하세요.
     - **코딩에 추천하는 모델:**
       - `anthropic/claude-3.5-sonnet`: 코딩 작업에 가장 많이 사용됩니다.
       - `google/gemini-2.0-flash-exp:free`: 코딩을 위한 무료 옵션입니다.
       - `deepseek/deepseek-chat`: 매우 저렴하며, 3.5 sonnet과 거의 동등한 성능을 제공합니다.
     - [OpenRouter 모델 순위](https://openrouter.ai/rankings/programming)

## Cline과의 첫 번째 상호작용

이제 Cline으로 빌드를 시작할 준비가 되었습니다. 첫 번째 프로젝트 폴더를 만들고 무언가를 만들어 봅시다! 다음 프롬프트를 Cline 채팅 창에 복사하여 붙여넣으세요:

```
Hey Cline! Cline 디렉토리에 "hello-world"라는 새 프로젝트 폴더를 만들고 "Hello World"라는 큰 파란색 텍스트가 있는 간단한 웹 페이지를 만들 수 있나요?
```

**보게 될 것:** Cline이 프로젝트 폴더를 만들고 첫 번째 웹 페이지를 설정하는 데 도움을 줄 것입니다.

## Cline과 작업할 때의 팁

- **질문하기:** 무언가 확실하지 않다면 Cline에게 질문하세요!
- **스크린샷 사용:** Cline은 이미지를 이해할 수 있으므로 작업 중인 것을 보여주기 위해 스크린샷을 사용하세요.
- **오류 복사 및 붙여넣기:** 오류를 만나면 오류 메시지를 Cline의 채팅에 복사하여 붙여넣으세요. 이를 통해 Cline은 문제를 이해하고 해결책을 제공할 수 있습니다.
- **평이한 언어 사용:** Cline은 비기술적인 평이한 언어를 이해하도록 설계되었습니다. 자신의 말로 아이디어를 설명하면 Cline이 이를 코드로 변환할 것입니다.

## 자주 묻는 질문

- **터미널이란 무엇인가요?** 터미널은 컴퓨터와 상호작용하기 위한 텍스트 기반 인터페이스입니다. 패키지 설치, 스크립트 실행, 파일 관리 등 다양한 작업을 수행하기 위해 명령을 실행할 수 있습니다. Cline은 명령을 실행하고 개발 환경과 상호작용하기 위해 터미널을 사용합니다.
- **코드베이스는 어떻게 작동하나요?** (이 섹션은 새로운 코더들의 일반적인 질문에 따라 확장될 것입니다)

## 여전히 어려움을 겪고 있나요?

저에게 연락하시면 Cline을 시작하는 데 도움을 드리겠습니다.

nick | 608-558-2410

우리의 Discord 커뮤니티에 가입하세요: [https://discord.gg/cline](https://discord.gg/cline)