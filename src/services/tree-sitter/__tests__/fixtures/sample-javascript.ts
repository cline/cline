export default String.raw`
// Import statements test - inherently single-line, exempt from 4-line requirement
import React, { useState, useEffect } from 'react';
import { render } from 'react-dom';
import * as utils from './utils';

// Function declaration test - standard function with block body
function testFunctionDefinition(
    param1,
    param2,
    param3
) {
    const result = param1 + param2;
    return result * param3;
}

// Async function test
async function testAsyncFunctionDefinition(
    url,
    options,
    timeout
) {
    const response = await fetch(url, options);
    const data = await response.json();
    return data;
}

// Generator function test
function* testGeneratorFunctionDefinition(
    start,
    end,
    step
) {
    for (let i = start; i <= end; i += step) {
        yield i;
    }
}

// Arrow function test
const testArrowFunctionDefinition = (
    param1,
    param2,
    callback
) => {
    const result = callback(param1);
    return result + param2;
};

// Class declaration test
class TestClassDefinition {
    // Class field declarations
    #privateField = 'private';
    static staticField = 'static';
    
    constructor(
        name,
        value
    ) {
        this.name = name;
        this.value = value;
    }
    
    // Method definition
    testMethodDefinition(
        param1,
        param2
    ) {
        return param1 + param2;
    }
    
    // Static method
    static testStaticMethodDefinition(
        input,
        multiplier
    ) {
        return input * multiplier;
    }
    
    // Getter/Setter test
    get testGetterDefinition() {
        return this.#privateField +
               this.name +
               this.value;
    }
    
    set testSetterDefinition(
        newValue
    ) {
        this.value = newValue;
        this.#privateField = 'modified';
    }
}

// Object literal test
const testObjectLiteralDefinition = {
    property1: 'value1',
    property2: 'value2',
    
    methodInObject(
        param
    ) {
        return param + this.property1;
    },
    
    get computedProperty() {
        return this.property1 +
               this.property2;
    }
};

// JSX element test
const testJsxElementDefinition = (
    props
) => {
    return (
        <div className="test-container">
            <header className="test-header">
                {props.title}
            </header>
            <main>
                {props.children}
            </main>
        </div>
    );
};

// Decorator test (requires experimental features)
function testDecoratorDefinition(
    target,
    context
) {
    return function(...args) {
        console.log('Decorator called');
        return target.apply(this, args);
    };
}

// Class with decorator
@testDecoratorDefinition
class TestDecoratedClassDefinition {
    constructor(
        name,
        type
    ) {
        this.name = name;
        this.type = type;
    }
    
    // Decorated method test
    @testDecoratorDefinition
    testDecoratedMethodDefinition(
        param1,
        param2,
        options = {}
    ) {
        const result = param1 + param2;
        console.log('Method called with options:', options);
        return result;
    }
}

// Module export test - inherently single-line, exempt from 4-line requirement
export { testFunctionDefinition, TestClassDefinition };
export default TestDecoratedClassDefinition;
`
