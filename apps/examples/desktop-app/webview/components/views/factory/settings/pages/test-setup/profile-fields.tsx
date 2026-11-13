"use client";

import type { FactoryVerificationProfile } from "@cline/shared/browser";
import type { ReactNode } from "react";
import { FS_TEST_SETUP } from "@/lib/factory-settings-copy/test-setup";
import { cn } from "@/lib/utils";

const T = FS_TEST_SETUP;
const READY_TIMEOUT_DEFAULT = 120;
const PORT_ENV_DEFAULT = "PORT";

type FieldId = keyof typeof T.fields;

/** One field's value as text, for comparing two versions. */
function fieldText(
	profile: FactoryVerificationProfile,
	field: FieldId,
): string {
	const environment = profile.environment;
	switch (field) {
		case "install":
			return environment.setup ?? "";
		case "start":
			return environment.start ?? "";
		case "readyWhen":
			return environment.healthcheck
				? `${environment.healthcheck} ${T.readyWhen(environment.readyTimeoutSeconds ?? READY_TIMEOUT_DEFAULT)}`
				: "";
		case "portVariable":
			return environment.start ? (environment.portEnv ?? PORT_ENV_DEFAULT) : "";
		case "stop":
			return environment.cleanup ?? "";
		case "exercise":
			return profile.exercise;
		case "evidence":
			return (profile.artifacts ?? []).join(", ");
		case "skills":
			return (profile.skills ?? []).join(", ");
	}
}

function Code({ children }: { children: ReactNode }) {
	return (
		<code className="rounded border bg-card px-1.5 font-mono leading-[20px] text-[12px] break-all">
			{children}
		</code>
	);
}

function fieldValue(
	profile: FactoryVerificationProfile,
	field: FieldId,
): ReactNode {
	const environment = profile.environment;
	switch (field) {
		case "readyWhen":
			return environment.healthcheck ? (
				<>
					<Code>{environment.healthcheck}</Code>{" "}
					{T.readyWhen(
						environment.readyTimeoutSeconds ?? READY_TIMEOUT_DEFAULT,
					)}
				</>
			) : null;
		case "exercise":
			return <span className="whitespace-pre-wrap">{profile.exercise}</span>;
		case "evidence":
			return profile.artifacts?.length ? (
				<span className="flex flex-wrap gap-1.5">
					{profile.artifacts.map((path) => (
						<Code key={path}>{path}</Code>
					))}
				</span>
			) : null;
		case "skills":
			return profile.skills?.length ? profile.skills.join(", ") : null;
		default: {
			const text = fieldText(profile, field);
			return text ? <Code>{text}</Code> : null;
		}
	}
}

/**
 * A test setup in full, as a definition list: how the tester installs,
 * starts, checks and stops the app, what it exercises and the evidence it
 * keeps. With `previous` (the approved version), changed fields are marked
 * in text, not only colour, with the approved value under them.
 */
export function TestSetupFields({
	profile,
	previous,
}: {
	profile: FactoryVerificationProfile;
	previous?: FactoryVerificationProfile;
}) {
	const fields = (Object.keys(T.fields) as FieldId[]).filter(
		(field) =>
			fieldText(profile, field) ||
			(previous ? fieldText(previous, field) : "") ||
			field === "exercise",
	);
	return (
		<dl
			data-test-setup-fields=""
			className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-6 gap-y-1.5 py-3 text-[13px] @max-[560px]/settings:grid-cols-1 @max-[560px]/settings:gap-y-0.5"
		>
			{fields.map((field) => {
				const before = previous ? fieldText(previous, field) : undefined;
				const changed =
					before !== undefined && before !== fieldText(profile, field);
				return (
					<div
						key={field}
						data-field={field}
						data-changed={changed || undefined}
						className="contents"
					>
						<dt
							className={cn(
								"text-muted-foreground @max-[560px]/settings:mt-2",
								changed && "text-amber-600 dark:text-amber-400",
							)}
						>
							{T.fields[field]}
							{changed ? (
								<span className="ml-1.5 rounded bg-amber-500/15 px-1 text-[11px] font-medium">
									{T.changedMark}
								</span>
							) : null}
						</dt>
						<dd className="min-w-0">
							{fieldValue(profile, field) ?? (
								<span className="text-muted-foreground">{T.notSet}</span>
							)}
							{changed ? (
								<p className="mt-0.5 text-xs text-muted-foreground">
									{T.was}{" "}
									{before ? (
										<s className="font-mono break-all">{before}</s>
									) : (
										T.notSet
									)}
								</p>
							) : null}
						</dd>
					</div>
				);
			})}
		</dl>
	);
}
