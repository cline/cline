# 🚀 MCP 빠른 시작 가이드

## ❓ MCP 서버란 무엇인가요?

MCP 서버는 Cline에 추가적인 기능을 제공하는 특별한 도우미라고 생각하세요! 이를 통해 Cline은 웹 페이지를 가져오거나 파일을 처리하는 등의 멋진 일을 할 수 있습니다.

## ⚠️ 중요: 시스템 요구 사항

정지! 계속 진행하기 전에 다음 요구 사항을 반드시 확인하세요:

### 필요한 소프트웨어

-   ✅ 최신 Node.js (v18 이상)

    -   확인 방법: `node --version` 실행
    -   설치: <https://nodejs.org/>에서

-   ✅ 최신 Python (v3.8 이상)

    -   확인 방법: `python --version` 실행
    -   설치: <https://python.org/>에서

-   ✅ UV 패키지 관리자
    -   Python 설치 후 `pip install uv` 실행
    -   확인 방법: `uv --version` 실행

❗ 이 명령 중 하나라도 실패하거나 오래된 버전을 표시하면 계속하기 전에 설치/업데이트하세요!

⚠️ 다른 오류가 발생하면 아래 "문제 해결" 섹션을 참조하세요.

## 🎯 빠른 단계 (요구 사항이 충족된 후에만!)

### 1. 🛠️ 첫 번째 MCP 서버 설치

1. Cline 확장 프로그램에서 `MCP 서버` 탭을 클릭하세요
1. `MCP 설정 편집` 버튼을 클릭하세요

 <img src="https://github.com/user-attachments/assets/abf908b1-be98-4894-8dc7-ef3d27943a47" alt="MCP 서버 패널" width="400" />

1. MCP 설정 파일이 VS Code의 탭에 표시되어야 합니다.
1. 파일 내용을 다음 코드로 교체하세요:

윈도우용:

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
		}
	}
}
```

맥 및 리눅스용:

```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "npx",
			"args": ["@anaisbetts/mcp-installer"]
		}
	}
}
```

파일을 저장한 후:

1. Cline이 변경 사항을 자동으로 감지합니다
2. MCP 설치 프로그램이 다운로드되고 설치됩니다
3. Cline이 MCP 설치 프로그램을 시작합니다
4. Cline의 MCP 설정 UI에서 서버 상태를 확인할 수 있습니다:

<img src="https://github.com/user-attachments/assets/2abbb3de-e902-4ec2-a5e5-9418ed34684e" alt="설치 프로그램이 있는 MCP 서버 패널" width="400" />

## 🤔 다음은 무엇인가요?

이제 MCP 설치 프로그램을 갖췄으니 Cline에게 다음 서버를 추가하도록 요청할 수 있습니다:

1. NPM 레지스트리: <https://www.npmjs.com/search?q=%40modelcontextprotocol>
2. 파이썬 패키지 인덱스: <https://pypi.org/search/?q=mcp+server-&o=>

예를 들어, 파이썬 패키지 인덱스에서 찾은 `mcp-server-fetch` 패키지를 Cline에게 설치하도록 요청할 수 있습니다:

```bash
"MCP 서버 `mcp-server-fetch`를 설치하세요
- MCP 설정을 업데이트하세요.
- 서버를 실행하기 위해 uvx 또는 python을 사용하세요."
```

Cline이 다음을 수행하는 것을 볼 수 있습니다:

1. `mcp-server-fetch` 파이썬 패키지를 설치합니다
1. mcp 설정 json 파일을 업데이트합니다
1. 서버를 시작하고 서버를 실행합니다

MCP 설정 파일은 이제 다음과 같이 보일 것입니다:

_윈도우 머신용:_
```json
{
	"mcpServers": {
		"mcp-installer": {
			"command": "cmd.exe",
			"args": ["/c", "npx", "-y", "@anaisbetts/mcp-installer"]
		},
		"mcp-server-fetch": {
			"command": "uvx",
			"args": ["mcp-server-fetch"]
		}
	}
}
```

MCP 서버의 상태를 확인하려면 MCP 서버 탭으로 이동하세요. 위의 이미지를 참조하세요.

축하합니다! 🎉 이제 Cline에 멋진 새 기능을 추가했습니다!

## 📝 문제 해결

### 1. `asdf`를 사용 중인데 "unknown command: npx" 오류가 발생합니다

약간의 나쁜 소식이 있습니다. MCP 서버 패키징이 조금 발전하지 않는 한, 여전히 작동하게 할 수 있지만 조금 더 수동 작업을 해야 합니다. 한 가지 옵션은 `asdf`를 제거하는 것이지만, 이를 원하지 않는다고 가정하겠습니다.

대신, 위의 지침을 따라 "MCP 설정 편집"을 해야 합니다. 그런 다음 [이 게시물](https://dev.to/cojiroooo/mcp-using-node-on-asdf-382n)에서 설명하는 것처럼 각 서버의 설정에 "env" 항목을 추가해야 합니다.

```json
"env": {
        "PATH": "/Users/<user_name>/.asdf/shims:/usr/bin:/bin",
        "ASDF_DIR": "<path_to_asdf_bin_dir>",
        "ASDF_DATA_DIR": "/Users/<user_name>/.asdf",
        "ASDF_NODEJS_VERSION": "<your_node_version>"
      }
```

`path_to_asdf_bin_dir`은 종종 셸 설정 파일(예: `.zshrc`)에서 찾을 수 있습니다. Homebrew를 사용하는 경우 `echo ${HOMEBREW_PREFIX}`를 사용하여 디렉토리의 시작 부분을 찾고 `/opt/asdf/libexec`를 추가할 수 있습니다.

좋은 소식도 있습니다. 완벽하지는 않지만, Cline이 이후 서버 설치 시 이를 꽤 신뢰성 있게 수행할 수 있습니다. Cline 설정의 "사용자 지정 지침"에 다음을 추가하세요(오른쪽 상단 도구 모음 버튼):

> MCP 서버를 설치하고 cline_mcp_settings.json을 편집할 때, 명령어로 `npx`를 사용해야 하는 서버가 있다면 "mcp-installer" 항목에서 "env" 항목을 복사하여 새 항목에 추가해야 합니다. 이는 서버가 제대로 작동하는 데 필수적입니다.

### 2. MCP 설치 프로그램을 실행할 때 여전히 오류가 발생합니다

MCP 설치 프로그램을 실행할 때 오류가 발생하면 다음을 시도해 보세요:

- MCP 설정 파일에서 오류를 확인하세요
- MCP 서버 문서를 읽고 MCP 설정 파일이 올바른 명령어와 인수를 사용하는지 확인하세요. 👈
- 터미널을 사용하여 명령어와 인수를 직접 실행하세요. 이렇게 하면 Cline이 보는 것과 동일한 오류를 볼 수 있습니다.