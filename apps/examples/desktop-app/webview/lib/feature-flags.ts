/**
 * The Agenda (Todo) UI is temporarily hidden while its UX is reworked, in
 * lockstep with `AGENDA_TODO_TOOL_ENABLED` in the hub server transport, which
 * disables the agent-facing todo kind of the `tasks` tool. All Agenda
 * components, hooks, and sidecar plumbing stay in the codebase; flip this back
 * to true (together with the hub flag) to restore the feature.
 */
export const AGENDA_UI_ENABLED = false;
