"use client"

import { useState, useRef } from "react"
import { z } from "zod"

import {
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui"

// Define the form schema using Zod
const contactFormSchema = z.object({
	name: z.string().min(1, "Name is required"),
	company: z.string().min(1, "Company is required"),
	email: z.string().email("Invalid email address"),
	website: z.string().url("Invalid website URL").or(z.string().length(0)),
	engineerCount: z.enum(["1-10", "11-50", "51-200", "201-500", "501-1000", "1000+"]),
	formType: z.enum(["early-access", "demo"]),
	_honeypot: z.string().optional(),
})

interface ContactFormProps {
	formType: "early-access" | "demo"
	buttonText: string
	buttonClassName?: string
}

export function ContactForm({ formType, buttonText, buttonClassName }: ContactFormProps) {
	const [isOpen, setIsOpen] = useState(false)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [formErrors, setFormErrors] = useState<Record<string, string>>({})
	const [submitStatus, setSubmitStatus] = useState<"idle" | "success" | "error">("idle")
	const formRef = useRef<HTMLFormElement>(null)

	const formTitle = formType === "early-access" ? "Become an Early Access Partner" : "Request a Demo"

	const formDescription =
		formType === "early-access"
			? "Fill out the form below to collaborate in shaping Roo Code's enterprise solution."
			: "Fill out the form below to see Roo Code's enterprise capabilities in action."

	// Get Basin endpoint from environment variable
	// This should be set in .env.local as NEXT_PUBLIC_BASIN_ENDPOINT="https://usebasin.com/f/your-form-id"
	const BASIN_ENDPOINT = process.env.NEXT_PUBLIC_BASIN_ENDPOINT || ""

	// Check if Basin endpoint is configured
	if (!BASIN_ENDPOINT) {
		console.warn("NEXT_PUBLIC_BASIN_ENDPOINT is not configured. Form submissions will not work.")
	}

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		e.preventDefault()
		setIsSubmitting(true)
		setFormErrors({})
		setSubmitStatus("idle")

		const form = e.currentTarget
		const formData = new FormData(form)

		// Create a data object for validation and submission
		const data = {
			name: formData.get("name") as string,
			company: formData.get("company") as string,
			email: formData.get("email") as string,
			website: formData.get("website") as string,
			engineerCount: formData.get("engineerCount") as string,
			formType,
			// Include honeypot field for spam protection
			_honeypot: formData.get("_honeypot") as string,
		}

		// Validate form data on client side
		try {
			contactFormSchema.parse(data)

			// Submit data to Basin
			try {
				const response = await fetch(BASIN_ENDPOINT, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json",
					},
					mode: "cors", // Ensure proper CORS handling
					body: JSON.stringify(data),
				})

				// Basin returns a 200 status code on success
				if (response.ok) {
					try {
						const responseData = await response.json()

						// Basin JSON API typically returns a 'status' property of 'success' when submission succeeds
						if (responseData && (responseData.success === true || responseData.status === "success")) {
							setSubmitStatus("success")
							// Reset form safely
							if (form) {
								form.reset()
							}
						} else {
							console.error("Basin error:", responseData)
							setSubmitStatus("error")
						}
					} catch (jsonError) {
						// In case response parsing fails but status was OK, assume success
						console.error("Error parsing JSON response:", jsonError)
						setSubmitStatus("success")
						if (form) {
							form.reset()
						}
					}
				} else {
					// Handle error response from Basin (4xx or 5xx)
					try {
						const errorData = await response.json()
						console.error("Basin API error:", response.status, errorData)
					} catch {
						console.error("Basin returned error status:", response.status)
					}
					setSubmitStatus("error")
				}
			} catch (error) {
				console.error("Error submitting form:", error)
				setSubmitStatus("error")
			}
		} catch (error) {
			if (error instanceof z.ZodError) {
				const errors: Record<string, string> = {}
				error.errors.forEach((err) => {
					if (err.path[0]) {
						errors[err.path[0] as string] = err.message
					}
				})
				setFormErrors(errors)
			} else {
				setSubmitStatus("error")
			}
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<Dialog open={isOpen} onOpenChange={setIsOpen}>
			<DialogTrigger asChild>
				<Button className={buttonClassName || ""}>{buttonText}</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>{formTitle}</DialogTitle>
					<DialogDescription>{formDescription}</DialogDescription>
				</DialogHeader>

				{submitStatus === "success" ? (
					<div className="flex flex-col items-center justify-center py-6">
						<div className="mb-4 rounded-full bg-green-100 p-3 text-green-600 dark:bg-green-900/20 dark:text-green-400">
							<svg
								xmlns="http://www.w3.org/2000/svg"
								className="h-6 w-6"
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor">
								<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
							</svg>
						</div>
						<h3 className="mb-2 text-xl font-bold">Thank You!</h3>
						<p className="text-center text-muted-foreground">
							Your information has been submitted successfully. Our team will be in touch with you
							shortly.
						</p>
						<Button className="mt-4" onClick={() => setIsOpen(false)}>
							Close
						</Button>
					</div>
				) : (
					<form ref={formRef} onSubmit={handleSubmit} className="space-y-4" data-basin-form>
						{/* Basin honeypot field for spam protection - should remain empty and hidden */}
						<input type="text" name="_honeypot" className="hidden" style={{ display: "none" }} />
						<div className="space-y-2">
							<label htmlFor="name" className="text-sm font-medium">
								Name <span className="text-red-500">*</span>
							</label>
							<input
								id="name"
								name="name"
								type="text"
								className={`w-full rounded-md border ${
									formErrors.name ? "border-red-500" : "border-input"
								} bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring`}
								placeholder="Your name"
							/>
							{formErrors.name && <p className="text-xs text-red-500">{formErrors.name}</p>}
						</div>

						<div className="space-y-2">
							<label htmlFor="company" className="text-sm font-medium">
								Company <span className="text-red-500">*</span>
							</label>
							<input
								id="company"
								name="company"
								type="text"
								className={`w-full rounded-md border ${
									formErrors.company ? "border-red-500" : "border-input"
								} bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring`}
								placeholder="Your company"
							/>
							{formErrors.company && <p className="text-xs text-red-500">{formErrors.company}</p>}
						</div>

						<div className="space-y-2">
							<label htmlFor="email" className="text-sm font-medium">
								Email <span className="text-red-500">*</span>
							</label>
							<input
								id="email"
								name="email"
								type="email"
								className={`w-full rounded-md border ${
									formErrors.email ? "border-red-500" : "border-input"
								} bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring`}
								placeholder="your.email@example.com"
							/>
							{formErrors.email && <p className="text-xs text-red-500">{formErrors.email}</p>}
						</div>

						<div className="space-y-2">
							<label htmlFor="website" className="text-sm font-medium">
								Website
							</label>
							<input
								id="website"
								name="website"
								type="url"
								className={`w-full rounded-md border ${
									formErrors.website ? "border-red-500" : "border-input"
								} bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring`}
								placeholder="https://example.com"
							/>
							{formErrors.website && <p className="text-xs text-red-500">{formErrors.website}</p>}
						</div>

						<div className="space-y-2">
							<label htmlFor="engineerCount" className="text-sm font-medium">
								Number of Software Engineers <span className="text-red-500">*</span>
							</label>
							<select
								id="engineerCount"
								name="engineerCount"
								className={`w-full rounded-md border ${
									formErrors.engineerCount ? "border-red-500" : "border-input"
								} bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring`}
								defaultValue="1-10">
								<option value="1-10">1-10</option>
								<option value="11-50">11-50</option>
								<option value="51-200">51-200</option>
								<option value="201-500">201-500</option>
								<option value="501-1000">501-1000</option>
								<option value="1000+">1000+</option>
							</select>
							{formErrors.engineerCount && (
								<p className="text-xs text-red-500">{formErrors.engineerCount}</p>
							)}
						</div>

						{submitStatus === "error" && (
							<div className="rounded-md bg-red-50 p-3 text-sm text-red-500 dark:bg-red-900/20">
								There was an error submitting your request. Please try again later.
							</div>
						)}

						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => setIsOpen(false)}>
								Cancel
							</Button>
							<Button type="submit" disabled={isSubmitting}>
								{isSubmitting ? "Submitting..." : "Submit"}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	)
}
