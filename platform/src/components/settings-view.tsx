"use client";

import {
	CheckCircle2,
	ExternalLink,
	KeyRound,
	Loader2,
	ShieldCheck,
	Trash2,
	UserRound,
	XCircle,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Badge, InlineAlert, Panel } from "@/components/ui";
import { ApiClientError, apiFetch } from "@/lib/client-api";
import type { OpenRouterModel, ProfileRow, SettingsRow } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";

type Limits = {
	tasksPerMonth: number;
	tokensPerMonth: number;
	concurrentTasks: number;
	maxTerminalTimeoutSeconds: number;
	projects: number;
};

type KeyInfo = {
	personal: boolean;
	last4: string | null;
	updatedAt: string | null;
	serverConfigured: boolean;
	sandboxConfigured: boolean;
};

export function SettingsView({
	user,
	initialProfile,
	initialSettings,
	limits,
	keyInfo,
}: {
	user: { id: string; email: string; createdAt: string };
	initialProfile: ProfileRow;
	initialSettings: SettingsRow;
	limits: Limits;
	keyInfo: KeyInfo;
}) {
	const [profile, setProfile] = useState(initialProfile);
	const [, setSettings] = useState(initialSettings);
	const [models, setModels] = useState<OpenRouterModel[]>([]);
	const [modelsError, setModelsError] = useState<string | null>(null);

	const [displayName, setDisplayName] = useState(initialProfile.display_name ?? "");
	const [profileBusy, setProfileBusy] = useState(false);
	const [profileMessage, setProfileMessage] = useState<string | null>(null);
	const [profileError, setProfileError] = useState<string | null>(null);

	const [defaultModel, setDefaultModel] = useState(initialSettings.default_model ?? "");
	const [manualModel, setManualModel] = useState("");
	const [maxConcurrent, setMaxConcurrent] = useState(initialSettings.max_concurrent_tasks);
	const [terminalTimeout, setTerminalTimeout] = useState(initialSettings.terminal_timeout_seconds);
	const [tokenLimit, setTokenLimit] = useState(
		initialSettings.monthly_token_limit ? String(initialSettings.monthly_token_limit) : "",
	);
	const [taskLimit, setTaskLimit] = useState(
		initialSettings.monthly_task_limit ? String(initialSettings.monthly_task_limit) : "",
	);
	const [settingsBusy, setSettingsBusy] = useState(false);
	const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
	const [settingsError, setSettingsError] = useState<string | null>(null);

	const [keyInput, setKeyInput] = useState("");
	const [keyBusy, setKeyBusy] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(null);
	const [keyMessage, setKeyMessage] = useState<string | null>(null);
	const [savedKey, setSavedKey] = useState(keyInfo);

	useEffect(() => {
		apiFetch<{ models: OpenRouterModel[]; error?: string }>("/api/models?tools=1")
			.then((data) => {
				setModels(data.models);
				if (data.error) setModelsError(data.error);
			})
			.catch((caught) => {
				setModelsError(
					caught instanceof ApiClientError ? caught.message : "Could not load models.",
				);
			});
	}, []);

	async function saveProfile(event: React.FormEvent) {
		event.preventDefault();
		setProfileBusy(true);
		setProfileError(null);
		setProfileMessage(null);
		try {
			const data = await apiFetch<{ profile: ProfileRow }>("/api/account", {
				method: "PATCH",
				body: JSON.stringify({ displayName: displayName.trim() || null }),
			});
			setProfile(data.profile);
			setProfileMessage("Profile saved.");
		} catch (caught) {
			setProfileError(
				caught instanceof ApiClientError ? caught.message : "Could not save profile.",
			);
		} finally {
			setProfileBusy(false);
		}
	}

	async function saveSettings(event: React.FormEvent) {
		event.preventDefault();
		setSettingsBusy(true);
		setSettingsError(null);
		setSettingsMessage(null);
		try {
			const payload = {
				defaultModel: defaultModel || manualModel.trim() || null,
				maxConcurrentTasks: maxConcurrent,
				terminalTimeoutSeconds: terminalTimeout,
				monthlyTokenLimit: tokenLimit ? Number(tokenLimit) : null,
				monthlyTaskLimit: taskLimit ? Number(taskLimit) : null,
			};
			const data = await apiFetch<{ settings: SettingsRow; profile: ProfileRow }>("/api/settings", {
				method: "PATCH",
				body: JSON.stringify(payload),
			});
			setSettings(data.settings);
			setProfile(data.profile);
			setSettingsMessage("Workspace defaults saved.");
		} catch (caught) {
			setSettingsError(
				caught instanceof ApiClientError ? caught.message : "Could not save settings.",
			);
		} finally {
			setSettingsBusy(false);
		}
	}

	async function saveKey(event: React.FormEvent) {
		event.preventDefault();
		if (!keyInput.trim()) return;
		setKeyBusy(true);
		setKeyError(null);
		setKeyMessage(null);
		try {
			const data = await apiFetch<{ last4: string }>("/api/keys", {
				method: "POST",
				body: JSON.stringify({ key: keyInput.trim() }),
			});
			setSavedKey((current) => ({
				...current,
				personal: true,
				last4: data.last4,
				updatedAt: new Date().toISOString(),
			}));
			setKeyInput("");
			setKeyMessage("Key validated and stored encrypted. It is never sent to the browser again.");
		} catch (caught) {
			setKeyError(caught instanceof ApiClientError ? caught.message : "Could not save the key.");
		} finally {
			setKeyBusy(false);
		}
	}

	async function removeKey() {
		setKeyBusy(true);
		setKeyError(null);
		setKeyMessage(null);
		try {
			await apiFetch("/api/keys", { method: "DELETE" });
			setSavedKey((current) => ({ ...current, personal: false, last4: null, updatedAt: null }));
			setKeyMessage("Personal key removed. The server key will be used if one is configured.");
		} catch (caught) {
			setKeyError(caught instanceof ApiClientError ? caught.message : "Could not remove the key.");
		} finally {
			setKeyBusy(false);
		}
	}

	return (
		<div className="space-y-6">
			<header>
				<p className="eyebrow">Settings</p>
				<h1 className="display mt-2 text-3xl font-semibold">Account & workspace defaults</h1>
				<p className="mt-2 max-w-2xl text-sm text-mist-500">
					Model credentials are encrypted server-side. Limits you set here are enforced in addition
					to your plan limits.
				</p>
			</header>

			<div className="grid gap-5 xl:grid-cols-2">
				<Panel className="p-5">
					<div className="flex items-center gap-2">
						<UserRound className="size-4 text-mist-400" />
						<h2 className="font-display text-sm font-semibold">Profile</h2>
						<Badge tone="muted" className="ml-auto capitalize">
							{profile.plan} plan
						</Badge>
					</div>
					<form onSubmit={saveProfile} className="mt-4 space-y-4">
						<div>
							<label className="label" htmlFor="display-name">
								Display name
							</label>
							<input
								id="display-name"
								value={displayName}
								onChange={(event) => setDisplayName(event.target.value)}
								maxLength={80}
								placeholder="Your name"
								className="input"
							/>
						</div>
						<div>
							<label className="label" htmlFor="account-email">
								Email
							</label>
							<input id="account-email" value={user.email} readOnly className="input opacity-70" />
							<p className="mt-1.5 text-[0.65rem] text-mist-600">
								Email changes are handled by Supabase Auth and are not editable here.
							</p>
						</div>
						{profileError ? <InlineAlert tone="danger">{profileError}</InlineAlert> : null}
						{profileMessage ? <InlineAlert tone="success">{profileMessage}</InlineAlert> : null}
						<div className="flex items-center justify-between">
							<p className="text-[0.65rem] text-mist-600">
								Member since {formatDateTime(user.createdAt)}
							</p>
							<button type="submit" disabled={profileBusy} className="btn btn-primary">
								{profileBusy ? <Loader2 className="size-4 animate-spin" /> : null}
								Save profile
							</button>
						</div>
					</form>
				</Panel>

				<Panel className="p-5">
					<div className="flex items-center gap-2">
						<KeyRound className="size-4 text-mist-400" />
						<h2 className="font-display text-sm font-semibold">OpenRouter key</h2>
					</div>
					<div className="mt-4 space-y-3">
						<div className="rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
							<div className="flex items-center justify-between">
								<span className="text-[0.75rem] text-mist-300">Personal key</span>
								{savedKey.personal ? (
									<span className="inline-flex items-center gap-1 text-[0.7rem] text-signal-300">
										<CheckCircle2 className="size-3.5" /> •••• {savedKey.last4}
									</span>
								) : (
									<span className="text-[0.7rem] text-mist-500">not set</span>
								)}
							</div>
							<div className="mt-1 flex items-center justify-between">
								<span className="text-[0.75rem] text-mist-300">Server key</span>
								{savedKey.serverConfigured ? (
									<span className="inline-flex items-center gap-1 text-[0.7rem] text-signal-300">
										<CheckCircle2 className="size-3.5" /> configured
									</span>
								) : (
									<span className="inline-flex items-center gap-1 text-[0.7rem] text-amber-400">
										<XCircle className="size-3.5" /> not configured
									</span>
								)}
							</div>
						</div>

						<form onSubmit={saveKey} className="space-y-2">
							<label className="label" htmlFor="openrouter-key">
								Add or replace your key
							</label>
							<div className="flex gap-2">
								<input
									id="openrouter-key"
									type="password"
									value={keyInput}
									onChange={(event) => setKeyInput(event.target.value)}
									placeholder="sk-or-v1-…"
									autoComplete="off"
									className="input flex-1 font-mono"
								/>
								<button
									type="submit"
									disabled={keyBusy || !keyInput.trim()}
									className="btn btn-primary"
								>
									{keyBusy ? <Loader2 className="size-4 animate-spin" /> : null}
									Validate & save
								</button>
							</div>
						</form>
						{savedKey.personal ? (
							<button
								type="button"
								onClick={removeKey}
								disabled={keyBusy}
								className="btn btn-ghost h-8 px-2 text-[0.7rem] text-mist-500 hover:text-rose-300"
							>
								<Trash2 className="size-3.5" /> Remove personal key
							</button>
						) : null}
						{keyError ? <InlineAlert tone="danger">{keyError}</InlineAlert> : null}
						{keyMessage ? <InlineAlert tone="success">{keyMessage}</InlineAlert> : null}
						<p className="flex flex-wrap items-center gap-1 text-[0.65rem] leading-relaxed text-mist-600">
							Keys are validated against OpenRouter before storage and encrypted with AES-256-GCM.
							<a
								href="https://openrouter.ai/keys"
								target="_blank"
								rel="noreferrer"
								className="inline-flex items-center gap-0.5 text-mist-400 hover:text-mist-200"
							>
								Create a key <ExternalLink className="size-2.5" />
							</a>
						</p>
					</div>
				</Panel>

				<Panel className="p-5 xl:col-span-2">
					<div className="flex items-center gap-2">
						<ShieldCheck className="size-4 text-mist-400" />
						<h2 className="font-display text-sm font-semibold">Execution defaults</h2>
					</div>
					<form onSubmit={saveSettings} className="mt-4 space-y-4">
						<div className="grid gap-4 sm:grid-cols-2">
							<div>
								<label className="label" htmlFor="default-model">
									Default model
								</label>
								{models.length > 0 ? (
									<select
										id="default-model"
										value={defaultModel}
										onChange={(event) => setDefaultModel(event.target.value)}
										className="input"
									>
										<option value="">No default — choose per task</option>
										{models.map((model) => (
											<option key={model.id} value={model.id}>
												{model.name}
											</option>
										))}
									</select>
								) : (
									<input
										id="default-model"
										value={manualModel}
										onChange={(event) => setManualModel(event.target.value)}
										placeholder="provider/model-id"
										className="input font-mono"
									/>
								)}
								{modelsError ? (
									<p className="mt-1.5 text-[0.65rem] leading-relaxed text-amber-300/90">
										Catalog unavailable ({modelsError}). Enter a model id manually.
									</p>
								) : (
									<p className="mt-1.5 text-[0.65rem] text-mist-600">
										Used when a project or task does not specify one.
									</p>
								)}
							</div>
							<div>
								<label className="label" htmlFor="terminal-timeout">
									Terminal timeout (seconds)
								</label>
								<input
									id="terminal-timeout"
									type="number"
									min={5}
									max={Math.min(300, limits.maxTerminalTimeoutSeconds)}
									value={terminalTimeout}
									onChange={(event) => setTerminalTimeout(Number(event.target.value))}
									className="input"
								/>
								<p className="mt-1.5 text-[0.65rem] text-mist-600">
									Maximum {Math.min(300, limits.maxTerminalTimeoutSeconds)}s on your plan.
								</p>
							</div>
							<div>
								<label className="label" htmlFor="max-concurrent">
									Concurrent tasks
								</label>
								<input
									id="max-concurrent"
									type="number"
									min={1}
									max={limits.concurrentTasks}
									value={maxConcurrent}
									onChange={(event) => setMaxConcurrent(Number(event.target.value))}
									className="input"
								/>
								<p className="mt-1.5 text-[0.65rem] text-mist-600">
									Plan ceiling: {limits.concurrentTasks} simultaneous tasks.
								</p>
							</div>
							<div className="grid grid-cols-2 gap-3">
								<div>
									<label className="label" htmlFor="token-limit">
										Monthly token cap
									</label>
									<input
										id="token-limit"
										type="number"
										min={1}
										value={tokenLimit}
										onChange={(event) => setTokenLimit(event.target.value)}
										placeholder="plan default"
										className="input"
									/>
								</div>
								<div>
									<label className="label" htmlFor="task-limit">
										Monthly task cap
									</label>
									<input
										id="task-limit"
										type="number"
										min={1}
										value={taskLimit}
										onChange={(event) => setTaskLimit(event.target.value)}
										placeholder="plan default"
										className="input"
									/>
								</div>
							</div>
						</div>

						{settingsError ? <InlineAlert tone="danger">{settingsError}</InlineAlert> : null}
						{settingsMessage ? <InlineAlert tone="success">{settingsMessage}</InlineAlert> : null}
						<div className="flex flex-wrap items-center justify-between gap-3">
							<p className="text-[0.65rem] text-mist-600">
								Plan ceilings: {limits.tasksPerMonth.toLocaleString()} tasks ·{" "}
								{limits.tokensPerMonth.toLocaleString()} tokens / month.
							</p>
							<button type="submit" disabled={settingsBusy} className="btn btn-primary">
								{settingsBusy ? <Loader2 className="size-4 animate-spin" /> : null}
								Save defaults
							</button>
						</div>
					</form>
				</Panel>
			</div>

			<Panel className="p-5">
				<h2 className="font-display text-sm font-semibold">Platform status</h2>
				<div className="mt-3 grid gap-3 text-[0.72rem] sm:grid-cols-2">
					<div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
						<span className="text-mist-400">Daytona sandboxes</span>
						<span className={savedKey.sandboxConfigured ? "text-signal-300" : "text-amber-400"}>
							{savedKey.sandboxConfigured ? "configured" : "DAYTONA_API_KEY missing"}
						</span>
					</div>
					<div className="flex items-center justify-between rounded-lg border border-white/[0.07] bg-white/[0.02] px-3 py-2.5">
						<span className="text-mist-400">Account id</span>
						<span className="max-w-[220px] truncate font-mono text-[0.65rem] text-mist-500">
							{user.id}
						</span>
					</div>
				</div>
				<p className="mt-4 text-[0.65rem] leading-relaxed text-mist-600">
					Agent runtime adapted from Cline (Apache-2.0). Sandboxes are provided by Daytona; models
					by OpenRouter. 21 Agent never runs untrusted code on its own servers.
				</p>
			</Panel>
		</div>
	);
}
