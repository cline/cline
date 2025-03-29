# Cline 도구 참조 가이드

## Cline이 무엇을 할 수 있나요?

Cline은 다음과 같은 작업을 수행할 수 있는 AI 어시스턴트입니다:

-   프로젝트 내 파일 편집 및 생성
-   터미널 명령 실행
-   코드 검색 및 분석
-   디버깅 및 문제 해결 도움
-   반복적인 작업 자동화
-   외부 도구와의 통합

## 첫 걸음

1. **작업 시작**

    - 채팅에 요청을 입력하세요
    - 예: "Header라는 이름의 새로운 React 컴포넌트를 생성하세요"

2. **컨텍스트 제공**

    - 파일, 폴더 또는 URL을 추가하려면 @ 멘션을 사용하세요
    - 예: "@file:src/components/App.tsx"

3. **변경 사항 검토**
    - Cline은 변경하기 전에 차이를 보여줍니다
    - 변경 사항을 편집하거나 거부할 수 있습니다

## 주요 기능

1. **파일 편집**

    - 새 파일 생성
    - 기존 코드 수정
    - 파일 전체에서 검색 및 교체

2. **터미널 명령**

    - npm 명령 실행
    - 개발 서버 시작
    - 종속성 설치

3. **코드 분석**

    - 오류 찾기 및 수정
    - 코드 리팩토링
    - 문서 추가

4. **브라우저 통합**
    - 웹 페이지 테스트
    - 스크린샷 캡처
    - 콘솔 로그 검사

## 사용 가능한 도구

최신 구현 세부 사항을 보려면 [Cline 저장소](https://github.com/cline/cline/blob/main/src/core/Cline.ts)에서 전체 소스 코드를 확인할 수 있습니다.

Cline은 다양한 작업을 위해 다음 도구에 접근할 수 있습니다:

1. **파일 작업**

    - `write_to_file`: 파일 생성 또는 덮어쓰기
    - `read_file`: 파일 내용 읽기
    - `replace_in_file`: 파일에 대한 대상 편집
    - `search_files`: 정규 표현식을 사용하여 파일 검색
    - `list_files`: 디렉토리 내용 나열

2. **터미널 작업**

    - `execute_command`: CLI 명령 실행
    - `list_code_definition_names`: 코드 정의 나열

3. **MCP 도구**

    - `use_mcp_tool`: MCP 서버의 도구 사용
    - `access_mcp_resource`: MCP 서버 리소스 접근
    - 사용자는 Cline이 접근할 수 있는 사용자 정의 MCP 도구를 생성할 수 있습니다
    - 예: Cline이 예보를 가져올 수 있는 날씨 API 도구 생성

4. **상호작용 도구**
    - `ask_followup_question`: 사용자에게 추가 질문
    - `attempt_completion`: 최종 결과 제시

각 도구는 특정 매개변수와 사용 패턴을 가지고 있습니다. 다음은 몇 가지 예입니다:

-   새 파일 생성 (write_to_file):

    ```xml
    <write_to_file>
    <path>src/components/Header.tsx</path>
    <content>
    // Header 컴포넌트 코드
    </content>
    </write_to_file>
    ```

-   패턴 검색 (search_files):

    ```xml
    <search_files>
    <path>src</path>
    <regex>function\s+\w+\(</regex>
    <file_pattern>*.ts</file_pattern>
    </search_files>
    ```

-   명령 실행 (execute_command):
    ```xml
    <execute_command>
    <command>npm install axios</command>
    <requires_approval>false</requires_approval>
    </execute_command>
    ```

## 일반적인 작업

1. **새 컴포넌트 생성**

    - "Footer라는 이름의 새로운 React 컴포넌트를 생성하세요"

2. **버그 수정**

    - "src/utils/format.ts의 오류를 수정하세요"

3. **코드 리팩토링**

    - "Button 컴포넌트를 TypeScript를 사용하도록 리팩토링하세요"

4. **명령 실행**
    - "axios를 추가하기 위해 npm install 실행"

## 도움 받기

-   [Discord 커뮤니티에 가입](https://discord.gg/cline)
-   문서 확인
-   Cline 개선을 위한 피드백 제공