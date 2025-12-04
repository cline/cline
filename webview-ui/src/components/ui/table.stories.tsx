import type { Meta } from "@storybook/react-vite"
import { Table, TableBody, TableCaption, TableCell, TableEmpty, TableFooter, TableHead, TableHeader, TableRow } from "./table"

const meta: Meta<typeof Table> = {
	title: "Ui/Table",
	component: Table,
	parameters: {
		docs: {
			description: {
				component:
					"A flexible table component built on semantic HTML. Includes styled subcomponents for header, body, footer, rows, cells, and captions with hover effects and proper border styling.",
			},
		},
	},
}

export default meta

export const PaymentHistory = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-6 w-full max-w-3xl px-4">
			<Table>
				<TableCaption>Your recent payment history</TableCaption>
				<TableHeader>
					<TableRow>
						<TableHead className="w-[100px]">Date</TableHead>
						<TableHead>Description</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Method</TableHead>
						<TableHead className="text-right">Amount</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableRow>
						<TableCell className="font-medium">Jan 15</TableCell>
						<TableCell>Team Plan</TableCell>
						<TableCell>Paid</TableCell>
						<TableCell>Credit Card</TableCell>
						<TableCell className="text-right">$29.99</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-medium">Dec 15</TableCell>
						<TableCell>Team Plan</TableCell>
						<TableCell>Paid</TableCell>
						<TableCell>Credit Card</TableCell>
						<TableCell className="text-right">$29.99</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-medium">Nov 15</TableCell>
						<TableCell>Team Plan</TableCell>
						<TableCell>Paid</TableCell>
						<TableCell>PayPal</TableCell>
						<TableCell className="text-right">$29.99</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-medium">Oct 15</TableCell>
						<TableCell>Team Plan</TableCell>
						<TableCell>Paid</TableCell>
						<TableCell>Credit Card</TableCell>
						<TableCell className="text-right">$29.99</TableCell>
					</TableRow>
					<TableRow>
						<TableCell className="font-medium">Sep 15</TableCell>
						<TableCell>Team Plan</TableCell>
						<TableCell>Paid</TableCell>
						<TableCell>Credit Card</TableCell>
						<TableCell className="text-right">$29.99</TableCell>
					</TableRow>
				</TableBody>
				<TableFooter>
					<TableRow>
						<TableCell colSpan={4}>Total (Last 5 months)</TableCell>
						<TableCell className="text-right">$149.95</TableCell>
					</TableRow>
				</TableFooter>
			</Table>
		</div>
	</div>
)

export const EmptyState = () => (
	<div className="w-screen flex justify-center items-center">
		<div className="flex flex-col gap-6 w-full max-w-3xl px-4">
			<Table>
				<TableCaption>Your payment history.</TableCaption>
				<TableHeader>
					<TableRow>
						<TableHead className="w-[100px]">Date</TableHead>
						<TableHead>Description</TableHead>
						<TableHead>Status</TableHead>
						<TableHead>Method</TableHead>
						<TableHead className="text-right">Amount</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					<TableEmpty>No payment history yet.</TableEmpty>
				</TableBody>
			</Table>
		</div>
	</div>
)
