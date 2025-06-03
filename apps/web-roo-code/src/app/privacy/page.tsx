import { Metadata } from "next"

export const metadata: Metadata = {
	title: "Privacy Policy - Roo Code Marketing Website",
	description:
		"Privacy policy for the Roo Code marketing website. Learn how we handle your data and protect your privacy.",
}

export default function Privacy() {
	return (
		<>
			<div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
				<div className="prose prose-lg mx-auto max-w-3xl dark:prose-invert">
					<h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
						Roo Code Marketing Landing Page Privacy Policy
					</h1>
					<p className="text-muted-foreground">Last Updated: March 7th, 2025</p>

					<p className="lead">
						Roo Code respects your privacy and is committed to being transparent about how data is collected
						and used on our marketing landing page. This policy focuses on data handling for the Roo Code
						marketing website. For details on how your data is handled within the Roo Code extension itself,
						please refer to our separate{" "}
						<a
							href="https://github.com/RooCodeInc/Roo-Code/blob/main/PRIVACY.md"
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary hover:underline">
							Roo Code Extension Privacy Policy
						</a>
						.
					</p>

					<h2 className="mt-8 text-2xl font-bold">Where Your Data Goes (And Where It Doesn&apos;t)</h2>

					<h3 className="mt-6 text-xl font-bold">Website Analytics & Tracking</h3>
					<ul>
						<li>
							We use PostHog (and its standard features) on our marketing landing page to analyze site
							traffic and usage trends. This collection includes information such as your IP address,
							browser type, device information, and pages visited.
						</li>
						<li>
							These analytics help us understand how users engage with the website, so we can improve
							content and design.
						</li>
						<li>We do not collect code, project data, or any AI-related prompts on this page.</li>
					</ul>

					<h3 className="mt-6 text-xl font-bold">Cookies and Similar Technologies</h3>
					<ul>
						<li>
							Our marketing website may use cookies or similar tracking technologies to remember user
							preferences and provide aggregated analytics.
						</li>
						<li>
							Cookies help with things like user session management, remembering certain selections or
							preferences, and compiling anonymous statistics.
						</li>
					</ul>

					<h3 className="mt-6 text-xl font-bold">Forms & Voluntary Submissions</h3>
					<ul>
						<li>
							If you submit your email or other personal data on our landing page (for example, to receive
							updates or join a waiting list), we collect that information voluntarily provided by you.
						</li>
						<li>
							We do not share or sell this data to third parties for their own marketing purposes. It is
							used only to communicate with you about Roo Code, respond to inquiries, or send updates
							you&apos;ve requested.
						</li>
					</ul>

					<h3 className="mt-6 text-xl font-bold">Third-Party Integrations</h3>
					<ul>
						<li>
							Our website may embed content or links to external platforms (e.g., for processing payments
							or handling support). Any data you provide through these external sites is governed by the
							privacy policies of those platforms.
						</li>
					</ul>

					<h2 className="mt-8 text-2xl font-bold">How We Use Your Data</h2>

					<h3 className="mt-6 text-xl font-bold">Site Improvements & Marketing</h3>
					<ul>
						<li>
							We analyze aggregated user behavior to measure the effectiveness of our site, troubleshoot
							any issues, and guide future improvements.
						</li>
						<li>
							If you sign up for newsletters or updates, we use your email or other contact information
							only to send you relevant Roo Code communications.
						</li>
					</ul>

					<h3 className="mt-6 text-xl font-bold">No Selling or Sharing of Data</h3>
					<ul>
						<li>
							We do not sell or share your personally identifiable information with third parties for
							their marketing.
						</li>
						<li>We do not train any models on your marketing site data.</li>
					</ul>

					<h2 className="mt-8 text-2xl font-bold">Your Choices & Control</h2>

					<h3 className="mt-6 text-xl font-bold">Manage Cookies</h3>
					<ul>
						<li>
							Most browsers allow you to manage or block cookies. If you disable cookies, some features of
							the site may not function properly.
						</li>
					</ul>

					<h3 className="mt-6 text-xl font-bold">Opt-Out of Communications</h3>
					<ul>
						<li>
							If you have signed up to receive updates, you can unsubscribe anytime by following the
							instructions in our emails or contacting us directly.
						</li>
					</ul>

					<h3 className="mt-6 text-xl font-bold">Request Deletion</h3>
					<ul>
						<li>
							You may request the deletion of any personal data you&apos;ve provided through our marketing
							forms by reaching out to us at{" "}
							<a href="mailto:support@roocode.com" className="text-primary hover:underline">
								support@roocode.com
							</a>
							.
						</li>
					</ul>

					<h2 className="mt-8 text-2xl font-bold">Security & Updates</h2>
					<ul>
						<li>
							We take reasonable measures to protect your data from unauthorized access or disclosure, but
							no website can be 100% secure.
						</li>
						<li>
							If our privacy practices for the marketing site change, we will update this policy and note
							the effective date at the top.
						</li>
					</ul>

					<h2 className="mt-8 text-2xl font-bold">Contact Us</h2>
					<p>
						If you have questions or concerns about this Privacy Policy or wish to make a request regarding
						your data, please reach out to us at{" "}
						<a href="mailto:support@roocode.com" className="text-primary hover:underline">
							support@roocode.com
						</a>
						.
					</p>

					<div className="mt-8 border-t border-border pt-6">
						<p className="text-muted-foreground">
							By using the Roo Code marketing landing page, you agree to this Privacy Policy. If you use
							the Roo Code extension, please see our separate{" "}
							<a
								href="https://github.com/RooCodeInc/Roo-Code/blob/main/PRIVACY.md"
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary hover:underline">
								Roo Code Extension Privacy Policy
							</a>{" "}
							for details on data handling in the extension.
						</p>
					</div>
				</div>
			</div>
		</>
	)
}
