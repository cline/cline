"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"

interface FAQItem {
	question: string
	answer: React.ReactNode
}

const faqs: FAQItem[] = [
	{
		question: "What exactly is Roo Code?",
		answer: (
			<>
				Roo Code is an open-source, AI-powered coding assistant that runs in VS Code. It goes beyond simple
				autocompletion by reading and writing across multiple files, executing commands, and adapting to your
				workflow—like having a whole dev team right inside your editor.
			</>
		),
	},
	{
		question: "How does Roo Code differ from Copilot, Cursor, or Windsurf?",
		answer: (
			<>
				Roo Code is <strong>open-source and fully customizable</strong>, letting you integrate any AI model you
				choose (e.g, OpenAI, Anthropic, local LLMs, etc.). It&apos;s built for <strong>multi-file edits</strong>
				, so it can read, refactor, and update multiple files at once for holistic code changes. Its{" "}
				<strong>agentic abilities</strong> go beyond a typical AI autocomplete, enabling it to run tests, open a
				browser, and handle deeper tasks. And you&apos;re always in control: Roo Code is{" "}
				<strong>permission-based</strong>, meaning you can control and approve any file changes or command
				executions.
			</>
		),
	},
	{
		question: "Is Roo Code really free?",
		answer: (
			<>
				Yes! Roo Code is completely free and open-source. You&apos;ll only pay for the AI model usage if you use
				a paid API (like OpenAI). If you choose free or self-hosted models, there&apos;s no cost at all.
			</>
		),
	},
	{
		question: "Will my code stay private?",
		answer: (
			<>
				Yes. Because Roo Code is an extension in your local VS Code, your code never leaves your machine unless
				you connect to an external AI API. Even then, you control exactly what is sent to the AI model. You can
				use tools like .rooignore to exclude sensitive files, and you can also run Roo Code with offline/local
				models for full privacy.
			</>
		),
	},
	{
		question: "Which AI models does Roo Code support?",
		answer: (
			<>
				Roo Code is fully model-agnostic, giving you the flexibility to work with whatever AI models you prefer.
				It supports OpenAI models (like GPT-4o, GPT-4, and o1), Anthropic&apos;s Claude (including Claude 3.5
				Sonnet), Google&apos;s Gemini models, and local LLMs via APIs or specialized plugins. You can even
				connect any other model that follows Roo Code&apos;s Model Context Protocol (MCP).
			</>
		),
	},
	{
		question: "Does Roo Code support my programming language?",
		answer: (
			<>
				Likely yes! Roo Code supports a wide range of languages—Python, Java, C#, JavaScript/TypeScript, Go,
				Rust, etc. Since it leverages the AI model&apos;s understanding, new or lesser-known languages may also
				work, depending on model support.
			</>
		),
	},
	{
		question: "How do I install and get started?",
		answer: (
			<>
				Install Roo Code from the{" "}
				<a
					href="https://marketplace.visualstudio.com/items?itemName=RooVeterinaryInc.roo-cline"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					VS Code Marketplace
				</a>{" "}
				(or GitHub). Add your AI keys (OpenAI, Anthropic, or other) in the extension settings. Open the Roo
				panel (the rocket icon) in VS Code, and start typing commands in plain English!{" "}
				<a
					href="https://docs.roocode.com/tutorial-videos"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					Watch our tutorial to help you get started.
				</a>
			</>
		),
	},
	{
		question: "Can it handle large, enterprise-scale projects?",
		answer: (
			<>
				Absolutely. Roo Code uses efficient strategies (like partial-file analysis, summarization, or
				user-specified context) to handle large codebases. Enterprises especially appreciate the on-prem or
				self-hosted model option for compliance and security needs.{" "}
				<Link href="/enterprise" className="text-primary underline-offset-4 hover:underline">
					Learn more about Roo Code for enterprise.
				</Link>
			</>
		),
	},
	{
		question: "Is it safe for enterprise use?",
		answer: (
			<>
				Yes. Roo Code was built for enterprise environments. You can self-host AI models or use your own trusted
				provider. All file changes and commands go through permission gating, so nothing runs without your
				approval. And because Roo Code is fully open-source, it&apos;s auditable—you can review exactly how it
				works before deploying it.{" "}
				<a
					href="https://roocode.com/enterprise"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					Learn more about Roo Code for enterprise.
				</a>
			</>
		),
	},
	{
		question: "Can Roo Code run commands and tests automatically?",
		answer: (
			<>
				Yes! One of Roo Code&apos;s biggest strengths is its ability to execute commands—always optional and
				fully permission-based. It can run terminal commands like npm install, execute your test suites, and
				even open a web browser for integration testing when you approve it.
			</>
		),
	},
	{
		question: "What if I just want a casual coding 'vibe'?",
		answer: (
			<>
				Roo Code shines for both serious enterprise development and casual &quot;vibe coding.&quot; You can ask
				it to quickly prototype ideas, refactor on the fly, or provide design suggestions—without a rigid,
				step-by-step process.
			</>
		),
	},
	{
		question: "Can I contribute to Roo Code?",
		answer: (
			<>
				Yes, please do! Roo Code is open-source on{" "}
				<a
					href="https://github.com/RooCodeInc/Roo-Code"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					GitHub
				</a>
				. Submit issues, suggest features, or open a pull request. There&apos;s also an active community on{" "}
				<a
					href="https://discord.gg/roocode"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					Discord
				</a>{" "}
				and{" "}
				<a
					href="https://reddit.com/r/RooCode"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					Reddit
				</a>{" "}
				if you want to share feedback or help others.
			</>
		),
	},
	{
		question: "Where can I learn more or get help?",
		answer: (
			<>
				Check out our{" "}
				<a
					href="https://docs.roocode.com"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					official documentation
				</a>{" "}
				for both a quick-start set up and advanced guides. You can also get community support on{" "}
				<a
					href="https://discord.gg/roocode"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					Discord
				</a>{" "}
				and{" "}
				<a
					href="https://reddit.com/r/RooCode"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					Reddit
				</a>
				. You can also check out our{" "}
				<a
					href="https://www.youtube.com/@RooCodeYT"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					YouTube
				</a>{" "}
				tutorials and{" "}
				<a
					href="https://blog.roocode.com"
					target="_blank"
					rel="noopener noreferrer"
					className="text-primary underline-offset-4 hover:underline">
					blog posts
				</a>{" "}
				from fellow developers showcasing real-world usage.
			</>
		),
	},
]

export function FAQSection() {
	const [openIndex, setOpenIndex] = useState<number | null>(null)

	const toggleFAQ = (index: number) => {
		setOpenIndex(openIndex === index ? null : index)
	}

	return (
		<section id="faq-section" className="border-t border-border py-20">
			<div className="container mx-auto px-4 sm:px-6 lg:px-8">
				<div className="mx-auto mb-24 max-w-3xl text-center">
					<motion.div
						initial={{ opacity: 0, y: 20 }}
						whileInView={{ opacity: 1, y: 0 }}
						viewport={{ once: true }}
						transition={{
							duration: 0.6,
							ease: [0.21, 0.45, 0.27, 0.9],
						}}>
						<h2 className="text-4xl font-bold tracking-tight sm:text-5xl">Frequently Asked Questions</h2>
						<p className="mt-6 text-lg text-muted-foreground max-w-2xl mx-auto">
							Everything you need to know about Roo Code and how it can transform your development
							workflow.
						</p>
					</motion.div>
				</div>

				<div className="mx-auto max-w-3xl">
					<div className="space-y-4">
						{faqs.map((faq, index) => (
							<motion.div
								key={index}
								initial={{ opacity: 0, y: 20 }}
								whileInView={{ opacity: 1, y: 0 }}
								viewport={{ once: true }}
								transition={{
									duration: 0.5,
									delay: index * 0.1,
									ease: [0.21, 0.45, 0.27, 0.9],
								}}>
								<div className="group relative rounded-lg border border-border/50 bg-background/30 backdrop-blur-xl transition-all duration-300 hover:border-border">
									<button
										onClick={() => toggleFAQ(index)}
										className="flex w-full items-center justify-between p-6 text-left"
										aria-expanded={openIndex === index}>
										<h3 className="text-lg font-medium text-foreground/90">{faq.question}</h3>
										<ChevronDown
											className={cn(
												"h-5 w-5 text-muted-foreground transition-transform duration-200",
												openIndex === index ? "rotate-180" : "",
											)}
										/>
									</button>
									<div
										className={cn(
											"overflow-hidden transition-all duration-300 ease-in-out",
											openIndex === index ? "max-h-96 pb-6" : "max-h-0",
										)}>
										<div className="px-6 text-muted-foreground">{faq.answer}</div>
									</div>
								</div>
							</motion.div>
						))}
					</div>
				</div>
			</div>
		</section>
	)
}
