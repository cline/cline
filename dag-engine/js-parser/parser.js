#!/usr/bin/env node
/**
 * JavaScript/TypeScript AST parser for DAG analysis.
 * Reads file path from stdin (JSON-RPC), outputs JSON analysis to stdout.
 */

const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;

/**
 * Parse a JavaScript or TypeScript file and extract symbols.
 * @param {string} filePath - Absolute path to the source file
 * @returns {Object} Analysis result with nodes and edges
 */
function parseFile(filePath) {
  let source;
  try {
    source = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return {
      error: `File read error: ${err.message}`,
      nodes: [],
      edges: [],
      warnings: [],
    };
  }

  const ext = path.extname(filePath).toLowerCase();

  // Configure parser plugins based on file type
  const plugins = [
    'jsx',
    'classProperties',
    'classPrivateProperties',
    'classPrivateMethods',
    'exportDefaultFrom',
    'exportNamespaceFrom',
    'dynamicImport',
    'nullishCoalescingOperator',
    'optionalChaining',
    'decorators-legacy',
  ];

  if (ext === '.ts' || ext === '.tsx') {
    plugins.push('typescript');
  }

  let ast;
  try {
    ast = parser.parse(source, {
      sourceType: 'module',
      plugins,
      errorRecovery: true,
    });
  } catch (err) {
    return {
      error: `Parse error: ${err.message}`,
      nodes: [],
      edges: [],
      warnings: [{
        type: 'parse_error',
        file: filePath,
        line: err.loc?.line || 1,
        description: err.message,
        severity: 'high',
      }],
    };
  }

  const nodes = [];
  const edges = [];
  const warnings = [];
  const imports = new Map(); // alias -> { source, imported }
  let currentClass = null;
  let currentClassId = null;
  let currentFunction = null;
  let currentFunctionId = null;

  // Add file node
  nodes.push({
    id: filePath,
    type: 'file',
    file_path: filePath,
    line_number: 1,
    name: path.basename(filePath),
  });

  traverse(ast, {
    // Import declarations
    ImportDeclaration(nodePath) {
      const source = nodePath.node.source.value;
      const line = nodePath.node.loc?.start.line || 1;

      // Track each imported identifier
      for (const specifier of nodePath.node.specifiers) {
        let localName, importedName;

        if (specifier.type === 'ImportDefaultSpecifier') {
          localName = specifier.local.name;
          importedName = 'default';
        } else if (specifier.type === 'ImportNamespaceSpecifier') {
          localName = specifier.local.name;
          importedName = '*';
        } else {
          localName = specifier.local.name;
          importedName = specifier.imported?.name || specifier.local.name;
        }

        imports.set(localName, { source, imported: importedName });
      }

      // Add import edge to file
      edges.push({
        from_node: filePath,
        to_node: source,
        edge_type: 'import',
        confidence: 'high',
        line_number: line,
        label: `import from '${source}'`,
      });
    },

    // Export declarations (re-exports create edges)
    ExportNamedDeclaration(nodePath) {
      if (nodePath.node.source) {
        const source = nodePath.node.source.value;
        const line = nodePath.node.loc?.start.line || 1;

        edges.push({
          from_node: filePath,
          to_node: source,
          edge_type: 'import',
          confidence: 'high',
          line_number: line,
          label: `export from '${source}'`,
        });
      }
    },

    ExportAllDeclaration(nodePath) {
      const source = nodePath.node.source.value;
      const line = nodePath.node.loc?.start.line || 1;

      edges.push({
        from_node: filePath,
        to_node: source,
        edge_type: 'import',
        confidence: 'high',
        line_number: line,
        label: `export * from '${source}'`,
      });
    },

    // Class declarations
    ClassDeclaration(nodePath) {
      const node = nodePath.node;
      if (!node.id) return;

      const className = node.id.name;
      const classId = `${filePath}:${className}`;
      const line = node.loc?.start.line || 1;

      nodes.push({
        id: classId,
        type: 'class',
        file_path: filePath,
        line_number: line,
        name: className,
        docstring: extractLeadingComment(nodePath),
        end_line_number: node.loc?.end.line,
      });

      // Track inheritance
      if (node.superClass) {
        const superName = getNameFromNode(node.superClass);
        if (superName) {
          edges.push({
            from_node: classId,
            to_node: resolveReference(superName, imports, filePath),
            edge_type: 'inherit',
            confidence: getConfidence(superName, imports),
            line_number: line,
            label: `extends ${superName}`,
          });
        }
      }

      // Track implemented interfaces (TypeScript)
      if (node.implements) {
        for (const impl of node.implements) {
          const implName = getNameFromNode(impl.expression || impl);
          if (implName) {
            edges.push({
              from_node: classId,
              to_node: resolveReference(implName, imports, filePath),
              edge_type: 'inherit',
              confidence: getConfidence(implName, imports),
              line_number: line,
              label: `implements ${implName}`,
            });
          }
        }
      }

      currentClass = className;
      currentClassId = classId;
    },

    'ClassDeclaration:exit'() {
      currentClass = null;
      currentClassId = null;
    },

    // Class methods
    ClassMethod(nodePath) {
      const node = nodePath.node;
      const methodName = node.key.name || node.key.value;
      if (!methodName) return;

      const methodId = currentClass
        ? `${filePath}:${currentClass}.${methodName}`
        : `${filePath}:${methodName}`;
      const line = node.loc?.start.line || 1;

      nodes.push({
        id: methodId,
        type: 'method',
        file_path: filePath,
        line_number: line,
        name: methodName,
        docstring: extractLeadingComment(nodePath),
        parameters: extractParameters(node.params),
        return_type: extractReturnType(node),
        end_line_number: node.loc?.end.line,
      });

      currentFunction = methodName;
      currentFunctionId = methodId;
    },

    'ClassMethod:exit'() {
      currentFunction = null;
      currentFunctionId = null;
    },

    // Function declarations
    FunctionDeclaration(nodePath) {
      const node = nodePath.node;
      if (!node.id) return;

      const funcName = node.id.name;
      const funcId = `${filePath}:${funcName}`;
      const line = node.loc?.start.line || 1;

      nodes.push({
        id: funcId,
        type: 'function',
        file_path: filePath,
        line_number: line,
        name: funcName,
        docstring: extractLeadingComment(nodePath),
        parameters: extractParameters(node.params),
        return_type: extractReturnType(node),
        end_line_number: node.loc?.end.line,
      });

      currentFunction = funcName;
      currentFunctionId = funcId;
    },

    'FunctionDeclaration:exit'() {
      currentFunction = null;
      currentFunctionId = null;
    },

    // Arrow functions assigned to variables
    VariableDeclarator(nodePath) {
      const node = nodePath.node;
      if (!node.id?.name) return;
      if (node.init?.type !== 'ArrowFunctionExpression' &&
          node.init?.type !== 'FunctionExpression') {
        return;
      }

      const funcName = node.id.name;
      const funcId = `${filePath}:${funcName}`;
      const line = node.loc?.start.line || 1;

      nodes.push({
        id: funcId,
        type: 'function',
        file_path: filePath,
        line_number: line,
        name: funcName,
        docstring: extractLeadingComment(nodePath.parentPath),
        parameters: extractParameters(node.init.params),
        return_type: extractReturnType(node.init),
        end_line_number: node.loc?.end.line,
      });
    },

    // Function/method calls
    CallExpression(nodePath) {
      const callerId = currentFunctionId || filePath;

      // Handle dynamic imports
      if (nodePath.node.callee.type === 'Import') {
        const arg = nodePath.node.arguments[0];
        const line = nodePath.node.loc?.start.line || 1;

        if (arg?.type === 'StringLiteral') {
          edges.push({
            from_node: callerId,
            to_node: arg.value,
            edge_type: 'import',
            confidence: 'medium',
            line_number: line,
            label: `dynamic import('${arg.value}')`,
          });
        } else {
          warnings.push({
            type: 'dynamic_import',
            file: filePath,
            line,
            description: 'Dynamic import with non-literal argument',
            severity: 'medium',
          });
        }
        return;
      }

      const callee = getNameFromNode(nodePath.node.callee);
      if (!callee) return;

      // Skip common builtins
      const builtins = ['console', 'Math', 'JSON', 'Object', 'Array', 'Promise',
                        'Error', 'Number', 'String', 'Boolean', 'Date', 'RegExp',
                        'Map', 'Set', 'WeakMap', 'WeakSet', 'Symbol', 'parseInt',
                        'parseFloat', 'isNaN', 'isFinite', 'setTimeout', 'setInterval',
                        'clearTimeout', 'clearInterval', 'require'];
      const baseName = callee.split('.')[0];
      if (builtins.includes(baseName)) return;

      const line = nodePath.node.loc?.start.line || 1;

      edges.push({
        from_node: callerId,
        to_node: resolveReference(callee, imports, filePath),
        edge_type: 'call',
        confidence: getConfidence(callee, imports),
        line_number: line,
        label: `calls ${callee}`,
      });
    },

    // JSX elements as component calls
    JSXOpeningElement(nodePath) {
      const callerId = currentFunctionId || filePath;
      const element = nodePath.node.name;

      let componentName = null;
      if (element.type === 'JSXIdentifier') {
        componentName = element.name;
      } else if (element.type === 'JSXMemberExpression') {
        componentName = getJSXMemberName(element);
      }

      if (!componentName) return;

      // Skip lowercase (HTML elements)
      if (componentName[0] === componentName[0].toLowerCase()) return;

      const line = nodePath.node.loc?.start.line || 1;

      edges.push({
        from_node: callerId,
        to_node: resolveReference(componentName, imports, filePath),
        edge_type: 'call',
        confidence: getConfidence(componentName, imports),
        line_number: line,
        label: `renders <${componentName} />`,
      });
    },
  });

  return { nodes, edges, warnings };
}

/**
 * Extract name from various AST node types.
 */
function getNameFromNode(node) {
  if (!node) return null;

  switch (node.type) {
    case 'Identifier':
      return node.name;
    case 'MemberExpression':
      const obj = getNameFromNode(node.object);
      const prop = node.computed
        ? null
        : node.property.name || node.property.value;
      if (obj && prop) return `${obj}.${prop}`;
      if (prop) return prop;
      return null;
    case 'ThisExpression':
      return 'this';
    case 'CallExpression':
      return getNameFromNode(node.callee);
    default:
      return null;
  }
}

/**
 * Get JSX member expression name.
 */
function getJSXMemberName(node) {
  if (node.type === 'JSXIdentifier') {
    return node.name;
  }
  if (node.type === 'JSXMemberExpression') {
    const obj = getJSXMemberName(node.object);
    const prop = node.property.name;
    return obj ? `${obj}.${prop}` : prop;
  }
  return null;
}

/**
 * Resolve a reference to its likely target.
 */
function resolveReference(name, imports, currentFile) {
  const baseName = name.split('.')[0];

  if (imports.has(baseName)) {
    const imp = imports.get(baseName);
    if (imp.imported === 'default') {
      return `${imp.source}:default`;
    }
    if (imp.imported === '*') {
      // Namespace import, try to resolve member
      const parts = name.split('.');
      if (parts.length > 1) {
        return `${imp.source}:${parts.slice(1).join('.')}`;
      }
      return `${imp.source}:*`;
    }
    return `${imp.source}:${imp.imported}`;
  }

  // Could be a local reference
  if (!name.includes('.')) {
    return `${currentFile}:${name}`;
  }

  return name;
}

/**
 * Determine confidence level for a reference.
 */
function getConfidence(name, imports) {
  const baseName = name.split('.')[0];

  if (imports.has(baseName)) {
    return 'high';
  }

  if (name.includes('[') || name.includes('eval')) {
    return 'unsafe';
  }

  return 'medium';
}

/**
 * Extract parameters from function params.
 */
function extractParameters(params) {
  return params.map(param => {
    if (param.type === 'Identifier') {
      const annotation = param.typeAnnotation?.typeAnnotation;
      if (annotation) {
        return `${param.name}: ${typeAnnotationToString(annotation)}`;
      }
      return param.name;
    }
    if (param.type === 'AssignmentPattern') {
      const name = param.left.name || '?';
      return `${name}?`;
    }
    if (param.type === 'RestElement') {
      const name = param.argument.name || 'args';
      return `...${name}`;
    }
    if (param.type === 'ObjectPattern') {
      return '{ ... }';
    }
    if (param.type === 'ArrayPattern') {
      return '[ ... ]';
    }
    return '?';
  });
}

/**
 * Extract return type annotation.
 */
function extractReturnType(node) {
  const annotation = node.returnType?.typeAnnotation;
  if (!annotation) return null;
  return typeAnnotationToString(annotation);
}

/**
 * Convert TypeScript type annotation to string.
 */
function typeAnnotationToString(annotation) {
  if (!annotation) return 'any';

  switch (annotation.type) {
    case 'TSStringKeyword': return 'string';
    case 'TSNumberKeyword': return 'number';
    case 'TSBooleanKeyword': return 'boolean';
    case 'TSVoidKeyword': return 'void';
    case 'TSAnyKeyword': return 'any';
    case 'TSNullKeyword': return 'null';
    case 'TSUndefinedKeyword': return 'undefined';
    case 'TSNeverKeyword': return 'never';
    case 'TSUnknownKeyword': return 'unknown';
    case 'TSObjectKeyword': return 'object';
    case 'TSTypeReference':
      const typeName = annotation.typeName?.name || 'unknown';
      if (annotation.typeParameters) {
        const params = annotation.typeParameters.params
          .map(typeAnnotationToString)
          .join(', ');
        return `${typeName}<${params}>`;
      }
      return typeName;
    case 'TSArrayType':
      return `${typeAnnotationToString(annotation.elementType)}[]`;
    case 'TSUnionType':
      return annotation.types.map(typeAnnotationToString).join(' | ');
    case 'TSIntersectionType':
      return annotation.types.map(typeAnnotationToString).join(' & ');
    case 'TSFunctionType':
      return 'Function';
    case 'TSTypeLiteral':
      return 'object';
    default:
      return 'unknown';
  }
}

/**
 * Extract leading JSDoc or comment.
 */
function extractLeadingComment(nodePath) {
  const comments = nodePath.node.leadingComments;
  if (!comments || comments.length === 0) return null;

  const last = comments[comments.length - 1];
  if (last.type === 'CommentBlock') {
    return last.value
      .replace(/^\*+/, '')
      .replace(/\n\s*\*/g, '\n')
      .trim();
  }
  return null;
}

// Main: JSON-RPC over stdin/stdout
async function main() {
  const args = process.argv.slice(2);

  if (args.length > 0) {
    // Parse single file from command line (for testing)
    const result = parseFile(args[0]);
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Read JSON-RPC requests from stdin
  const readline = require('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;

    try {
      const request = JSON.parse(line);
      const result = parseFile(request.file);
      console.log(JSON.stringify({ id: request.id, result }));
    } catch (err) {
      console.log(JSON.stringify({ id: 0, error: err.message }));
    }
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
