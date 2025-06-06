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
		fixable: "code",
		messages: {
			useProtobufMethod:
				"Use {{typeName}}.create() or {{typeName}}.fromPartial() instead of " +
				"object literal for protobuf type from @shared/proto\n" +
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
						} else if (spec.type === "ImportNamespaceSpecifier") {
							// import * as proto from '@shared/proto'
							protobufNamespaceImports.add(spec.local.name)
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
							const declaratorText = sourceCode.getText(declarator)
							const objectText = sourceCode.getText(node)

							context.report({
								node,
								messageId: "useProtobufMethod",
								data: {
									typeName,
									code: declaratorText,
									objectContent: objectText,
								},
								fix(fixer) {
									// Replace the object literal with Type.create() call
									return fixer.replaceText(node, `${typeName}.create(${objectText})`)
								},
							})
							return
						}

						// Check if it's a namespaced protobuf type (e.g., proto.MyRequest)
						if (isNamespacedProtobufType(protobufNamespaceImports, typeName)) {
							//console.log('🚨 VIOLATION: Using object literal for namespaced protobuf type:', typeName);
							const sourceCode = context.getSourceCode()
							const declaratorText = sourceCode.getText(declarator)
							context.report({
								node,
								messageId: "useProtobufMethodGeneric",
								data: { code: declaratorText },
								fix(fixer) {
									// For namespaced types, use the full type name to call create()
									return fixer.replaceText(node, `${typeName}.create(${sourceCode.getText(node)})`)
								},
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
						const assignmentText = sourceCode.getText(assignment.left) + " = "
						const objectText = sourceCode.getText(node)

						context.report({
							node,
							messageId: "useProtobufMethod",
							data: {
								typeName,
								code: assignmentText + "{",
								objectContent: objectText,
							},
							fix(fixer) {
								// Replace the object literal with Type.create() call in assignments
								return fixer.replaceText(node, `${typeName}.create(${objectText})`)
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
				if (!functionNode) {
					return
				}

				// Try to get the return type using our enhanced helper
				const sourceCode = context.getSourceCode()
				let returnTypeName = getFunctionReturnType(functionNode, sourceCode)

				// For async functions with Promise<Type> return type, extract the inner type
				if (returnTypeName && returnTypeName.startsWith("Promise<") && returnTypeName.endsWith(">")) {
					returnTypeName = returnTypeName.slice(8, -1)
				}

				// Check if the return type is a protobuf type
				if (returnTypeName) {
					if (protobufImports.has(returnTypeName)) {
						//console.log('🚨 VIOLATION: Return type is a protobuf type:', returnTypeName);
						const sourceCode = context.getSourceCode()
						const returnText = sourceCode.getText(node.parent)
						context.report({
							node,
							messageId: "useProtobufMethod",
							data: {
								typeName: returnTypeName,
								code: returnText,
								objectContent: sourceCode.getText(node),
							},
							fix(fixer) {
								// Replace the object literal with Type.create() call in return statements
								return fixer.replaceText(node, `${returnTypeName}.create(${sourceCode.getText(node)})`)
							},
						})
						return
					}

					// Check if it's a namespaced protobuf type
					if (isNamespacedProtobufType(protobufNamespaceImports, returnTypeName)) {
						const sourceCode = context.getSourceCode()
						const returnText = sourceCode.getText(node.parent)
						//console.log('🚨 VIOLATION: Return type is a namespaced protobuf type:', returnTypeName);
						context.report({
							node,
							messageId: "useProtobufMethodGeneric",
							data: { code: returnText },
							fix(fixer) {
								// For namespaced types in return statements, we need to extract the full type name
								const objectCode = sourceCode.getText(node)
								// Since we may not know the exact type, we'll use the more generic namespaced type
								return fixer.replaceText(node, `${returnTypeName}.create(${objectCode})`)
							},
						})
						return
					}
				}

				// Final fallback - if there are any protobuf imports and the function signature
				// mentions a return type that matches one of the imported types
				const functionText = functionNode ? sourceCode.getText(functionNode) : ""

				for (const protoType of protobufImports) {
					// Use more precise regex to match return type patterns specifically
					// Rather than just checking if the type name appears anywhere in the signature
					const returnTypeRegex = new RegExp(
						// Match arrow function return type
						`=>\\s*:?\\s*${protoType}\\b|` +
							// Match function declaration return type
							`\\)\\s*:?\\s*${protoType}\\b|` +
							// Match Promise return type
							`\\)\\s*:?\\s*Promise<\\s*${protoType}\\s*>|` +
							// Match function type in variable declaration
							`:\\s*\\(.*\\)\\s*=>\\s*${protoType}\\b`,
					)

					if (returnTypeRegex.test(functionText)) {
						const returnText = sourceCode.getText(node.parent)
						//console.log('🚨 VIOLATION: regex matched protobuf type:', functionText);
						context.report({
							node,
							messageId: "useProtobufMethod",
							data: {
								typeName: protoType,
								code: returnText,
								objectContent: sourceCode.getText(node),
							},
							fix(fixer) {
								// Replace the object literal with Type.create() call
								return fixer.replaceText(node, `${protoType}.create(${sourceCode.getText(node)})`)
							},
						})
						return
					}
				}
				// Check for namespace imports too
				for (const namespace of protobufNamespaceImports) {
					// Similar to above, but for namespaced types
					const namespaceReturnTypeRegex = new RegExp(
						// Match arrow function return type
						`=>\\s*:?\\s*${namespace}\\.\\w+\\b|` +
							// Match function declaration return type
							`\\)\\s*:?\\s*${namespace}\\.\\w+\\b|` +
							// Match Promise return type
							`\\)\\s*:?\\s*Promise<\\s*${namespace}\\.\\w+\\s*>|` +
							// Match function type in variable declaration
							`:\\s*\\(.*\\)\\s*=>\\s*${namespace}\\.\\w+\\b`,
					)

					if (namespaceReturnTypeRegex.test(functionText)) {
						const returnText = sourceCode.getText(node.parent)
						//console.log('🚨 VIOLATION: regex matched namespaced protobuf type:', functionText, "namespace:", namespace);
						context.report({
							node,
							messageId: "useProtobufMethodGeneric",
							data: { code: returnText },
							fix(fixer) {
								// For namespaced types based on function signature patterns
								// Extract the namespace and type from the function text using more precise patterns
								const match = functionText.match(
									new RegExp(
										// Match return type patterns more precisely
										`\\)\\s*:?\\s*(${namespace}\\.[\\w]+)\\b|` + // Function declaration
											`=>\\s*:?\\s*(${namespace}\\.[\\w]+)\\b|` + // Arrow function
											`Promise<\\s*(${namespace}\\.[\\w]+)\\s*>`, // Promise wrapped
									),
								)
								if (match) {
									const fullType = match[1] || match[2]
									return fixer.replaceText(node, `${fullType}.create(${sourceCode.getText(node)})`)
								}
								// Fallback - we can't determine the exact type, but we know it's from the namespace
								// Use a namespace-based approach
								return fixer.replaceText(node, `${namespace}.create(${sourceCode.getText(node)})`)
							},
						})
						return
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
						const callText = sourceCode.getText(node.parent)
						//console.log('🚨 VIOLATION: Check function call arguments object literal:', callText);
						context.report({
							node,
							messageId: "useProtobufMethodGeneric",
							data: { code: callText },
							fix(fixer) {
								// For calls on a protobuf namespace
								const memberExpr = node.parent.callee
								// Try to determine if this is calling a method that expects a specific type
								const methodName = memberExpr.property.name

								// If method name looks like 'create' + Type, we can infer the type
								const possibleTypeName = methodName.replace(/^create/, "")

								// Check if namespace has a type with this name
								// Since we can't directly check at lint time, we'll use the namespace + inferred type
								if (possibleTypeName && possibleTypeName !== methodName) {
									return fixer.replaceText(
										node,
										`${namespace}.${possibleTypeName}.create(${sourceCode.getText(node)})`,
									)
								}

								// Fallback - use a more generic approach with namespace
								return fixer.replaceText(node, `${namespace}.create(${sourceCode.getText(node)})`)
							},
						})
						return
					}
				}

				// For regular function calls with object literals, check if there are protobuf imports
				// and if the function might expect a protobuf type
				if (node.parent.callee) {
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
									if (
										typeName &&
										(protobufImports.has(typeName) ||
											isNamespacedProtobufType(protobufNamespaceImports, typeName))
									) {
										const callText = sourceCode.getText(node.parent)
										//console.log('🚨 VIOLATION: Function call arguments object literal:', callText);
										context.report({
											node,
											messageId: "useProtobufMethodGeneric",
											data: { code: callText },
											fix(fixer) {
												// For function calls with protobuf type parameters
												return fixer.replaceText(node, `${typeName}.create(${sourceCode.getText(node)})`)
											},
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

// Helper functions
function getTypeName(typeAnnotation) {
	if (!typeAnnotation) {
		return null
	}

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

// Helper to extract function return type more reliably
function getFunctionReturnType(functionNode, sourceCode) {
	// 1. Check explicit return type annotation
	if (functionNode.returnType) {
		return getTypeName(functionNode.returnType.typeAnnotation)
	}

	// 2. For variable declarations like const foo: (arg: Type) => ReturnType = ...
	if (functionNode.parent && functionNode.parent.type === "VariableDeclarator") {
		const declarator = functionNode.parent
		if (declarator.id && declarator.id.typeAnnotation) {
			const typeAnnotation = declarator.id.typeAnnotation.typeAnnotation

			// Handle function type annotations
			if (typeAnnotation.type === "TSFunctionType" && typeAnnotation.typeAnnotation) {
				return getTypeName(typeAnnotation.typeAnnotation)
			}

			// Handle type references to function types
			if (typeAnnotation.type === "TSTypeReference") {
				// This might be a type like Promise<ReturnType>
				if (
					typeAnnotation.typeName.name === "Promise" &&
					typeAnnotation.typeParameters &&
					typeAnnotation.typeParameters.params.length > 0
				) {
					return getTypeName(typeAnnotation.typeParameters.params[0])
				}
			}
		}
	}

	// 3. For class methods, check if it's part of an interface implementation
	if (
		functionNode.parent &&
		functionNode.parent.type === "MethodDefinition" &&
		functionNode.parent.parent &&
		functionNode.parent.parent.type === "ClassBody"
	) {
		const className = getEnclosingClassName(functionNode)
		const methodName = functionNode.parent.key.name

		if (className && methodName) {
			// Look for interface declarations in the scope
			const scope = sourceCode.getScope(functionNode)
			// This would require more complex scope analysis which is limited in ESLint
			// For now, we'll return null and rely on other methods
		}
	}

	return null
}

// Helper to get the class name for a method
function getEnclosingClassName(node) {
	let current = node.parent
	while (current) {
		if (current.type === "ClassDeclaration" && current.id) {
			return current.id.name
		}
		current = current.parent
	}
	return null
}
function isNamespacedProtobufType(protobufNamespaceImports, typeName) {
	if (!typeName.includes(".")) {
		return false
	}

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
