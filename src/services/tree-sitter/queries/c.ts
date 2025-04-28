/*
C Language Constructs Supported by Tree-Sitter Parser:

1. Class-like Constructs:
- struct definitions (with fields)
- union definitions (with variants)
- enum definitions (with values)
- anonymous unions/structs
- aligned structs

2. Function-related Constructs:
- function definitions (with parameters)
- function declarations (prototypes)
- static functions
- function pointers

3. Type Definitions:
- typedef declarations (all types)
- function pointer typedefs
- struct/union typedefs

4. Variable Declarations:
- global variables
- static variables
- array declarations
- pointer declarations

5. Preprocessor Constructs:
- function-like macros
- object-like macros
- conditional compilation
*/

export default `
; Function definitions and declarations
(function_definition
  declarator: (function_declarator
    declarator: (identifier) @name.definition.function))

(declaration
  type: (_)?
  declarator: (function_declarator
    declarator: (identifier) @name.definition.function
    parameters: (parameter_list)?)?) @definition.function

(function_declarator
  declarator: (identifier) @name.definition.function
  parameters: (parameter_list)?) @definition.function

; Struct definitions
(struct_specifier
  name: (type_identifier) @name.definition.struct) @definition.struct

; Union definitions
(union_specifier
  name: (type_identifier) @name.definition.union) @definition.union

; Enum definitions
(enum_specifier
  name: (type_identifier) @name.definition.enum) @definition.enum

; Typedef declarations
(type_definition
  declarator: (type_identifier) @name.definition.type) @definition.type

; Global variables
(declaration
  (storage_class_specifier)?
  type: (_)
  declarator: (identifier) @name.definition.variable) @definition.variable

(declaration
  (storage_class_specifier)?
  type: (_)
  declarator: (init_declarator
    declarator: (identifier) @name.definition.variable)) @definition.variable

; Object-like macros
(preproc_def
  name: (identifier) @name.definition.macro) @definition.macro

; Function-like macros
(preproc_function_def
  name: (identifier) @name.definition.macro) @definition.macro
`
