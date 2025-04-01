import typescriptQuery from "./typescript"

/**
 * Tree-sitter Query for TSX Files:
 *    Combines TypeScript queries with TSX-specific React component queries
 *
 * This query captures various TypeScript and React component definitions in TSX files.
 *
 * TSX COMPONENT STRUCTURE:
 *
 * 1. React Function Component (Function Declaration):
 *    ```tsx
 *    function MyComponent(): JSX.Element {
 *      return <div>...</div>;
 *    }
 *    ```
 *    Tree Structure:
 *    - function_declaration
 *      - name: identifier ("MyComponent")
 *      - return_type: type_annotation
 *        - type_identifier ("JSX.Element") or generic_type
 *      - body: statement_block
 *
 * 2. React Function Component (Arrow Function):
 *    ```tsx
 *    const MyComponent = (): JSX.Element => {
 *      return <div>...</div>;
 *    }
 *    ```
 *    Tree Structure:
 *    - variable_declaration
 *      - variable_declarator
 *        - name: identifier ("MyComponent")
 *        - value: arrow_function
 *          - return_type: type_annotation
 *            - type_identifier or generic_type
 *
 * 3. React Function Component (Exported Arrow Function):
 *    ```tsx
 *    export const MyComponent = ({ prop1, prop2 }) => {
 *      return <div>...</div>;
 *    }
 *    ```
 *    Tree Structure:
 *    - export_statement
 *      - variable_declaration
 *        - variable_declarator
 *          - name: identifier ("MyComponent")
 *          - value: arrow_function
 *
 * 4. React Class Component:
 *    ```tsx
 *    class MyComponent extends React.Component {
 *      render() {
 *        return <div>...</div>;
 *      }
 *    }
 *    ```
 *    Tree Structure:
 *    - class_declaration
 *      - name: type_identifier ("MyComponent")
 *      - class_heritage
 *        - extends_clause
 *          - member_expression ("React.Component")
 *
 * IMPORTANT NOTES:
 * - Field names like "superclass" or "extends" don't exist in the TSX grammar
 * - Use direct node matching instead of field names when possible
 * - Simpler patterns are more robust and less prone to errors
 */

export default `${typescriptQuery}

; React Component Definitions
; Function Components
(function_declaration
  name: (identifier) @name.definition.component) @definition.component

; Arrow Function Components
(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.component
    value: [(arrow_function) (function_expression)])) @definition.component

; Class Components
(class_declaration
  name: (type_identifier) @name.definition.component
  (class_heritage
    (extends_clause
      (member_expression) @base))) @definition.component

; Higher Order Components
(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.component
    value: (call_expression
      function: (identifier) @hoc))) @definition.component
  (#match? @hoc "^with[A-Z]")

; Capture all named definitions (component or not)
(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition
    value: [
      (call_expression) @value
      (arrow_function) @value
    ])) @definition.component

; Capture all exported component declarations, including React component wrappers
(export_statement
  (variable_declaration
    (variable_declarator
      name: (identifier) @name.definition.component
      value: [
        (call_expression) @value
        (arrow_function) @value
      ]))) @definition.component

; Capture React component name inside wrapped components
(call_expression
  function: (_)
  arguments: (arguments
    (arrow_function))) @definition.wrapped_component

; HOC definitions - capture both the HOC name and definition
(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.hoc
    value: (arrow_function
      parameters: (formal_parameters)))) @definition.hoc

; Type definitions (to include interfaces and types)
(type_alias_declaration
  name: (type_identifier) @name.definition.type) @definition.type

(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

; Enhanced Components
(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.component
    value: (call_expression))) @definition.component

; Types and Interfaces
(interface_declaration
  name: (type_identifier) @name.definition.interface) @definition.interface

(type_alias_declaration
  name: (type_identifier) @name.definition.type) @definition.type

; JSX Component Usage - Capture all components in JSX
(jsx_element
  open_tag: (jsx_opening_element
    name: [(identifier) @component (member_expression) @component])) @definition.component
  (#match? @component "^[A-Z]")

(jsx_self_closing_element
  name: [(identifier) @component (member_expression) @component]) @definition.component
  (#match? @component "^[A-Z]")

; Capture all identifiers in JSX expressions that start with capital letters
(jsx_expression
  (identifier) @jsx_component) @definition.jsx_component
  (#match? @jsx_component "^[A-Z]")

; Capture all member expressions in JSX
(member_expression
  object: (identifier) @object
  property: (property_identifier) @property) @definition.member_component
  (#match? @object "^[A-Z]")

; Capture components in conditional expressions
(ternary_expression
  consequence: (parenthesized_expression
    (jsx_element
      open_tag: (jsx_opening_element
        name: (identifier) @component)))) @definition.conditional_component
  (#match? @component "^[A-Z]")

(ternary_expression
  alternative: (jsx_self_closing_element
    name: (identifier) @component)) @definition.conditional_component
  (#match? @component "^[A-Z]")
`
