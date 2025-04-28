export const sampleHtmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" 
          content="width=device-width, 
                   initial-scale=1.0">
    <title>HTML Sample</title>
</head>
<body>

    <!-- Multi-line comment structure
         showing comment handling
         across multiple lines
         for testing -->

    <div class="test-element"
         id="element-test"
         data-test="true"
         aria-label="Test element">
        <h1>Element Test</h1>
    </div>

    <div class="test-attribute"
         id="attribute-test"
         data-custom="test"
         aria-hidden="true"
         role="presentation">
        Testing attributes
    </div>

    <script type="text/javascript">
        // Script content
        function testFunction() {
            console.log('test');
        }
    </script>

    <style type="text/css">
        /* Style content */
        .test-style {
            color: red;
            background: blue;
        }
    </style>

    <div class="test-text">
        This is a text node
        spanning multiple
        lines to meet the
        4-line requirement
    </div>

    <div class="test-fragment">
        <p>Fragment test</p>
        <span>Multiple elements</span>
        <em>In a fragment</em>
        <strong>Structure</strong>
    </div>

    <img src="test.jpg"
         alt="Test void element"
         class="test-void"
         loading="lazy">

    <br class="test-self-closing" />

    <div class="test-raw-text">
        <pre>
            Raw text content
            preserving whitespace
            and formatting
            exactly as written
        </pre>
    </div>

    <div class="test-nested">
        <div class="level-1">
            <div class="level-2">
                <div class="level-3">
                    Deeply nested content
                </div>
            </div>
        </div>
    </div>

</body>
</html>`
