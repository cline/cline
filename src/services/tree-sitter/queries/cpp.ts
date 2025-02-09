/*
- struct declarations
- union declarations
- function declarations
- method declarations (with namespace scope)
- typedef declarations
- class declarations
*/

// Query for finding imports
export const importQuery = `
[
  (include_directive
    path: (string_literal) @module)

  (include_directive
    path: (system_lib_string) @module)

  (using_declaration
    name: (qualified_identifier) @import)
]
`

// Query for finding definitions
export default `
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name.definition.function)) @definition.function

(method_definition
  declarator: (function_declarator
    declarator: (field_identifier) @name.definition.method)) @definition.method

(class_specifier
  name: (type_identifier) @name.definition.class) @definition.class

(namespace_definition
  name: (identifier) @name.definition.module) @definition.module
`
