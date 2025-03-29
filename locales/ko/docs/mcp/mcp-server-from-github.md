# GitHub 저장소에서 MCP 서버 구축하기

이 가이드는 Cline을 사용하여 GitHub 저장소에서 기존 MCP 서버를 구축하는 단계별 안내를 제공합니다.

## **MCP 서버 찾기**

온라인에서 MCP 서버를 찾을 수 있는 여러 장소가 있습니다:

-   **Cline은 MCP 서버를 자동으로 목록에 추가할 수 있으며, 이를 편집할 수 있습니다.** Cline은 GitHub에서 직접 저장소를 복제하고 서버를 구축할 수 있습니다.
-   **GitHub:** GitHub에서 MCP 서버를 찾을 수 있는 가장 일반적인 두 곳은 다음과 같습니다:
    -   [공식 MCP 서버 저장소](https://github.com/modelcontextprotocol/servers)
    -   [Awesome-MCP 서버 저장소](https://github.com/punkpeye/awesome-mcp-servers)
-   **온라인 디렉토리:** 여러 웹사이트에서 MCP 서버를 나열합니다:

    -   [mcpservers.org](https://mcpservers.org/)
    -   [mcp.so](https://mcp.so/)
    -   [glama.ai/mcp/servers](https://glama.ai/mcp/servers)

    이러한 디렉토리는 다운로드 수, 날짜, 별점, 사용 사례 등 다양한 기준으로 서버를 정렬할 수 있게 해줍니다. 각 항목은 기능, 도구 및 구성 지침과 같은 정보를 제공합니다.

-   **PulseMCP:** 이 웹사이트에는 AI가 MCP 서버를 사용하여 웹사이트를 쓸모없게 만들 수 있는 방법에 대해 논의하는 블로그 글이 있습니다. PulseMCP에는 MCP 서버에 대한 FAQ 섹션도 포함되어 있습니다: [https://www.pulsemcp.com/](https://www.pulsemcp.com/)

## **Cline으로 구축하기**

1.  **프로세스 시작:** Cline에 다음 정보를 제공하십시오:
    -   **GitHub 저장소 URL:** 서버 저장소의 URL입니다.
    -   **README.md 내용:** 이는 선택 사항이지만 서버의 목적과 구성을 이해하는 데 도움이 됩니다. GitHub 저장소에서 README.md 파일을 복사할 수 있습니다.
2.  **Cline과의 예시 상호작용:**

    ```
    User: "Cline, 나는 Brave 브라우저 제어를 위한 MCP 서버를 추가하고 싶어. 여기 GitHub 링크야: https://github.com/modelcontextprotocol/servers/tree/main/src/brave 추가할 수 있어?"

    Cline: "확인. MCP 디렉토리에 저장소를 복제 중입니다. 'package.json' 파일이 있어서 빌드해야 합니다. 'npm run build'를 실행할까요?"

    User: "네, 빌드해 주세요."

    Cline: "빌드 완료. 이 서버는 브라우저 경로가 필요합니다. Brave 브라우저 실행 파일이 어디에 있나요?"

    User: "'/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'에 있습니다."

    Cline: "확인. 그 경로로 서버 설정을 업데이트하고 'cline_mcp_settings.json'에 추가했습니다. 다른 요청 있으신가요?"

    User: "아니요, 그게 다예요. 테스트해 봅시다."

    Cline: "좋습니다! 서버 연결을 테스트하기 위해 MCP Inspector를 시작합니다. 그 후에 Cline에서 브라우저를 제어해 볼 수 있습니다."
    ```
3. **Cline의 행동:** 귀하의 지시에 따라 Cline은 다음과 같은 작업을 수행합니다:
    - **저장소 복제:** Cline은 귀하의 로컬 머신에 저장소를 복제하며, 일반적으로 설정에 지정된 디렉토리에 복제합니다.
    - **조정:** Cline에게 서버의 구성을 수정하도록 지시할 수 있습니다. 예를 들어:
        - **사용자:** "이 서버에는 API 키가 필요합니다. 어디에 추가해야 하는지 찾을 수 있나요?"
        - Cline은 귀하의 지시에 따라 `cline_mcp_settings.json` 파일이나 다른 관련 파일을 자동으로 업데이트할 수 있습니다.
    - **서버 빌드:** Cline은 서버에 적합한 빌드 명령어를 실행하며, 일반적으로 `npm run build`입니다.
    - **설정에 서버 추가:** Cline은 서버의 구성을 `cline_mcp_settings.json` 파일에 추가합니다.

## **테스트 및 문제 해결**

1. **서버 테스트:** Cline이 빌드 프로세스를 완료하면 서버를 테스트하여 예상대로 작동하는지 확인하십시오. 문제가 발생하면 Cline이 도와줄 수 있습니다.
2. **MCP 인스펙터:** MCP 인스펙터를 사용하여 서버의 연결 및 기능을 테스트할 수 있습니다.

## **최적의 방법**

- **기본 이해:** Cline이 프로세스를 단순화하지만, 서버의 코드, MCP 프로토콜(), 서버를 구성하는 방법에 대한 기본적인 이해가 있으면 문제 해결과 사용자 정의가 더 효과적입니다.
- **명확한 지시:** 프로세스 내내 Cline에게 명확하고 구체적인 지시를 제공하십시오.
- **테스트:** 설치 및 구성 후 서버를 철저히 테스트하여 정상적으로 작동하는지 확인하십시오.
- **버전 관리:** 서버 코드의 변경 사항을 추적하기 위해 버전 관리 시스템(예: Git)을 사용하십시오.
- **최신 상태 유지:** 최신 기능과 보안 패치를 활용하기 위해 MCP 서버를 최신 상태로 유지하십시오.