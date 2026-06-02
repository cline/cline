import * as p from "@clack/prompts";
import { runConnectAdapter } from "../../commands/connect";
import { PLATFORMS, type PlatformDef, type SecurityDef } from "./platforms";

function isCancel(value: unknown): value is symbol {
	return p.isCancel(value);
}

const SENSITIVE_FLAGS = new Set([
	"-k",
	"--access-token",
	"--api-key",
	"--app-secret",
	"--bot-token",
	"--credentials-json",
	"--signing-secret",
	"--verify-token",
	"--webhook-secret",
]);

function redactCommandArgs(args: string[]): string {
	const redacted: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const arg = args[i] ?? "";
		redacted.push(arg);
		if (SENSITIVE_FLAGS.has(arg) && i + 1 < args.length) {
			redacted.push("[redacted]");
			i++;
		}
	}
	return redacted.join(" ");
}

async function collectFields(platform: PlatformDef): Promise<string[] | null> {
	const args: string[] = [];

	for (const field of platform.fields) {
		if (field.help) {
			for (const line of field.help) {
				p.log.info(line);
			}
		}

		const value = await p.text({
			message: field.label,
			placeholder: field.placeholder,
			validate: field.required
				? (v) => {
						if (!v?.trim()) return `${field.label} is required`;
						return undefined;
					}
				: undefined,
		});

		if (isCancel(value)) return null;

		const trimmed = (value as string).trim();
		if (trimmed) {
			args.push(field.flag, trimmed);
		}
	}

	return args;
}

async function collectSecurity(
	security: SecurityDef,
): Promise<string[] | null> {
	const restrict = await p.confirm({
		message: security.prompt,
		initialValue: true,
	});

	if (isCancel(restrict)) return null;
	if (!restrict) {
		p.log.warn(
			"Anyone who finds this bot will be able to run tasks on your machine.",
		);
		return [];
	}

	const values: Record<string, string> = {};

	for (const field of security.fields) {
		if (field.help) {
			for (const line of field.help) {
				p.log.info(line);
			}
		}

		const value = await p.text({
			message: field.label,
			placeholder: field.placeholder,
			validate: (v) => {
				const trimmed = v?.trim();
				if (!trimmed) return field.requiredMessage;
				return field.validate?.(trimmed);
			},
		});

		if (isCancel(value)) return null;

		values[field.key] = (value as string).trim();
	}

	const hookCmd = security.buildHookCommand(values);
	p.log.success("Access restriction enabled");
	return ["--hook-command", hookCmd];
}

export async function runConnectWizard(): Promise<number> {
	p.intro("Connect a messaging platform");

	const platformId = await p.select({
		message: "Select a platform",
		options: PLATFORMS.map((pl) => ({
			value: pl.id,
			label: pl.name,
			hint: pl.hint,
		})),
	});

	if (isCancel(platformId)) {
		p.outro("Cancelled");
		return 0;
	}

	const platform = PLATFORMS.find((pl) => pl.id === (platformId as string));
	if (!platform) {
		p.log.error("Unknown platform");
		return 1;
	}

	p.log.step(`Setting up ${platform.name}`);

	if (platform.type === "webhook") {
		p.log.warn(
			"This connector requires a publicly accessible URL for webhooks.",
		);
	}

	const args = await collectFields(platform);
	if (!args) {
		p.outro("Cancelled");
		return 0;
	}

	if (platform.security) {
		const securityArgs = await collectSecurity(platform.security);
		if (!securityArgs) {
			p.outro("Cancelled");
			return 0;
		}
		args.push(...securityArgs);
	}

	const advanced = await p.group({
		provider: () =>
			p.text({
				message: "Provider override",
				placeholder: "leave empty for default",
			}),
		model: () =>
			p.text({
				message: "Model override",
				placeholder: "leave empty for default",
			}),
		systemPrompt: () =>
			p.text({
				message: "System prompt override",
				placeholder: "leave empty for default",
			}),
		mode: () =>
			p.select({
				message: "Agent mode",
				options: [
					{ value: "act", label: "Act", hint: "execute tasks" },
					{ value: "plan", label: "Plan", hint: "plan only" },
				],
				initialValue: "act",
			}),
	});

	if (isCancel(advanced)) {
		p.outro("Cancelled");
		return 0;
	}

	if (advanced.provider?.trim()) {
		args.push("--provider", advanced.provider.trim());
	}
	if (advanced.model?.trim()) {
		args.push("--model", advanced.model.trim());
	}
	if (advanced.systemPrompt?.trim()) {
		args.push("--system", advanced.systemPrompt.trim());
	}
	if (advanced.mode === "plan") {
		args.push("--mode", "plan");
	}

	args.push("-i");

	p.log.success(
		`Running: cline connect ${platform.id} ${redactCommandArgs(args)}`,
	);
	p.outro("Starting connector (Ctrl+C to stop)");

	return runConnectAdapter(platform.id, args, {
		writeln: (text) => {
			if (text) console.log(text);
		},
		writeErr: (text) => console.error(text),
	});
}
