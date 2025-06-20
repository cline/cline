import { Metadata } from "next"

export const metadata: Metadata = {
	title: "Privacy Policy - Roo Code",
	description:
		"Privacy policy for Roo Code Cloud and marketing website. Learn how we handle your data and protect your privacy.",
}

export default function Privacy() {
	return (
		<>
			<div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
				<div className="prose prose-lg mx-auto max-w-4xl dark:prose-invert">
					<h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
						Roo Code Cloud Privacy Policy
					</h1>
					<p className="text-muted-foreground">Last Updated: June 19, 2025</p>

					<p className="lead">
						This Privacy Policy explains how Roo Code, Inc. (&quot;Roo Code,&quot; &quot;we,&quot;
						&quot;our,&quot; or &quot;us&quot;) collects, uses, and shares information when you:
					</p>
					<ul className="lead">
						<li>
							browse any page under <strong>roocode.com</strong> (the <em>Marketing Site</em>); and/or
						</li>
						<li>
							create an account for, sign in to, or otherwise use <strong>Roo Code Cloud</strong> at{" "}
							<strong>app.roocode.com</strong> or through the Roo Code extension while authenticated to
							that Cloud account (the <em>Cloud Service</em>).
						</li>
					</ul>

					<div className="my-8 rounded-lg border border-border bg-muted/50 p-6">
						<h3 className="mt-0 text-lg font-semibold">Extension‑Only Usage</h3>
						<p className="mb-0">
							If you run the Roo Code extension <strong>without</strong> connecting to a Cloud account,
							your data is governed by the standalone{" "}
							<a
								href="https://github.com/RooCodeInc/Roo-Code/blob/main/PRIVACY.md"
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary hover:underline">
								Roo Code Extension Privacy Policy
							</a>
							.
						</p>
					</div>

					<h2 className="mt-12 text-2xl font-bold">Quick Summary</h2>
					<ul>
						<li>
							<strong>Your source code never transits Roo Code servers.</strong> It stays on your device
							and is sent <strong>directly</strong>—via a client‑to‑provider TLS connection—to the
							third‑party AI model you select. Roo Code never stores, inspects, or trains on your code.
						</li>
						<li>
							<strong>Prompts and chat snippets are collected by default</strong> in Roo Code Cloud so you
							can search and re‑use past conversations. Organization admins can disable this collection at
							any time.
						</li>
						<li>
							We collect only the data needed to operate Roo Code Cloud, do <strong>not</strong> sell
							customer data, and do <strong>not</strong> use your content to train models.
						</li>
					</ul>

					<h2 className="mt-12 text-2xl font-bold">1. Information We Collect</h2>

					<div className="overflow-x-auto">
						<table className="min-w-full border-collapse border border-border">
							<thead>
								<tr className="bg-muted/50">
									<th className="border border-border px-4 py-2 text-left font-semibold">Category</th>
									<th className="border border-border px-4 py-2 text-left font-semibold">Examples</th>
									<th className="border border-border px-4 py-2 text-left font-semibold">Source</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">Account Information</td>
									<td className="border border-border px-4 py-2">
										Name, email, organization, auth tokens
									</td>
									<td className="border border-border px-4 py-2">You</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">
										Workspace Configuration
									</td>
									<td className="border border-border px-4 py-2">
										Org settings, allow‑lists, rules files, modes, dashboards
									</td>
									<td className="border border-border px-4 py-2">You / Extension (when signed in)</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">
										Prompts, Chat Snippets & Token Counts
									</td>
									<td className="border border-border px-4 py-2">
										Text prompts, model outputs, token counts
									</td>
									<td className="border border-border px-4 py-2">Extension (when signed in)</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">Usage Data</td>
									<td className="border border-border px-4 py-2">
										Feature clicks, error logs, performance metrics (captured via PostHog)
									</td>
									<td className="border border-border px-4 py-2">Services automatically (PostHog)</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">Payment Data</td>
									<td className="border border-border px-4 py-2">
										Tokenized card details, billing address, invoices
									</td>
									<td className="border border-border px-4 py-2">Payment processor (Stripe)</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">Marketing Data</td>
									<td className="border border-border px-4 py-2">
										Cookies, IP address, browser type, page views,{" "}
										<strong>voluntary form submissions</strong> (e.g., newsletter or wait‑list
										sign‑ups)
									</td>
									<td className="border border-border px-4 py-2">
										Marketing Site automatically / You
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<h2 className="mt-12 text-2xl font-bold">2. How We Use Information</h2>
					<ul>
						<li>
							<strong>Operate & secure Roo Code Cloud</strong> (authentication, completions, abuse
							prevention)
						</li>
						<li>
							<strong>Provide support & improve features</strong> (debugging, analytics, product
							decisions)
						</li>
						<li>
							<strong>Process payments & manage subscriptions</strong>
						</li>
						<li>
							<strong>Send product updates and roadmap communications</strong> (opt‑out available)
						</li>
					</ul>

					<h2 className="mt-12 text-2xl font-bold">3. Where Your Data Goes (And Doesn&apos;t)</h2>

					<div className="overflow-x-auto">
						<table className="min-w-full border-collapse border border-border">
							<thead>
								<tr className="bg-muted/50">
									<th className="border border-border px-4 py-2 text-left font-semibold">Data</th>
									<th className="border border-border px-4 py-2 text-left font-semibold">Sent To</th>
									<th className="border border-border px-4 py-2 text-left font-semibold">
										<strong>Not</strong> Sent To
									</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">
										Code & files you work on
									</td>
									<td className="border border-border px-4 py-2">
										Your chosen model provider (direct client → provider TLS)
									</td>
									<td className="border border-border px-4 py-2">
										Roo Code servers; ad networks; model‑training pipelines
									</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">
										Prompts, chat snippets & token counts (Cloud)
									</td>
									<td className="border border-border px-4 py-2">
										Roo Code Cloud (encrypted at rest)
									</td>
									<td className="border border-border px-4 py-2">Any third‑party</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">
										Workspace Configuration
									</td>
									<td className="border border-border px-4 py-2">
										Roo Code Cloud (encrypted at rest)
									</td>
									<td className="border border-border px-4 py-2">Any third-party</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">Usage & Telemetry</td>
									<td className="border border-border px-4 py-2">
										PostHog (self‑hosted analytics platform)
									</td>
									<td className="border border-border px-4 py-2">Ad networks or data brokers</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">Payment Data</td>
									<td className="border border-border px-4 py-2">Stripe (PCI‑DSS Level 1)</td>
									<td className="border border-border px-4 py-2">
										Roo Code servers (we store only the Stripe customer ID)
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<h2 className="mt-12 text-2xl font-bold">4. Data Retention</h2>
					<ul>
						<li>
							<strong>Source Code:</strong> Never stored on Roo Code servers.
						</li>
						<li>
							<strong>Prompts & Chat Snippets:</strong> Persist in your Cloud workspace until you or your
							organization admin deletes them or disables collection.
						</li>
						<li>
							<strong>Operational Logs & Analytics:</strong> Retained only as needed to operate and secure
							Roo Code Cloud.
						</li>
					</ul>

					<h2 className="mt-12 text-2xl font-bold">5. Your Choices</h2>
					<ul>
						<li>
							<strong>Manage cookies:</strong> You can block or delete cookies in your browser settings;
							some site features may not function without them.
						</li>
						<li>
							<strong>Disable prompt collection</strong> in Organization settings.
						</li>
						<li>
							<strong>Delete your Cloud account</strong> at any time from{" "}
							<strong>Security Settings</strong> inside Roo Code Cloud.
						</li>
					</ul>

					<h2 className="mt-12 text-2xl font-bold">6. Security Practices</h2>
					<p>
						We use TLS for all data in transit, AES‑256 encryption at rest, least‑privilege IAM, continuous
						monitoring, routine penetration testing, and maintain a SOC 2 program.
					</p>

					<h2 className="mt-12 text-2xl font-bold">7. Updates to This Policy</h2>
					<p>
						If our privacy practices change, we will update this policy and note the new{" "}
						<strong>Last Updated</strong> date at the top. For material changes that affect Cloud
						workspaces, we will also email registered workspace owners before the changes take effect.
					</p>

					<h2 className="mt-12 text-2xl font-bold">8. Contact Us</h2>
					<p>
						Questions or concerns? Email{" "}
						<a href="mailto:privacy@roocode.com" className="text-primary hover:underline">
							privacy@roocode.com
						</a>
						.
					</p>
				</div>
			</div>
		</>
	)
}
