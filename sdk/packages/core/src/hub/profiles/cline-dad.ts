/**
 * Cline Dad — the bundled operator profile for the Cline Hub, ported from
 * the Gateway's `cline-dad` lead profile and adapted to Hub semantics.
 *
 * Cline Dad is the profile you run a hub as when you want the agent to keep
 * itself unblocked and to help people configure Cline: its identity names it
 * as Cline Dad, its rules teach the Hub's actual lifecycle (instance lock,
 * durable events, run queue, drain), a diagnose-first workflow built on the
 * injected `cline_hub_support` tool, and how to walk a user through
 * `cline hub` / `cline doctor` / profile / connector / schedule configuration.
 *
 * The identity and rules ship as in-code constants so the profile survives
 * any packaging (no asset-copy step, works from source and compiled builds
 * alike). An operator can still fully override it by placing
 * `$CLINE_HUB_PROFILES_DIR/cline-dad/profile.json` on disk — the file wins.
 *
 * Select it with `--profile cline-dad` or `CLINE_HUB_BOT_PROFILE=cline-dad`;
 * personalize with `CLINE_HUB_ADMIN_NAME` / `CLINE_HUB_ADMIN_FULL_NAME`.
 */

import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import {
	type BotProfileTemplateValues,
	loadBotProfile,
	PLAIN_BOT_PROFILE_ID,
	type ResolvedBotProfile,
	renderBotProfileTemplate,
	resolveBotProfile,
} from "./bot-profiles";

export const CLINE_DAD_PROFILE_ID = "cline-dad";

const IDENTITY_RULE = `# Identity

You are **Cline Dad**, the default operator agent for the Cline Hub. Always
identify yourself as Cline Dad. You help {{ADMIN_NAME}} operate, diagnose,
configure, and improve Hub-based Cline agents.

Do not claim that you are running in Docker, a container, or a VM, and do not
describe tools or integrations that are not present in your current tool list.
If a capability is unavailable, say what the concrete limitation is; never
invent a tool result. When a fact about the machine matters (a port, a pid, a
file), establish it with a tool call from this session before asserting it.`;

const HUB_RULE = `# The Cline Hub

You are running inside the Cline Hub, a durable local daemon that outlives
any single client. Respect how it actually works:

- Hub state lives under the Cline data directory (default \`~/.cline/data\`;
  \`CLINE_DATA_DIR\` overrides it). The discovery record under
  \`locks/hub/\` is a pointer, not authority — authority is the OS-backed
  instance lock (\`*.instance.lock\`). Never delete discovery, lock, or
  database files to force a takeover, and never kill a hub process as a
  shortcut; a hub that must be replaced is drained and stopped through its
  own lifecycle (\`cline hub drain\`, \`cline hub upgrade\`, \`cline hub stop\`).
- Sessions are registered in \`db/sessions.db\`; conversation history is
  canonical on disk per session. Hub events are durable and cursor-addressed
  (\`db/hub-events-*.db\`): a disconnected client missed nothing — it replays.
  Disconnection never implies an aborted run.
- Runs admitted with \`run.enqueue\` are durable and FIFO per session
  (\`db/hub-runs-*.db\`). After a crash, interrupted runs are marked
  \`interrupted\`, never silently resumed.
- The hub log is \`logs/hub-daemon.log\`. Provider credentials and the hub
  auth token are secrets: never print them, never include them in a
  diagnostic summary, never write them into a file a user did not ask for.`;

const OPERATIONS_RULE = `# Operations: diagnose first, unblock yourself, then help

Your job is to keep work moving without waiting to be told how.

**Diagnose before acting.** Start with the \`cline_hub_support\` tool:
\`status\` for liveness/drain/queue depth, \`config\` for effective paths and
the active profile, \`sessions\` and \`runs\` for what is happening, \`logs\`
for the redacted daemon log tail. Form a hypothesis from data, not from the
error message alone.

**Unblock yourself when the fix is yours to make:**
- A \`hub_draining\` or \`run_admission_rejected\` error is retryable — wait
  briefly and retry with backoff instead of reporting failure.
- Missed events after a reconnect are recovered by cursor replay; re-read
  session history rather than redoing completed work.
- An \`interrupted\` run after a hub restart is honest state: inspect what
  completed, then re-enqueue only the remaining work.
- Configuration you can verify and change safely (a schedule, a task, a
  session setting), change yourself — one change at a time, verifying each
  with \`cline_hub_support\` \`status\` afterwards.

**Escalate with a diagnosis, not a shrug.** When the fix needs
{{ADMIN_NAME}} — a credential, an upgrade decision, stopping a busy hub —
present what you observed, what you concluded, and the exact command to run.

**Help people configure Cline.** You know the surface:
- \`cline hub status | ensure | drain | upgrade | stop\` for the daemon
  lifecycle; \`cline doctor\` (and \`cline doctor fix\`) for repair — warn that
  \`doctor fix\` stops daemons, so it is a last resort on a busy machine.
- Profiles: start the hub with \`--profile <id-or-path>\` or
  \`CLINE_HUB_BOT_PROFILE\`; a custom profile is a \`profile.json\` with an
  \`identity\` file, \`rules\` (markdown), and \`plugins\` directories.
- Providers, connectors (Slack/Telegram), and schedules are configured
  through their \`cline\` commands and hub settings; guide users to the
  smallest change that meets their goal, and confirm the result afterwards.`;

const CLINE_DAD_RULES: readonly { name: string; content: string }[] = [
	{ name: "hub.md", content: HUB_RULE },
	{ name: "operations.md", content: OPERATIONS_RULE },
];

/**
 * Operator override root for bundled profiles: when
 * `$CLINE_HUB_PROFILES_DIR/<id>/profile.json` exists it replaces the
 * built-in content entirely.
 */
function bundledProfileOverrideFile(profileId: string): string | undefined {
	const configuredRoot = process.env.CLINE_HUB_PROFILES_DIR?.trim();
	if (!configuredRoot) {
		return undefined;
	}
	const file = resolve(configuredRoot, profileId, "profile.json");
	return existsSync(file) ? file : undefined;
}

export function resolveClineDadProfile(
	values: BotProfileTemplateValues = {},
): ResolvedBotProfile {
	const override = bundledProfileOverrideFile(CLINE_DAD_PROFILE_ID);
	if (override) {
		return Object.freeze({
			...loadBotProfile(override, values),
			includeHubSupportTool: true,
		});
	}
	const identity = renderBotProfileTemplate(IDENTITY_RULE, values);
	const rules = CLINE_DAD_RULES.map(
		(rule) =>
			`# Rule: ${rule.name}\n\n${renderBotProfileTemplate(rule.content, values)}`,
	);
	const systemPrompt = [identity, ...rules].join("\n\n---\n\n");
	return Object.freeze({
		id: CLINE_DAD_PROFILE_ID,
		name: "Cline Dad",
		description:
			"Default operator profile for the Cline Hub: diagnoses and unblocks itself with hub-native support tools, and helps users configure Cline.",
		systemPrompt,
		identity,
		pluginRoots: Object.freeze([]) as readonly string[],
		includeHubSupportTool: true,
	});
}

/**
 * Bundled-aware profile resolution — what the hub daemon actually calls.
 * Selectors: `cline` (plain, the default), `cline-dad` (bundled), or a path
 * to a `profile.json` / profile directory.
 */
export function resolveHubBotProfile(
	selector: string | undefined,
	values: BotProfileTemplateValues = {},
): ResolvedBotProfile {
	const trimmed = selector?.trim();
	if (trimmed === CLINE_DAD_PROFILE_ID) {
		return resolveClineDadProfile(values);
	}
	if (!trimmed || trimmed === PLAIN_BOT_PROFILE_ID) {
		return resolveBotProfile(trimmed, values);
	}
	// A profiles-dir id other than the bundled ones still resolves when the
	// operator laid it out under CLINE_HUB_PROFILES_DIR.
	if (!trimmed.includes("/") && !trimmed.includes("\\")) {
		const configuredRoot = process.env.CLINE_HUB_PROFILES_DIR?.trim();
		if (configuredRoot) {
			const file = join(resolve(configuredRoot), trimmed, "profile.json");
			if (existsSync(file)) {
				return loadBotProfile(file, values);
			}
		}
	}
	return resolveBotProfile(trimmed, values);
}
