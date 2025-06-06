const { RuleTester: GrpcRuleTester } = require("eslint")
const grpcRule = require("../no-grpc-client-object-literals")

const grpcRuleTester = new GrpcRuleTester({
	parser: require.resolve("@typescript-eslint/parser"),
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: "module",
		ecmaFeatures: {
			jsx: true,
		},
	},
})

grpcRuleTester.run("no-grpc-client-object-literals", grpcRule, {
	valid: [
		// Valid case: Using .create() method with gRPC client
		{
			code: `
                import { TogglePlanActModeRequest } from '@shared/proto/state';
                import { StateServiceClient } from '../services/grpc-client';
                
                StateServiceClient.togglePlanActMode(
                    TogglePlanActModeRequest.create({
                        chatSettings: {
                            mode: PlanActMode.PLAN,
                            preferredLanguage: 'en',
                        },
                    })
                );
            `,
		},
		// Valid case: Using .fromPartial() method with gRPC client
		{
			code: `
                import { TogglePlanActModeRequest, ChatSettings } from '@shared/proto/state';
                import { StateServiceClient } from '../services/grpc-client';
                
                const chatSettings = ChatSettings.fromPartial({
                    mode: PlanActMode.PLAN,
                    preferredLanguage: 'en',
                });
                
                StateServiceClient.togglePlanActMode(
                    TogglePlanActModeRequest.create({
                        chatSettings: chatSettings,
                    })
                );
            `,
		},
		// Valid case: Regular function call with object literal (not a gRPC client)
		{
			code: `
                function processData(data) {
                    console.log(data);
                }
                
                processData({
                    id: 123,
                    name: 'test',
                });
            `,
		},
		// Valid case: Using proper nested protobuf objects
		{
			code: `
                import { TogglePlanActModeRequest, ChatSettings } from '@shared/proto/state';
                import { StateServiceClient } from '../services/grpc-client';
                
                // Using proper nested protobuf objects
                const chatSettings = ChatSettings.create({
                    mode: 0,
                    preferredLanguage: 'en',
                });
                
                const request = TogglePlanActModeRequest.create({
                    chatSettings: chatSettings,
                });
                
                StateServiceClient.togglePlanActMode(request);
            `,
		},
		// Valid case: Object literal in second parameter (should not be checked)
		{
			code: `
                import { StateSubscribeRequest } from '@shared/proto/state';
                import { StateServiceClient } from '../services/grpc-client';
                
                const request = StateSubscribeRequest.create({
                    topics: ['apiConfig', 'tasks']
                });
                
                // Second parameter is an object literal but should not trigger the rule
                StateServiceClient.subscribe(request, {
                    metadata: {
                        userId: 123,
                        sessionId: "abc-123"
                    }
                });
            `,
		},
	],
	invalid: [
		// Invalid case: Using object literal directly with gRPC client
		{
			code: `
                import { StateServiceClient } from '../services/grpc-client';
                
                StateServiceClient.togglePlanActMode({
                    chatSettings: {
                        mode: 0,
                        preferredLanguage: 'en',
                    },
                });
            `,
			errors: [{ messageId: "useProtobufMethod" }],
		},
		// Invalid case: Using object literal with nested properties
		{
			code: `
                import { ChatSettings } from '@shared/proto/state';
                import { StateServiceClient } from '../services/grpc-client';
                
                const chatSettings = ChatSettings.create({
                    mode: 0,
                    preferredLanguage: 'en',
                });
                
                StateServiceClient.togglePlanActMode({
                    chatSettings: {
                        mode: 1,
                        preferredLanguage: 'fr',
                    },
                });
            `,
			errors: [{ messageId: "useProtobufMethod" }],
		},
		// Invalid case: Nested object literal in protobuf create method
		{
			code: `
                import { TogglePlanActModeRequest, ChatSettings } from '@shared/proto/state';
                import { StateServiceClient } from '../services/grpc-client';
                
                // Using nested object literal instead of ChatSettings.create()
                const request = TogglePlanActModeRequest.create({
                    chatSettings: {
                        mode: 0,
                        preferredLanguage: 'en',
                    },
                });
                
                StateServiceClient.togglePlanActMode(request);
            `,
			errors: [{ messageId: "useProtobufMethod" }],
		},
		// Invalid case: Object literal as first parameter to subscribe method
		{
			code: `
                import { StateServiceClient } from '../services/grpc-client';
                
                // First parameter is an object literal, which should trigger the rule
                StateServiceClient.subscribe({
                    topics: ['apiConfig', 'tasks']
                }, {
                    metadata: {
                        userId: 123,
                        sessionId: "abc-123"
                    }
                });
            `,
			errors: [{ messageId: "useProtobufMethod" }],
		},
	],
})
