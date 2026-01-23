// Error message translations
export const errorMessages = {
	en: {
		// General errors
		somethingWentWrong: "Something went wrong",
		error: "Error",
		unknownError: "Unknown error",

		// API errors
		apiRequestFailed: "API Request Failed",
		apiRequestCancelled: "API Request Cancelled",
		networkError: "Network error: Unable to connect to the API server. Please check your internet connection and try again.",
		streamingError: "Streaming error: Connection was interrupted while receiving the response.",

		// Authentication errors
		authenticationFailed: "Authentication failed. Please sign in to continue.",
		signInRequired: "Please sign in to access Cline services.",
		signInToCline: "Sign in to Cline",
		clickRetryBelow: "Click retry below",

		// Credit/Balance errors
		creditLimitReached: "Credit Limit Reached",
		insufficientCredits: "Insufficient credits to complete this request.",
		outOfCredits: "You have run out of credits.",
		currentBalance: "Current Balance",
		totalSpent: "Total Spent",
		totalPromotions: "Total Promotions",
		buyCredits: "Buy Credits",
		retryRequest: "Retry Request",

		// Rate limit errors
		rateLimitExceeded: "Rate limit exceeded. Please wait before making another request.",
		requestId: "Request ID",

		// File operation errors
		diffError: "The model used search patterns that don't match anything in the file. Retrying...",
		clineignoreError: "Cline tried to access {{file}}, but it's blocked by {{clineignore}}.",
		fileNotFound: "File not found",
		fileReadError: "Failed to read file",
		fileWriteError: "Failed to write file",

		// Command errors
		commandFailed: "Command execution failed",
		commandTimeout: "Command timed out",
		shellIntegrationUnavailable: "Shell Integration Unavailable",
		shellIntegrationWarning:
			'Cline may have trouble viewing the command\'s output. Please update VSCode (CMD/CTRL + Shift + P → "Update") and make sure you\'re using a supported shell: zsh, bash, fish, or PowerShell (CMD/CTRL + Shift + P → "Terminal: Select Default Profile").',
		stillHavingTrouble: "Still having trouble?",

		// PowerShell specific
		powershellNotRecognized: "PowerShell is not recognized as an internal or external command",
		powershellIssue: "This appears to be a PowerShell configuration issue. Please see our",
		troubleshootingGuide: "troubleshooting guide",

		// Browser errors
		browserConnectionFailed: "Failed to connect to browser",
		browserActionFailed: "Browser action failed",

		// MCP errors
		mcpServerError: "MCP server error",
		mcpConnectionFailed: "Failed to connect to MCP server",

		// Validation errors
		validationError: "Validation error",
		invalidInput: "Invalid input",
		requiredField: "This field is required",

		// Recording errors
		recordingFailed: "Failed to start recording",
		recordingStopFailed: "Failed to stop recording",
		recordingCancelFailed: "Failed to cancel recording",
		noAudioData: "No audio data received",
		transcriptionFailed: "Transcription failed",

		// Checkpoint errors
		checkpointRestoreFailed: "Failed to restore checkpoint",
		checkpointSaveFailed: "Failed to save checkpoint",

		// Task errors
		taskCancelled: "Task was cancelled",
		taskFailed: "Task failed",
		mistakeLimitReached: "Cline is having trouble...",

		// Generic action errors
		actionFailed: "Action failed",
		operationFailed: "Operation failed",
		unexpectedError: "An unexpected error occurred",
	},
	ko: {
		// 일반 오류
		somethingWentWrong: "문제가 발생했습니다",
		error: "오류",
		unknownError: "알 수 없는 오류",

		// API 오류
		apiRequestFailed: "API 요청 실패",
		apiRequestCancelled: "API 요청 취소됨",
		networkError: "네트워크 오류: API 서버에 연결할 수 없습니다. 인터넷 연결을 확인하고 다시 시도해주세요.",
		streamingError: "스트리밍 오류: 응답을 받는 중 연결이 끊어졌습니다.",

		// 인증 오류
		authenticationFailed: "인증에 실패했습니다. 계속하려면 로그인해주세요.",
		signInRequired: "Cline 서비스를 이용하려면 로그인해주세요.",
		signInToCline: "Cline에 로그인",
		clickRetryBelow: "아래 재시도 버튼을 클릭하세요",

		// 크레딧/잔액 오류
		creditLimitReached: "크레딧 한도 도달",
		insufficientCredits: "이 요청을 완료하기에 크레딧이 부족합니다.",
		outOfCredits: "크레딧이 모두 소진되었습니다.",
		currentBalance: "현재 잔액",
		totalSpent: "총 사용액",
		totalPromotions: "총 프로모션",
		buyCredits: "크레딧 구매",
		retryRequest: "요청 재시도",

		// 속도 제한 오류
		rateLimitExceeded: "속도 제한을 초과했습니다. 잠시 후 다시 시도해주세요.",
		requestId: "요청 ID",

		// 파일 작업 오류
		diffError: "모델이 파일에서 일치하는 항목이 없는 검색 패턴을 사용했습니다. 재시도 중...",
		clineignoreError: "Cline이 {{file}}에 접근하려 했지만 {{clineignore}}에 의해 차단되었습니다.",
		fileNotFound: "파일을 찾을 수 없음",
		fileReadError: "파일 읽기 실패",
		fileWriteError: "파일 쓰기 실패",

		// 명령 오류
		commandFailed: "명령 실행 실패",
		commandTimeout: "명령 시간 초과",
		shellIntegrationUnavailable: "셸 통합을 사용할 수 없음",
		shellIntegrationWarning:
			'Cline이 명령 출력을 보는 데 문제가 있을 수 있습니다. VSCode를 업데이트하고(CMD/CTRL + Shift + P → "Update") 지원되는 셸(zsh, bash, fish 또는 PowerShell)을 사용하고 있는지 확인하세요(CMD/CTRL + Shift + P → "Terminal: Select Default Profile").',
		stillHavingTrouble: "여전히 문제가 있나요?",

		// PowerShell 관련
		powershellNotRecognized: "PowerShell이 내부 또는 외부 명령으로 인식되지 않습니다",
		powershellIssue: "PowerShell 구성 문제로 보입니다. 다음을 참조하세요",
		troubleshootingGuide: "문제 해결 가이드",

		// 브라우저 오류
		browserConnectionFailed: "브라우저 연결 실패",
		browserActionFailed: "브라우저 작업 실패",

		// MCP 오류
		mcpServerError: "MCP 서버 오류",
		mcpConnectionFailed: "MCP 서버 연결 실패",

		// 유효성 검사 오류
		validationError: "유효성 검사 오류",
		invalidInput: "잘못된 입력",
		requiredField: "필수 항목입니다",

		// 녹음 오류
		recordingFailed: "녹음 시작 실패",
		recordingStopFailed: "녹음 중지 실패",
		recordingCancelFailed: "녹음 취소 실패",
		noAudioData: "오디오 데이터를 받지 못했습니다",
		transcriptionFailed: "음성 변환 실패",

		// 체크포인트 오류
		checkpointRestoreFailed: "체크포인트 복원 실패",
		checkpointSaveFailed: "체크포인트 저장 실패",

		// 작업 오류
		taskCancelled: "작업이 취소되었습니다",
		taskFailed: "작업 실패",
		mistakeLimitReached: "Cline에 문제가 발생했습니다...",

		// 일반 작업 오류
		actionFailed: "작업 실패",
		operationFailed: "작업 실패",
		unexpectedError: "예기치 않은 오류가 발생했습니다",
	},
}
