/*
Supported Lua structures:
- function definitions (global, local, and method)
- table constructors
- variable declarations
- class-like structures
*/
export default String.raw`
; Function definitions
(function_definition_statement
  name: (identifier) @name.definition.function) @definition.function

(function_definition_statement
  name: (variable
    table: (identifier)
    field: (identifier) @name.definition.method)) @definition.method

(local_function_definition_statement
  name: (identifier) @name.definition.function) @definition.function

; Table constructors (class-like structures)
(local_variable_declaration
  (variable_list
    (variable name: (identifier) @name.definition.table))
  (expression_list
    value: (table))) @definition.table

; Variable declarations
(variable_assignment
  (variable_list
    (variable name: (identifier) @name.definition.variable))) @definition.variable

; Local variable declarations
(local_variable_declaration
  (variable_list
    (variable name: (identifier) @name.definition.variable))) @definition.variable
`
