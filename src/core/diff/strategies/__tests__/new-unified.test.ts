import { NewUnifiedDiffStrategy } from '../new-unified';

describe('main', () => {

  let strategy: NewUnifiedDiffStrategy

  beforeEach(() => {
      strategy = new NewUnifiedDiffStrategy()
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
    
    expect(result).toBe(`line1
new line
line2
modified line3`);
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
});