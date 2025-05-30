const { ESLintUtils } = require("@typescript-eslint/utils")

const createRule = ESLintUtils.RuleCreator((name) => `https://cline.bot/eslint-rules/${name}`)

module.exports = createRule({
	name: "no-protobuf-object-literals",
	meta: {
		type: "problem",
		docs: {
			description: "Enforce using .create() or .fromPartial() for protobuf objects instead of object literals",
			recommended: "error",
		},
		messages: {
			useProtobufMethod:
				"Use {{typeName}}.create() or {{typeName}}.fromPartial() instead of " +
				"object literal for protobuf type\n" +
				"Found: {{code}}\n  Suggestion: " +
				"{{typeName}}.create({{objectContent}})",
			useProtobufMethodGeneric:
				"Use .create() or .fromPartial() instead of object literal for protobuf " +
				"type from @shared/proto\n  Found: {{code}}",
		},
		schema: [
			{
				type: "object",
				properties: {
					protobufPackages: {
						type: "array",
						items: { type: "string" },
						default: ["shared/proto/"],
					},
				},
				additionalProperties: false,
			},
		],
	},
	defaultOptions: [{ protobufPackages: ["shared/proto/"] }],

	create(context, [options]) {
		const protobufPackages = options.protobufPackages
		const protobufImports = new Set() // Set of imported protobuf types
		const protobufNamespaceImports = new Set() // For namespace imports like "import * as proto"
		const safeObjectExpressions = new Set() // Track object expressions in create/fromPartial calls

		// Helper functions
		function getTypeName(typeAnnotation) {
			if (!typeAnnotation) return null

			if (typeAnnotation.type === "TSTypeReference") {
				if (typeAnnotation.typeName.type === "Identifier") {
					return typeAnnotation.typeName.name
				} else if (typeAnnotation.typeName.type === "TSQualifiedName") {
					// Handle namespaced types like proto.MyRequest
					return `${typeAnnotation.typeName.left.name}.${typeAnnotation.typeName.right.name}`
				}
			}
			return null
		}

		function isNamespacedProtobufType(typeName) {
			if (!typeName.includes(".")) return false

			const namespace = typeName.split(".")[0]
			return protobufNamespaceImports.has(namespace)
		}

		function findParentFunction(node) {
			let current = node.parent
			while (current) {
				if (
					current.type === "FunctionDeclaration" ||
					current.type === "FunctionExpression" ||
					current.type === "ArrowFunctionExpression"
				) {
					return current
				}
				current = current.parent
			}
			return null
		}

		function hasProtobufReturnType(functionNode) {
			if (!functionNode.returnType) return false

			const returnTypeName = getTypeName(functionNode.returnType.typeAnnotation)
			return returnTypeName && protobufImports.has(returnTypeName)
		}

		return {
			// Skip object literals inside create() or fromPartial() method calls
			CallExpression(node) {
				if (
					node.callee &&
					node.callee.type === "MemberExpression" &&
					(node.callee.property.name === "create" || node.callee.property.name === "fromPartial") &&
					node.arguments.length > 0 &&
					node.arguments[0].type === "ObjectExpression"
				) {
					// Track this object expression as being used with create/fromPartial
					safeObjectExpressions.add(node.arguments[0])
				}
			},

			// Track imports from protobuf packages
			ImportDeclaration(node) {
				const packageName = node.source.value

				if (matchesProtobufPackage(packageName, protobufPackages)) {
					// This is a protobuf package.
					node.specifiers.forEach((spec) => {
						if (spec.type === "ImportSpecifier") {
							// import { MyRequest } from '@shared/proto'
							protobufImports.add(spec.imported.name)
							//console.log('📝 Registered protobuf type:', spec.imported.name);
						} else if (spec.type === "ImportNamespaceSpecifier") {
							// import * as proto from '@shared/proto'
							protobufNamespaceImports.add(spec.local.name)
							//console.log('📝 Registered namespace:', spec.local.name);
						}
					})
				}
			},

			// Check variable declarations with type annotations
			"VariableDeclarator > ObjectExpression"(node) {
				// Skip if this is inside a create/fromPartial call
				if (safeObjectExpressions.has(node)) {
					return
				}

				// Found object literal in variable declaration
				const declarator = node.parent

				if (declarator.id && declarator.id.typeAnnotation) {
					const typeName = getTypeName(declarator.id.typeAnnotation.typeAnnotation)
					if (typeName) {
						// Check if it's a direct protobuf import
						if (protobufImports.has(typeName)) {
							//console.log('🚨 VIOLATION: Using object literal for protobuf type:', typeName);
							const sourceCode = context.getSourceCode()
							const declaratorText = sourceCode.getText(declarator).trim()
							const objectText = sourceCode.getText(node).trim()

							context.report({
								node,
								messageId: "useProtobufMethod",
								data: {
									typeName,
									code: declaratorText,
									objectContent: objectText,
								},
							})
							return
						}

						// Check if it's a namespaced protobuf type (e.g., proto.MyRequest)
						if (isNamespacedProtobufType(typeName)) {
							//console.log('🚨 VIOLATION: Using object literal for namespaced protobuf type:', typeName);
							const sourceCode = context.getSourceCode()
							const declaratorText = sourceCode.getText(declarator).trim()
							context.report({
								node,
								messageId: "useProtobufMethodGeneric",
								data: { code: declaratorText },
							})
						}
					}
				}
			},

			// Check assignment expressions
			"AssignmentExpression > ObjectExpression"(node) {
				// Skip if this is inside a create/fromPartial call
				if (safeObjectExpressions.has(node)) {
					return
				}

				const assignment = node.parent

				// For assignment to variables without inline type annotation
				if (assignment.left && assignment.right === node) {
					let typeName = null

					// Check if there's a typeAnnotation directly on the left
					if (assignment.left.typeAnnotation) {
						typeName = getTypeName(assignment.left.typeAnnotation.typeAnnotation)
					}
					// Otherwise try to infer from the variable name if it's a simple identifier
					else if (assignment.left.type === "Identifier") {
						const varName = assignment.left.name
						// Check variable declarations in the current scope
						const sourceCode = context.getSourceCode()
						const scope = sourceCode.getScope(node)
						const variable = scope.variables.find((v) => v.name === varName)
						if (variable && variable.defs.length > 0) {
							const def = variable.defs[0]
							if (def.node.id && def.node.id.typeAnnotation) {
								typeName = getTypeName(def.node.id.typeAnnotation.typeAnnotation)
							}
						}
					}

					if (typeName && protobufImports.has(typeName)) {
						//console.log('🚨 VIOLATION: Using object literal in assignment for protobuf type:', typeName);
						const sourceCode = context.getSourceCode()
						const assignmentText = sourceCode.getText(assignment.left).trim() + " = "
						const objectText = sourceCode.getText(node).trim()

						context.report({
							node,
							messageId: "useProtobufMethod",
							data: {
								typeName,
								code: assignmentText + "{",
								objectContent: objectText,
							},
						})
					}
				}
			},

			// Check return statements
			"ReturnStatement > ObjectExpression"(node) {
				// Skip if this is inside a create/fromPartial call
				if (safeObjectExpressions.has(node)) {
					return
				}

				// Find the parent function to get its return type
				const functionNode = findParentFunction(node)
				if (!functionNode) return

				// Try to get the return type from the function declaration
				let returnTypeName = null
				if (functionNode.returnType) {
					returnTypeName = getTypeName(functionNode.returnType.typeAnnotation)
				}
				// For arrow functions and function expressions without explicit return type
				// Try to get it from the parent variable declaration or assignment
				else if (functionNode.parent) {
					if (
						functionNode.parent.type === "VariableDeclarator" &&
						functionNode.parent.id &&
						functionNode.parent.id.typeAnnotation
					) {
						returnTypeName = getTypeName(functionNode.parent.id.typeAnnotation.typeAnnotation)
					}
				}

				// For async functions with Promise<Type> return type, extract the inner type
				if (returnTypeName && returnTypeName.startsWith("Promise<") && returnTypeName.endsWith(">")) {
					returnTypeName = returnTypeName.slice(8, -1).trim()
				}

				// Check if the return type is a protobuf type
				if (returnTypeName) {
					if (protobufImports.has(returnTypeName)) {
						const sourceCode = context.getSourceCode()
						const returnText = sourceCode.getText(node.parent).trim()
						context.report({
							node,
							messageId: "useProtobufMethod",
							data: {
								typeName: returnTypeName,
								code: returnText,
								objectContent: sourceCode.getText(node).trim(),
							},
						})
						return
					}

					// Check if it's a namespaced protobuf type
					if (isNamespacedProtobufType(returnTypeName)) {
						const sourceCode = context.getSourceCode()
						const returnText = sourceCode.getText(node.parent).trim()
						context.report({
							node,
							messageId: "useProtobufMethodGeneric",
							data: { code: returnText },
						})
						return
					}
				}

				// If we couldn't determine the type directly, check if the function name suggests it returns a protobuf type
				if (functionNode.id && functionNode.id.name) {
					const functionName = functionNode.id.name
					// Check if the function name is in form of "get<ProtobufType>" or "create<ProtobufType>"
					for (const protoType of protobufImports) {
						if (
							functionName === `get${protoType}` ||
							functionName === `create${protoType}` ||
							functionName.endsWith(protoType)
						) {
							const sourceCode = context.getSourceCode()
							const returnText = sourceCode.getText(node.parent).trim()
							context.report({
								node,
								messageId: "useProtobufMethod",
								data: {
									typeName: protoType,
									code: returnText,
									objectContent: sourceCode.getText(node).trim(),
								},
							})
							return
						}
					}
				}

				// Final fallback - if there are any protobuf imports and the function signature
				// mentions a return type that matches one of the imported types
				if (protobufImports.size > 0 || protobufNamespaceImports.size > 0) {
					const sourceCode = context.getSourceCode()
					const functionText = functionNode ? sourceCode.getText(functionNode) : ""

					for (const protoType of protobufImports) {
						// Check if the function signature includes the protobuf type name as the return type
						// This is a more aggressive check that might have false positives but will catch more cases
						if (
							functionText.includes(`Promise<${protoType}>`) ||
							functionText.includes(`: ${protoType}`) ||
							functionText.includes(`:${protoType}`)
						) {
							const returnText = sourceCode.getText(node.parent).trim()
							context.report({
								node,
								messageId: "useProtobufMethod",
								data: {
									typeName: protoType,
									code: returnText,
									objectContent: sourceCode.getText(node).trim(),
								},
							})
							return
						}
					}

					// Check for namespace imports too
					for (const namespace of protobufNamespaceImports) {
						if (
							functionText.includes(`Promise<${namespace}.`) ||
							functionText.includes(`: ${namespace}.`) ||
							functionText.includes(`:${namespace}.`)
						) {
							const returnText = sourceCode.getText(node.parent).trim()
							context.report({
								node,
								messageId: "useProtobufMethodGeneric",
								data: { code: returnText },
							})
							return
						}
					}
				}
			},

			// Check function call arguments (more selective approach)
			"CallExpression > ObjectExpression"(node) {
				// Skip if this is inside a create/fromPartial call
				if (safeObjectExpressions.has(node)) {
					return
				}

				// We need to be more selective to avoid false positives
				// Only warn if:
				// 1. The function is called on a protobuf namespace
				// 2. The call argument has a type annotation that matches a protobuf type
				// 3. The call is to a function that we know takes a protobuf type

				// Check if it's a call on a protobuf namespace
				if (
					node.parent.callee &&
					node.parent.callee.type === "MemberExpression" &&
					node.parent.callee.object.type === "Identifier"
				) {
					const namespace = node.parent.callee.object.name
					if (protobufNamespaceImports.has(namespace)) {
						const sourceCode = context.getSourceCode()
						const callText = sourceCode.getText(node.parent).trim()

						context.report({
							node,
							messageId: "useProtobufMethodGeneric",
							data: { code: callText },
						})
						return
					}
				}

				// For regular function calls with object literals, check if there are protobuf imports
				// and if the function might expect a protobuf type
				if (protobufImports.size > 0 && node.parent.callee) {
					// This is a more permissive check to catch cases like processContent({ ... })
					// which might be passing a protobuf type
					const sourceCode = context.getSourceCode()
					const scope = sourceCode.getScope(node)

					// Try to find the function definition
					if (node.parent.callee.type === "Identifier") {
						const functionName = node.parent.callee.name
						const variable = scope.variables.find((v) => v.name === functionName)

						// If we found the function and it has parameter type annotations
						// that match protobuf types, flag it
						if (variable && variable.defs.length > 0) {
							const def = variable.defs[0]
							if (def.node.params && node.parent.arguments.indexOf(node) < def.node.params.length) {
								const param = def.node.params[node.parent.arguments.indexOf(node)]
								if (param.typeAnnotation) {
									const typeName = getTypeName(param.typeAnnotation.typeAnnotation)
									if (typeName && (protobufImports.has(typeName) || isNamespacedProtobufType(typeName))) {
										const callText = sourceCode.getText(node.parent).trim()
										context.report({
											node,
											messageId: "useProtobufMethodGeneric",
											data: { code: callText },
										})
										return
									}
								}
							}
						}
					}
				}
			},
		}
	},
})

function matchesProtobufPackage(packageName, protobufPackages) {
	return protobufPackages.some((protobufPackage) => {
		// Remove leading and trailing @ and / from protobufPackage
		const cleanedPackage = protobufPackage.replace(/^[@\/]/, "").replace(/[\/]$/, "")
		const pattern = new RegExp(`(.*[@/]|)${escapeRegex(cleanedPackage)}[/].*`)
		return pattern.test(packageName)
	})
}

// Helper function to escape special regex characters
function escapeRegex(string) {
	return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
