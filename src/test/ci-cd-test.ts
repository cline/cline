// This file intentionally has formatting issues to test CI/CD warnings

export function testFunction(   param1:string,param2:   number)    {
    // Inconsistent spacing and missing semicolon
    const test   =   "unformatted string"
    
    // Unnecessary spacing
    if(   param1    ){
        return     true
    }

    // Missing spaces around operators
    const result=param2+5;

    return result
}
