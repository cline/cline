import type {
	ChatPromptCompletion,
	ToolApprovalRequestItem,
} from "@/hooks/chat-session/types";
import type { ChatSessionStatus } from "@/lib/chat-schema";

export type RealtimeChatBridge = {
	threadId: string;
	sessionId: string | null;
	providerId: string;
	modelId: string;
	status: ChatSessionStatus;
	hasChatHistory: boolean;
	pendingToolApprovals: ToolApprovalRequestItem[];
	pendingQuestionCount: number;
	sendPrompt: (prompt: string) => Promise<ChatPromptCompletion | undefined>;
};
