import { ContextCondense } from "@roo/schemas"

interface ContextCondenseRowProps {
	ts: number
	contextCondense?: ContextCondense
}

const ContextCondenseRow = ({ contextCondense }: ContextCondenseRowProps) => {
	if (!contextCondense) {
		return null
	}
	return null
}

export default ContextCondenseRow
