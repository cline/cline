export const vueQuery = `
; Top-level structure
(component) @component.definition

; Template section
(template_element) @template.definition
(template_element
  (element
    (start_tag
      (tag_name) @element.name.definition))
  (element
    (start_tag
      (attribute
        (attribute_name) @attribute.name.definition)))
  (element
    (start_tag
      (directive_attribute
        (directive_name) @directive.name.definition))))

; Script section
(script_element) @script.definition
(script_element
  (raw_text) @script.content.definition)

; Style section
(style_element) @style.definition
(style_element
  (raw_text) @style.content.definition)
`
