/**
 * Tuning levers: timeouts, budgets, cadences, limits, and the few names more
 * than one module shares. A protocol fact or a file name with one user lives
 * in that module.
 */

export const PLUGIN_NAME = "next-turn";

/** How long a chat's saved tray state outlives its last write. */
export const SESSION_STATE_TTL_MS = 1_209_600_000;

/** Planner calls one chat may make in an hour before the tray says its allowance is used. */
export const DEFAULT_PLANNER_CALLS_PER_HOUR = 20;

/** Reconnect backoff for the hub link: first delay, ceiling, and growth factor. */
export const HUB_RECONNECT_INITIAL_MS = 500;
export const HUB_RECONNECT_MAX_MS = 30_000;
export const HUB_RECONNECT_FACTOR = 2;
/** How often the link polls whether its client is connected: `NodeHubClient` has no connection callback. */
export const HUB_CONNECTION_POLL_MS = 500;
/** How long a hub command may take before it is refused. */
export const HUB_COMMAND_TIMEOUT_MS = 10_000;

/** Folded events between cursor writes; the cursor is also written on dispose. */
export const CURSOR_SAVE_EVERY_EVENTS = 50;

/** Per-source probe budget when the manifest is built, by tier. */
export const PROBE_BUDGET_MS = {
	T0: 5,
	T1: 50,
	T2: 150,
	T3: 150,
} as const;

/** What the engine reads on connect, before live events take over: root sessions, tasks, upcoming runs, and recent executions to find each schedule's latest run. */
export const SEED_SESSION_LIMIT = 100;
export const SEED_TASK_LIMIT = 200;
export const SEED_UPCOMING_LIMIT = 50;
export const SEED_EXECUTION_LIMIT = 100;

/** Agenda priorities this urgent or more (lower is more urgent) rank a waiting task `high` in Needs you. */
export const URGENT_TASK_PRIORITY_MAX = 1;

/** At most one Needs-you notification per chat in this window. */
export const NOTIFY_MIN_INTERVAL_MS = 60_000;

/** Task proposals: upstream's default priority (P3), and how long a proposal waits before it expires. */
export const DEFAULT_TASK_PRIORITY = 3;
export const TASK_PROPOSAL_TTL_MS = 1_209_600_000;

/** How long each tier's facts may take before the planner is told the source is unknown. */
export const FACTS_BUDGET_MS = {
	T0: 5,
	T1: 50,
	T2: 400,
	T3: 800,
} as const;

/**
 * Session history: recent root sessions read, one-term searches run
 * (the hub ANDs every term in a query), hits per search, sessions the planner
 * sees, and the longest title and snippet it sees.
 */
export const HISTORY_LIST_LIMIT = 50;
export const HISTORY_QUERY_MAX = 4;
export const HISTORY_SEARCH_LIMIT = 8;
export const HISTORY_SESSIONS_MAX = 5;
export const HISTORY_TITLE_MAX = 80;
export const HISTORY_SNIPPET_MAX = 160;
/** Request words shorter than this are not search terms. */
export const SEARCH_TERM_MIN_LENGTH = 4;

/** Cline setup: names per kind the planner sees. */
export const SETUP_NAMES_MAX = 20;

/** Repository conventions: the largest file read, and the commands kept from each. */
export const REPO_FILE_MAX_BYTES = 262_144;
export const REPO_COMMANDS_MAX = 8;

/** Time units: ages such as "3h ago", refresh cadences, and the planner's hourly allowance. */
export const MINUTE_MS = 60_000;
export const HOUR_MS = 3_600_000;
export const DAY_MS = 86_400_000;

/**
 * Connectors. GitHub is read the way Cline desktop's PR bar reads
 * it: `gh` with prompts off, the same 15 s timeout and 2 MiB output cap, and
 * the same five-minute memory of "gh is not signed in".
 */
export const GH_AVAILABILITY_CACHE_MS = 300_000;
export const CONNECTOR_COMMAND_TIMEOUT_MS = 15_000;
export const CONNECTOR_COMMAND_MAX_BUFFER = 2_097_152;
export const GH_PR_LIST_LIMIT = 100;
export const GH_REVIEW_THREADS_MAX = 100;
export const GH_RUN_LIST_LIMIT = 10;
/** Names a GitHub fact lists before "and N more", and the longest PR title the planner sees. */
export const GITHUB_NAMES_MAX = 5;
export const GITHUB_TITLE_MAX = 100;

/** Composio toolkits that are personal or speak for the person: detected, but Off until the person turns them on. */
export const PERSONAL_TOOLKITS: ReadonlySet<string> = new Set([
	"gmail",
	"googlecalendar",
	"googledrive",
	"googledocs",
	"googlesheets",
	"outlook",
	"slack",
	"discord",
	"telegram",
	"whatsapp",
]);

/** GitHub's Read cadence per scope, in minutes; the PR also refreshes after a push. */
export const GITHUB_PR_EVERY_MINUTES = 5;
export const GITHUB_REVIEWS_EVERY_MINUTES = 5;
export const GITHUB_DEFAULT_CI_EVERY_MINUTES = 15;

/**
 * Pinned reads on MCP servers and Composio toolkits: how often
 * one refreshes, how long a call may take, how many a connector may pin, and
 * how much of a result the planner sees (items listed, characters).
 */
export const PINNED_READ_EVERY_MINUTES = 15;
export const PINNED_READ_TIMEOUT_MS = 20_000;
export const PINNED_READS_MAX = 5;
export const PINNED_SUMMARY_ITEMS = 5;
export const PINNED_SUMMARY_MAX = 240;

/**
 * The suggestion set: rows on screen, the
 * model's pool and how many pools are kept, how many prompts a reroll may
 * exclude, and the bounds on what a suggestion says.
 */
export const SET_SIZE = 3;
export const POOL_SIZE = 6;
export const POOL_CACHE_LIMIT = 8;
export const EXCLUDED_LIMIT = 12;
export const REROLL_LIMIT = 2;
/** Offers kept per turn, so an action on a rules row still resolves after the model set replaces it. */
export const RETAINED_OFFERS_LIMIT = 2;
export const PLANNER_LEDGER_TAIL_BYTES = 262_144;
export const DESKTOP_CLIENT_NAME = "cline-desktop";
export const PROMPT_MIN_CHARS = 8;
export const PROMPT_MAX_CHARS = 200;
export const WHY_MAX_CHARS = 120;
export const REF_MAX_CHARS = 200;
/** Tasks the planner sees, and other agents' open reports. */
export const TRACKED_LIMIT = 8;
export const OTHER_STATUS_SHOWN = 5;

/** What the planner sees of the turn: the request and reply, tools run, one error each, and edited paths. */
export const TURN_TEXT_LIMIT = 1_500;
export const TURN_TOOL_LIMIT = 8;
export const TURN_ERROR_LIMIT = 300;
export const TURN_PATH_LIMIT = 8;

/**
 * The planner's model call. It runs detached from `afterRun`, so the rule-based
 * set is already on screen while it works; the deadline only bounds how long
 * a late set may still swap in.
 */
export const PLANNER_TIMEOUT_MS = 20_000;
export const PLANNER_MAX_OUTPUT_TOKENS = 600;
export const PLANNER_TEMPERATURE = 0.3;

/**
 * Some models refuse a call with reasoning off, and the model catalog cannot
 * say which ones. A call that failed for any reason other than auth or a
 * transient provider error is asked once more with low reasoning, which the
 * SDK maps onto each model's own controls: a model's default reasoning runs
 * past the planner's deadline. Reasoning tokens count against the output
 * budget, so that call gets a larger one.
 */
export const PLANNER_RETRY_REASONING_EFFORT = "low";
export const PLANNER_RETRY_MAX_OUTPUT_TOKENS = 2_000;

/** How long `afterRun` waits for the working tree's dirty count before the Commit row is left out. */
export const DIRTY_FILES_BUDGET_MS = 150;

/** The label log: its schema version, the longest typed text it hashes, and tags per record. */
export const LABEL_SCHEMA_VERSION = 3;
export const TYPED_TEXT_LIMIT = 10_000;
export const LABEL_TAGS_MAX = 48;

/** An edited suggestion that keeps this share of its text is an `adjust`, not something typed instead. */
export const EDIT_KEPT_RATIO = 0.5;
