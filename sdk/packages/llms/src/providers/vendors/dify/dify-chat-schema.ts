/*!
 * Vendored from dify-ai-provider v1.1.1 (https://github.com/warmwind/dify-ai-provider,
 * commit 352943be697b89cf1a4d329e11b53c1f19e4286d), (c) 2024 Oscar Jiang, MIT
 * license (see ./LICENSE). Changes for @ai-sdk/provider-utils 5 and zod 4 are
 * listed in ./README.md.
 */
import { z } from "zod";

export const completionResponseSchema = z.object({
	id: z.string(),
	answer: z.string(),
	task_id: z.string(),
	conversation_id: z.string(),
	message_id: z.string(),
	metadata: z.object({
		usage: z.object({
			completion_tokens: z.number(),
			prompt_tokens: z.number(),
			total_tokens: z.number(),
		}),
	}),
});

export const errorResponseSchema = z.object({
	code: z.string(),
	message: z.string(),
	status: z.number(),
});

// Define a base schema with common fields that all events might have
export const difyStreamEventBase = z
	.object({
		event: z.string(),
		conversation_id: z.string().optional(),
		message_id: z.string().optional(),
		task_id: z.string().optional(),
		created_at: z.number().optional(),
	})
	.passthrough();

// Create schemas for specific event types
export const workflowStartedSchema = difyStreamEventBase.extend({
	event: z.literal("workflow_started"),
	workflow_run_id: z.string(),
	data: z
		.object({
			id: z.string(),
			workflow_id: z.string(),
			created_at: z.number(),
		})
		.passthrough(),
});

export const workflowFinishedSchema = difyStreamEventBase.extend({
	event: z.literal("workflow_finished"),
	workflow_run_id: z.string(),
	task_id: z.string().optional(),
	data: z
		.object({
			id: z.string(),
			workflow_id: z.string(),
			outputs: z.record(z.string(), z.unknown()).optional(),
			status: z.string().optional(),
			elapsed_time: z.number().optional(),
			total_tokens: z.number().optional(),
			total_steps: z.string().optional(),
			created_at: z.number().optional(),
			finished_at: z.number().optional(),
		})
		.passthrough(),
});

export const nodeStartedSchema = difyStreamEventBase.extend({
	event: z.literal("node_started"),
	workflow_run_id: z.string(),
	data: z
		.object({
			id: z.string(),
			node_id: z.string(),
			node_type: z.string(),
		})
		.passthrough(),
});

export const nodeFinishedSchema = difyStreamEventBase.extend({
	event: z.literal("node_finished"),
	workflow_run_id: z.string(),
	data: z
		.object({
			id: z.string(),
			node_id: z.string(),
			node_type: z.string(),
		})
		.passthrough(),
});

export const messageSchema = difyStreamEventBase.extend({
	event: z.literal("message"),
	id: z.string().optional(),
	answer: z.string(),
	from_variable_selector: z.array(z.string()).optional(),
});

export const messageEndSchema = difyStreamEventBase.extend({
	event: z.literal("message_end"),
	id: z.string().optional(),
	metadata: z
		.object({
			usage: z
				.object({
					prompt_tokens: z.number().optional(),
					completion_tokens: z.number().optional(),
					total_tokens: z.number().optional(),
					prompt_unit_price: z.string().optional(),
					prompt_price_unit: z.string().optional(),
					prompt_price: z.string().optional(),
					completion_unit_price: z.string().optional(),
					completion_price_unit: z.string().optional(),
					completion_price: z.string().optional(),
					total_price: z.string().optional(),
					currency: z.string().optional(),
					latency: z.number().optional(),
				})
				.passthrough(),
			retriever_resources: z.array(z.unknown()).optional(),
		})
		.passthrough(),
	files: z.nullable(z.array(z.unknown())).optional(),
});

export const ttsMessageSchema = difyStreamEventBase.extend({
	event: z.literal("tts_message"),
	audio: z.string(),
});

export const ttsMessageEndSchema = difyStreamEventBase.extend({
	event: z.literal("tts_message_end"),
	audio: z.string(),
});

// {
// success: true,
//   value: {
//     event: 'agent_thought',
//     conversation_id: '6aa52695-406a-408a-898f-37946c44af19',
//     message_id: '6f8fafdd-b585-4067-bcc8-866026d67101',
//     task_id: 'eadf26b9-4c0f-4562-8cca-c1ce8e47399d',
//     created_at: 1749536594,
//     id: 'aeeec11f-d613-4616-844d-0c19f52bc59d',
//     position: 1,
//     thought: 'Hello! How can I assist you today? 😊',
//     observation: '',
//     tool: '',
//     tool_labels: {},
//     tool_input: '',
//     message_files: []
//   },
//   rawValue: {
//     event: 'agent_thought',
//     conversation_id: '6aa52695-406a-408a-898f-37946c44af19',
//     message_id: '6f8fafdd-b585-4067-bcc8-866026d67101',
//     created_at: 1749536594,
//     task_id: 'eadf26b9-4c0f-4562-8cca-c1ce8e47399d',
//     id: 'aeeec11f-d613-4616-844d-0c19f52bc59d',
//     position: 1,
//     thought: 'Hello! How can I assist you today? 😊',
//     observation: '',
//     tool: '',
//     tool_labels: {},
//     tool_input: '',
//     message_files: []
//   }
// }

// {
// success: true,
// value: {
//   event: 'message_end',
//   conversation_id: '6aa52695-406a-408a-898f-37946c44af19',
//   message_id: '6f8fafdd-b585-4067-bcc8-866026d67101',
//   task_id: 'eadf26b9-4c0f-4562-8cca-c1ce8e47399d',
//   created_at: 1749536594,
//   id: '6f8fafdd-b585-4067-bcc8-866026d67101',
//   metadata: { usage: [Object] },
//   files: null
// },
// rawValue: {
//   event: 'message_end',
//   conversation_id: '6aa52695-406a-408a-898f-37946c44af19',
//   message_id: '6f8fafdd-b585-4067-bcc8-866026d67101',
//   created_at: 1749536594,
//   task_id: 'eadf26b9-4c0f-4562-8cca-c1ce8e47399d',
//   id: '6f8fafdd-b585-4067-bcc8-866026d67101',
//   metadata: { usage: [Object] },
//   files: null
// }

// }

// {
// event: 'agent_message',
// conversation_id: '6aa52695-406a-408a-898f-37946c44af19',
// message_id: '6f8fafdd-b585-4067-bcc8-866026d67101',
// task_id: 'eadf26b9-4c0f-4562-8cca-c1ce8e47399d',
// created_at: 1749536594,
// id: '6f8fafdd-b585-4067-bcc8-866026d67101',
// answer: ''
//

export const agentMessageSchema = difyStreamEventBase.extend({
	event: z.literal("agent_message"),
	answer: z.string(),
});

export const agentThoughtSchema = difyStreamEventBase.extend({
	event: z.literal("agent_thought"),
	id: z.string(),
	position: z.number(),
	thought: z.string(),
	observation: z.string(),
	tool: z.string(),
	tool_labels: z.record(z.string(), z.string()).optional(),
	tool_input: z.string(),
	message_files: z.array(z.unknown()),
});

export const messageReplaceSchema = difyStreamEventBase.extend({
	event: z.literal("message_replace"),
	answer: z.string(),
});

export const messageFileSchema = difyStreamEventBase.extend({
	event: z.literal("message_file"),
	id: z.string(),
	type: z.string(),
	belongs_to: z.string(),
	url: z.string(),
});

export const pingSchema = difyStreamEventBase.extend({
	event: z.literal("ping"),
});

export const errorSchema = difyStreamEventBase.extend({
	event: z.literal("error"),
	status: z.number().optional(),
	code: z.string().optional(),
	message: z.string().optional(),
});

// Combine all schemas with discriminatedUnion
export const difyStreamEventSchema = z
	.discriminatedUnion("event", [
		workflowStartedSchema,
		workflowFinishedSchema,
		nodeStartedSchema,
		nodeFinishedSchema,
		messageSchema,
		messageEndSchema,
		ttsMessageSchema,
		ttsMessageEndSchema,
		agentThoughtSchema,
		agentMessageSchema,
		messageReplaceSchema,
		messageFileSchema,
		pingSchema,
		errorSchema,
	])
	.or(difyStreamEventBase); // Fallback for any other event types

export type DifyStreamEvent = z.infer<typeof difyStreamEventSchema>;
