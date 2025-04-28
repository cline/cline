export default `
; Document structure
(document) @definition.document

; Elements with content
(element
  (start_tag
    (tag_name) @name.definition)
  (#not-eq? @name.definition "script")
  (#not-eq? @name.definition "style")) @definition.element

; Script elements
(script_element
  (start_tag
    (tag_name) @name.definition)) @definition.script

; Style elements
(style_element
  (start_tag
    (tag_name) @name.definition)) @definition.style

; Attributes
(attribute
  (attribute_name) @name.definition) @definition.attribute

; Comments
(comment) @definition.comment

; Text content
(text) @definition.text

; Raw text content
(raw_text) @definition.raw_text

; Void elements (self-closing)
(element
  (start_tag
    (tag_name) @name.definition)
  (#match? @name.definition "^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$")) @definition.void_element

; Self-closing tags
(self_closing_tag
  (tag_name) @name.definition) @definition.self_closing_tag

; Doctype declarations
(doctype) @definition.doctype

; Multiple elements (parent with children)
(element
  (element)+) @definition.nested_elements
`
