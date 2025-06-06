const { RuleTester } = require("eslint")
const rule = require("../no-protobuf-object-literals")

const ruleTester = new RuleTester({
	parser: require.resolve("@typescript-eslint/parser"),
	parserOptions: {
		ecmaVersion: 2020,
		sourceType: "module",
		ecmaFeatures: {
			jsx: true,
		},
	},
})

ruleTester.run("no-protobuf-object-literals", rule, {
	valid: [
		// Valid case: Using .create() method
		{
			code: `
        import { State } from '@shared/proto/state';
        
        const state = State.create({
          stateJson: '{"apiConfig":{"provider":"anthropic","model":"claude-3-haiku"}}'
        });
      `,
		},
		// Valid case: Using .fromPartial() method
		{
			code: `
        import { ChatSettings } from '@shared/proto/state';
        
        const settings = ChatSettings.fromPartial({
          mode: 0,
          preferredLanguage: 'en',
          openAiReasoningEffort: 'thorough'
        });
      `,
		},
		// Valid case: Object literal not used with protobuf type
		{
			code: `
        interface MyInterface {
          id: number;
          name: string;
        }
        
        const obj: MyInterface = {
          id: 123,
          name: 'test'
        };
      `,
		},
		// Valid case: Using object literal for non-protobuf import
		{
			code: `
        import { SomeType } from '@some/other/package';

        const obj: SomeType = {
          id: 123,
          name: 'test'
        };
      `,
		},
		// Valid case: Regular function call with object literal (should not be flagged)
		{
			code: `
        import { State } from '@shared/proto/state';

        // This should not be flagged because it's a regular function call
        // not directly tied to a protobuf type
        process({
          id: 123,
          name: 'test',
          data: { nested: true }
        });
      `,
		},
	],
	invalid: [
		// Invalid case: Using object literal with imported protobuf type
		{
			code: `
        import { State } from '@shared/proto/state';

        const state: State = {
          stateJson: '{"apiConfig":{"provider":"anthropic","model":"claude-3-haiku"}}'
        };
      `,
			output: `
        import { State } from '@shared/proto/state';

        const state: State = State.create({
          stateJson: '{"apiConfig":{"provider":"anthropic","model":"claude-3-haiku"}}'
        });
      `,
			errors: [{ messageId: "useProtobufMethod" }],
		},
		// Invalid case: Using object literal with namespaced protobuf type
		{
			code: `
        import * as stateProto from '@shared/proto/state';

        const state: stateProto.State = {
          stateJson: '{"apiConfig":{"provider":"anthropic","model":"claude-3-haiku"}}'
        };
      `,
			output: `
        import * as stateProto from '@shared/proto/state';

        const state: stateProto.State = stateProto.State.create({
          stateJson: '{"apiConfig":{"provider":"anthropic","model":"claude-3-haiku"}}'
        });
      `,
			errors: [{ messageId: "useProtobufMethodGeneric" }],
		},
		// Invalid case: Using object literal in a return statement (with protobuf return type)
		{
			code: `
        import { ChatSettings } from '@shared/proto/state';

        function createSettings(): ChatSettings {
          return {
            mode: 0,
            preferredLanguage: 'en',
            openAiReasoningEffort: 'thorough'
          };
        }
      `,
			output: `
        import { ChatSettings } from '@shared/proto/state';

        function createSettings(): ChatSettings {
          return ChatSettings.create({
            mode: 0,
            preferredLanguage: 'en',
            openAiReasoningEffort: 'thorough'
          });
        }
      `,
			errors: [{ messageId: "useProtobufMethod" }],
		},
		// Invalid case: Using object literal in a function parameter (with protobuf types imported)
		{
			code: `
        import { ChatContent } from '@shared/proto/state';

        function processContent(content: ChatContent) {
          // process the content
        }

        processContent({
          message: 'Hello, this is a test message',
          images: ['image1.png', 'image2.jpg'],
          files: ['file1.txt', 'file2.pdf']
        });
      `,
			output: `
        import { ChatContent } from '@shared/proto/state';

        function processContent(content: ChatContent) {
          // process the content
        }

        processContent(ChatContent.create({
          message: 'Hello, this is a test message',
          images: ['image1.png', 'image2.jpg'],
          files: ['file1.txt', 'file2.pdf']
        }));
      `,
			errors: [{ messageId: "useProtobufMethodGeneric" }],
		},
		// Invalid case: Using object literal in assignment expression
		{
			code: `
        import { State } from '@shared/proto/state';

        let state: State;
        state = {
          stateJson: '{"apiConfig":{"provider":"anthropic","model":"claude-3-haiku"}}'
        };
      `,
			output: `
        import { State } from '@shared/proto/state';

        let state: State;
        state = State.create({
          stateJson: '{"apiConfig":{"provider":"anthropic","model":"claude-3-haiku"}}'
        });
      `,
			errors: [{ messageId: "useProtobufMethod" }],
		},
		// Test with custom protobufPackages option
		{
			code: `
        import { CustomProto } from 'custom/proto/package';

        const obj: CustomProto = {
          field1: 'value',
          field2: 123
        };
      `,
			output: `
        import { CustomProto } from 'custom/proto/package';

        const obj: CustomProto = CustomProto.create({
          field1: 'value',
          field2: 123
        });
      `,
			options: [{ protobufPackages: ["custom/proto"] }],
			errors: [{ messageId: "useProtobufMethod" }],
		},
	],
})
