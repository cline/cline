export default String.raw`
// Package declaration test - at least 4 lines long
package main

import (
    "fmt"
    "sync"
    "time"
)

// Const block test - at least 4 lines long
const (
    TestConstDefinition1 = "test1"
    TestConstDefinition2 = "test2"
    TestConstDefinition3 = "test3"
    TestConstDefinition4 = 42
)

// Var block test - at least 4 lines long
var (
    TestVarDefinition1 string = "var1"
    TestVarDefinition2 int    = 42
    TestVarDefinition3 bool   = true
    TestVarDefinition4 []int  = []int{1, 2, 3}
)

// Interface declaration test - at least 4 lines long
type TestInterfaceDefinition interface {
    TestInterfaceMethod1(
        param1 string,
        param2 int,
    ) error
    TestInterfaceMethod2() string
}

// Struct declaration test - at least 4 lines long
type TestStructDefinition struct {
    TestField1 string
    TestField2 int
    TestField3 bool
    testField4 []string
}

// Type declaration test - at least 4 lines long
type TestTypeDefinition struct {
    sync.Mutex
    data map[string]interface{}
    ch   chan string
    done chan struct{}
}

// Function declaration test - at least 4 lines long
func TestFunctionDefinition(
    param1 string,
    param2 int,
    param3 bool,
) error {
    return nil
}

// Method declaration test - at least 4 lines long
func (t *TestStructDefinition) TestMethodDefinition(
    param1 string,
    param2 int,
) (
    result string,
    err error,
) {
    return "", nil
}

// Channel test - at least 4 lines long
func TestChannelDefinition(
    input chan string,
    output chan<- int,
    done <-chan struct{},
) {
    select {
    case msg := <-input:
        output <- len(msg)
    case <-done:
        return
    }
}

// Goroutine test - at least 4 lines long
func TestGoroutineDefinition() {
    ch := make(chan string)
    done := make(chan struct{})
    go func() {
        time.Sleep(time.Second)
        ch <- "hello"
        close(done)
    }()
}

// Defer test - at least 4 lines long
func TestDeferDefinition() {
    file := createFile()
    defer func() {
        file.Close()
        fmt.Println("file closed")
    }()
}

// Select test - at least 4 lines long
func TestSelectDefinition(
    ch1, ch2 <-chan string,
    done chan struct{},
) {
    select {
    case msg1 := <-ch1:
        fmt.Println("received from ch1:", msg1)
    case msg2 := <-ch2:
        fmt.Println("received from ch2:", msg2)
    case <-done:
        fmt.Println("done")
        return
    }
}

// Helper function to avoid undefined error
func createFile() interface{} {
    return nil
}
`
