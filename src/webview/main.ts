import { provideVSCodeDesignSystem, vsCodeButton, vsCodeCheckbox } from "@vscode/webview-ui-toolkit"
// const toolkit = require("@vscode/webview-ui-toolkit")
// /*
// You must register the components you want to use
// */
provideVSCodeDesignSystem().register(vsCodeButton(), vsCodeCheckbox())

const vscode = acquireVsCodeApi();

window.addEventListener("load", main);

function main() {
  // To get improved type annotations/IntelliSense the associated class for
  // a given toolkit component can be imported and used to type cast a reference
  // to the element (i.e. the `as Button` syntax)
  const howdyButton = document.getElementById("howdy") as Button;
  howdyButton?.addEventListener("click", handleHowdyClick);
}

function handleHowdyClick() {
  vscode.postMessage({
    command: "hello",
    text: "Hey there partner! 🤠",
  });
}