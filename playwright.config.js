const fs = require("fs");
const os = require("os");
const path = require("path");
const { defineConfig, devices } = require("@playwright/test");

function tempUserDataDir() {
  // 每个 Playwright worker/会话生成一个唯一临时 profile 目录，运行结束后自动清理，
  // 彻底隔离 IndexedDB / localStorage，避免复用真实 Chrome profile 导致数据污染。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pw-"));
  process.on("exit", () => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch (e) {
      // 忽略清理错误
    }
  });
  return dir;
}

function resolveChromeConfig() {
  const userDataDir = tempUserDataDir();

  if (process.env.CHROME_BIN) {
    return {
      launchOptions: {
        executablePath: process.env.CHROME_BIN,
        userDataDir,
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
        userDataDir,
      },
    };
  }

  return {
    launchOptions: {
      userDataDir,
    },
  };
}

module.exports = defineConfig({
  testDir: path.join(__dirname, "tests"),
  testMatch: /(?<!unit\/).*\.spec\.js$/,
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
    command: "./node_modules/.bin/vite --port 3000 --host 127.0.0.1 --mode production",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
