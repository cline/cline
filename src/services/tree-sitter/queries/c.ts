/*
- struct declarations
- union declarations
- function declarations
- typedef declarations
*/

// Query for finding imports/includes
export const importQuery = `
(preproc_include path: (string_literal) @module)
(preproc_include path: (system_lib_string) @module)
`

// Query for finding definitions
export default `
(struct_specifier name: (type_identifier) @name.definition.class body:(_)) @definition.class

(declaration type: (union_specifier name: (type_identifier) @name.definition.class)) @definition.class

(function_declarator declarator: (identifier) @name.definition.function) @definition.function

(type_definition declarator: (type_identifier) @name.definition.type) @definition.type
`
