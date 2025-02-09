/*
- struct declarations
- union declarations
- function declarations
- method declarations (with namespace scope)
- typedef declarations
- class declarations
*/

// Query for finding imports/includes
export const importQuery = `
[
  ; Standard includes with angle brackets
  (preproc_include 
    path: (system_lib_string) @module @import)

  ; Local includes with quotes
  (preproc_include 
    path: (string_literal) @module @import)

  ; Include with macro expansion
  (preproc_include
    path: (identifier) @module @import)

  ; Include with path concatenation
  (preproc_include
    path: (concatenated_string) @module @import)

  ; Include with conditional compilation
  (if_statement 
    condition: (condition) @condition
    (preproc_include 
      path: [(string_literal) (system_lib_string)] @module @import))
]
`

// Query for finding definitions
export default `
(struct_specifier name: (type_identifier) @name.definition.class body:(_)) @definition.class

(declaration type: (union_specifier name: (type_identifier) @name.definition.class)) @definition.class

(function_declarator declarator: (identifier) @name.definition.function) @definition.function

(function_declarator declarator: (field_identifier) @name.definition.function) @definition.function

(function_declarator declarator: (qualified_identifier scope: (namespace_identifier) @scope name: (identifier) @name.definition.method)) @definition.method

(type_definition declarator: (type_identifier) @name.definition.type) @definition.type

(class_specifier name: (type_identifier) @name.definition.class) @definition.class
`
