export const AIMLAPI_MESSAGES = {
	apiKeyInputPrompt: "Enter your aimlapi.com key.",
	apiKeyHiddenHint: "Your API key will be hidden and verified automatically.",
	apiKeyInvalid:
		"API key is invalid. Please make sure you enter a valid aimlapi.com key.",
	pickPathPrompt: "Do you have aimlapi.com key?",
	pickPathHaveKey: "I already have aimlapi.com key",
	pickPathHaveHint: "Proceed to paste the key",
	pickPathNewUser: "I am a new user",
	pickPathNewHint: "One click set up",
	enterEmail: "Enter your email.",
	emailInvalid: "Email format is incorrect.",
	codeSent: (email: string) => `We sent a 6-digit code to ${email}.`,
	codeIncorrect: "Code you've entered is incorrect.",
	lowBalance: "Your aimlapi.com balance is running low.",
	lowBalanceHint: "It is recommended to top up your balance.",
	lowBalanceTopUp: "Sure, let's do that",
	lowBalanceSkip: "I'll skip topping up the balance for now",
	topUpPrompt: "Add credits (min $20).",
	autoTopUpLabel: "Auto top-up",
	autoTopUpHint:
		"Automatically add the same amount when your balance runs low.",
	amountRequired: "Please enter a top-up amount.",
	topUpBrowserFallback:
		"If the browser did not open automatically please use this link to top up your account:",
	topUpFailed: "Top up failed. Please try again.",
	everythingRuns: "Everything is ready.",
	topUpSuccess: (amountUsd?: string) =>
		amountUsd
			? `Top-up successful — $${amountUsd} credited to your account`
			: "Top-up successful.",
	successMagicLink: (email: string) =>
		`We've emailed you a magic link to ${email}. Use it to access your aimlapi.com account and review your usage and balance.`,
} as const;
