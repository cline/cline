import { ModelFamily } from "@/shared/prompts"
import { ClineDefaultTool } from "@/shared/tools"
import type { ClineToolSpec } from "../spec"

const id = ClineDefaultTool.RETRIEVE_CUSTOMER_OPS

const generic: ClineToolSpec = {
	variant: ModelFamily.GENERIC,
	id,
	name: "retrieval_customer_operations",
	description:
		"Retrieve available customer connector operations for MuleSoft flow generation. Use this tool to get a list of available customer connectors before generating a MuleSoft flow. This tool returns a default list of customer connector operations that can be used in the flow.",
	parameters: [
		{
			name: "query",
			required: false,
			instruction: "Optional query string to filter customer operations by name",
			usage: "customer (optional)",
		},
	],
}

const NATIVE_GPT_5: ClineToolSpec = {
	variant: ModelFamily.NATIVE_GPT_5,
	id,
	name: "retrieval_customer_operations",
	description:
		"Retrieve available customer connector operations for MuleSoft flow generation. Use this tool to get a list of available customer connectors before generating a MuleSoft flow. This tool returns a default list of customer connector operations that can be used in the flow.",
	parameters: [
		{
			name: "query",
			required: false,
			instruction: "Optional query string to filter customer operations by name",
			usage: "customer (optional)",
		},
	],
}

const NATIVE_NEXT_GEN: ClineToolSpec = {
	...NATIVE_GPT_5,
	variant: ModelFamily.NATIVE_NEXT_GEN,
}

export const retrieval_customer_operations_variants = [generic, NATIVE_NEXT_GEN, NATIVE_GPT_5]

