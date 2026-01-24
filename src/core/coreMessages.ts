import { DEFAULT_LANGUAGE_SETTINGS, LanguageKey } from "@shared/Languages"

export type CoreMessageKey =
	| "commonCancel"
	| "commonDismiss"
	| "commonRetry"
	| "commonYes"
	| "commonNo"
	| "mentionFetchErrorForUrl"
	| "diffTitleNewChanges"
	| "diffTitleChangesSinceSnapshot"
	| "diffNoChangesFound"
	| "diffRetrieveFailed"
	| "diffUnexpectedNoCheckpointHash"
	| "resetGlobalState"
	| "resetWorkspaceState"
	| "resetStateSuccess"
	| "resetStateFailed"
	| "devServerNotRunning"
	| "logoutSuccessCline"
	| "logoutFailedCline"
	| "logoutSuccessOca"
	| "logoutFailedOca"
	| "loginFailedCline"
	| "loginFailedOca"
	| "mcpAuthSuccess"
	| "mcpAuthFailed"
	| "explainSelectCode"
	| "improveSelectCode"
	| "deleteTasksConfirmSingle"
	| "deleteTasksConfirmMultiple"
	| "deleteTasksOptionDelete"
	| "deleteAllPrompt"
	| "deleteAllOptionExceptFavorites"
	| "deleteAllOptionEverything"
	| "deleteAllNoFavoritesConfirm"
	| "deleteAllNoFavoritesOptionDeleteAll"
	| "deleteAllError"
	| "explainChangesNoActiveTask"
	| "explainChangesCheckpointsNotEnabled"
	| "explainChangesCheckpointsDisabled"
	| "explainChangesMessageStateHandlerUnavailable"
	| "explainChangesCheckpointTrackerUnavailable"
	| "explainChangesNoCheckpointHash"
	| "explainChangesNoChangesFound"
	| "explainChangesApiConfigUnavailable"
	| "explainChangesTitle"
	| "explainChangesFailed"
	| "terminalProfileClosedSingle"
	| "terminalProfileClosedMultiple"
	| "terminalProfileBusySingle"
	| "terminalProfileBusyMultiple"
	| "installCliFailed"
	| "createSkillAlreadyExists"
	| "fileTypeRule"
	| "fileTypeWorkflow"
	| "ruleFileDeleted"
	| "ruleFileAlreadyExists"
	| "ruleFileCreated"
	| "ruleScopeGlobal"
	| "ruleScopeWorkspace"
	| "checkpointRestoreFailed"
	| "stateManagerLoadTaskSettingsFailed"
	| "ocaNotAuthenticated"
	| "ocaNotAuthenticatedError"
	| "ocaNoModelsFound"
	| "ocaModelsRefreshed"
	| "ocaFetchFailed"
	| "ocaServiceErrorStatus"
	| "ocaBackendUnavailable"
	| "ocaRefreshError"
	| "subagentsUnsupportedPlatform"
	| "reconstructConfirm"
	| "reconstructOptionConfirm"
	| "reconstructing"
	| "reconstructWarnings"
	| "reconstructSuccess"
	| "reconstructFailed"
	| "reconstructNoTasksDir"
	| "reconstructNoTaskDirs"
	| "reconstructScanFailed"
	| "reconstructTaskFailed"
	| "reconstructUntitledTask"
	| "workspaceInitFailedFallback"
	| "openAiCodexSignInSuccess"
	| "openAiCodexSignInFailed"
	| "dictationInstallCopied"
	| "dictationDependencyRequired"
	| "dictationInstallWithCline"
	| "dictationCopyCommand"
	| "dictationSignInCline"
	| "dictationError"
	| "dictationSignInRequired"
	| "unknownErrorOccurred"

type CoreMessageParams = Record<string, string | number>

const messages: Record<string, Record<CoreMessageKey, string>> = {
	en: {
		commonCancel: "Cancel",
		commonDismiss: "Dismiss",
		commonRetry: "Retry",
		commonYes: "Yes",
		commonNo: "No",
		mentionFetchErrorForUrl: "Error fetching content for {{url}}: {{error}}",
		diffTitleNewChanges: "New changes",
		diffTitleChangesSinceSnapshot: "Changes since snapshot",
		diffNoChangesFound: "No changes found",
		diffRetrieveFailed: "Failed to retrieve diff set: {{error}}",
		diffUnexpectedNoCheckpointHash: "Unexpected error: No checkpoint hash found",
		resetGlobalState: "Resetting global state...",
		resetWorkspaceState: "Resetting workspace state...",
		resetStateSuccess: "State reset",
		resetStateFailed: "Failed to reset state: {{error}}",
		devServerNotRunning:
			"Cline: Local webview dev server is not running, HMR will not work. Please run 'npm run dev:webview' before launching the extension to enable HMR. Using bundled assets.",
		logoutSuccessCline: "Successfully logged out of Cline",
		logoutFailedCline: "Logout failed",
		logoutSuccessOca: "Successfully logged out of OCA",
		logoutFailedOca: "OCA Logout failed",
		loginFailedCline: "Failed to log in to Cline",
		loginFailedOca: "Failed to log in to OCA",
		mcpAuthSuccess: "Successfully authenticated MCP server",
		mcpAuthFailed: "Failed to authenticate MCP server",
		explainSelectCode: "Please select some code to explain.",
		improveSelectCode: "Please select some code to improve.",
		deleteTasksConfirmSingle: "Are you sure you want to delete this task? This action cannot be undone.",
		deleteTasksConfirmMultiple: "Are you sure you want to delete these {{count}} tasks? This action cannot be undone.",
		deleteTasksOptionDelete: "Delete",
		deleteAllPrompt: "What would you like to delete?",
		deleteAllOptionExceptFavorites: "Delete All Except Favorites",
		deleteAllOptionEverything: "Delete Everything",
		deleteAllNoFavoritesConfirm: "No favorited tasks found. Would you like to delete all tasks anyway?",
		deleteAllNoFavoritesOptionDeleteAll: "Delete All Tasks",
		deleteAllError:
			"Encountered error while deleting task history, there may be some files left behind. Error: {{error}}",
		explainChangesNoActiveTask: "No active task",
		explainChangesCheckpointsNotEnabled: "Checkpoints not enabled",
		explainChangesCheckpointsDisabled: "Checkpoints are disabled in settings. Cannot review changes.",
		explainChangesMessageStateHandlerUnavailable: "Message state handler not available",
		explainChangesCheckpointTrackerUnavailable: "Checkpoint tracker not available",
		explainChangesNoCheckpointHash: "Unexpected error: No checkpoint hash found",
		explainChangesNoChangesFound: "No changes found to review",
		explainChangesApiConfigUnavailable: "API configuration not available",
		explainChangesTitle: "Explain Changes",
		explainChangesFailed: "Failed to explain changes: {{error}}",
		terminalProfileClosedSingle: "Closed {{count}} terminal with different profile.",
		terminalProfileClosedMultiple: "Closed {{count}} terminals with different profile.",
		terminalProfileBusySingle:
			"{{count}} busy terminal has a different profile. Close it to use the new profile for all commands.",
		terminalProfileBusyMultiple:
			"{{count}} busy terminals have a different profile. Close them to use the new profile for all commands.",
		installCliFailed: "Failed to start CLI installation: {{error}}",
		createSkillAlreadyExists: 'Skill "{{name}}" already exists',
		fileTypeRule: "rule",
		fileTypeWorkflow: "workflow",
		ruleFileDeleted: '{{fileType}} file "{{fileName}}" deleted successfully',
		ruleFileAlreadyExists: '{{fileType}} file "{{fileName}}" already exists.',
		ruleFileCreated: "Created new {{scope}} {{fileType}} file: {{fileName}}",
		ruleScopeGlobal: "global",
		ruleScopeWorkspace: "workspace",
		checkpointRestoreFailed: "Failed to restore checkpoint",
		stateManagerLoadTaskSettingsFailed: "Failed to load task settings, defaulting to globally selected settings.",
		ocaNotAuthenticated: "Not authenticated with OCA. Please sign in first.",
		ocaNotAuthenticatedError: "Not authenticated with OCA",
		ocaNoModelsFound: "No models found. Did you set up your OCA access (possibly through entitlements)?",
		ocaModelsRefreshed: "Refreshed OCA models from {{baseUrl}}",
		ocaFetchFailed: "Failed to fetch OCA models. Please check your configuration from {{baseUrl}}",
		ocaServiceErrorStatus:
			"Did you set up your OCA access (possibly through entitlements)? OCA service returned {{status}} {{statusText}}.",
		ocaBackendUnavailable:
			"Unable to access the OCA backend. Is your endpoint and proxy configured properly? Please see the troubleshooting guide.",
		ocaRefreshError: "Error refreshing OCA models. {{details}} opc-request-id: {{requestId}}",
		subagentsUnsupportedPlatform: "CLI subagents are only supported on macOS and Linux platforms",
		reconstructConfirm:
			"This will rebuild your task history from existing task data. This operation will backup your current task history and attempt to reconstruct it from task folders. Continue?",
		reconstructOptionConfirm: "Yes, Reconstruct",
		reconstructing: "Reconstructing task history...",
		reconstructWarnings:
			"Reconstruction completed with warnings:\n- Reconstructed: {{reconstructed}} tasks\n- Skipped: {{skipped}} tasks\n- Errors: {{errors}}\n\nFirst few errors:\n{{errorList}}",
		reconstructSuccess:
			"Task history successfully reconstructed! Found and restored {{reconstructed}} tasks.",
		reconstructFailed: "Failed to reconstruct task history: {{error}}",
		reconstructNoTasksDir: "No tasks directory found. Nothing to reconstruct.",
		reconstructNoTaskDirs: "No task directories found. Nothing to reconstruct.",
		reconstructScanFailed: "Failed to scan tasks directory: {{error}}",
		reconstructTaskFailed: "Failed to reconstruct task {{taskId}}: {{error}}",
		reconstructUntitledTask: "Untitled Task",
		workspaceInitFailedFallback: "Failed to initialize workspace. Using single folder mode.",
		openAiCodexSignInSuccess: "Successfully signed in to OpenAI Codex",
		openAiCodexSignInFailed: "OpenAI Codex sign in failed: {{error}}",
		dictationInstallCopied: "Installation command copied to clipboard: {{command}}",
		dictationDependencyRequired: "{{dependency}} is required for voice recording. {{description}}",
		dictationInstallWithCline: "Install with Cline",
		dictationCopyCommand: "Copy Command",
		dictationSignInCline: "Sign in to Cline",
		dictationError: "Voice recording error: {{error}}",
		dictationSignInRequired: "Please sign in to your Cline Account to use Dictation.",
		unknownErrorOccurred: "Unknown error occurred",
	},
	ko: {
		commonCancel: "취소",
		commonDismiss: "닫기",
		commonRetry: "재시도",
		commonYes: "예",
		commonNo: "아니오",
		mentionFetchErrorForUrl: "{{url}} 콘텐츠를 가져오는 중 오류가 발생했습니다: {{error}}",
		diffTitleNewChanges: "새 변경사항",
		diffTitleChangesSinceSnapshot: "스냅샷 이후 변경사항",
		diffNoChangesFound: "변경사항이 없습니다",
		diffRetrieveFailed: "변경사항을 불러오지 못했습니다: {{error}}",
		diffUnexpectedNoCheckpointHash: "예상치 못한 오류: 체크포인트 해시가 없습니다",
		resetGlobalState: "전역 상태를 초기화하는 중...",
		resetWorkspaceState: "워크스페이스 상태를 초기화하는 중...",
		resetStateSuccess: "상태가 초기화되었습니다",
		resetStateFailed: "상태 초기화에 실패했습니다: {{error}}",
		devServerNotRunning:
			"Cline: 로컬 웹뷰 개발 서버가 실행 중이 아니어서 HMR이 동작하지 않습니다. 확장 실행 전에 'npm run dev:webview'를 실행해 HMR을 활성화하세요. 번들된 에셋을 사용합니다.",
		logoutSuccessCline: "Cline에서 로그아웃했습니다",
		logoutFailedCline: "로그아웃에 실패했습니다",
		logoutSuccessOca: "OCA에서 로그아웃했습니다",
		logoutFailedOca: "OCA 로그아웃에 실패했습니다",
		loginFailedCline: "Cline 로그인에 실패했습니다",
		loginFailedOca: "OCA 로그인에 실패했습니다",
		mcpAuthSuccess: "MCP 서버 인증에 성공했습니다",
		mcpAuthFailed: "MCP 서버 인증에 실패했습니다",
		explainSelectCode: "설명할 코드를 선택하세요.",
		improveSelectCode: "개선할 코드를 선택하세요.",
		deleteTasksConfirmSingle: "이 작업을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
		deleteTasksConfirmMultiple: "이 작업 {{count}}개를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.",
		deleteTasksOptionDelete: "삭제",
		deleteAllPrompt: "어떤 항목을 삭제하시겠습니까?",
		deleteAllOptionExceptFavorites: "즐겨찾기를 제외하고 모두 삭제",
		deleteAllOptionEverything: "모두 삭제",
		deleteAllNoFavoritesConfirm: "즐겨찾기 작업이 없습니다. 그래도 모든 작업을 삭제하시겠습니까?",
		deleteAllNoFavoritesOptionDeleteAll: "모든 작업 삭제",
		deleteAllError: "작업 기록 삭제 중 오류가 발생했습니다. 일부 파일이 남아 있을 수 있습니다. 오류: {{error}}",
		explainChangesNoActiveTask: "활성 작업이 없습니다",
		explainChangesCheckpointsNotEnabled: "체크포인트가 활성화되어 있지 않습니다",
		explainChangesCheckpointsDisabled: "설정에서 체크포인트가 비활성화되어 있습니다. 변경사항을 검토할 수 없습니다.",
		explainChangesMessageStateHandlerUnavailable: "메시지 상태 핸들러를 사용할 수 없습니다",
		explainChangesCheckpointTrackerUnavailable: "체크포인트 추적기를 사용할 수 없습니다",
		explainChangesNoCheckpointHash: "예상치 못한 오류: 체크포인트 해시가 없습니다",
		explainChangesNoChangesFound: "검토할 변경사항이 없습니다",
		explainChangesApiConfigUnavailable: "API 설정을 사용할 수 없습니다",
		explainChangesTitle: "변경사항 설명",
		explainChangesFailed: "변경사항 설명에 실패했습니다: {{error}}",
		terminalProfileClosedSingle: "프로필이 다른 터미널 {{count}}개를 닫았습니다.",
		terminalProfileClosedMultiple: "프로필이 다른 터미널 {{count}}개를 닫았습니다.",
		terminalProfileBusySingle:
			"사용 중인 터미널 {{count}}개가 다른 프로필을 사용 중입니다. 모든 명령에 새 프로필을 적용하려면 이를 닫으세요.",
		terminalProfileBusyMultiple:
			"사용 중인 터미널 {{count}}개가 다른 프로필을 사용 중입니다. 모든 명령에 새 프로필을 적용하려면 이를 닫으세요.",
		installCliFailed: "CLI 설치를 시작하지 못했습니다: {{error}}",
		createSkillAlreadyExists: '스킬 "{{name}}"이(가) 이미 존재합니다',
		fileTypeRule: "규칙",
		fileTypeWorkflow: "워크플로",
		ruleFileDeleted: '{{fileType}} 파일 "{{fileName}}"이(가) 삭제되었습니다',
		ruleFileAlreadyExists: '{{fileType}} 파일 "{{fileName}}"이(가) 이미 존재합니다.',
		ruleFileCreated: "새 {{scope}} {{fileType}} 파일을 만들었습니다: {{fileName}}",
		ruleScopeGlobal: "전역",
		ruleScopeWorkspace: "워크스페이스",
		checkpointRestoreFailed: "체크포인트 복원에 실패했습니다",
		stateManagerLoadTaskSettingsFailed:
			"작업 설정을 불러오지 못했습니다. 전역으로 선택된 설정을 사용합니다.",
		ocaNotAuthenticated: "OCA에 인증되어 있지 않습니다. 먼저 로그인하세요.",
		ocaNotAuthenticatedError: "OCA에 인증되어 있지 않습니다",
		ocaNoModelsFound: "모델을 찾을 수 없습니다. OCA 접근 권한(예: 엔타이틀먼트)이 설정되어 있는지 확인하세요.",
		ocaModelsRefreshed: "{{baseUrl}}에서 OCA 모델을 새로고침했습니다",
		ocaFetchFailed: "{{baseUrl}}의 구성 상태를 확인하세요. OCA 모델을 가져오지 못했습니다.",
		ocaServiceErrorStatus:
			"OCA 접근 권한(예: 엔타이틀먼트)이 설정되어 있나요? OCA 서비스가 {{status}} {{statusText}}을(를) 반환했습니다.",
		ocaBackendUnavailable:
			"OCA 백엔드에 연결할 수 없습니다. 엔드포인트와 프록시 구성이 올바른지 확인하세요. 문제 해결 가이드를 참고하세요.",
		ocaRefreshError: "OCA 모델 새로고침 중 오류가 발생했습니다. {{details}} opc-request-id: {{requestId}}",
		subagentsUnsupportedPlatform: "CLI 서브에이전트는 macOS와 Linux에서만 지원됩니다",
		reconstructConfirm:
			"기존 작업 데이터를 바탕으로 작업 기록을 재구성합니다. 현재 작업 기록을 백업한 뒤 작업 폴더에서 복원합니다. 계속하시겠습니까?",
		reconstructOptionConfirm: "예, 재구성",
		reconstructing: "작업 기록을 재구성하는 중...",
		reconstructWarnings:
			"경고와 함께 재구성이 완료되었습니다:\n- 복원됨: {{reconstructed}}개 작업\n- 건너뜀: {{skipped}}개 작업\n- 오류: {{errors}}\n\n처음 몇 개 오류:\n{{errorList}}",
		reconstructSuccess: "작업 기록을 성공적으로 재구성했습니다! {{reconstructed}}개 작업을 복원했습니다.",
		reconstructFailed: "작업 기록 재구성에 실패했습니다: {{error}}",
		reconstructNoTasksDir: "작업 디렉터리를 찾을 수 없습니다. 재구성할 항목이 없습니다.",
		reconstructNoTaskDirs: "작업 디렉터리가 없습니다. 재구성할 항목이 없습니다.",
		reconstructScanFailed: "작업 디렉터리 스캔에 실패했습니다: {{error}}",
		reconstructTaskFailed: "작업 {{taskId}} 재구성에 실패했습니다: {{error}}",
		reconstructUntitledTask: "제목 없는 작업",
		workspaceInitFailedFallback: "워크스페이스 초기화에 실패했습니다. 단일 폴더 모드로 전환합니다.",
		openAiCodexSignInSuccess: "OpenAI Codex에 로그인했습니다",
		openAiCodexSignInFailed: "OpenAI Codex 로그인 실패: {{error}}",
		dictationInstallCopied: "설치 명령을 클립보드에 복사했습니다: {{command}}",
		dictationDependencyRequired: "음성 녹음을 위해 {{dependency}}가 필요합니다. {{description}}",
		dictationInstallWithCline: "Cline으로 설치",
		dictationCopyCommand: "명령 복사",
		dictationSignInCline: "Cline에 로그인",
		dictationError: "음성 녹음 오류: {{error}}",
		dictationSignInRequired: "음성 받아쓰기를 사용하려면 Cline 계정에 로그인하세요.",
		unknownErrorOccurred: "알 수 없는 오류가 발생했습니다",
	},
}

const interpolate = (template: string, params?: CoreMessageParams) => {
	if (!params) {
		return template
	}
	return Object.entries(params).reduce(
		(result, [key, value]) => result.replaceAll(`{{${key}}}`, String(value)),
		template,
	)
}

export const getCoreMessage = (key: CoreMessageKey, language?: LanguageKey, params?: CoreMessageParams) => {
	const locale = language || DEFAULT_LANGUAGE_SETTINGS
	const translations = messages[locale] || messages[DEFAULT_LANGUAGE_SETTINGS]
	const template = translations?.[key] || messages[DEFAULT_LANGUAGE_SETTINGS][key]
	return interpolate(template, params)
}
