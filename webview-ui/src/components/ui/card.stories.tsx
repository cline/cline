import type { Meta } from "@storybook/react-vite"
import { ImageIcon } from "lucide-react"
import { Button } from "./button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card"
import { InputGroup, InputGroupInput, InputGroupTextarea } from "./input-group"

const meta: Meta<typeof Card> = {
	title: "Ui/Card",
	component: Card,
	parameters: {
		docs: {
			description: {
				component:
					"A versatile card component for displaying content in a contained format. Includes CardHeader, CardTitle, CardDescription, CardContent, and CardFooter subcomponents for structured layouts.",
			},
		},
	},
}

export default meta

// Comprehensive showcase with all card examples
export const Overview = () => {
	return (
		<div className="w-screen p-8">
			<div className="flex flex-col gap-8">
				{/* Basic Cards */}
				<div>
					<h1 className="mb-4">Basic Cards</h1>
					<div className="flex gap-6">
						{/* Simple card */}
						<Card className="w-[350px]">
							<CardHeader>
								<CardTitle>Simple Card</CardTitle>
								<CardDescription>This is a basic card with header and description</CardDescription>
							</CardHeader>
							<CardContent>
								<p className="text-sm">Card content goes here. You can add any content you want.</p>
							</CardContent>
						</Card>

						{/* Card with footer */}
						<Card className="w-[350px]">
							<CardHeader>
								<CardTitle>Card with Footer</CardTitle>
								<CardDescription>This card includes action buttons in the footer</CardDescription>
							</CardHeader>
							<CardContent>
								<p className="text-sm">This demonstrates a card with buttons in the footer section.</p>
							</CardContent>
							<CardFooter className="gap-2">
								<Button size="sm" variant="outline">
									Cancel
								</Button>
								<Button size="sm" variant="default">
									Confirm
								</Button>
							</CardFooter>
						</Card>
					</div>
				</div>

				{/* Cards with Images */}
				<div>
					<h1 className="mb-4">Cards with Images</h1>
					<div className="flex gap-6">
						{/* Card with image placeholder */}
						<Card className="w-[350px]">
							<CardHeader className="p-0">
								<div className="aspect-video bg-muted rounded-t-xl flex items-center justify-center">
									<ImageIcon className="w-12 h-12 text-muted-foreground" />
								</div>
							</CardHeader>
							<CardContent className="p-6">
								<CardTitle className="mb-2">Image Card Title</CardTitle>
								<CardDescription className="mb-4">
									This card includes an image at the top with content below.
								</CardDescription>
								<p className="text-sm">
									Perfect for blog posts, product displays, or any content that benefits from visual context.
								</p>
							</CardContent>
							<CardFooter>
								<Button className="w-full" size="sm" variant="default">
									View Details
								</Button>
							</CardFooter>
						</Card>

						{/* Another image card variant */}
						<Card className="w-[350px]">
							<CardHeader className="p-0">
								<div className="aspect-video bg-gradient-to-br from-blue-500/20 to-purple-500/20 rounded-t-xl flex items-center justify-center">
									<ImageIcon className="w-12 h-12 text-blue-500" />
								</div>
							</CardHeader>
							<CardContent className="p-6">
								<CardTitle className="mb-2">Featured Content</CardTitle>
								<CardDescription className="mb-4">
									Cards can be customized with different image styles and gradients.
								</CardDescription>
								<p className="text-sm">This example uses a gradient background instead of a solid color.</p>
							</CardContent>
							<CardFooter className="gap-2">
								<Button className="flex-1" size="sm" variant="outline">
									Share
								</Button>
								<Button className="flex-1" size="sm" variant="default">
									Save
								</Button>
							</CardFooter>
						</Card>
					</div>
				</div>

				{/* Cards with Forms */}
				<div>
					<h1 className="mb-4">Cards with Forms</h1>
					<div className="flex gap-6">
						{/* Login form card */}
						<Card className="w-[400px]">
							<CardHeader>
								<CardTitle>Login</CardTitle>
								<CardDescription>Enter your credentials to access your account</CardDescription>
							</CardHeader>
							<CardContent>
								<form className="space-y-4">
									<div className="space-y-2">
										<label className="text-sm font-medium" htmlFor="email">
											Email
										</label>
										<InputGroup>
											<InputGroupInput id="email" placeholder="name@example.com" type="email" />
										</InputGroup>
									</div>
									<div className="space-y-2">
										<label className="text-sm font-medium" htmlFor="password">
											Password
										</label>
										<InputGroup>
											<InputGroupInput id="password" placeholder="Enter your password" type="password" />
										</InputGroup>
									</div>
									<div className="flex items-center gap-2">
										<input className="rounded border-input" id="remember" type="checkbox" />
										<label className="text-sm" htmlFor="remember">
											Remember me
										</label>
									</div>
								</form>
							</CardContent>
							<CardFooter className="flex-col gap-2">
								<Button className="w-full" variant="default">
									Sign In
								</Button>
								<Button className="w-full" size="sm" variant="ghost">
									Forgot password?
								</Button>
							</CardFooter>
						</Card>

						{/* Settings form card */}
						<Card className="w-[400px]">
							<CardHeader>
								<CardTitle>Profile Settings</CardTitle>
								<CardDescription>Update your profile information</CardDescription>
							</CardHeader>
							<CardContent>
								<form className="space-y-4">
									<div className="space-y-2">
										<label className="text-sm font-medium" htmlFor="name">
											Display Name
										</label>
										<InputGroup>
											<InputGroupInput id="name" placeholder="John Doe" type="text" />
										</InputGroup>
									</div>
									<div className="space-y-2">
										<label className="text-sm font-medium" htmlFor="bio">
											Bio
										</label>
										<InputGroup>
											<InputGroupTextarea id="bio" placeholder="Tell us about yourself" rows={3} />
										</InputGroup>
									</div>
									<div className="space-y-2">
										<label className="text-sm font-medium" htmlFor="notifications">
											Notification Preferences
										</label>
										<select
											className="w-full h-9 px-3 border border-input rounded-md bg-background text-sm focus:outline-none focus:ring-1 focus:ring-ring"
											id="notifications">
											<option>All notifications</option>
											<option>Important only</option>
											<option>None</option>
										</select>
									</div>
								</form>
							</CardContent>
							<CardFooter className="gap-2">
								<Button className="flex-1" variant="outline">
									Cancel
								</Button>
								<Button className="flex-1" variant="default">
									Save Changes
								</Button>
							</CardFooter>
						</Card>
					</div>
				</div>
			</div>
		</div>
	)
}
