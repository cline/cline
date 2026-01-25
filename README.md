<div align="center"><sub>
English | <a href="https://github.com/cline/cline/blob/main/locales/es/README.md" target="_blank">Español</a> | <a href="https://github.com/cline/cline/blob/main/locales/de/README.md" target="_blank">Deutsch</a> | <a href="https://github.com/cline/cline/blob/main/locales/ja/README.md" target="_blank">日本語</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-cn/README.md" target="_blank">简体中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/zh-tw/README.md" target="_blank">繁體中文</a> | <a href="https://github.com/cline/cline/blob/main/locales/ko/README.md" target="_blank">한국어</a>
</sub></div>

# Cline

<p align="center">
  <img src="https://media.githubusercontent.com/media/cline/cline/main/assets/docs/demo.gif" width="100%" />
</p>

<div align="center">
<table>
<tbody>
<td align="center">
<a href="https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev" target="_blank"><strong>Download on VS Marketplace</strong></a>
</td>
<td align="center">
<a href="https://discord.gg/cline" target="_blank"><strong>Discord</strong></a>
</td>
<td align="center">
<a href="https://www.reddit.com/r/cline/" target="_blank"><strong>r/cline</strong></a>
</td>
<td align="center">
<a href="https://github.com/cline/cline/discussions/categories/feature-requests?discussions_q=is%3Aopen+category%3A%22Feature+Requests%22+sort%3Atop" target="_blank"><strong>Feature Requests</strong></a>
</td>
<td align="center">
<a href="https://docs.cline.bot/getting-started/for-new-coders" target="_blank"><strong>Getting Started</strong></a>
</td>
</tbody>
</table>
</div>

**CLI**와 에**디**터를 사용할 수 있는 AI 어시스턴트 Cline을 만나보세요.

[Claude Sonnet의 에이전트형 코딩 기능](https://www.anthropic.com/claude/sonnet) 덕분에 Cline은 복잡한 소프트웨어 개발 작업을 단계별로 처리할 수 있습니다. 파일 생성 및 편집, 대규모 프로젝트 탐색, 브라우저 사용, 터미널 명령 실행(권한 부여 후) 도구를 통해 코드 완성이나 기술 지원을 넘어서는 방식으로 여러분을 도울 수 있습니다. Cline은 Model Context Protocol(MCP)을 사용하여 새로운 도구를 만들고 자신의 기능을 확장할 수도 있습니다. 자율 AI 스크립트는 전통적으로 샌드박스 환경에서 실행되지만, 이 확장 프로그램은 모든 파일 변경과 터미널 명령을 승인할 수 있는 human-in-the-loop GUI를 제공하여 에이전트형 AI의 잠재력을 안전하고 접근 가능한 방식으로 탐색할 수 있게 합니다.

1. 작업을 입력하고 이미지를 추가하여 목업을 기능적인 앱으로 변환하거나 스크린샷으로 버그를 수정하세요.
2. Cline은 파일 구조 및 소스 코드 AST 분석, 정규식 검색 실행, 관련 파일 읽기를 통해 기존 프로젝트를 파악하는 것으로 시작합니다. 컨텍스트에 추가되는 정보를 신중하게 관리함으로써 Cline은 컨텍스트 윈도우를 압도하지 않으면서도 대규모의 복잡한 프로젝트에 대해 가치 있는 지원을 제공할 수 있습니다.
3. Cline이 필요한 정보를 얻으면 다음을 수행할 수 있습니다:
    - 파일을 생성 및 편집하고 린터/컴파일러 오류를 모니터링하여 누락된 import나 구문 오류와 같은 문제를 스스로 사전에 수정합니다.
    - 터미널에서 직접 명령을 실행하고 작업하면서 출력을 모니터링하여 파일 편집 후 개발 서버 문제에 대응할 수 있습니다.
    - 웹 개발 작업의 경우 Cline은 헤드리스 브라우저에서 사이트를 실행하고 클릭, 입력, 스크롤하며 스크린샷과 콘솔 로그를 캡처하여 런타임 오류와 시각적 버그를 수정할 수 있습니다.
4. 작업이 완료되면 Cline은 `open -a "Google Chrome" index.html`과 같은 터미널 명령으로 결과를 제시하며, 버튼 클릭으로 실행할 수 있습니다.

> [!TIP]
> [이 가이드](https://docs.cline.bot/features/customization/opening-cline-in-sidebar)를 따라 편집기 오른쪽에 Cline을 여세요. 이렇게 하면 파일 탐색기와 나란히 Cline을 사용할 수 있으며, 워크스페이스 변경 사항을 더 명확하게 볼 수 있습니다.

---

<img align="right" width="340" src="https://github.com/user-attachments/assets/3cf21e04-7ce9-4d22-a7b9-ba2c595e88a4">

### 모든 API와 모델 사용

Cline은 OpenRouter, Anthropic, OpenAI, Google Gemini, AWS Bedrock, Azure, GCP Vertex, Cerebras, Groq와 같은 API 프로바이더를 지원합니다. OpenAI 호환 API를 구성하거나 LM Studio/Ollama를 통해 로컬 모델을 사용할 수도 있습니다. OpenRouter를 사용하는 경우 확장 프로그램이 최신 모델 목록을 가져와 사용 가능한 즉시 최신 모델을 사용할 수 있습니다.

확장 프로그램은 전체 작업 루프와 개별 요청에 대한 총 토큰 및 API 사용 비용을 추적하여 매 단계마다 지출 정보를 제공합니다.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/81be79a8-1fdb-4028-9129-5fe055e01e76">

### 터미널에서 명령 실행

[VSCode v1.93의 새로운 셸 통합 업데이트](https://code.visualstudio.com/updates/v1_93#_terminal-shell-integration-api) 덕분에 Cline은 터미널에서 직접 명령을 실행하고 출력을 받을 수 있습니다. 이를 통해 패키지 설치 및 빌드 스크립트 실행부터 애플리케이션 배포, 데이터베이스 관리, 테스트 실행에 이르기까지 광범위한 작업을 수행할 수 있으며, 개발 환경과 툴체인에 적응하여 작업을 올바르게 완료합니다.

개발 서버와 같이 오래 실행되는 프로세스의 경우 "실행 중 계속" 버튼을 사용하여 명령이 백그라운드에서 실행되는 동안 Cline이 작업을 계속하도록 할 수 있습니다. Cline이 작업하는 동안 새로운 터미널 출력이 있으면 알림을 받아 파일 편집 시 컴파일 타임 오류와 같은 문제에 대응할 수 있습니다.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="400" src="https://github.com/user-attachments/assets/c5977833-d9b8-491e-90f9-05f9cd38c588">

### 파일 생성 및 편집

Cline은 편집기에서 직접 파일을 생성하고 편집할 수 있으며, 변경 사항의 diff 뷰를 제시합니다. diff 뷰 편집기에서 직접 Cline의 변경 사항을 편집하거나 되돌릴 수 있으며, 만족할 때까지 채팅으로 피드백을 제공할 수 있습니다. Cline은 린터/컴파일러 오류(누락된 import, 구문 오류 등)도 모니터링하여 발생하는 문제를 스스로 수정할 수 있습니다.

Cline이 수행한 모든 변경 사항은 파일의 타임라인에 기록되어 필요한 경우 수정 사항을 쉽게 추적하고 되돌릴 수 있습니다.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="370" src="https://github.com/user-attachments/assets/bc2e85ba-dfeb-4fe6-9942-7cfc4703cbe5">

### 브라우저 사용

Claude Sonnet의 새로운 [Computer Use](https://www.anthropic.com/news/3-5-models-and-computer-use) 기능을 통해 Cline은 브라우저를 실행하고 요소를 클릭하고 텍스트를 입력하고 스크롤하며 각 단계에서 스크린샷과 콘솔 로그를 캡처할 수 있습니다. 이를 통해 대화형 디버깅, 엔드투엔드 테스트, 일반적인 웹 사용까지 가능합니다! 이는 여러분이 직접 오류 로그를 복사하여 붙여넣을 필요 없이 시각적 버그와 런타임 문제를 수정할 수 있는 자율성을 제공합니다.

Cline에게 "앱 테스트"를 요청해보세요. `npm run dev`와 같은 명령을 실행하고 로컬에서 실행 중인 개발 서버를 브라우저에서 실행하며 모든 것이 작동하는지 확인하기 위해 일련의 테스트를 수행하는 것을 볼 수 있습니다. [데모 보기](https://x.com/sdrzn/status/1850880547825823989)

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/ac0efa14-5c1f-4c26-a42d-9d7c56f5fadd">

### "도구 추가..."

[Model Context Protocol](https://github.com/modelcontextprotocol) 덕분에 Cline은 사용자 지정 도구를 통해 기능을 확장할 수 있습니다. [커뮤니티 제작 서버](https://github.com/modelcontextprotocol/servers)를 사용할 수도 있지만, Cline은 특정 워크플로우에 맞춤화된 도구를 직접 만들고 설치할 수 있습니다. Cline에게 "도구 추가"를 요청하기만 하면 새 MCP 서버 생성부터 확장 프로그램에 설치하는 것까지 모든 것을 처리합니다. 이러한 사용자 지정 도구는 Cline의 툴킷의 일부가 되어 향후 작업에 사용할 수 있습니다.

-   "Jira 티켓을 가져오는 도구 추가": 티켓 AC를 검색하고 Cline에게 작업 시키기
-   "AWS EC2를 관리하는 도구 추가": 서버 메트릭 확인 및 인스턴스 확장/축소
-   "최신 PagerDuty 인시던트를 가져오는 도구 추가": 세부 정보를 가져와 Cline에게 버그 수정 요청

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="left" width="360" src="https://github.com/user-attachments/assets/7fdf41e6-281a-4b4b-ac19-020b838b6970">

### 컨텍스트 추가

**`@url`:** URL을 붙여넣어 확장 프로그램이 가져와서 마크다운으로 변환하도록 하여 Cline에게 최신 문서 제공

**`@problems`:** 워크스페이스 오류 및 경고('문제' 패널)를 추가하여 Cline이 수정하도록 함

**`@file`:** 파일 내용을 추가하여 파일 읽기 승인에 API 요청을 낭비하지 않음 (+ 파일 검색 입력)

**`@folder`:** 폴더의 파일을 한 번에 추가하여 워크플로우를 더욱 가속화

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

<img align="right" width="350" src="https://github.com/user-attachments/assets/140c8606-d3bf-41b9-9a1f-4dbf0d4c90cb">

### 체크포인트: 비교 및 복원

Cline이 작업을 진행하면서 확장 프로그램은 각 단계에서 워크스페이스의 스냅샷을 생성합니다. '비교' 버튼을 사용하여 스냅샷과 현재 워크스페이스 간의 diff를 볼 수 있으며, '복원' 버튼을 사용하여 해당 시점으로 롤백할 수 있습니다.

예를 들어 로컬 웹 서버로 작업할 때 '워크스페이스만 복원'을 사용하여 앱의 다른 버전을 빠르게 테스트한 다음, 계속 빌드하려는 버전을 찾으면 '작업 및 워크스페이스 복원'을 사용할 수 있습니다. 이를 통해 진행 상황을 잃지 않고 다양한 접근 방식을 안전하게 탐색할 수 있습니다.

<!-- Transparent pixel to create line break after floating image -->

<img width="2000" height="0" src="https://github.com/user-attachments/assets/ee14e6f7-20b8-4391-9091-8e8e25561929"><br>

## 기여하기

프로젝트에 기여하려면 [기여 가이드](CONTRIBUTING.md)를 참조하여 기본 사항을 배우세요. [Discord](https://discord.gg/cline)에 가입하여 `#contributors` 채널에서 다른 기여자들과 채팅할 수도 있습니다. 정규직 일자리를 찾고 있다면 [채용 페이지](https://cline.bot/join-us)에서 공개 채용 정보를 확인하세요!

## 엔터프라이즈

엔터프라이즈급 제어 기능을 갖춘 동일한 Cline 경험을 얻으세요: SSO(SAML/OIDC), 글로벌 정책 및 구성, 감사 추적을 통한 관찰 가능성, 프라이빗 네트워킹(VPC/프라이빗 링크), 자체 호스팅 또는 온프레미스 배포, 엔터프라이즈 지원. [엔터프라이즈 페이지](https://cline.bot/enterprise)에서 자세히 알아보거나 [문의하기](https://cline.bot/contact-sales).

## 라이선스

[Apache 2.0 © 2025 Cline Bot Inc.](./LICENSE)
