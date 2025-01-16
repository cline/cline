import { NewUnifiedDiffStrategy } from '../new-unified';

describe('main', () => {

  let strategy: NewUnifiedDiffStrategy

  beforeEach(() => {
      strategy = new NewUnifiedDiffStrategy(0.97)
  })

  describe('constructor', () => {
    it('should use default confidence threshold when not provided', () => {
      const defaultStrategy = new NewUnifiedDiffStrategy()
      expect(defaultStrategy['confidenceThreshold']).toBe(1)
    })

    it('should use provided confidence threshold', () => {
      const customStrategy = new NewUnifiedDiffStrategy(0.85)
      expect(customStrategy['confidenceThreshold']).toBe(0.85)
    })

    it('should enforce minimum confidence threshold', () => {
      const lowStrategy = new NewUnifiedDiffStrategy(0.7) // Below minimum of 0.8
      expect(lowStrategy['confidenceThreshold']).toBe(0.8)
    })
  })

  describe('getToolDescription', () => {
      it('should return tool description with correct cwd', () => {
          const cwd = '/test/path'
          const description = strategy.getToolDescription(cwd)
          
          expect(description).toContain('apply_diff')
          expect(description).toContain(cwd)
          expect(description).toContain('Parameters:')
          expect(description).toContain('Format Requirements:')
      })
  })

  it('should apply simple diff correctly', async () => {
    const original = `line1
line2
line3`;

    const diff = `--- a/file.txt
+++ b/file.txt
@@ ... @@
 line1
+new line
 line2
-line3
+modified line3`;

    const result = await strategy.applyDiff(original, diff);
    expect(result.success).toBe(true);
    if(result.success) {
      expect(result.content).toBe(`line1
new line
line2
modified line3`);
    }
  });

  it('should handle multiple hunks', async () => {
    const original = `line1
line2
line3
line4
line5`;

    const diff = `--- a/file.txt
+++ b/file.txt
@@ ... @@
 line1
+new line
 line2
-line3
+modified line3
@@ ... @@
 line4
-line5
+modified line5
+new line at end`;

    const result = await strategy.applyDiff(original, diff);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toBe(`line1
new line
line2
modified line3
line4
modified line5
new line at end`);
    }
  });

  it('should handle complex large', async () => {
    const original = `line1
line2
line3
line4
line5
line6
line7
line8
line9
line10`;

    const diff = `--- a/file.txt
+++ b/file.txt
@@ ... @@
 line1
+header line
+another header
 line2
-line3
-line4
+modified line3
+modified line4
+extra line
@@ ... @@
 line6
+middle section
 line7
-line8
+changed line8
+bonus line
@@ ... @@
 line9
-line10
+final line
+very last line`;

    const result = await strategy.applyDiff(original, diff);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toBe(`line1
header line
another header
line2
modified line3
modified line4
extra line
line5
line6
middle section
line7
changed line8
bonus line
line9
final line
very last line`);
    }
  });

  it('should handle indentation changes', async () => {
    const original = `first line
  indented line
    double indented line
  back to single indent
no indent
  indented again
    double indent again
      triple indent
  back to single
last line`;

    const diff = `--- original
+++ modified
@@ ... @@
 first line
   indented line
+	tab indented line
+  new indented line
     double indented line
   back to single indent
 no indent
   indented again
     double indent again
-      triple indent
+      hi there mate
   back to single
 last line`;

    const expected = `first line
  indented line
	tab indented line
  new indented line
    double indented line
  back to single indent
no indent
  indented again
    double indent again
      hi there mate
  back to single
last line`;

    const result = await strategy.applyDiff(original, diff);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toBe(expected);
    }
  });

  it('should handle high level edits', async () => {

    const original = `def factorial(n):
    if n == 0:
        return 1
    else:
        return n * factorial(n-1)`
    const diff = `@@ ... @@
-def factorial(n):
-    if n == 0:
-        return 1
-    else:
-        return n * factorial(n-1)
+def factorial(number):
+    if number == 0:
+        return 1
+    else:
+        return number * factorial(number-1)`

const expected = `def factorial(number):
    if number == 0:
        return 1
    else:
        return number * factorial(number-1)`

    const result = await strategy.applyDiff(original, diff);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toBe(expected);
    }
  });

  it('it should handle very complex edits', async () => {
    const original = `//Initialize the array that will hold the primes
var primeArray = [];
/*Write a function that checks for primeness and
 pushes those values to t*he array*/
function PrimeCheck(candidate){
  isPrime = true;
  for(var i = 2; i < candidate && isPrime; i++){
    if(candidate%i === 0){
      isPrime = false;
    } else {
      isPrime = true;
    }
  }
  if(isPrime){
    primeArray.push(candidate);
  }
  return primeArray;
}
/*Write the code that runs the above until the
 l ength of the array equa*ls the number of primes
 desired*/

var numPrimes = prompt("How many primes?");

//Display the finished array of primes

//for loop starting at 2 as that is the lowest prime number keep going until the array is as long as we requested
for (var i = 2; primeArray.length < numPrimes; i++) {
  PrimeCheck(i); //
}
console.log(primeArray);
`

    const diff = `--- test_diff.js
+++ test_diff.js
@@ ... @@
-//Initialize the array that will hold the primes
 var primeArray = [];
-/*Write a function that checks for primeness and
- pushes those values to t*he array*/
 function PrimeCheck(candidate){
   isPrime = true;
   for(var i = 2; i < candidate && isPrime; i++){
@@ ... @@
   return primeArray;
 }
-/*Write the code that runs the above until the
-  l ength of the array equa*ls the number of primes
-  desired*/
 
 var numPrimes = prompt("How many primes?");
 
-//Display the finished array of primes
-
-//for loop starting at 2 as that is the lowest prime number keep going until the array is as long as we requested
 for (var i = 2; primeArray.length < numPrimes; i++) {
-  PrimeCheck(i); //
+  PrimeCheck(i);
 }
 console.log(primeArray);`

    const expected = `var primeArray = [];
function PrimeCheck(candidate){
  isPrime = true;
  for(var i = 2; i < candidate && isPrime; i++){
    if(candidate%i === 0){
      isPrime = false;
    } else {
      isPrime = true;
    }
  }
  if(isPrime){
    primeArray.push(candidate);
  }
  return primeArray;
}

var numPrimes = prompt("How many primes?");

for (var i = 2; primeArray.length < numPrimes; i++) {
  PrimeCheck(i);
}
console.log(primeArray);
`
 

    const result = await strategy.applyDiff(original, diff);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.content).toBe(expected);
    }
  });

  describe('error handling and edge cases', () => {
    it('should reject completely invalid diff format', async () => {
      const original = 'line1\nline2\nline3';
      const invalidDiff = 'this is not a diff at all';
      
      const result = await strategy.applyDiff(original, invalidDiff);
      expect(result.success).toBe(false);
    });

    it('should reject diff with invalid hunk format', async () => {
      const original = 'line1\nline2\nline3';
      const invalidHunkDiff = `--- a/file.txt
+++ b/file.txt
invalid hunk header
 line1
-line2
+new line`;
      
      const result = await strategy.applyDiff(original, invalidHunkDiff);
      expect(result.success).toBe(false);
    });

    it('should fail when diff tries to modify non-existent content', async () => {
      const original = 'line1\nline2\nline3';
      const nonMatchingDiff = `--- a/file.txt
+++ b/file.txt
@@ ... @@
 line1
-nonexistent line
+new line
 line3`;
      
      const result = await strategy.applyDiff(original, nonMatchingDiff);
      expect(result.success).toBe(false);
    });

    it('should handle overlapping hunks', async () => {
      const original = `line1
line2
line3
line4
line5`;
      const overlappingDiff = `--- a/file.txt
+++ b/file.txt
@@ ... @@
 line1
 line2
-line3
+modified3
 line4
@@ ... @@
 line2
-line3
-line4
+modified3and4
 line5`;
      
      const result = await strategy.applyDiff(original, overlappingDiff);
      expect(result.success).toBe(false);
    });

    it('should handle empty lines modifications', async () => {
      const original = `line1

line3

line5`;
      const emptyLinesDiff = `--- a/file.txt
+++ b/file.txt
@@ ... @@
 line1

-line3
+line3modified

 line5`;
      
      const result = await strategy.applyDiff(original, emptyLinesDiff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.content).toBe(`line1

line3modified

line5`);
      }
    });

    it('should handle mixed line endings in diff', async () => {
      const original = 'line1\r\nline2\nline3\r\n';
      const mixedEndingsDiff = `--- a/file.txt
+++ b/file.txt
@@ ... @@
 line1\r
-line2
+modified2\r
 line3`;
      
      const result = await strategy.applyDiff(original, mixedEndingsDiff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.content).toBe('line1\r\nmodified2\r\nline3\r\n');
      }
    });

    it('should handle partial line modifications', async () => {
      const original = 'const value = oldValue + 123;';
      const partialDiff = `--- a/file.txt
+++ b/file.txt
@@ ... @@
-const value = oldValue + 123;
+const value = newValue + 123;`;
      
      const result = await strategy.applyDiff(original, partialDiff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.content).toBe('const value = newValue + 123;');
      }
    });

    it('should handle slightly malformed but recoverable diff', async () => {
      const original = 'line1\nline2\nline3';
      // Missing space after --- and +++
      const slightlyBadDiff = `---a/file.txt
+++b/file.txt
@@ ... @@
 line1
-line2
+new line
 line3`;
      
      const result = await strategy.applyDiff(original, slightlyBadDiff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.content).toBe('line1\nnew line\nline3');
      }
    });
  });

  describe('similar code sections', () => {
    it('should correctly modify the right section when similar code exists', async () => {
      const original = `function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a + b;  // Bug here
}`;

      const diff = `--- a/math.js
+++ b/math.js
@@ ... @@
 function multiply(a, b) {
-  return a + b;  // Bug here
+  return a * b;
 }`;

      const result = await strategy.applyDiff(original, diff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.content).toBe(`function add(a, b) {
  return a + b;
}

function subtract(a, b) {
  return a - b;
}

function multiply(a, b) {
  return a * b;
}`);
      }
    });

    it('should handle multiple similar sections with correct context', async () => {
      const original = `if (condition) {
  doSomething();
  doSomething();
  doSomething();
}

if (otherCondition) {
  doSomething();
  doSomething();
  doSomething();
}`;

      const diff = `--- a/file.js
+++ b/file.js
@@ ... @@
 if (otherCondition) {
   doSomething();
-  doSomething();
+  doSomethingElse();
   doSomething();
 }`;

      const result = await strategy.applyDiff(original, diff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.content).toBe(`if (condition) {
  doSomething();
  doSomething();
  doSomething();
}

if (otherCondition) {
  doSomething();
  doSomethingElse();
  doSomething();
}`);
      }
    });
  });

  describe('hunk splitting', () => {
    it('should handle large diffs with multiple non-contiguous changes', async () => {
      const original = `import { readFile } from 'fs';
import { join } from 'path';
import { Logger } from './logger';

const logger = new Logger();

async function processFile(filePath: string) {
  try {
    const data = await readFile(filePath, 'utf8');
    logger.info('File read successfully');
    return data;
  } catch (error) {
    logger.error('Failed to read file:', error);
    throw error;
  }
}

function validateInput(input: string): boolean {
  if (!input) {
    logger.warn('Empty input received');
    return false;
  }
  return input.length > 0;
}

async function writeOutput(data: string) {
  logger.info('Processing output');
  // TODO: Implement output writing
  return Promise.resolve();
}

function parseConfig(configPath: string) {
  logger.debug('Reading config from:', configPath);
  // Basic config parsing
  return {
    enabled: true,
    maxRetries: 3
  };
}

export {
  processFile,
  validateInput,
  writeOutput,
  parseConfig
};`;

      const diff = `--- a/file.ts
+++ b/file.ts
@@ ... @@
-import { readFile } from 'fs';
+import { readFile, writeFile } from 'fs';
 import { join } from 'path';
-import { Logger } from './logger';
+import { Logger } from './utils/logger';
+import { Config } from './types';
 
-const logger = new Logger();
+const logger = new Logger('FileProcessor');
 
 async function processFile(filePath: string) {
   try {
     const data = await readFile(filePath, 'utf8');
-    logger.info('File read successfully');
+    logger.info(\`File \${filePath} read successfully\`);
     return data;
   } catch (error) {
-    logger.error('Failed to read file:', error);
+    logger.error(\`Failed to read file \${filePath}:\`, error);
     throw error;
   }
 }
 
 function validateInput(input: string): boolean {
   if (!input) {
-    logger.warn('Empty input received');
+    logger.warn('Validation failed: Empty input received');
     return false;
   }
-  return input.length > 0;
+  return input.trim().length > 0;
 }
 
-async function writeOutput(data: string) {
-  logger.info('Processing output');
-  // TODO: Implement output writing
-  return Promise.resolve();
+async function writeOutput(data: string, outputPath: string) {
+  try {
+    await writeFile(outputPath, data, 'utf8');
+    logger.info(\`Output written to \${outputPath}\`);
+  } catch (error) {
+    logger.error(\`Failed to write output to \${outputPath}:\`, error);
+    throw error;
+  }
 }
 
-function parseConfig(configPath: string) {
-  logger.debug('Reading config from:', configPath);
-  // Basic config parsing
-  return {
-    enabled: true,
-    maxRetries: 3
-  };
+async function parseConfig(configPath: string): Promise<Config> {
+  try {
+    const configData = await readFile(configPath, 'utf8');
+    logger.debug(\`Reading config from \${configPath}\`);
+    return JSON.parse(configData);
+  } catch (error) {
+    logger.error(\`Failed to parse config from \${configPath}:\`, error);
+    throw error;
+  }
 }
 
 export {
   processFile,
   validateInput,
   writeOutput,
-  parseConfig
+  parseConfig,
+  type Config
 };`;

      const expected = `import { readFile, writeFile } from 'fs';
import { join } from 'path';
import { Logger } from './utils/logger';
import { Config } from './types';

const logger = new Logger('FileProcessor');

async function processFile(filePath: string) {
  try {
    const data = await readFile(filePath, 'utf8');
    logger.info(\`File \${filePath} read successfully\`);
    return data;
  } catch (error) {
    logger.error(\`Failed to read file \${filePath}:\`, error);
    throw error;
  }
}

function validateInput(input: string): boolean {
  if (!input) {
    logger.warn('Validation failed: Empty input received');
    return false;
  }
  return input.trim().length > 0;
}

async function writeOutput(data: string, outputPath: string) {
  try {
    await writeFile(outputPath, data, 'utf8');
    logger.info(\`Output written to \${outputPath}\`);
  } catch (error) {
    logger.error(\`Failed to write output to \${outputPath}:\`, error);
    throw error;
  }
}

async function parseConfig(configPath: string): Promise<Config> {
  try {
    const configData = await readFile(configPath, 'utf8');
    logger.debug(\`Reading config from \${configPath}\`);
    return JSON.parse(configData);
  } catch (error) {
    logger.error(\`Failed to parse config from \${configPath}:\`, error);
    throw error;
  }
}

export {
  processFile,
  validateInput,
  writeOutput,
  parseConfig,
  type Config
};`;

      const result = await strategy.applyDiff(original, diff);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.content).toBe(expected);
      }
    });
  });
});