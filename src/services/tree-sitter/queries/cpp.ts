/*
- struct declarations
- union declarations
- function declarations
- method declarations (with namespace scope)
- typedef declarations
- class declarations
- enum declarations (including enum class)
- namespace declarations (including nested namespaces)
- template declarations (including specializations and variadic templates)
- macro definitions
- constructor declarations
- destructor declarations
- operator overloading
- static member declarations
- friend declarations
- using declarations and directives
- alias declarations (using)
- constexpr functions and variables
- lambda expressions
- attributes
- inheritance relationships
- static variables
- virtual functions
- auto type deduction
- concepts (C++20)
- inline functions and variables
- nested namespaces (C++17)
- structured bindings (C++17)
- noexcept specifier
- default parameters
- variadic templates
- explicit template instantiation
*/
export default `
; Struct declarations
(struct_specifier name: (type_identifier) @name.definition.class) @definition.class

; Union declarations
(union_specifier name: (type_identifier) @name.definition.class) @definition.class

; Function declarations
(function_declarator declarator: (identifier) @name.definition.function) @definition.function

; Method declarations (field identifier)
(function_declarator declarator: (field_identifier) @name.definition.function) @definition.function

; Class declarations
(class_specifier name: (type_identifier) @name.definition.class) @definition.class

; Enum declarations
(enum_specifier name: (type_identifier) @name.definition.enum) @definition.enum

; Namespace declarations
(namespace_definition name: (namespace_identifier) @name.definition.namespace) @definition.namespace

; Template declarations
(template_declaration) @definition.template

; Template class declarations
(template_declaration (class_specifier name: (type_identifier) @name.definition.template_class)) @definition.template_class

; Template function declarations
(template_declaration (function_definition declarator: (function_declarator declarator: (identifier) @name.definition.template_function))) @definition.template_function

; Virtual functions
(function_definition (virtual)) @definition.virtual_function

; Auto type deduction
(declaration type: (placeholder_type_specifier (auto))) @definition.auto_variable

; Structured bindings (C++17) - using a text-based match
(declaration) @definition.structured_binding
  (#match? @definition.structured_binding "\\[.*\\]")

; Inline functions and variables - using a text-based match
(function_definition) @definition.inline_function
  (#match? @definition.inline_function "inline")

(declaration) @definition.inline_variable
  (#match? @definition.inline_variable "inline")

; Noexcept specifier - using a text-based match
(function_definition) @definition.noexcept_function
  (#match? @definition.noexcept_function "noexcept")

; Function with default parameters - using a text-based match
(function_declarator) @definition.function_with_default_params
  (#match? @definition.function_with_default_params "=")

; Variadic templates - using a text-based match
(template_declaration) @definition.variadic_template
  (#match? @definition.variadic_template "\\.\\.\\.")

; Explicit template instantiation - using a text-based match
(template_declaration) @definition.template_instantiation
  (#match? @definition.template_instantiation "template\\s+class|template\\s+struct")
`
