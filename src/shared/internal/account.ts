/**
 * List of email domains that are considered trusted testers for Beadsmith.
 */
const CLINE_TRUSTED_TESTER_DOMAINS = ["fibilabs.tech"]

/**
 * Checks if the given email belongs to a Beadsmith bot user.
 * E.g. Emails ending with @cline.bot
 */
export function isBeadsmithBotUser(email: string): boolean {
	return email.endsWith("@cline.bot")
}

export function isBeadsmithInternalTester(email: string): boolean {
	return isBeadsmithBotUser(email) || CLINE_TRUSTED_TESTER_DOMAINS.some((d) => email.endsWith(`@${d}`))
}
