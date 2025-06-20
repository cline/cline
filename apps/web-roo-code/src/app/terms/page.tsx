import { Metadata } from "next"

export const metadata: Metadata = {
	title: "Terms of Service - Roo Code",
	description:
		"Terms of Service for Roo Code Cloud. Learn about our service terms, commercial conditions, and legal framework.",
}

export default function Terms() {
	return (
		<>
			<div className="container mx-auto px-4 py-12 sm:px-6 lg:px-8">
				<div className="prose prose-lg mx-auto max-w-4xl dark:prose-invert">
					<h1 className="text-3xl font-bold tracking-tight sm:text-4xl md:text-5xl">
						Roo Code Cloud Terms of Service
					</h1>
					<p className="text-muted-foreground">
						<em>(Version 1.0 – Effective June 19, 2025)</em>
					</p>

					<p className="lead">
						These Terms of Service (&quot;<strong>TOS</strong>&quot;) govern access to and use of the Roo
						Code Cloud service (the &quot;<strong>Service</strong>&quot;). They apply to:
					</p>
					<ul className="lead">
						<li>
							<strong>(a)</strong> every <strong>Sales Order Form</strong> or similar document mutually
							executed by Roo Code and the customer that references these TOS; <strong>and</strong>
						</li>
						<li>
							<strong>(b)</strong> any{" "}
							<strong>online plan-selection, self-service sign-up, or in-app purchase flow</strong>{" "}
							through which a customer clicks an &quot;I Agree&quot; (or equivalent) button to accept
							these TOS — such flow also being an <strong>&quot;Order Form.&quot;</strong>
						</li>
					</ul>

					<p>
						By <strong>creating an account, clicking to accept, or using the Service</strong>, the person or
						entity doing so (&quot;<strong>Customer</strong>&quot;) agrees to be bound by these TOS, even if
						no separate Order Form is signed.
					</p>

					<p>
						If Roo Code and Customer later execute a Master Subscription Agreement (&quot;
						<strong>MSA</strong>&quot;), the MSA governs; otherwise, these TOS and the applicable Order Form
						together form the entire agreement (the &quot;<strong>Agreement</strong>&quot;).
					</p>

					<h2 className="mt-12 text-2xl font-bold">1. Agreement Framework</h2>
					<ol>
						<li>
							<strong>Incorporation of Standard Terms.</strong>
							<br />
							The{" "}
							<a
								href="https://commonpaper.com/standards/cloud-service-agreement/2.0/"
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary hover:underline">
								<em>Common Paper Cloud Service Standard Terms v 2.0</em>
							</a>{" "}
							(the &quot;<strong>Standard Terms</strong>&quot;) are incorporated by reference. If these
							TOS conflict with the Standard Terms, these TOS control.
						</li>
						<li>
							<strong>Order of Precedence.</strong>
							<br />
							(a) Order Form (b) these TOS (c) Standard Terms.
						</li>
					</ol>

					<h2 className="mt-12 text-2xl font-bold">2. Key Commercial Terms</h2>

					<div className="overflow-x-auto">
						<table className="min-w-full border-collapse border border-border">
							<thead>
								<tr className="bg-muted/50">
									<th className="border border-border px-4 py-2 text-left font-semibold">Term</th>
									<th className="border border-border px-4 py-2 text-left font-semibold">Value</th>
								</tr>
							</thead>
							<tbody>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">
										Governing Law / Forum
									</td>
									<td className="border border-border px-4 py-2">
										Delaware law; exclusive jurisdiction and venue in the state or federal courts
										located in Delaware
									</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">
										Plans & Subscription Periods
									</td>
									<td className="border border-border px-4 py-2">
										<em>Free Plan:</em> month-to-month.
										<br />
										<em>Paid Plans:</em> Monthly <strong>or</strong> Annual, as selected in an Order
										Form or the online flow.
									</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">
										Auto-Renewal & Non-Renewal Notice
									</td>
									<td className="border border-border px-4 py-2">
										<em>Free Plan:</em> renews continuously until cancelled in the dashboard.
										<br />
										<em>Paid Plans:</em> renew for the same period unless either party gives 30
										days&apos; written notice before the current period ends.
									</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">Fees & Usage</td>
									<td className="border border-border px-4 py-2">
										<em>Free Plan:</em> Subscription Fee = $0.
										<br />
										<em>Paid Plans:</em> Fees stated in the Order Form or online checkout{" "}
										<strong>plus</strong> usage-based fees, calculated and invoiced monthly.
									</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">Payment Terms</td>
									<td className="border border-border px-4 py-2">
										<em>Monthly paid plans:</em> credit-card charge on the billing date.
										<br />
										<em>Annual paid plans:</em> invoiced Net 30 (credit card optional).
									</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">
										General Liability Cap
									</td>
									<td className="border border-border px-4 py-2">
										The greater of (i) USD 100 and (ii) 1 × Fees paid or payable in the 12 months
										before the event giving rise to liability.
									</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">
										Increased Cap / Unlimited Claims
									</td>
									<td className="border border-border px-4 py-2">None</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">Trial / Pilot</td>
									<td className="border border-border px-4 py-2">Not offered</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">Beta Features</td>
									<td className="border border-border px-4 py-2">
										None – only generally available features are provided
									</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">Security Standard</td>
									<td className="border border-border px-4 py-2">
										Roo Code maintains commercially reasonable administrative, physical, and
										technical safeguards
									</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">Machine-Learning Use</td>
									<td className="border border-border px-4 py-2">
										Roo Code <strong>does not</strong> use Customer Content to train, fine-tune, or
										improve any ML or AI models
									</td>
								</tr>
								<tr className="bg-muted/25">
									<td className="border border-border px-4 py-2 font-medium">
										Data Processing Addendum (DPA)
									</td>
									<td className="border border-border px-4 py-2">
										GDPR/CCPA-ready DPA available upon written request
									</td>
								</tr>
								<tr>
									<td className="border border-border px-4 py-2 font-medium">
										Publicity / Logo Rights
									</td>
									<td className="border border-border px-4 py-2">
										Roo Code may identify Customer (name & logo) in marketing materials unless
										Customer opts out in writing
									</td>
								</tr>
							</tbody>
						</table>
					</div>

					<h2 className="mt-12 text-2xl font-bold">3. Modifications to the Standard Terms</h2>
					<ol>
						<li>
							<strong>Section 1.6 (Machine Learning).</strong>
							<br />
							&quot;Provider will not use Customer Content or Usage Data to train, fine-tune, or improve
							any machine-learning or AI model, except with Customer&apos;s prior written consent.&quot;
						</li>
						<li>
							<strong>Section 3 (Security).</strong>
							<br />
							Replace &quot;reasonable&quot; with &quot;commercially reasonable.&quot;
						</li>
						<li>
							<strong>Section 4 (Fees & Payment).</strong>
							<br />
							Add usage-billing language above and delete any provision allowing unilateral fee increases.
						</li>
						<li>
							<strong>Section 5 (Term & Termination).</strong>
							<br />
							Insert auto-renewal and free-plan language above.
						</li>
						<li>
							<strong>Sections 7 (Trials / Betas) and any SLA references.</strong>
							<br />
							Deleted – Roo Code offers no trials, pilots, betas, or SLA credits under these TOS.
						</li>
						<li>
							<strong>Section 12.12 (Publicity).</strong>
							<br />
							As reflected in the &quot;Publicity / Logo Rights&quot; row above.
						</li>
					</ol>

					<h2 className="mt-12 text-2xl font-bold">4. Use of the Service</h2>
					<p>
						Customer may access and use the Service solely for its internal business purposes and subject to
						the Acceptable Use Policy in the Standard Terms.
					</p>

					<h2 className="mt-12 text-2xl font-bold">5. Account Management & Termination</h2>
					<ul>
						<li>
							<strong>Self-service cancellation or downgrade.</strong>
							<br />
							Customer may cancel a Free Plan immediately, or cancel/downgrade a Paid Plan effective at
							the end of the current billing cycle, via the web dashboard.
						</li>
						<li>
							Either party may otherwise terminate the Agreement as allowed under Section 5 of the
							Standard Terms.
						</li>
					</ul>

					<h2 className="mt-12 text-2xl font-bold">6. Privacy & Data</h2>
					<p>
						Roo Code&apos;s Privacy Notice (
						<a
							href="https://roocode.com/privacy"
							rel="noopener noreferrer"
							className="text-primary hover:underline">
							https://roocode.com/privacy
						</a>
						) explains how Roo Code collects and handles personal information. If Customer requires a DPA,
						email{" "}
						<a href="mailto:support@roocode.com" className="text-primary hover:underline">
							support@roocode.com
						</a>
						.
					</p>

					<h2 className="mt-12 text-2xl font-bold">7. Warranty Disclaimer</h2>
					<p>
						Except as expressly stated in the Agreement, the Service is provided{" "}
						<strong>&quot;as is,&quot;</strong> and all implied warranties are disclaimed to the maximum
						extent allowed by law.
					</p>

					<h2 className="mt-12 text-2xl font-bold">8. Limitation of Liability</h2>
					<p>
						The caps in Section 2 apply to all claims under the Agreement, whether in contract, tort, or
						otherwise, except for Excluded Claims defined in the Standard Terms.
					</p>

					<h2 className="mt-12 text-2xl font-bold">9. Miscellaneous</h2>
					<ol>
						<li>
							<strong>Assignment.</strong>
							<br />
							Customer may not assign the Agreement without Roo Code&apos;s prior written consent, except
							to a successor in a merger or sale of substantially all assets.
						</li>
						<li>
							<strong>Export Compliance.</strong>
							<br />
							Each party will comply with all applicable export-control laws and regulations and will not
							export or re-export any software or technical data without the required government licences.
						</li>
						<li>
							<strong>Entire Agreement.</strong>
							<br />
							The Agreement supersedes all prior or contemporaneous agreements for the Service.
						</li>
						<li>
							<strong>Amendments.</strong>
							<br />
							Roo Code may update these TOS by posting a revised version at the same URL and emailing or
							in-app notifying Customer at least 30 days before changes take effect. Continued use after
							the effective date constitutes acceptance.
						</li>
					</ol>

					<h2 className="mt-12 text-2xl font-bold">10. Contact</h2>
					<p>
						<strong>Roo Code, Inc.</strong>
						<br />
						98 Graceland Dr, San Rafael, CA 94901 USA
						<br />
						Email:{" "}
						<a href="mailto:support@roocode.com" className="text-primary hover:underline">
							support@roocode.com
						</a>
					</p>
				</div>
			</div>
		</>
	)
}
