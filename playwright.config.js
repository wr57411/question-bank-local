const fs = require("fs");
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

function resolveChromeConfig() {
  if (process.env.CHROME_BIN) {
    return {
      launchOptions: {
        executablePath: process.env.CHROME_BIN,
      },
    };
  }

  const chromePaths = process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      ]
    : process.platform === "win32"
      ? [
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
          "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
        ]
      : [];

  const installedChrome = chromePaths.find((candidate) => fs.existsSync(candidate));
  if (installedChrome) {
    return {
      launchOptions: {
        executablePath: installedChrome,
      },
    };
  }

  return {};
}

module.exports = defineConfig({
  testDir: path.join(__dirname, "tests"),
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:3000",
    headless: true,
    acceptDownloads: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
    ...resolveChromeConfig(),
  },
  webServer: {
    command: "npx serve www -l 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
  },
});
