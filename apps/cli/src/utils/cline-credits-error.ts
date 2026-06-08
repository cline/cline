export const CLINE_CREDITS_DASHBOARD_URL =
	"https://app.cline.bot/dashboard/account?tab=credits&redirect=true";

export function isClineCreditsBalanceErrorMessage(message: string): boolean {
	const normalized = message.trim().toLowerCase();
	return (
		normalized.includes("insufficient balance") &&
		normalized.includes("cline credits balance")
	);
}

export function formatClineCreditsBalanceErrorMessage(): string {
	return [
		"Cline Credits depleted",
		"You have run out of Cline credits. Add credits in the dashboard to continue.",
		`Dashboard: ${CLINE_CREDITS_DASHBOARD_URL}`,
	].join("\n");
}
