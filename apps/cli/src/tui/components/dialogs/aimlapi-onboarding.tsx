// @jsxImportSource @opentui/react
import {
	Llms,
	type ProviderSettingsManager,
	saveLocalProviderSettings,
} from "@cline/core";
import type { ChoiceContext } from "@opentui-ui/dialog";
import {
	type DialogActions,
	useDialogKeyboard,
} from "@opentui-ui/dialog/react";
import "opentui-spinner/react";
import open from "open";
import { useEffect, useMemo, useState } from "react";
import { palette } from "../../palette";
import { withLoadingDialog } from "./loading-dialog";

type AimlapiPath = "new-user" | "existing-key";

interface AimlapiInputContentProps extends ChoiceContext<string> {
	title: string;
	hint?: string;
	placeholder?: string;
	initialValue?: string;
	error?: string;
	password?: boolean;
}

export function AimlapiInputContent(props: AimlapiInputContentProps) {
	const {
		resolve,
		dismiss,
		dialogId,
		title,
		hint,
		placeholder,
		initialValue,
		error,
		password,
	} = props;
	const [value, setValue] = useState(initialValue ?? "");

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const trimmed = value.trim();
			if (trimmed) resolve(trimmed);
		}
	}, dialogId);

	const inputValue = password ? "*".repeat(value.length) : value;
	// The masked input is controlled with a stars string, so opentui reports each
	// onInput as (chars already consumed) + (newly inserted chars). Reconstruct the
	// real value from the functional updater's `current` — never from render-time
	// state. A paste often arrives as a burst of synchronous onInput calls before
	// any re-render; reading a stale `inputValue.length` (still 0 during the burst)
	// made every call re-append the whole buffer, inflating a 32-char key into
	// hundreds of characters and drawing a 401. `current.length` stays in lockstep
	// with the chars already consumed regardless of how React batches the updates.
	const handleInput = (next: string) => {
		if (!password) {
			setValue(next);
			return;
		}
		setValue((current) =>
			next.length < current.length
				? current.slice(0, next.length)
				: current + next.slice(current.length),
		);
	};

	return (
		<box flexDirection="column" gap={0} paddingX={1}>
			<text fg={palette.act}>
				<strong>{title}</strong>
			</text>
			{hint && <text fg="gray">{hint}</text>}
			<box border borderStyle="rounded" borderColor={palette.act} paddingX={1}>
				<input
					focused
					flexGrow={1}
					onInput={handleInput}
					placeholder={placeholder ?? ""}
					value={inputValue}
				/>
			</box>
			{error && <text fg={palette.error}>{error}</text>}
			<text fg="gray">Enter to continue, Esc to go back</text>
		</box>
	);
}

function AimlapiOptionContent<T extends string>(
	props: ChoiceContext<T> & {
		title: string;
		hint?: string;
		options: Array<{ value: T; label: string; hint?: string }>;
	},
) {
	const { resolve, dismiss, dialogId, title, hint, options } = props;
	const [selected, setSelected] = useState(0);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const option = options[selected];
			if (option) resolve(option.value);
			return;
		}
		if (key.name === "up" || key.name === "down" || key.name === "tab") {
			setSelected((current) => (current + 1) % options.length);
		}
	}, dialogId);

	return (
		<box flexDirection="column" gap={1} paddingX={1}>
			<text fg={palette.act}>
				<strong>{title}</strong>
			</text>
			{hint && <text fg="gray">{hint}</text>}
			<box flexDirection="column">
				{options.map((option, index) => {
					const active = index === selected;
					return (
						<box
							key={option.value}
							backgroundColor={active ? palette.selection : undefined}
							flexDirection="column"
							paddingX={1}
						>
							<text fg={active ? palette.textOnSelection : undefined}>
								{active ? "❯ " : "  "}
								{option.label}
							</text>
							{option.hint && (
								<text fg={active ? palette.textOnSelection : "gray"}>
									{option.hint}
								</text>
							)}
						</box>
					);
				})}
			</box>
			<text fg="gray">↑/↓ navigate, Enter to select, Esc to go back</text>
		</box>
	);
}

export function AimlapiPathContent(props: ChoiceContext<AimlapiPath>) {
	return (
		<AimlapiOptionContent
			{...props}
			options={[
				{
					value: "new-user",
					label: Llms.AIMLAPI_MESSAGES.pickPathNewUser,
					hint: Llms.AIMLAPI_MESSAGES.pickPathNewHint,
				},
				{
					value: "existing-key",
					label: Llms.AIMLAPI_MESSAGES.pickPathHaveKey,
					hint: Llms.AIMLAPI_MESSAGES.pickPathHaveHint,
				},
			]}
			title={Llms.AIMLAPI_MESSAGES.pickPathPrompt}
		/>
	);
}

type LowBalanceAction = "top-up" | "skip";

interface AimlapiTopUpInput {
	amount: string;
	autoTopUp: boolean;
}

function AimlapiLowBalanceContent(props: ChoiceContext<LowBalanceAction>) {
	return (
		<AimlapiOptionContent
			{...props}
			hint={Llms.AIMLAPI_MESSAGES.lowBalanceHint}
			options={[
				{
					value: "top-up",
					label: Llms.AIMLAPI_MESSAGES.lowBalanceTopUp,
				},
				{
					value: "skip",
					label: Llms.AIMLAPI_MESSAGES.lowBalanceSkip,
				},
			]}
			title={Llms.AIMLAPI_MESSAGES.lowBalance}
		/>
	);
}

function AimlapiTopUpInputContent(
	props: ChoiceContext<AimlapiTopUpInput> & {
		error?: string;
		initialAmount: string;
		initialAutoTopUp: boolean;
	},
) {
	const { resolve, dismiss, dialogId, error, initialAmount, initialAutoTopUp } =
		props;
	const [amount, setAmount] = useState(initialAmount);
	const [autoTopUp, setAutoTopUp] = useState(initialAutoTopUp);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			dismiss();
			return;
		}
		if (key.name === "tab") {
			setAutoTopUp((current) => !current);
			return;
		}
		if (key.name === "return" || key.name === "enter") {
			const trimmed = amount.trim();
			if (trimmed) resolve({ amount: trimmed, autoTopUp });
		}
	}, dialogId);

	return (
		<box flexDirection="column" gap={0} paddingX={1}>
			<text fg={palette.act}>
				<strong>{Llms.AIMLAPI_MESSAGES.topUpPrompt}</strong>
			</text>
			<box border borderStyle="rounded" borderColor={palette.act} paddingX={1}>
				<input
					focused
					flexGrow={1}
					onInput={setAmount}
					placeholder="25"
					value={amount}
				/>
			</box>
			<box flexDirection="row">
				<text>
					{Llms.AIMLAPI_MESSAGES.autoTopUpLabel}
					<span fg="gray">(Tab)</span>:
				</text>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI box is the mouse-interactive primitive. */}
				<box onMouseDown={() => setAutoTopUp(true)} paddingX={1}>
					<text fg={autoTopUp ? "white" : "gray"}>on</text>
				</box>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: OpenTUI box is the mouse-interactive primitive. */}
				<box onMouseDown={() => setAutoTopUp(false)} paddingX={1}>
					<text fg={autoTopUp ? "gray" : "white"}>off</text>
				</box>
			</box>
			{error && <text fg={palette.error}>{error}</text>}
			<text fg="gray">Enter to continue, Esc to go back</text>
		</box>
	);
}

interface AimlapiProgressContentProps
	extends ChoiceContext<Llms.AimlapiProvisionedKey | false> {
	provision: (
		onStatus: (status: Llms.AimlapiTopUpStatus, detail?: string) => void,
		signal: AbortSignal,
	) => Promise<Llms.AimlapiProvisionedKey>;
}

function AimlapiProgressContent(props: AimlapiProgressContentProps) {
	const { resolve, dismiss, dialogId, provision } = props;
	// Per zero's design the streamed top-up shows a spinner only — the per-step
	// status lines are gone. Once the checkout link arrives it replaces the spinner,
	// since the user must open it to pay.
	const [checkoutUrl, setCheckoutUrl] = useState("");
	const [error, setError] = useState("");
	const controller = useMemo(() => new AbortController(), []);

	useEffect(() => {
		void provision((_next, detail) => {
			if (detail) setCheckoutUrl(detail);
		}, controller.signal)
			.then(resolve)
			.catch((cause: unknown) => {
				if (controller.signal.aborted) return;
				setError(cause instanceof Error ? cause.message : String(cause));
			});
		return () => controller.abort();
	}, [controller, provision, resolve]);

	useDialogKeyboard((key) => {
		if (key.name === "escape") {
			controller.abort();
			dismiss();
			return;
		}
		if (error && (key.name === "return" || key.name === "enter")) {
			resolve(false);
		}
	}, dialogId);

	return (
		<box flexDirection="column" gap={1} paddingX={1}>
			{!error && !checkoutUrl && (
				<box flexDirection="row" gap={1}>
					<spinner name="dots" color="gray" />
				</box>
			)}
			{!error && checkoutUrl && (
				<>
					<text>Opening checkout in browser...</text>
					<text fg="gray">{Llms.AIMLAPI_MESSAGES.topUpBrowserFallback}</text>
					<text fg={palette.act} selectable>
						<a href={checkoutUrl}>{checkoutUrl}</a>
					</text>
				</>
			)}
			{error && <text fg={palette.error}>{error}</text>}
			<text fg="gray">
				{error ? "Enter or Esc to go back" : "Esc to cancel"}
			</text>
		</box>
	);
}

function AimlapiDoneContent(
	props: ChoiceContext<boolean> & {
		magicLinkEmail?: string;
		toppedUp: boolean;
		amount?: string;
	},
) {
	const { resolve, dialogId, magicLinkEmail, toppedUp, amount } = props;
	useDialogKeyboard((key) => {
		if (key.name === "return" || key.name === "enter") resolve(true);
	}, dialogId);
	const toppedUpAmount = amount?.trim();
	return (
		<box flexDirection="column" gap={1} paddingX={1}>
			<text fg={palette.success}>
				<strong>
					{toppedUp
						? Llms.AIMLAPI_MESSAGES.topUpSuccess(toppedUpAmount)
						: Llms.AIMLAPI_MESSAGES.everythingRuns}
				</strong>
			</text>
			{magicLinkEmail && (
				<text>{Llms.AIMLAPI_MESSAGES.successMagicLink(magicLinkEmail)}</text>
			)}
			<text fg="gray">Enter to continue</text>
		</box>
	);
}

async function showDone(
	dialog: DialogActions,
	termHeight: number,
	options: { magicLinkEmail?: string; toppedUp: boolean; amount?: string },
): Promise<void> {
	await dialog.choice<boolean>({
		style: { maxHeight: termHeight - 2 },
		closeOnEscape: false,
		content: (ctx) => <AimlapiDoneContent {...ctx} {...options} />,
	});
}

async function openAimlapiCheckout(url: string): Promise<void> {
	await open(url, { wait: false });
}

// promptAimlapiTopUpAmount drives the "Add credits" amount/auto-top-up form,
// re-prompting on an invalid amount. Returns the validated input, or undefined if
// the user backed out.
async function promptAimlapiTopUpAmount(
	dialog: DialogActions,
	termHeight: number,
): Promise<AimlapiTopUpInput | undefined> {
	let amountError: string | undefined;
	let amount = "25";
	let autoTopUp = true;
	while (true) {
		const value = await dialog.choice<AimlapiTopUpInput>({
			style: { maxHeight: termHeight - 2 },
			content: (ctx) => (
				<AimlapiTopUpInputContent
					{...ctx}
					error={amountError}
					initialAmount={amount}
					initialAutoTopUp={autoTopUp}
				/>
			),
		});
		if (!value) return undefined;
		amount = value.amount;
		autoTopUp = value.autoTopUp;
		try {
			Llms.parseAimlapiAmountUsd(amount);
			return { amount, autoTopUp };
		} catch (cause) {
			amountError = cause instanceof Error ? cause.message : String(cause);
		}
	}
}

// runAimlapiProvision shows the streamed top-up progress screen and resolves with
// the provisioned key, or a falsy value when the checkout was cancelled/failed.
function runAimlapiProvision(
	dialog: DialogActions,
	termHeight: number,
	provision: (
		onStatus: (status: Llms.AimlapiTopUpStatus, detail?: string) => void,
		signal: AbortSignal,
	) => Promise<Llms.AimlapiProvisionedKey>,
) {
	return dialog.choice<Llms.AimlapiProvisionedKey | false>({
		style: { maxHeight: termHeight - 2 },
		closeOnEscape: false,
		content: (ctx) => <AimlapiProgressContent {...ctx} provision={provision} />,
	});
}

export async function runAimlapiOnboarding(
	dialog: DialogActions,
	manager: ProviderSettingsManager,
	termHeight: number,
): Promise<boolean> {
	const path = await dialog.choice<AimlapiPath>({
		style: { maxHeight: termHeight - 2 },
		content: (ctx) => <AimlapiPathContent {...ctx} />,
	});
	if (!path) return false;

	if (path === "existing-key") {
		let error: string | undefined;
		while (true) {
			const pastedKey = await dialog.choice<string>({
				style: { maxHeight: termHeight - 2 },
				content: (ctx) => (
					<AimlapiInputContent
						{...ctx}
						error={error}
						hint={Llms.AIMLAPI_MESSAGES.apiKeyHiddenHint}
						password
						placeholder="Paste your key..."
						title={Llms.AIMLAPI_MESSAGES.apiKeyInputPrompt}
					/>
				),
			});
			if (!pastedKey) return false;
			let balance: Llms.AimlapiBalanceResult;
			try {
				balance = await withLoadingDialog(
					dialog,
					"Verifying API key...",
					async () => Llms.validateAimlapiApiKey(pastedKey),
				);
			} catch (cause) {
				// Only a genuine auth rejection (401/403) means the key is invalid.
				// Every other failure — timeout, network error, 5xx, non-JSON, or a
				// key issued for a different environment than the configured inference
				// base URL — must surface its real reason instead of masquerading as
				// "invalid key" and sending users to chase a working key.
				const isAuthRejection =
					cause instanceof Llms.AimlapiApiError &&
					(cause.status === 401 || cause.status === 403);
				error = isAuthRejection
					? Llms.AIMLAPI_MESSAGES.apiKeyInvalid
					: cause instanceof Error
						? cause.message
						: String(cause);
				continue;
			}
			// The key is valid, so persist it right away — a low balance is a top-up
			// opportunity, not a reason to reject a working key.
			const key = pastedKey.trim();
			saveLocalProviderSettings(manager, {
				providerId: "aimlapi",
				apiKey: key,
				baseUrl: Llms.resolveAimlapiEndpoints().inferenceBaseUrl,
				model: Llms.AIMLAPI_DEFAULT_MODEL,
			});
			if (!balance.lowBalance) {
				await showDone(dialog, termHeight, { toppedUp: false });
				return true;
			}
			// A valid key with a low balance can fund its own account via the by-key
			// checkout (bound to this key), so offer the optional top-up chooser.
			const lowBalanceAction = await dialog.choice<LowBalanceAction>({
				style: { maxHeight: termHeight - 2 },
				content: (ctx) => <AimlapiLowBalanceContent {...ctx} />,
			});
			if (!lowBalanceAction || lowBalanceAction === "skip") {
				await showDone(dialog, termHeight, { toppedUp: false });
				return true;
			}
			const topUp = await promptAimlapiTopUpAmount(dialog, termHeight);
			if (!topUp) {
				await showDone(dialog, termHeight, { toppedUp: false });
				return true;
			}
			const provisioned = await runAimlapiProvision(
				dialog,
				termHeight,
				(onStatus, signal) =>
					Llms.provisionAimlapiKeyByKey({
						apiKey: key,
						amountUsd: topUp.amount,
						autoTopUp: topUp.autoTopUp,
						onStatus,
						signal,
						openCheckout: openAimlapiCheckout,
					}),
			);
			if (!provisioned) {
				await showDone(dialog, termHeight, { toppedUp: false });
				return true;
			}
			saveLocalProviderSettings(manager, {
				providerId: "aimlapi",
				apiKey: provisioned.apiKey,
				baseUrl: provisioned.baseUrl,
				model: provisioned.model,
			});
			await showDone(dialog, termHeight, {
				toppedUp: true,
				amount: topUp.amount,
			});
			return true;
		}
	}

	let emailError: string | undefined;
	let email = "";
	let onboarding: Llms.AimlapiEmailOnboardingResult;
	while (true) {
		const value = await dialog.choice<string>({
			style: { maxHeight: termHeight - 2 },
			content: (ctx) => (
				<AimlapiInputContent
					{...ctx}
					error={emailError}
					initialValue={email}
					placeholder="you@example.com"
					title={Llms.AIMLAPI_MESSAGES.enterEmail}
				/>
			),
		});
		if (!value) return false;
		email = value;
		if (!Llms.isValidAimlapiEmail(email)) {
			emailError = Llms.AIMLAPI_MESSAGES.emailInvalid;
			continue;
		}
		try {
			onboarding = await withLoadingDialog(
				dialog,
				"Checking aimlapi.com account...",
				async () => Llms.beginAimlapiEmailOnboarding(email),
			);
			break;
		} catch (cause) {
			emailError = cause instanceof Error ? cause.message : String(cause);
		}
	}

	let sessionToken: string;
	let apiKey = "";
	let apiKeyId = "";
	let exchange = onboarding.action === "new-account";
	if (onboarding.action === "new-account") {
		sessionToken = onboarding.sessionToken;
	} else {
		let codeError: string | undefined;
		while (true) {
			const code = await dialog.choice<string>({
				style: { maxHeight: termHeight - 2 },
				content: (ctx) => (
					<AimlapiInputContent
						{...ctx}
						error={codeError}
						placeholder="123456"
						title={Llms.AIMLAPI_MESSAGES.codeSent(email)}
					/>
				),
			});
			if (!code) return false;
			try {
				const signedIn = await withLoadingDialog(
					dialog,
					"Verifying code...",
					async () => Llms.completeAimlapiCodeSignIn(email, code),
				);
				sessionToken = signedIn.sessionToken;
				apiKey = signedIn.apiKey;
				apiKeyId = signedIn.apiKeyId;
				exchange = false;
				if (!signedIn.lowBalance) {
					saveLocalProviderSettings(manager, {
						providerId: "aimlapi",
						apiKey,
						baseUrl: Llms.resolveAimlapiEndpoints().inferenceBaseUrl,
						model: Llms.AIMLAPI_DEFAULT_MODEL,
					});
					await showDone(dialog, termHeight, { toppedUp: false });
					return true;
				}
				break;
			} catch {
				codeError = Llms.AIMLAPI_MESSAGES.codeIncorrect;
			}
		}

		const lowBalanceAction = await dialog.choice<LowBalanceAction>({
			style: { maxHeight: termHeight - 2 },
			content: (ctx) => <AimlapiLowBalanceContent {...ctx} />,
		});
		if (!lowBalanceAction) return false;
		if (lowBalanceAction === "skip") {
			saveLocalProviderSettings(manager, {
				providerId: "aimlapi",
				apiKey,
				baseUrl: Llms.resolveAimlapiEndpoints().inferenceBaseUrl,
				model: Llms.AIMLAPI_DEFAULT_MODEL,
			});
			await showDone(dialog, termHeight, { toppedUp: false });
			return true;
		}
	}

	const topUp = await promptAimlapiTopUpAmount(dialog, termHeight);
	if (!topUp) return false;

	const provisioned = await runAimlapiProvision(
		dialog,
		termHeight,
		(onStatus, signal) =>
			Llms.provisionAimlapiKey({
				sessionToken,
				exchange,
				existingApiKey: apiKey,
				existingApiKeyId: apiKeyId,
				amountUsd: topUp.amount,
				autoTopUp: topUp.autoTopUp,
				onStatus,
				signal,
				openCheckout: openAimlapiCheckout,
			}),
	);
	if (!provisioned) return false;
	saveLocalProviderSettings(manager, {
		providerId: "aimlapi",
		apiKey: provisioned.apiKey,
		baseUrl: provisioned.baseUrl,
		model: provisioned.model,
	});
	await showDone(dialog, termHeight, {
		magicLinkEmail: onboarding.action === "new-account" ? email : undefined,
		toppedUp: true,
		amount: topUp.amount,
	});
	return true;
}
