
/*
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
  */


import {
    provideVSCodeDesignSystem,
    Button,
    Dropdown,
    ProgressRing,
    TextField,
    vsCodeButton,
    vsCodeDropdown,
    vsCodeOption,
    vsCodeTextField,
    vsCodeProgressRing,
  } from "@vscode/webview-ui-toolkit";
  
  // In order to use the Webview UI Toolkit web components they
  // must be registered with the browser (i.e. webview) using the
  // syntax below.
  provideVSCodeDesignSystem().register(
    vsCodeButton(),
    vsCodeDropdown(),
    vsCodeOption(),
    vsCodeProgressRing(),
    vsCodeTextField()
  );
  
  // Get access to the VS Code API from within the webview context
  const vscode = acquireVsCodeApi();
  
  // Just like a regular webpage we need to wait for the webview
  // DOM to load before we can reference any of the HTML elements
  // or toolkit components
  window.addEventListener("load", main);
  
  // Main function that gets executed once the webview DOM loads
  function main() {
    // To get improved type annotations/IntelliSense the associated class for
    // a given toolkit component can be imported and used to type cast a reference
    // to the element (i.e. the `as Button` syntax)
    const checkWeatherButton = document.getElementById("check-weather-button") as Button;
    checkWeatherButton.addEventListener("click", checkWeather);
  
    setVSCodeMessageListener();
  }
  
  function checkWeather() {
    const location = document.getElementById("location") as TextField;
    const unit = document.getElementById("unit") as Dropdown;
  
    // Passes a message back to the extension context with the location that
    // should be searched for and the degree unit (F or C) that should be returned
    vscode.postMessage({
      command: "weather",
      location: location.value,
      unit: unit.value,
    });
  
    displayLoadingState();
  }
  
  // Sets up an event listener to listen for messages passed from the extension context
  // and executes code based on the message that is recieved
  function setVSCodeMessageListener() {
    window.addEventListener("message", (event) => {
      const command = event.data.command;
  
    //   switch (command) {
    //     case "weather":
    //       const weatherData = JSON.parse(event.data.payload);
    //       displayWeatherData(weatherData);
    //       break;
    //     case "error":
    //       displayError(event.data.message);
    //       break;
    //   }
    });
  }
  
  function displayLoadingState() {
    const loading = document.getElementById("loading") as ProgressRing;
    const icon = document.getElementById("icon");
    const summary = document.getElementById("summary");
    if (loading && icon && summary) {
      loading.classList.remove("hidden");
      icon.classList.add("hidden");
      summary.textContent = "Getting weather...";
    }
  }
  
//   function displayWeatherData(weatherData) {
//     const loading = document.getElementById("loading") as ProgressRing;
//     const icon = document.getElementById("icon");
//     const summary = document.getElementById("summary");
//     if (loading && icon && summary) {
//       loading.classList.add("hidden");
//       icon.classList.remove("hidden");
//       icon.textContent = getWeatherIcon(weatherData);
//       summary.textContent = getWeatherSummary(weatherData);
//     }
//   }
  
//   function displayError(errorMsg) {
//     const loading = document.getElementById("loading") as ProgressRing;
//     const icon = document.getElementById("icon");
//     const summary = document.getElementById("summary");
//     if (loading && icon && summary) {
//       loading.classList.add("hidden");
//       icon.classList.add("hidden");
//       summary.textContent = errorMsg;
//     }
//   }
  
//   function getWeatherSummary(weatherData) {
//     const skyText = weatherData.current.skytext;
//     const temperature = weatherData.current.temperature;
//     const degreeType = weatherData.location.degreetype;
  
//     return `${skyText}, ${temperature}${degreeType}`;
//   }
  
//   function getWeatherIcon(weatherData) {
//     const skyText = weatherData.current.skytext.toLowerCase();
//     let icon = "";
  
//     switch (skyText) {
//       case "sunny":
//         icon = "☀️";
//         break;
//       case "mostly sunny":
//         icon = "🌤";
//         break;
//       case "partly sunny":
//         icon = "🌥";
//         break;
//       case "clear":
//         icon = "☀️";
//         break;
//       case "fair":
//         icon = "🌥";
//         break;
//       case "mostly cloudy":
//         icon = "☁️";
//         break;
//       case "cloudy":
//         icon = "☁️";
//         break;
//       case "rain showers":
//         icon = "🌦";
//         break;
//       default:
//         icon = "✨";
//     }
  
//     return icon;
//   }