import { ClaudeDevProvider } from "../providers/ClaudeDevProvider";
import { ApiConfiguration } from "./api";


export interface ClaudeDevConfig {
  provider: ClaudeDevProvider;
  apiConfiguration: ApiConfiguration;
  maxRequestsPerTask?: number;
  customInstructions?: string;
  alwaysAllowReadOnly?: boolean;
}
