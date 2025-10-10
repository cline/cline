import { ClineMessage } from "@shared/ExtensionMessage"

// Matrix Parse特定的消息类型定义
export type MatrixParseAsk =
	| "upload_matrix_file"
	| "confirm_dbc_conversion"
	| "confirm_code_generation"
	| "review_generated_code"
	| "user_confirmation"
	| "user_feedback"

export type MatrixParseSay =
	| "workflow_step"
	| "agent_request"
	| "agent_response"
	| "error"
	| "dbc_conversion_started"
	| "dbc_conversion_completed"
	| "dbc_validation_started"
	| "dbc_validation_completed"
	| "code_generation_started"
	| "code_generation_completed"
	| "code_validation_started"
	| "code_validation_completed"
	| "task_completed"
	| "info"

export class MatrixParseMessageFactory {
	static createAsk(ask: MatrixParseAsk, text?: string, additionalData?: any): ClineMessage {
		return {
			ts: Date.now(),
			type: "ask",
			ask: ask as any, // 类型转换，实际运行时是字符串
			text: text ? JSON.stringify(text) : undefined,
			...additionalData,
		}
	}

	static createSay(say: MatrixParseSay, text?: string, additionalData?: any): ClineMessage {
		return {
			ts: Date.now(),
			type: "say",
			say: say as any, // 类型转换，实际运行时是字符串
			text: text ? JSON.stringify(text) : undefined,
			...additionalData,
		}
	}

	static createUploadFileAsk(): ClineMessage {
		return MatrixParseMessageFactory.createAsk("upload_matrix_file", "请上传CAN功能矩阵定义文件", {
			allowedFormats: [".xlsx", ".xls", ".csv"],
			maxSize: 10 * 1024 * 1024, // 10MB
		})
	}

	static createConfirmDbcAsk(dbcContent: string, fileName: string): ClineMessage {
		return MatrixParseMessageFactory.createAsk("confirm_dbc_conversion", "DBC文件已生成，请确认转换结果", {
			dbcContent,
			fileName,
		})
	}

	static createConfirmCodeGenerationAsk(languages: ("c" | "java")[] = ["c", "java"]): ClineMessage {
		return MatrixParseMessageFactory.createAsk("confirm_code_generation", "请选择要生成的代码语言", {
			languageOptions: languages,
		})
	}

	static createReviewCodeAsk(codeContent: string, language: "c" | "java", fileName: string): ClineMessage {
		return MatrixParseMessageFactory.createAsk("review_generated_code", `已生成${language.toUpperCase()}代码，请审查`, {
			codeContent,
			language,
			fileName,
		})
	}

	static createUserConfirmationAsk(text: string, step: string): ClineMessage {
		return MatrixParseMessageFactory.createAsk("user_confirmation", text, {
			step,
		})
	}

	static createUserFeedbackAsk(text: string, step: string): ClineMessage {
		return MatrixParseMessageFactory.createAsk("user_feedback", text, {
			step,
		})
	}

	static createWorkflowStepSay(step: string, status: string, details?: string): ClineMessage {
		return MatrixParseMessageFactory.createSay("workflow_step", "工作流步骤更新", {
			step,
			status,
			details,
		})
	}

	static createTaskCompletedSay(message: string, dbcFilePath?: string, codeFilePath?: string): ClineMessage {
		return MatrixParseMessageFactory.createSay("task_completed", message, {
			dbcFilePath,
			codeFilePath,
		})
	}
}
