// Query patterns for TOML syntax elements
export const tomlQuery = `
; Tables - capture the entire table node
(table) @definition

; Array tables - capture the entire array table node
(table_array_element) @definition

; Key-value pairs - capture the entire pair
(pair) @definition

; Arrays and inline tables
(array) @definition
(inline_table) @definition

; Basic values
(string) @definition
(integer) @definition
(float) @definition
(boolean) @definition
(offset_date_time) @definition
(local_date) @definition
(local_time) @definition
`
