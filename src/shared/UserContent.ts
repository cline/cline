
import { TextBlockParam, ImageBlockParam, ToolUseBlockParam, ToolResultBlockParam } from "@anthropic-ai/sdk/resources/messages.mjs";


export type UserContent = Array<
  TextBlockParam | ImageBlockParam | ToolUseBlockParam | ToolResultBlockParam
>;
