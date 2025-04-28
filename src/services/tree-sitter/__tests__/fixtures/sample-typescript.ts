export default String.raw`
// Import statements test - inherently single-line, exempt from 4-line requirement
import React, { useState, useEffect } from 'react';
import { render } from 'react-dom';
import * as utils from './utils';

// Interface declaration test
interface TestInterfaceDefinition {
    name: string;
    value: number;
    
    methodSignature(
        param1: string,
        param2: number
    ): string;
}

// Type declaration test
type TestTypeDefinition = {
    id: number;
    name: string;
    
    callback: (
        param: string
    ) => void;
};

// Enum declaration test
enum TestEnumDefinition {
    First = 'FIRST',
    Second = 'SECOND',
    Third = 'THIRD',
    Fourth = 'FOURTH'
}

// Namespace declaration test
namespace TestNamespaceDefinition {
    export interface InnerInterface {
        prop: string;
    }
    
    export function innerFunction(
        param: string
    ): void {
        console.log(param);
    }
}

// Generic interface test
interface TestGenericInterfaceDefinition<T, U> {
    data: T;
    metadata: U;
    
    process(
        input: T
    ): U;
}

// Function with type annotations
function testTypedFunctionDefinition(
    param1: string,
    param2: number,
    callback: (result: string) => void
): string {
    const result = param1.repeat(param2);
    callback(result);
    return result;
}

// Async function with type annotations
async function testTypedAsyncFunctionDefinition(
    url: string,
    options: RequestInit,
    timeout: number
): Promise<Response> {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
}

// Generic function test
function testGenericFunctionDefinition<T, U>(
    input: T,
    transform: (value: T) => U
): U {
    return transform(input);
}

// Class with interface implementation
class TestTypedClassDefinition implements TestInterfaceDefinition {
    // Typed class fields
    private readonly #privateField: string;
    static staticField: number = 42;
    
    constructor(
        public name: string,
        public value: number
    ) {
        this.#privateField = 'private';
    }
    
    // Interface method implementation
    methodSignature(
        param1: string,
        param2: number
    ): string {
        return param1.repeat(param2);
    }
    
    // Generic method
    genericMethod<T>(
        input: T,
        count: number
    ): T[] {
        return Array(count).fill(input);
    }
}

// Abstract class test
abstract class TestAbstractClassDefinition {
    constructor(
        protected name: string,
        private value: number
    ) {}
    
    abstract process(
        input: string
    ): number;
    
    // Concrete method
    format(): string {
        return this.name +
               String(this.value);
    }
}

// Typed object literal
const testTypedObjectLiteralDefinition: TestTypeDefinition = {
    id: 1,
    name: 'test',
    
    callback: (
        param: string
    ): void => {
        console.log(param);
    }
};

// JSX element with TypeScript props
interface TestJsxPropsDefinition {
    title: string;
    items: string[];
    onSelect: (item: string) => void;
}

const testTypedJsxElementDefinition = (
    props: TestJsxPropsDefinition
): JSX.Element => {
    return (
        <div className="test-container">
            <header className="test-header">
                {props.title}
            </header>
            <main>
                {props.items.map(item => (
                    <div onClick={() => props.onSelect(item)}>
                        {item}
                    </div>
                ))}
            </main>
        </div>
    );
};

// Decorator with TypeScript types
function testTypedDecoratorDefinition(
    target: any,
    propertyKey: string,
    descriptor: PropertyDescriptor
): PropertyDescriptor {
    const original = descriptor.value;
    descriptor.value = function(...args: any[]) {
        return original.apply(this, args);
    };
    return descriptor;
}

// Class with typed decorator
@testTypedDecoratorDefinition
class TestTypedDecoratedClassDefinition {
    constructor(
        private name: string,
        protected type: string
    ) {}
    
    @testTypedDecoratorDefinition
    testDecoratedMethodDefinition(
        param1: string,
        param2: number
    ): string {
        return param1.repeat(param2);
    }
}

// Module exports - inherently single-line, exempt from 4-line requirement
export { testTypedFunctionDefinition, TestTypedClassDefinition };
export default TestTypedDecoratedClassDefinition;
`
