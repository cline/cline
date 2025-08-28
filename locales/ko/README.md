# Cline

<p align="center">
    <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>VS Marketplace에서 다운로드</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>기능 요청</strong></a>
</td>
<td align="center">
<a href="https://cline.bot/join-us" target="_blank"><strong>채용 정보</strong></a>
</td>
</tbody>
</table>
</div>

Cline을 만나보세요, **CLI** 및 **에디터**를 활용할 수 있는 AI 어시스턴트입니다.

[Claude 4 Sonnet의 에이전트형 코딩 기능](https://www.anthropic.com/claude/sonnet) 덕분에, Cline은 복잡한 소프트웨어 개발 작업을 단계별로 처리할 수 있습니다. 파일 생성과 편집, 대규모 프로젝트 탐색, 브라우저 사용, 터미널 명령 실행(권한 허가 필요) 등의 도구를 사용하여 단순 코드 완성이나 기술 지원을 넘어서는 도움을 제공합니다. Cline은 Model Context Protocol(MCP)를 사용하여 새로운 도구를 만들고 자신의 기능을 확장할 수도 있습니다. 자율적인 AI 스크립트는 일반적으로 샌드박스 환경에서 실행되지만, 이 확장 프로그램은 모든 파일 변경 및 터미널 명령을 승인할 수 있는 사람이 개입가능한 GUI를 제공하여, 에이전트형 AI의 잠재력을 보다 안전하고 쉽게 탐색할 수 있도록 합니다.

1. 작업을 입력하고, 목업을 기능하는 앱으로 변환하거나 스크린샷으로 버그를 수정합니다.
2. Cline은 파일 구조와 소스코드 AST의 분석, 정규식 검색 실행, 관련 파일 읽기부터 시작하여 기존 프로젝트를 파악합니다. 또한, 어떤 정보를 컨텍스트에 추가할지를 신중하게 관리하여, 대규모 복잡한 프로젝트에서도 컨텍스트 윈도우를 과부하시키지 않으면서도 효과적인 지원을 제공합니다.
3. Cline이 필요한 정보를 얻은 후 다음과 같은 작업을 할 수 있습니다:
    - 파일 생성과 편집 + 린터/컴파일러 오류 모니터링을 수행하여 누락된 임포트나 구문 오류 등의 문제를 자동으로 수정합니다.
    - 터미널에서 명령을 직접 실행하고 작업 중에 출력을 모니터링합니다. 이를 통해 파일 편집 후 개발 서버의 문제에 대응할 수 있습니다.
    - 웹 개발 작업에서는 헤드리스 브라우저로 사이트를 실행하고, 클릭, 입력, 스크롤, 스크린샷과 콘솔 로그 캡처를 수행하여 런타임 오류나 시각적 버그를 수정합니다.
4. 작업이 완료되면 Cline은 `open -a "Google Chrome" index.html`과 같은 터미널 명령을 제공하여 버튼 클릭 한 번으로 결과를 확인할 수 있도록 합니다.

> [!TIP]
> `CMD/CTRL + Shift + P` 단축키를 사용하여 명령 팔레트를 열고 "Cline: Open In New Tab"을 입력하여 에디터의 탭으로 확장 프로그램을 엽니다. 이를 통해 파일 탐색기와 병행하여 Cline을 사용하고 워크스페이스의 변경을 더 명확하게 확인할 수 있습니다.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### 어떤 API나 모델이든 사용 가능

Cline은 OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex 등의 API 제공자를 지원합니다. 또한 OpenAI 호환 API를 설정하거나 LM Studio/Ollama를 통해 로컬 모델을 사용할 수도 있습니다. OpenRouter를 사용하는 경우, 확장 프로그램에서 최신 모델 목록을 가져와 바로 최신 모델을 사용할 수 있게 합니다.

또한, Cline은 전체 작업 루프와 개별 요청별로 토큰 사용량과 API 비용을 추적하여, 진행 중인 작업의 비용을 실시간으로 확인할 수 있도록 도와줍니다.

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### 터미널에서 명령 실행

VSCode v1.93의 새로운 [셸 통합 업데이트](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api) 덕분에, Cline은 터미널에서 명령을 직접 실행하고 출력을 받을 수 있습니다. 이를 통해 패키지 설치나 빌드 스크립트 실행부터 애플리케이션 배포, 데이터베이스 관리, 테스트 실행까지 광범위한 작업을 수행할 수 있습니다. Cline은 개발 환경과 도구 체인에 맞추어 정확하게 작업을 실행합니다.

개발 서버와 같은 오래 실행되는 프로세스의 경우, "실행 중 계속"(Proceed While Running) 버튼을 사용하여 명령이 백그라운드에서 실행되는 동안 Cline이 작업을 계속할 수 있게 합니다. 작업이 진행되는 동안 Cline은 새로운 터미널 출력을 실시간으로 확인하여, 파일 편집 시 발생하는 컴파일 오류와 같은 문제에 즉시 대응할 수 있습니다.

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### 파일 생성과 편집

Cline은 에디터 내에서 파일을 생성 및 편집하고 변경의 Diff 뷰로 표시합니다. Diff 뷰 에디터에서 Cline의 변경을 직접 편집하거나 되돌릴 수 있으며, 채팅에서 피드백을 제공하여 만족할 때까지 개선 요청할 수 있습니다. Cline은 린터/컴파일러 오류(누락된 임포트, 구문 오류 등)도 모니터링하고 발생한 문제를 자동으로 수정합니다.

Cline에 의한 모든 변경은 파일의 타임라인에 기록되어 필요할 때 변경을 추적하고 되돌릴 수 있는 간단한 방법을 제공합니다.


<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### 브라우저 사용

Claude 4 Sonnet의 새로운 [컴퓨터 사용](https://www.anthropic.com/news/3-5-models-and-computer-use) 기능으로 인해, Cline은 브라우저를 실행하고 요소를 클릭하고 텍스트를 입력하고 스크롤하며 각 단계에서 스크린샷과 콘솔 로그를 캡처할 수 있습니다. 이를 통해 인터랙티브한 디버깅, 엔드투엔드 테스트, 심지어 일반적인 웹 탐색까지 가능해집니다. 이로 인해 오류 로그를 수동으로 복사 & 붙여넣기 할 필요 없이 시각적 버그나 런타임 문제를 자율적으로 수정할 수 있습니다.

Cline에게 "앱을 테스트해줘"라고 요청하면, `npm run dev`와 같은 명령을 실행하고 로컬에서 실행 중인 개발 서버를 브라우저에서 실행하여 일련의 테스트를 수행하고 모든 것이 정상적으로 작동하는지 확인합니다. [데모는 여기를 참조하세요.](https://x.com/sdrzn/status/1850880547825823989)

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "도구를 추가 해주세요."

Cline은 [Model Context Protocol](https://github.com/modelcontextprotocol)을 활용하여 커스텀 도구를 생성하고 기능을 확장할 수 있습니다. 기존의 [커뮤니티 서버](https://github.com/modelcontextprotocol/servers)를 사용할 수도 있지만, Cline은 사용자의 워크플로우에 최적화된 도구를 직접 제작하고 설치할 수도 있습니다. "~ 도구를 추가해주세요."라고 요청만 하면, Cline은 새로운 MCP 서버 생성부터 확장 프로그램 내 설치까지 모두 자동으로 처리합니다. 이러한 커스텀 도구는 Cline의 툴키트의 일부가 되어 향후 작업에서 사용할 수 있게 됩니다.

- "Jira 티켓을 가져오는 도구를 추가해주세요": 티켓 AC를 가져와 Cline에게 작업을 요청
- "AWS EC2를 관리하는 도구를 추가해주세요": 서버 메트릭을 확인하고 인스턴스를 확장 또는 축소
- "최신 PagerDuty 인시던트를 가져오는 도구를 추가해주세요": 최신 장애 정보를 가져와 Cline에게 버그 수정 요청

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### 컨텍스트 추가

**`@url`：** URL을 붙여넣으면 확장이 해당 페이지를 가져와 Markdown으로 변환합니다. 최신 문서를 Cline에게 제공할 때 유용합니다.

**`@problems`：** Cline이 수정할 워크스페이스 오류와 경고(Problems' panel)를 추가합니다.

**`@file`：** 파일의 내용을 추가하여, 파일을 읽는 데 API 요청을 허비하지 않고도 Cline이 접근할 수 있도록 합니다. (+ 파일 검색 가능)

**`@folder`：** 폴더 내 모든 파일을 한 번에 추가하여 워크플로우를 더욱 빠르게 진행할 수 있습니다.

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### 체크포인트: 비교 및 복원

Cline이 작업을 진행하는 동안 확장 프로그램은 각 단계에서 워크스페이스의 스냅샷을 저장합니다. “Compare” 버튼을 사용하여 스냅샷과 현재 워크스페이스의 차이를 확인하고, “Restore” 버튼을 사용하여 해당 시점으로 롤백할 수 있습니다.

예를 들어, 로컬 웹 서버에서 작업 중일 때 “Restore Workspace Only”을 사용하여 서로 다른 버전의 앱을 신속하게 테스트하고, “Restore Task and Workspace”을 사용하여 계속 진행할 버전을 찾을 수 있습니다. 이를 통해 진행 상황을 잃지 않고 안전하게 다양한 접근 방식을 실험할 수 있습니다.

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## 기여

프로젝트에 기여하려면, [기여 가이드](CONTRIBUTING.md)에서 기본 사항을 익히세요. 또한, [Discord](https://discord.gg/cline)에 참여하여 `#contributors` 채널에서 다른 기여자들과 이야기할 수 있습니다. 풀타임 직업을 찾고 있다면, [채용 페이지](https://cline.bot/join-us)에서 열려있는 포지션을 확인하세요.

<details>
<summary>로컬 개발 방법</summary>

1. 리포지토리를 클론합니다 _(Requires [git-lfs](https://git-lfs.com/))_：
        ```bash
        git clone https://github.com/cline/cline.git
        ```
2. 프로젝트를 VSCode에서 엽니다：
        ```bash
        code cline
        ```
3. 확장 프로그램과 webview-gui의 필요한 의존성을 설치합니다：
        ```bash
        npm run install:all
        ```
4. `F5`를 눌러(또는 `Run`->`Start Debugging`), 확장 프로그램이 로드된 새로운 VSCode 창을 엽니다. (프로젝트 빌드에 문제가 있는 경우, [esbuild problem matchers extension](https://marketplace.visualstudio.com/items?itemName=connor4312.esbuild-problem-matchers)을 설치해야 할 수도 있습니다.)

</details>

<details>
<summary>Pull Request 생성 방법</summary>

1. PR을 만들기 전, 변경 사항을 기록하는 changeset 항목을 생성:
    ```bash
    npm run changeset
    ```
   이후 프롬프트에서 다음 정보를 입력하세요:
   - 변경 유형 (major, minor, patch)
     - `major` → 호환되지 않는 변경 (1.0.0 → 2.0.0)
     - `minor` → 새로운 기능 추가 (1.0.0 → 1.1.0)
     - `patch` → 버그 수정 (1.0.0 → 1.0.1)
   - 변경 사항 설명 입력

2. 변경 사항과 생성된 `.changeset` 파일을 커밋 후 브랜치를 푸시하고 GitHub에서 PR을 생성하세요.

3. 브랜치를 푸시하고 GitHub에서 PR을 생성하세요. CI가 다음과 같은 작업을 수행합니다:
   - 테스트 및 코드 검증 실행
   - Changesetbot이 버전 변경 영향을 보여주는 코멘트를 생성
   - 브랜치가 메인에 머지되면, Changesetbot이 버전 패키지 PR을 생성
   - 버전 패키지 PR이 머지되면, 새로운 릴리즈가 게시됨

</details>

## 라이센스

[Apache 2.0 © 2025 Cline Bot Inc.](/LICENSE)
