import { UnifiedDiffStrategy } from '../unified'

describe('UnifiedDiffStrategy', () => {
    let strategy: UnifiedDiffStrategy

    beforeEach(() => {
        strategy = new UnifiedDiffStrategy()
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

    describe('applyDiff', () => {
        it('should successfully apply a function modification diff', () => {
            const originalContent = `import { Logger } from '../logger';

function calculateTotal(items: number[]): number {
  return items.reduce((sum, item) => {
    return sum + item;
  }, 0);
}

export { calculateTotal };`

            const diffContent = `--- src/utils/helper.ts
+++ src/utils/helper.ts
@@ -1,9 +1,10 @@
 import { Logger } from '../logger';
 
 function calculateTotal(items: number[]): number {
-  return items.reduce((sum, item) => {
-    return sum + item;
+  const total = items.reduce((sum, item) => {
+    return sum + item * 1.1;  // Add 10% markup
   }, 0);
+  return Math.round(total * 100) / 100;  // Round to 2 decimal places
 }
 
 export { calculateTotal };`

            const expected = `import { Logger } from '../logger';

function calculateTotal(items: number[]): number {
  const total = items.reduce((sum, item) => {
    return sum + item * 1.1;  // Add 10% markup
  }, 0);
  return Math.round(total * 100) / 100;  // Round to 2 decimal places
}

export { calculateTotal };`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(expected)
        })

        it('should successfully apply a diff adding a new method', () => {
            const originalContent = `class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }
}`

            const diffContent = `--- src/Calculator.ts
+++ src/Calculator.ts
@@ -1,5 +1,9 @@
 class Calculator {
   add(a: number, b: number): number {
     return a + b;
   }
+
+  multiply(a: number, b: number): number {
+    return a * b;
+  }
 }`

            const expected = `class Calculator {
  add(a: number, b: number): number {
    return a + b;
  }

  multiply(a: number, b: number): number {
    return a * b;
  }
}`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(expected)
        })

        it('should successfully apply a diff modifying imports', () => {
            const originalContent = `import { useState } from 'react';
import { Button } from './components';

function App() {
  const [count, setCount] = useState(0);
  return <Button onClick={() => setCount(count + 1)}>{count}</Button>;
}`

            const diffContent = `--- src/App.tsx
+++ src/App.tsx
@@ -1,7 +1,8 @@
-import { useState } from 'react';
+import { useState, useEffect } from 'react';
 import { Button } from './components';
 
 function App() {
   const [count, setCount] = useState(0);
+  useEffect(() => { document.title = \`Count: \${count}\` }, [count]);
   return <Button onClick={() => setCount(count + 1)}>{count}</Button>;
 }`

            const expected = `import { useState, useEffect } from 'react';
import { Button } from './components';

function App() {
  const [count, setCount] = useState(0);
  useEffect(() => { document.title = \`Count: \${count}\` }, [count]);
  return <Button onClick={() => setCount(count + 1)}>{count}</Button>;
}`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(expected)
        })

        it('should successfully apply a diff with multiple hunks', () => {
            const originalContent = `import { readFile, writeFile } from 'fs';

function processFile(path: string) {
  readFile(path, 'utf8', (err, data) => {
    if (err) throw err;
    const processed = data.toUpperCase();
    writeFile(path, processed, (err) => {
      if (err) throw err;
    });
  });
}

export { processFile };`

            const diffContent = `--- src/file-processor.ts
+++ src/file-processor.ts
@@ -1,12 +1,14 @@
-import { readFile, writeFile } from 'fs';
+import { promises as fs } from 'fs';
+import { join } from 'path';
 
-function processFile(path: string) {
-  readFile(path, 'utf8', (err, data) => {
-    if (err) throw err;
+async function processFile(path: string) {
+  try {
+    const data = await fs.readFile(join(__dirname, path), 'utf8');
     const processed = data.toUpperCase();
-    writeFile(path, processed, (err) => {
-      if (err) throw err;
-    });
-  });
+    await fs.writeFile(join(__dirname, path), processed);
+  } catch (error) {
+    console.error('Failed to process file:', error);
+    throw error;
+  }
 }
 
 export { processFile };`

            const expected = `import { promises as fs } from 'fs';
import { join } from 'path';

async function processFile(path: string) {
  try {
    const data = await fs.readFile(join(__dirname, path), 'utf8');
    const processed = data.toUpperCase();
    await fs.writeFile(join(__dirname, path), processed);
  } catch (error) {
    console.error('Failed to process file:', error);
    throw error;
  }
}

export { processFile };`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(expected)
        })

        it('should handle empty original content', () => {
            const originalContent = ''
            const diffContent = `--- empty.ts
+++ empty.ts
@@ -0,0 +1,3 @@
+export function greet(name: string): string {
+  return \`Hello, \${name}!\`;
+}`

            const expected = `export function greet(name: string): string {
  return \`Hello, \${name}!\`;
}\n`

            const result = strategy.applyDiff(originalContent, diffContent)
            expect(result).toBe(expected)
        })
    })
})

