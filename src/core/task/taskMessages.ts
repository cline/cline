import { DEFAULT_LANGUAGE_SETTINGS, LanguageKey } from "@shared/Languages"

export type TaskMessageKey =
	| "checkpointUnsupportedMultiRoot"
	| "checkpointManagerInitFailed"
	| "checkpointInitTimedOut"
	| "unknownError"
	| "hookExecutionCancelled"
	| "contextWindowExceededRetry"
	| "yoloTooManyMistakes"
	| "errorSubtitle"
	| "taskTroubleContinue"
	| "mistakeLimitClaudeGuidance"
	| "mistakeLimitOtherModelsGuidance"
	| "newruleProcessingIssue"
	| "loading"
	| "responseInterruptedApiError"
	| "responseInterruptedUser"
	| "responseInterruptedUserFeedback"
	| "responseInterruptedToolUse"
	| "invalidApiResponse"
	| "failureNoResponse"
	| "noAssistantMessageRetry"
	| "missingToolParamError"
	| "missingToolParamPathPart"

type TaskMessageParams = Record<string, string | number>

const messages: Record<string, Record<TaskMessageKey, string>> = {
	en: {
		checkpointUnsupportedMultiRoot: "Checkpoints are not currently supported in multi-root workspaces.",
		checkpointManagerInitFailed: "Failed to initialize checkpoint manager: {{error}}",
		checkpointInitTimedOut: "Checkpoint initialization timed out: {{error}}",
		unknownError: "Unknown error",
		hookExecutionCancelled: "Hook execution cancelled by user",
		contextWindowExceededRetry: "Context window exceeded. Click retry to truncate the conversation and try again.",
		yoloTooManyMistakes:
			"[YOLO MODE] Task failed: Too many consecutive mistakes ({{count}}). The model may not be capable enough for this task. Consider using a more capable model.",
		errorSubtitle: "Error",
		taskTroubleContinue: "Cline is having trouble. Would you like to continue the task?",
		mistakeLimitClaudeGuidance:
			'This may indicate a failure in his thought process or inability to use a tool properly, which can be mitigated with some user guidance (e.g. "Try breaking down the task into smaller steps").',
		mistakeLimitOtherModelsGuidance:
			"Cline uses complex prompts and iterative task execution that may be challenging for less capable models. For best results, it's recommended to use Claude 4 Sonnet for its advanced agentic coding capabilities.",
		newruleProcessingIssue:
			"Issue with processing the /newrule command. Double check that, if '.clinerules' already exists, it's a directory and not a file. Otherwise there was an issue referencing this file/directory.",
		loading: "Loading...",
		responseInterruptedApiError: "Response interrupted by API Error",
		responseInterruptedUser: "Response interrupted by user",
		responseInterruptedUserFeedback: "Response interrupted by user feedback",
		responseInterruptedToolUse:
			"Response interrupted by a tool use result. Only one tool may be used at a time and should be placed at the end of the message.",
		invalidApiResponse:
			"Invalid API Response: The provider returned an empty or unparsable response. This is a provider-side issue where the model failed to generate valid output or returned tool calls that Cline cannot process. Retrying the request may help resolve this issue.",
		failureNoResponse: "Failure: I did not provide a response.",
		noAssistantMessageRetry: "No assistant message was received. Would you like to retry the request?",
		missingToolParamError:
			"Cline tried to use {{toolName}}{{pathPart}} without value for required parameter '{{paramName}}'. Retrying...",
		missingToolParamPathPart: " for '{{path}}'",
	},
	ko: {
		checkpointUnsupportedMultiRoot: "체크포인트는 멀티 루트 워크스페이스에서 현재 지원되지 않습니다.",
		checkpointManagerInitFailed: "체크포인트 매니저 초기화에 실패했습니다: {{error}}",
		checkpointInitTimedOut: "체크포인트 초기화 시간이 초과되었습니다: {{error}}",
		unknownError: "알 수 없는 오류",
		hookExecutionCancelled: "사용자에 의해 훅 실행이 취소되었습니다",
		contextWindowExceededRetry: "컨텍스트 창 한도를 초과했습니다. 대화를 잘라내고 다시 시도하려면 재시도를 클릭하세요.",
		yoloTooManyMistakes:
			"[YOLO 모드] 작업 실패: 연속 실수가 너무 많습니다 ({{count}}). 이 작업에 모델의 역량이 부족할 수 있습니다. 더 성능이 좋은 모델을 사용해 보세요.",
		errorSubtitle: "오류",
		taskTroubleContinue: "Cline에 문제가 발생했습니다. 작업을 계속하시겠습니까?",
		mistakeLimitClaudeGuidance:
			'이는 사고 과정의 실패 또는 도구를 제대로 사용하지 못한 것을 의미할 수 있습니다. 사용자 가이드를 제공하면 완화될 수 있습니다(예: "작업을 더 작은 단계로 나눠 보세요").',
		mistakeLimitOtherModelsGuidance:
			"Cline은 복잡한 프롬프트와 반복적 작업 실행을 사용하므로 성능이 낮은 모델에서는 어렵습니다. 최상의 결과를 위해 고급 에이전트형 코딩 기능을 가진 Claude 4 Sonnet 사용을 권장합니다.",
		newruleProcessingIssue:
			"/newrule 명령 처리 중 문제가 발생했습니다. '.clinerules'가 이미 존재한다면 파일이 아니라 디렉터리인지 확인하세요. 또는 이 파일/디렉터리를 참조하는 과정에서 문제가 발생했습니다.",
		loading: "로딩 중...",
		responseInterruptedApiError: "API 오류로 응답이 중단됨",
		responseInterruptedUser: "사용자에 의해 응답이 중단됨",
		responseInterruptedUserFeedback: "사용자 피드백으로 응답이 중단됨",
		responseInterruptedToolUse:
			"도구 사용 결과로 응답이 중단되었습니다. 한 번에 하나의 도구만 사용할 수 있으며 메시지 끝에 배치해야 합니다.",
		invalidApiResponse:
			"잘못된 API 응답: 제공자가 비어 있거나 파싱할 수 없는 응답을 반환했습니다. 이는 모델이 유효한 출력을 생성하지 못했거나 Cline이 처리할 수 없는 도구 호출을 반환한 제공자 측 문제입니다. 요청을 다시 시도하면 해결될 수 있습니다.",
		failureNoResponse: "실패: 응답을 제공하지 못했습니다.",
		noAssistantMessageRetry: "어시스턴트 메시지를 받지 못했습니다. 요청을 다시 시도하시겠습니까?",
		missingToolParamError:
			"Cline이 {{toolName}}{{pathPart}}에 필요한 매개변수 '{{paramName}}' 값을 제공하지 못했습니다. 재시도 중...",
		missingToolParamPathPart: " '{{path}}'",
	},
}

const interpolate = (template: string, params?: TaskMessageParams) => {
	if (!params) {
		return template
	}
	return Object.entries(params).reduce(
		(result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
		template,
	)
}

export const getTaskMessage = (key: TaskMessageKey, language: LanguageKey | undefined, params?: TaskMessageParams) => {
	const locale = language || DEFAULT_LANGUAGE_SETTINGS
	const translations = messages[locale] || messages[DEFAULT_LANGUAGE_SETTINGS]
	const template = translations?.[key] || messages[DEFAULT_LANGUAGE_SETTINGS][key]
	return interpolate(template, params)
}
