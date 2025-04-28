export default String.raw`
// Function definition tests - standard, async, and const functions
fn test_function_definition(
    param1: i32,
    param2: &str,
    param3: Option<String>,
    param4: Vec<u8>
) -> Result<i32, String> {
    println!("Function definition test");
    let result = param1 + param3.map_or(0, |s| s.len() as i32);
    Ok(result)
}

async fn test_async_function_definition(
    url: &str,
    timeout: std::time::Duration,
    retry_count: u32,
    headers: Vec<(&str, &str)>
) -> Result<String, Box<dyn std::error::Error>> {
    println!("Async function test");
    println!("URL: {}, timeout: {:?}, retries: {}", url, timeout, retry_count);
    Ok(String::from("Async test response"))
}

const fn test_const_function_definition<T: Copy + std::fmt::Debug>(
    value: T,
    multiplier: usize,
    prefix: &'static str,
    suffix: &'static str
) -> [T; 4] {
    println!("Const function test");
    [value; 4]
}

// Struct definition tests - standard, tuple, and unit structs
// Note: Unit structs are exempt from 4-line requirement due to language syntax
struct test_struct_definition {
    name: String,
    value: i32,
    data: Option<Vec<f64>>,
    metadata: std::collections::HashMap<String, i32>,
    created_at: std::time::SystemTime,
}

struct test_tuple_struct_definition(
    String,
    i32,
    Option<Vec<f64>>,
    std::collections::HashMap<String, i32>,
    std::time::SystemTime
);

// Unit struct - exempt from 4-line requirement
struct test_unit_struct_definition;

// Enum definition tests
enum test_enum_definition {
    // Unit variant - exempt from 4-line requirement
    TestUnitVariant,
    
    // Tuple variant with multiple fields
    TestTupleVariant(
        String,
        i32,
        f64,
        Vec<u8>
    ),
    
    // Struct variant with fields
    TestStructVariant {
        name: String,
        value: i32,
        data: Option<Vec<f64>>,
        timestamp: std::time::SystemTime
    },
    
    // Recursive variant
    TestRecursiveVariant(
        String,
        Box<test_enum_definition>
    )
}

// Trait definition test
trait test_trait_definition {
    // Required method
    fn test_required_method(
        &self,
        input: &str,
        count: usize
    ) -> Result<String, Box<dyn std::error::Error>>;
    
    // Method with generics
    fn test_generic_method<T: std::fmt::Debug + Clone>(
        &self,
        data: T,
        prefix: &str
    ) -> Option<T>;
    
    // Default implementation
    fn test_default_method(
        &self,
        message: &str
    ) -> String {
        format!("Default implementation: {}", message)
    }
}

// Implementation test
impl test_struct_definition {
    fn test_implementation_method(
        &self,
        multiplier: i32,
        offset: i32,
        scale_factor: f64
    ) -> i32 {
        (self.value * multiplier + offset) as i32
    }
    
    fn test_static_method(
        name: String,
        value: i32,
        metadata: std::collections::HashMap<String, i32>
    ) -> Self {
        Self {
            name,
            value,
            data: None,
            metadata,
            created_at: std::time::SystemTime::now(),
        }
    }
}

// Trait implementation test
impl test_trait_definition for test_struct_definition {
    fn test_required_method(
        &self,
        input: &str,
        count: usize
    ) -> Result<String, Box<dyn std::error::Error>> {
        Ok(format!("{}: {}", self.name, input.repeat(count)))
    }
    
    fn test_generic_method<T: std::fmt::Debug + Clone>(
        &self,
        data: T,
        prefix: &str
    ) -> Option<T> {
        if self.value > 0 {
            Some(data)
        } else {
            None
        }
    }
}

// Module definition test
mod test_module_definition {
    use std::collections::HashMap;
    use std::io::{self, Read, Write};
    use std::time::{Duration, SystemTime};
    use super::{
        test_struct_definition,
        test_trait_definition,
        test_enum_definition
    };
    
    pub fn test_module_function(
        param: &test_struct_definition,
        timeout: Duration,
        retry_count: u32
    ) -> io::Result<String> {
        Ok(format!("Module test: {}", param.name))
    }
}

// Macro definition tests
macro_rules! test_macro_definition {
    // Basic pattern
    ($test_expr:expr) => {
        println!("Test macro: {}", $test_expr)
    };
    
    // Complex pattern with repetition
    ($test_expr:expr, $($test_arg:expr),+ $(,)?) => {
        {
            print!("Test macro: {}", $test_expr);
            $(
                print!(", argument: {}", $test_arg);
            )+
            println!();
        }
    };
    
    // Pattern with different types
    ($test_expr:expr, $test_ident:ident, $test_ty:ty) => {
        {
            let $test_ident: $test_ty = $test_expr;
            println!("Test macro with type: {}", stringify!($test_ty));
        }
    };
}

// Procedural macro test - shows typical usage
#[derive(
    Debug,
    Clone,
    PartialEq,
    test_procedural_macro_definition,
    serde::Serialize,
    serde::Deserialize
)]
struct test_proc_macro_struct {
    test_field1: String,
    test_field2: i32,
    test_field3: Option<Vec<String>>,
    test_field4: std::time::SystemTime,
}

// Type alias tests - Note: Simple type aliases are exempt from 4-line requirement
type test_type_alias = fn(i32, &str) -> Result<String, std::io::Error>;

// Complex generic type alias
type test_generic_type_alias<T, E> = Result<
    std::collections::HashMap<String, Vec<T>>,
    Box<dyn std::error::Error + Send + Sync + E>
> where T: Clone + Send + 'static, E: std::error::Error + 'static;

// Const and static tests
const TEST_CONSTANT_DEFINITION: f64 =
    3.141592653589793238462643383279502884197169399375105820974944592307816406286;

static TEST_STATIC_DEFINITION: &str =
    "This is a test static string\n\
     that spans multiple lines\n\
     to meet the four-line requirement\n\
     for proper testing purposes";

// Lifetime parameter tests
struct test_lifetime_definition<'short, 'long: 'short> {
    test_ref1: &'short str,
    test_ref2: &'long str,
    test_ref3: &'short [&'long str],
    test_ref4: std::collections::HashMap<&'short str, &'long str>,
    test_ref5: Box<dyn test_trait_definition + 'long>,
}

impl<'short, 'long: 'short> test_lifetime_definition<'short, 'long> {
    fn test_lifetime_method<'a, 'b>(
        &'a self,
        input: &'b str,
        data: &'short [&'long str]
    ) -> &'short str
    where
        'b: 'a,
        'short: 'b,
    {
        self.test_ref1
    }
}

// Additional test structures
// Unsafe block test
impl test_struct_definition {
    unsafe fn test_unsafe_function(
        ptr: *const i32,
        len: usize,
        offset: isize
    ) -> Option<i32> {
        if ptr.is_null() {
            return None;
        }
        Some(*ptr.offset(offset))
    }
}

// Where clause test
fn test_where_clause_function<T, U, V>(
    t: T,
    u: U,
    v: V
) -> Result<T, Box<dyn std::error::Error>>
where
    T: Clone + std::fmt::Debug,
    U: AsRef<str> + 'static,
    V: Into<String> + Send,
{
    println!("Testing where clause: {:?}", t);
    Ok(t)
}

// Pattern matching test
fn test_match_expression(
    value: test_enum_definition
) -> String {
    match value {
        test_enum_definition::TestUnitVariant =>
            "Unit variant".to_string(),
        test_enum_definition::TestTupleVariant(s, i, f, v) =>
            format!("Tuple: {}, {}, {}, {:?}", s, i, f, v),
        test_enum_definition::TestStructVariant { name, value, data, timestamp } =>
            format!("Struct: {}, {}, {:?}, {:?}", name, value, data, timestamp),
        test_enum_definition::TestRecursiveVariant(_, _) =>
            "Recursive variant".to_string(),
    }
}
`
