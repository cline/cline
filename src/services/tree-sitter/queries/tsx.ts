import typescriptQuery from "./typescript"

/**
 * Tree-sitter Query for TSX Files
 *
 * This query captures React component definitions in TSX files:
 * - Function Components
 * - Class Components
 * - Higher Order Components
 * - Type Definitions
 * - Props Interfaces
 * - State Definitions
 * - Generic Components
 */

export default `${typescriptQuery}

; Function Components - Both function declarations and arrow functions
(function_declaration
  name: (identifier) @name) @definition.component

; Arrow Function Components
(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: (arrow_function))) @definition.component

; Export Statement Components
(export_statement
  (variable_declaration
    (variable_declarator
      name: (identifier) @name
      value: (arrow_function)))) @definition.component

; Class Components
(class_declaration
  name: (type_identifier) @name) @definition.class_component

; Interface Declarations
(interface_declaration
  name: (type_identifier) @name) @definition.interface

; Type Alias Declarations
(type_alias_declaration
  name: (type_identifier) @name) @definition.type

; HOC Components
(variable_declaration
  (variable_declarator
    name: (identifier) @name
    value: (call_expression
      function: (identifier)))) @definition.component

; JSX Component Usage - Capture all components in JSX
(jsx_element
  open_tag: (jsx_opening_element
    name: [(identifier) @component (member_expression) @component])) @definition.jsx_element

; Self-closing JSX elements
(jsx_self_closing_element
  name: [(identifier) @component (member_expression) @component]) @definition.jsx_self_closing_element

; Capture all identifiers in JSX expressions that start with capital letters
(jsx_expression
  (identifier) @jsx_component) @definition.jsx_component

; Capture all member expressions in JSX
(member_expression
  object: (identifier) @object
  property: (property_identifier) @property) @definition.member_component

; Capture components in conditional expressions
(ternary_expression
  consequence: (parenthesized_expression
    (jsx_element
      open_tag: (jsx_opening_element
        name: (identifier) @component)))) @definition.conditional_component

(ternary_expression
  alternative: (jsx_self_closing_element
    name: (identifier) @component)) @definition.conditional_component

; Generic Components
(function_declaration
  name: (identifier) @name
  type_parameters: (type_parameters)) @definition.generic_component
`
