import { Mode } from '../../shared/modes';

export type { Mode };

export type ToolName =
  | 'execute_command'
  | 'read_file'
  | 'write_to_file'
  | 'apply_diff'
  | 'search_files'
  | 'list_files'
  | 'list_code_definition_names'
  | 'browser_action'
  | 'use_mcp_tool'
  | 'access_mcp_resource'
  | 'ask_followup_question'
  | 'attempt_completion';

export const CODE_TOOLS: ToolName[] = [
  'execute_command',
  'read_file',
  'write_to_file',
  'apply_diff',
  'search_files',
  'list_files',
  'list_code_definition_names',
  'browser_action',
  'use_mcp_tool',
  'access_mcp_resource',
  'ask_followup_question',
  'attempt_completion'
];

export const ARCHITECT_TOOLS: ToolName[] = [
  'read_file',
  'search_files',
  'list_files',
  'list_code_definition_names',
  'ask_followup_question',
  'attempt_completion'
];

export const ASK_TOOLS: ToolName[] = [
  'read_file',
  'search_files',
  'list_files',
  'browser_action',
  'use_mcp_tool',
  'access_mcp_resource',
  'ask_followup_question',
  'attempt_completion'
];