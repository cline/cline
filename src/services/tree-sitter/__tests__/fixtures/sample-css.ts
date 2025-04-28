export default String.raw`
/* Variable declaration test - at least 4 lines long */
:root {
  --test-variable-definition-primary: #3498db;
  --test-variable-definition-secondary: #2ecc71;
  --test-variable-definition-accent: #e74c3c;
  --test-variable-definition-text: #333333;
}

/* Import statement test - at least 4 lines long */
@import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap');
@import url('https://fonts.googleapis.com/css2?family=Lato:wght@300;400;700&display=swap');
@import './test-import-definition-variables.css';

/* Media query test - at least 4 lines long */
@media screen and (min-width: 768px) and (max-width: 1024px) {
  .test-media-query-definition-container {
    padding: 20px;
    margin: 10px;
  }
}

/* Keyframe animation test - at least 4 lines long */
@keyframes test-keyframe-definition-fade {
  0% {
    opacity: 0;
    transform: translateY(-10px);
  }
  100% {
    opacity: 1;
    transform: translateY(0);
  }
}

/* Animation property test - at least 4 lines long */
.test-animation-definition {
  animation-name: test-keyframe-definition-fade;
  animation-duration: 1s;
  animation-timing-function: ease-in-out;
  animation-fill-mode: forwards;
}

/* Function test - at least 4 lines long */
.test-function-definition {
  background-color: rgba(
    var(--test-variable-definition-primary, 255),
    100,
    200,
    0.5
  );
  transform: translate(
    calc(100% - 20px),
    calc(50% - 10px)
  );
}

/* Mixin test (using CSS custom properties as a proxy) - at least 4 lines long */
.test-mixin-definition {
  --button-padding: 10px 15px;
  --button-border-radius: 4px;
  --button-font-weight: bold;
  --button-transition: all 0.3s ease;
}

/* Basic ruleset test - at least 4 lines long */
.test-ruleset-definition {
  color: var(--test-variable-definition-text);
  font-family: 'Open Sans', sans-serif;
  font-size: 16px;
  line-height: 1.5;
}

/* Selector test with multiple complex selectors - at least 4 lines long */
.test-selector-definition:hover,
.test-selector-definition:focus,
.test-selector-definition::before,
.test-selector-definition > .child {
  color: var(--test-variable-definition-accent);
}

/* Nested ruleset test (using nesting syntax) - at least 4 lines long */
.test-nested-ruleset-definition {
  display: flex;
  flex-direction: column;
  
  & > .nested-child {
    margin-bottom: 10px;
    padding: 15px;
  }
  
  & .deeply-nested {
    color: blue;
    font-weight: bold;
  }
}
`
