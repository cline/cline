/*
- struct definitions
- method definitions
- function definitions
*/
export default `
(struct_item
    name: (type_identifier) @name.definition.class) @definition.class

(declaration_list
    (function_item
        name: (identifier) @name.definition.method)) @definition.method

(function_item
    name: (identifier) @name.definition.function) @definition.function
`
