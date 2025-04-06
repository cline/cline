import { describe, expect, it, jest, beforeEach } from "@jest/globals"
import { parseSourceCodeDefinitionsForFile } from ".."
import * as fs from "fs/promises"
import * as path from "path"
import Parser from "web-tree-sitter"
import { fileExistsAtPath } from "../../../utils/fs"
import { loadRequiredLanguageParsers } from "../languageParser"
import { rustQuery } from "../queries"
import { initializeTreeSitter, testParseSourceCodeDefinitions, inspectTreeStructure, debugLog } from "./helpers"

// Sample Rust content for tests covering all supported structures:
// - struct definitions
// - method definitions (functions within a declaration list)
// - function definitions
// - enum definitions
// - trait definitions
// - impl trait for struct
// - generic structs with lifetime parameters
const sampleRustContent = `
// Basic struct definition
struct Point {
    x: f64,
    y: f64,
}

// Struct with implementation (methods)
struct Rectangle {
    width: u32,
    height: u32,
}

impl Rectangle {
    // Method definition
    fn area(&self) -> u32 {
        self.width * self.height
    }

    // Another method
    fn can_hold(&self, other: &Rectangle) -> bool {
        self.width > other.width && self.height > other.height
    }

    // Associated function (not a method, but still part of impl)
    fn square(size: u32) -> Rectangle {
        Rectangle {
            width: size,
            height: size,
        }
    }
}

// A standalone function
fn calculate_distance(p1: &Point, p2: &Point) -> f64 {
    let dx = p2.x - p1.x;
    let dy = p2.y - p1.y;
    (dx * dx + dy * dy).sqrt()
}

// A more complex struct
struct Vehicle {
    make: String,
    model: String,
    year: u32,
}

impl Vehicle {
    // Constructor-like method
    fn new(make: String, model: String, year: u32) -> Vehicle {
        Vehicle {
            make,
            model,
            year,
        }
    }

    // Regular method
    fn description(&self) -> String {
        format!("{} {} ({})", self.make, self.model, self.year)
    }
}

// Another standalone function
fn process_data(input: &str) -> String {
    format!("Processed: {}", input)
}

// More complex Rust structures for advanced testing
enum Status {
    Active,
    Inactive,
    Pending(String),
    Error { code: i32, message: String },
}

trait Drawable {
    fn draw(&self);
    fn get_dimensions(&self) -> (u32, u32);
}

impl Drawable for Rectangle {
    fn draw(&self) {
        println!("Drawing rectangle: {}x{}", self.width, self.height);
    }
    
    fn get_dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
    }
}

// Generic struct with lifetime parameters
struct Container<'a, T> {
    data: &'a T,
    count: usize,
}

impl<'a, T> Container<'a, T> {
    fn new(data: &'a T) -> Container<'a, T> {
        Container {
            data,
            count: 1,
        }
    }
}

// Macro definition
macro_rules! say_hello {
    // Match a single name
    ($name:expr) => {
        println!("Hello, {}!", $name);
    };
    // Match multiple names
    ($($name:expr),*) => {
        $(
            println!("Hello, {}!", $name);
        )*
    };
}

// Module definition
mod math {
    // Constants
    pub const PI: f64 = 3.14159;
    
    // Static variables
    pub static VERSION: &str = "1.0.0";
    
    // Type alias
    pub type Number = f64;
    
    // Functions within modules
    pub fn add(a: Number, b: Number) -> Number {
        a + b
    }
    
    pub fn subtract(a: Number, b: Number) -> Number {
        a - b
    }
}

// Union type
union IntOrFloat {
    int_value: i32,
    float_value: f32,
}

// Trait with associated types
trait Iterator {
    // Associated type
    type Item;
    
    // Method using associated type
    fn next(&mut self) -> Option<Self::Item>;
    
    // Default implementation
    fn count(self) -> usize where Self: Sized {
        let mut count = 0;
        while let Some(_) = self.next() {
            count += 1;
        }
        count
    }
}

// Advanced Rust language features for testing

// 1. Closures: Multi-line anonymous functions with captured environments
fn use_closures() {
    let captured_value = 42;
    
    // Simple closure
    let simple_closure = || {
        println!("Captured value: {}", captured_value);
    };
    
    // Closure with parameters
    let add_closure = |a: i32, b: i32| -> i32 {
        let sum = a + b + captured_value;
        println!("Sum with captured value: {}", sum);
        sum
    };
    
    // Using closures
    simple_closure();
    let result = add_closure(10, 20);
}

// 2. Match Expressions: Complex pattern matching constructs
fn complex_matching(value: Option<Result<Vec<i32>, String>>) {
    match value {
        Some(Ok(vec)) if vec.len() > 5 => {
            println!("Got a vector with more than 5 elements");
            for item in vec {
                println!("Item: {}", item);
            }
        },
        Some(Ok(vec)) => {
            println!("Got a vector with {} elements", vec.len());
        },
        Some(Err(e)) => {
            println!("Got an error: {}", e);
        },
        None => {
            println!("Got nothing");
        }
    }
}

// 3. Where Clauses: Type constraints on generic parameters
fn print_sorted<T>(collection: &[T])
where
    T: std::fmt::Debug + Ord + Clone,
{
    let mut sorted = collection.to_vec();
    sorted.sort();
    println!("Sorted collection: {:?}", sorted);
}

// 4. Attribute Macros: Annotations that modify behavior
#[derive(Debug, Clone, PartialEq)]
struct AttributeExample {
    field1: String,
    field2: i32,
}

#[cfg(test)]
mod test_module {
    #[test]
    fn test_example() {
        assert_eq!(2 + 2, 4);
    }
}

// 5. Procedural Macros (simulated, as they require separate crates)
// This is a placeholder to represent a proc macro
// In real code, this would be in a separate crate with #[proc_macro]
fn custom_derive_macro() {
    // Implementation would generate code at compile time
}

// 6. Async Functions and Blocks: Asynchronous code constructs
async fn fetch_data(url: &str) -> Result<String, String> {
    // Simulated async operation
    println!("Fetching data from {}", url);
    
    // Async block
    let result = async {
        // Simulated async work
        Ok("Response data".to_string())
    }.await;
    
    result
}

// 7. Impl Blocks with Generic Parameters: Implementation with complex type parameters
struct GenericContainer<T, U> {
    first: T,
    second: U,
}

impl<T, U> GenericContainer<T, U>
where
    T: std::fmt::Display,
    U: std::fmt::Debug,
{
    fn new(first: T, second: U) -> Self {
        GenericContainer { first, second }
    }
    
    fn display(&self) {
        println!("First: {}, Second: {:?}", self.first, self.second);
    }
}

// 8. Complex Trait Bounds: Trait bounds using + operator or where clauses
trait Processor<T> {
    fn process(&self, item: T) -> T;
}

fn process_items<T, P>(processor: P, items: Vec<T>) -> Vec<T>
where
    P: Processor<T> + Clone,
    T: Clone + std::fmt::Debug + 'static,
{
    items.into_iter()
         .map(|item| processor.process(item))
         .collect()
}
`

// Rust test options
const rustOptions = {
	language: "rust",
	wasmFile: "tree-sitter-rust.wasm",
	queryString: rustQuery,
	extKey: "rs",
	content: sampleRustContent,
}

// Mock file system operations
jest.mock("fs/promises")
const mockedFs = jest.mocked(fs)

// Mock loadRequiredLanguageParsers
jest.mock("../languageParser", () => ({
	loadRequiredLanguageParsers: jest.fn(),
}))

// Mock fileExistsAtPath to return true for our test paths
jest.mock("../../../utils/fs", () => ({
	fileExistsAtPath: jest.fn().mockImplementation(() => Promise.resolve(true)),
}))

describe("parseSourceCodeDefinitionsForFile with Rust", () => {
	beforeEach(() => {
		jest.clearAllMocks()
	})

	it("should parse Rust struct definitions", async () => {
		const result = await testParseSourceCodeDefinitions("/test/file.rs", sampleRustContent, rustOptions)

		// Check for struct definitions
		expect(result).toContain("struct Point")
		expect(result).toContain("struct Rectangle")
		expect(result).toContain("struct Vehicle")
	})

	it("should parse Rust method definitions within impl blocks", async () => {
		const result = await testParseSourceCodeDefinitions("/test/file.rs", sampleRustContent, rustOptions)

		// Check for function definitions within implementations
		expect(result).toContain("fn square")
		expect(result).toContain("fn new")
	})

	it("should parse Rust standalone function definitions", async () => {
		const result = await testParseSourceCodeDefinitions("/test/file.rs", sampleRustContent, rustOptions)

		// Check for standalone function definitions
		// Based on the actual output we've seen
		expect(result).toContain("fn calculate_distance")
	})

	it("should correctly identify structs and functions", async () => {
		const result = await testParseSourceCodeDefinitions("/test/file.rs", sampleRustContent, rustOptions)

		// Verify that structs and functions are being identified
		const resultLines = result?.split("\n") || []

		// Check that struct Point is found
		const pointStructLine = resultLines.find((line) => line.includes("struct Point"))
		expect(pointStructLine).toBeTruthy()

		// Check that fn calculate_distance is found
		const distanceFuncLine = resultLines.find((line) => line.includes("fn calculate_distance"))
		expect(distanceFuncLine).toBeTruthy()

		// Check that fn square is found (method in impl block)
		const squareFuncLine = resultLines.find((line) => line.includes("fn square"))
		expect(squareFuncLine).toBeTruthy()
	})

	it("should parse all supported Rust structures comprehensively", async () => {
		const result = await testParseSourceCodeDefinitions("/test/file.rs", sampleRustContent, rustOptions)
		const resultLines = result?.split("\n") || []

		// Verify all struct definitions are captured
		expect(resultLines.some((line) => line.includes("struct Point"))).toBe(true)
		expect(resultLines.some((line) => line.includes("struct Rectangle"))).toBe(true)
		expect(resultLines.some((line) => line.includes("struct Vehicle"))).toBe(true)

		// Verify impl block functions are captured
		expect(resultLines.some((line) => line.includes("fn square"))).toBe(true)
		expect(resultLines.some((line) => line.includes("fn new"))).toBe(true)

		// Verify standalone functions are captured
		expect(resultLines.some((line) => line.includes("fn calculate_distance"))).toBe(true)

		// Verify the output format includes line numbers
		expect(resultLines.some((line) => /\d+--\d+ \|/.test(line))).toBe(true)

		// Verify the output includes the file name
		expect(result).toContain("# file.rs")
	})

	it("should handle complex Rust structures", async () => {
		const result = await testParseSourceCodeDefinitions("/test/file.rs", sampleRustContent, rustOptions)
		const resultLines = result?.split("\n") || []

		// Now we test specific captures for all supported structures
		expect(result).toBeTruthy()

		// Test enum definitions
		expect(resultLines.some((line) => line.includes("enum Status"))).toBe(true)

		// Test trait definitions
		expect(resultLines.some((line) => line.includes("trait Drawable"))).toBe(true)

		// Test impl trait for struct
		expect(resultLines.some((line) => line.includes("impl Drawable for Rectangle"))).toBe(true)

		// Test generic structs with lifetime parameters
		expect(resultLines.some((line) => line.includes("struct Container<'a, T>"))).toBe(true)

		// Test macro definitions
		expect(resultLines.some((line) => line.includes("macro_rules! say_hello"))).toBe(true)

		// Test module definitions
		expect(resultLines.some((line) => line.includes("mod math"))).toBe(true)

		// Test union types
		expect(resultLines.some((line) => line.includes("union IntOrFloat"))).toBe(true)

		// Test trait with associated types
		expect(resultLines.some((line) => line.includes("trait Iterator"))).toBe(true)

		// Test advanced Rust language features
		// 1. Closures
		expect(
			resultLines.some(
				(line) =>
					line.includes("let simple_closure") ||
					line.includes("let add_closure") ||
					line.includes("closure_expression"),
			),
		).toBe(true)

		// 2. Match expressions
		expect(resultLines.some((line) => line.includes("match value") || line.includes("match_expression"))).toBe(true)

		// 3. Functions with where clauses
		expect(resultLines.some((line) => line.includes("fn print_sorted") || line.includes("where_clause"))).toBe(true)

		// 4. Attribute macros - Note: These might not be directly captured by the current query
		// Instead, we check for the struct that has the attribute
		expect(resultLines.some((line) => line.includes("struct AttributeExample"))).toBe(true)

		// 5. Async functions
		expect(resultLines.some((line) => line.includes("async fn fetch_data"))).toBe(true)

		// 6. Impl blocks with generic parameters
		expect(resultLines.some((line) => line.includes("impl<T, U> GenericContainer"))).toBe(true)

		// 7. Functions with complex trait bounds
		expect(resultLines.some((line) => line.includes("fn process_items") || line.includes("trait_bounds"))).toBe(
			true,
		)

		// Note: The following structures are nested inside modules and might not be captured directly
		// - Type aliases (type Number)
		// - Constants (const PI)
		// - Static variables (static VERSION)
		// - Associated types (type Item)
		// These would require more complex query patterns or post-processing to extract
	})
})
