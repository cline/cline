import Anthropic from "@anthropic-ai/sdk";
import { TextBlockParam, ImageBlockParam } from "@anthropic-ai/sdk/resources/messages.mjs";


export type ToolResponse = string | Array<Anthropic.TextBlockParam | Anthropic.ImageBlockParam>;
