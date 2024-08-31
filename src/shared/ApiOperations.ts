import Anthropic from "@anthropic-ai/sdk";
import { UserContent } from "./UserContent";
import { ClaudeRequestResult } from "./ClaudeRequestResult";


export interface ApiOperations {
  attemptApiRequest(): Promise<Anthropic.Messages.Message>;
  recursivelyMakeClaudeRequests(userContent: UserContent): Promise<ClaudeRequestResult>;
}
