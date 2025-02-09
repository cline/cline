/*
- struct definitions
- method definitions
- function definitions
*/

// Query for finding imports
export const importQuery = `
(use_declaration path: (scoped_identifier name: (identifier) @import path: (identifier) @module))
(extern_crate_declaration name: (identifier) @module)
`

// Query for finding definitions
export default `
(struct_item
  name: (type_identifier) @name.definition.class) @definition.class

(declaration_list
    (function_item
        name: (identifier) @name.definition.method)) @definition.method

(function_item
    name: (identifier) @name.definition.function) @definition.function
`
