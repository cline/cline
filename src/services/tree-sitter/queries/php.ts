/*
- class declarations
- function definitions
- method declarations
*/

// Query for finding imports
export const importQuery = `
[
  ; Regular namespace use
  (namespace_use_clause 
    name: (qualified_name) @module)
  
  ; Group use declarations
  (namespace_use_group_clause 
    name: (qualified_name) @module
    (namespace_use_group 
      (namespace_name) @import))
  
  ; Function imports
  (namespace_use_clause 
    "function" 
    name: (qualified_name) @module)
  
  ; Const imports
  (namespace_use_clause 
    "const" 
    name: (qualified_name) @module)
  
  ; Conditional imports inside if blocks
  (if_statement
    (namespace_use_clause 
      name: (qualified_name) @module))
]
`

// Query for finding definitions
export default `
(class_declaration
  name: (name) @name.definition.class) @definition.class

(function_definition
  name: (name) @name.definition.function) @definition.function

(method_declaration
  name: (name) @name.definition.function) @definition.function
`
