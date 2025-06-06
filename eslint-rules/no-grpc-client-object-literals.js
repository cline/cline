const { ESLintUtils } = require("@typescript-eslint/utils")

const createRule = ESLintUtils.RuleCreator((name) => `https://cline.bot/eslint-rules/${name}`)

module.exports = createRule({
	name: "no-grpc-client-object-literals",
	meta: {
		type: "problem",
		docs: {
			description:
				"Enforce using .create() or .fromPartial() for gRPC service client parameters instead of object literals",
			recommended: "error",
		},
		messages: {
			useProtobufMethod:
				"Use the appropriate protobuf .create() or .fromPartial() method instead of " +
				"object literal for gRPC client parameters.\n" +
				"Found: {{code}}\n" +
				"gRPC client methods should always receive properly created protobuf objects.",
		},
		schema: [],
	},
	defaultOptions: [],

	create(context) {
		// Check if a name matches the gRPC service client pattern using regex
		// Must start with an uppercase letter and end with ServiceClient
		const isGrpcServiceClient = (name) => {
			return typeof name === "string" && /^[A-Z].*ServiceClient$/.test(name)
		}

		const safeObjectExpressions = new Map() // Track object expressions in create/fromPartial calls

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
					safeObjectExpressions.set(node.arguments[0], { isProblematic: false })
				}
			},

			// Track create/fromPartial calls that contain nested object literals
			"CallExpression[callee.type='MemberExpression'][callee.property.name=/^(create|fromPartial)$/]"(node) {
				if (node.arguments.length > 0 && node.arguments[0].type === "ObjectExpression") {
					// Track problematic nested object literals
					const nestedObjectLiterals = new Map() // Map of object expressions to their containing property paths

					// Search for nested object literals
					const queue = [
						...node.arguments[0].properties.map((prop) => ({
							property: prop,
							path: prop.key && prop.key.name ? prop.key.name : "unknown",
						})),
					]

					while (queue.length > 0) {
						const { property, path } = queue.shift()

						// Skip spread elements
						if (property.type !== "Property") continue

						// If this is an object literal, mark it as problematic
						if (property.value.type === "ObjectExpression") {
							nestedObjectLiterals.set(property.value, path)

							// Add nested properties to queue
							queue.push(
								...property.value.properties.map((prop) => ({
									property: prop,
									path: `${path}.${prop.key && prop.key.name ? prop.key.name : "unknown"}`,
								})),
							)
						}
					}

					// For each problematic nested object, track it with its path
					nestedObjectLiterals.forEach((path, objectExpr) => {
						safeObjectExpressions.set(objectExpr, {
							isProblematic: true,
							path: path,
							parentNode: node,
						})
					})
				}
			},

			// Check calls to gRPC service clients
			"CallExpression[callee.type='MemberExpression']"(node) {
				// Get the object (left side) of the member expression
				const callee = node.callee
				if (callee.object && callee.object.type === "Identifier") {
					const objectName = callee.object.name

					// Check if this is a call to one of our gRPC service clients
					if (isGrpcServiceClient(objectName)) {
						// Only check the first argument of gRPC service client calls
						if (node.arguments.length > 0) {
							const arg = node.arguments[0] // Only check the first parameter
							if (arg.type === "ObjectExpression" && !safeObjectExpressions.has(arg)) {
								// This is an object literal being passed directly to a gRPC client
								const sourceCode = context.getSourceCode()
								const callText = sourceCode.getText(node).trim()

								context.report({
									node: arg,
									messageId: "useProtobufMethod",
									data: {
										code: callText,
									},
								})
							} else if (arg.type === "ObjectExpression") {
								// Search for nested object literals that aren't protected
								const queue = [...arg.properties]
								while (queue.length > 0) {
									const property = queue.shift()

									// Skip spread elements
									if (property.type !== "Property") continue

									// Check value
									if (
										property.value.type === "ObjectExpression" &&
										!safeObjectExpressions.has(property.value)
									) {
										// Found a nested object literal
										const sourceCode = context.getSourceCode()
										const propertyText = sourceCode.getText(property).trim()

										context.report({
											node: property.value,
											messageId: "useProtobufMethod",
											data: {
												code: `${objectName}.${callee.property.name}(... ${propertyText} ...)`,
											},
										})
									}

									// Add any nested properties to the queue
									if (property.value.type === "ObjectExpression") {
										queue.push(...property.value.properties)
									}
								}
							} else if (arg.type === "Identifier") {
								// This is a variable - check if it references a problematic protobuf object
								const varName = arg.name
								const sourceCode = context.getSourceCode()
								const scope = sourceCode.getScope(node)

								// Find the variable declaration
								const variable = scope.variables.find((v) => v.name === varName)
								if (variable && variable.references && variable.references.length > 0) {
									// Look for definitions
									const def = variable.defs.find(
										(d) => d.node && d.node.type === "VariableDeclarator" && d.node.init,
									)

									if (
										def &&
										def.node.init.type === "CallExpression" &&
										def.node.init.callee.type === "MemberExpression" &&
										(def.node.init.callee.property.name === "create" ||
											def.node.init.callee.property.name === "fromPartial")
									) {
										// Flag if we find problematic nested object literals in this create/fromPartial call
										const callText = sourceCode.getText(node).trim()
										const initCallText = sourceCode.getText(def.node.init).trim()

										// Check for nested object literals in init node
										let foundNestedLiteral = false
										if (
											def.node.init.arguments.length > 0 &&
											def.node.init.arguments[0].type === "ObjectExpression"
										) {
											// Find any nested object literals
											const queue = [...def.node.init.arguments[0].properties]
											while (queue.length > 0 && !foundNestedLiteral) {
												const property = queue.shift()

												// Skip spread elements
												if (property.type !== "Property") continue

												if (property.value.type === "ObjectExpression") {
													foundNestedLiteral = true

													context.report({
														node,
														messageId: "useProtobufMethod",
														data: {
															code: `${callText} - using request created with nested object literal at: ${property.key.name}`,
														},
													})
												}

												// Add any nested properties to the queue
												if (property.value.type === "ObjectExpression") {
													queue.push(...property.value.properties)
												}
											}
										}
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
