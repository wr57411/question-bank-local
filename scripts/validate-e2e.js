const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const { spawn } = require("child_process");
const net = require("net");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const WWW_ROOT = path.join(PROJECT_ROOT, "www");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function log(step) {
  process.stdout.write(`[validate-e2e] ${step}\n`);
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? `\n${JSON.stringify(details, null, 2)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

function getChromeCommand() {
  if (process.env.CHROME_BIN) {
    return process.env.CHROME_BIN;
  }

  const candidates = process.platform === "darwin"
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
      : [
          "/usr/bin/google-chrome",
          "/usr/bin/google-chrome-stable",
          "/usr/bin/chromium",
          "/usr/bin/chromium-browser",
          "/usr/bin/microsoft-edge",
        ];

  const match = candidates.find((candidate) => fs.existsSync(candidate));
  if (!match) {
    throw new Error("No Chrome-compatible browser found. Set CHROME_BIN to a Chromium-based browser executable.");
  }

  return match;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((closeError) => {
        if (closeError) {
          reject(closeError);
          return;
        }
        resolve(address.port);
      });
    });
    server.on("error", reject);
  });
}

function listFiles(dirPath) {
  return fs.existsSync(dirPath) ? fs.readdirSync(dirPath).sort() : [];
}

async function waitForDownloadedFile(dirPath, previousFiles, extension, timeoutMs = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const files = listFiles(dirPath);
    const nextFile = files.find((file) => {
      if (previousFiles.includes(file)) {
        return false;
      }

      return file.endsWith(extension) && !file.endsWith(".crdownload");
    });

    if (nextFile) {
      const fullPath = path.join(dirPath, nextFile);
      const stats = fs.statSync(fullPath);
      if (stats.size > 0) {
        return fullPath;
      }
    }

    await sleep(100);
  }

  throw new Error(`Timed out waiting for a downloaded ${extension} file in ${dirPath}`);
}

function startStaticServer() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
        const relativePath = urlPath === "/" ? "/index.html" : urlPath;
        const normalizedPath = path.normalize(relativePath).replace(/^(\.\.[/\\])+/, "");
        const filePath = path.join(WWW_ROOT, normalizedPath);

        if (!filePath.startsWith(WWW_ROOT)) {
          res.writeHead(403);
          res.end("Forbidden");
          return;
        }

        fs.readFile(filePath, (error, data) => {
          if (error) {
            res.writeHead(error.code === "ENOENT" ? 404 : 500);
            res.end(error.code === "ENOENT" ? "Not Found" : "Internal Server Error");
            return;
          }

          const ext = path.extname(filePath).toLowerCase();
          res.writeHead(200, {
            "Content-Type": MIME_TYPES[ext] || "application/octet-stream",
            "Cache-Control": "no-store",
          });
          res.end(data);
        });
      } catch (error) {
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    });

    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

async function waitForJson(url, timeoutMs = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response.json();
      }
    } catch (_) {
      // Ignore until the timeout expires.
    }
    await sleep(100);
  }

  throw new Error(`Timed out waiting for ${url}`);
}

async function createChromeTarget(browserPort, appUrl, timeoutMs = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(
        `http://127.0.0.1:${browserPort}/json/new?${encodeURIComponent(appUrl)}`,
        { method: "PUT" }
      );

      if (response.ok) {
        return response.json();
      }
    } catch (_) {
      // Ignore until the timeout expires.
    }

    await sleep(100);
  }

  throw new Error(`Timed out creating a Chrome target for ${appUrl}`);
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
  }

  static async connect(browserPort, appUrl) {
    const target = await createChromeTarget(browserPort, appUrl, 10000);

    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });

    const client = new CdpClient(ws);
    ws.addEventListener("message", async (event) => {
      const raw = typeof event.data === "string"
        ? event.data
        : event.data instanceof ArrayBuffer
          ? Buffer.from(event.data).toString("utf8")
          : typeof event.data?.text === "function"
            ? await event.data.text()
            : Buffer.from(event.data).toString("utf8");

      const payload = JSON.parse(raw);
      if (!Object.prototype.hasOwnProperty.call(payload, "id")) {
        return;
      }

      const pending = client.pending.get(payload.id);
      if (!pending) {
        return;
      }

      client.pending.delete(payload.id);
      if (payload.error) {
        pending.reject(new Error(payload.error.message));
      } else {
        pending.resolve(payload.result);
      }
    });

    return client;
  }

  send(method, params = {}) {
    const id = this.nextId++;
    const message = JSON.stringify({ id, method, params });

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(message);
    });
  }

  async evaluate(expression, awaitPromise = true) {
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
    });

    if (response.exceptionDetails) {
      throw new Error(response.exceptionDetails.text || "Runtime evaluation failed");
    }

    return response.result.value;
  }

  async waitFor(expression, timeoutMs = 10000) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (await this.evaluate(expression)) {
        return;
      }
      await sleep(100);
    }

    throw new Error(`Timed out waiting for condition: ${expression}`);
  }

  close() {
    this.ws.close();
  }
}

function js(strings, ...values) {
  let out = "";
  strings.forEach((part, index) => {
    out += part;
    if (index < values.length) {
      out += JSON.stringify(values[index]);
    }
  });
  return out;
}

function startChrome(browserPort) {
  const chromeCommand = getChromeCommand();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "question-bank-local-chrome-"));

  const child = spawn(
    chromeCommand,
    [
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--no-default-browser-check",
      `--user-data-dir=${userDataDir}`,
      `--remote-debugging-port=${browserPort}`,
      "about:blank",
    ],
    {
      stdio: ["ignore", "ignore", "pipe"],
    }
  );

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  return { child, userDataDir, getStderr: () => stderr };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

async function cleanup(child, userDataDir, server) {
  if (child && !child.killed) {
    child.kill("SIGTERM");
    await sleep(300);
    if (!child.killed) {
      child.kill("SIGKILL");
    }
  }

  if (server) {
    await closeServer(server);
  }

  if (userDataDir) {
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
}

async function runValidation() {
  const { server, port: serverPort } = await startStaticServer();
  const browserPort = await getFreePort();
  const chrome = startChrome(browserPort);
  const downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "question-bank-local-downloads-"));
  const appUrl = `http://127.0.0.1:${serverPort}/`;

  let client;

  try {
    log("Connecting to headless browser");
    await waitForJson(`http://127.0.0.1:${browserPort}/json/version`, 10000);
    client = await CdpClient.connect(browserPort, appUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDir,
    });
    await client.waitFor(`document.readyState === "complete" && typeof localforage !== "undefined"`);

    const maliciousTagName = `<img src=x onerror="window.__tagXss=1">危险标签`;
    const normalTagName = "数学";
    const maliciousPaperName = `<img src=x onerror="window.__paperXss=1">期末卷`;

    log("Priming dialogs");
    await client.evaluate(`
      (() => {
        window.confirm = () => true;
        window.alert = (message) => {
          window.__alerts = window.__alerts || [];
          window.__alerts.push(String(message));
        };
        return true;
      })();
    `);

    log("Creating tags");
    await client.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll(".tab"));
        tabs.find((tab) => tab.textContent.includes("标签管理")).click();
        return true;
      })();
    `);

    await client.evaluate(js`
      (async () => {
        const addTag = async (name, color) => {
          document.getElementById("tag-name").value = name;
          document.getElementById("tag-color").value = color;
          document.getElementById("tag-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
          await new Promise((resolve) => setTimeout(resolve, 250));
        };

        await addTag(${maliciousTagName}, "#ef4444");
        await addTag(${normalTagName}, "#3b82f6");
      })();
    `);

    const tagState = await client.evaluate(`
      (() => ({
        tagTexts: Array.from(document.querySelectorAll("#tags-list .tag")).map((el) => el.childNodes[0].textContent.trim()),
        xssFired: Boolean(window.__tagXss),
      }))();
    `);

    assert(tagState.tagTexts.includes(maliciousTagName), "Malicious tag name was not rendered as text", tagState);
    assert(tagState.tagTexts.includes(normalTagName), "Normal tag was not created", tagState);
    assert(tagState.xssFired === false, "Tag XSS payload executed", tagState);

    log("Creating a question");
    await client.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll(".tab"));
        tabs.find((tab) => tab.textContent.includes("题目管理")).click();
        return true;
      })();
    `);

    await client.evaluate(js`
      (async () => {
        const makeFile = async (name, color) => {
          const canvas = document.createElement("canvas");
          canvas.width = 40;
          canvas.height = 40;
          const ctx = canvas.getContext("2d");
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 40, 40);
          const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
          return new File([blob], name, { type: "image/jpeg" });
        };

        const assignImage = async (inputId, fileName, color) => {
          const dt = new DataTransfer();
          dt.items.add(await makeFile(fileName, color));
          const input = document.getElementById(inputId);
          input.files = dt.files;
          input.dispatchEvent(new Event("change", { bubbles: true }));
        };

        await assignImage("question-image", "question.jpg", "#f59e0b");
        await assignImage("answer-image", "answer.jpg", "#10b981");

        const select = document.getElementById("tag-select");
        Array.from(select.options).forEach((option) => {
          option.selected = [${maliciousTagName}, ${normalTagName}].includes(option.textContent);
        });

        document.getElementById("question-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      })();
    `);

    await client.waitFor(`document.querySelectorAll("#questions-list .question-card").length === 1`);

    const questionState = await client.evaluate(`
      (() => ({
        questionCount: document.querySelectorAll("#questions-list .question-card").length,
        statusText: document.querySelector("#status-message .status")?.textContent || "",
        allQuestionCount: typeof allQuestions !== "undefined" ? allQuestions.length : -1,
      }))();
    `);

    assert(questionState.questionCount === 1, "Question was not added to the list", questionState);
    assert(questionState.allQuestionCount === 1, "Question storage count is incorrect", questionState);

    log("Filtering by the active tag");
    await client.evaluate(js`
      (() => {
        const chip = Array.from(document.querySelectorAll("#filter-tags .filter-tag"))
          .find((el) => el.textContent.includes(${maliciousTagName}));
        chip.click();
        return true;
      })();
    `);

    const filteredState = await client.evaluate(`
      (() => ({
        activeFilterTagId: typeof activeFilterTagId === "undefined" ? null : activeFilterTagId,
        visibleQuestions: document.querySelectorAll("#questions-list .question-card").length,
      }))();
    `);

    assert(filteredState.visibleQuestions === 1, "Question disappeared under a matching tag filter", filteredState);

    log("Deleting the active tag");
    await client.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll(".tab"));
        tabs.find((tab) => tab.textContent.includes("标签管理")).click();
        return true;
      })();
    `);

    await client.evaluate(js`
      (() => {
        const target = Array.from(document.querySelectorAll("#tags-list .tag"))
          .find((el) => el.childNodes[0].textContent.trim() === ${maliciousTagName});
        target.querySelector(".remove").click();
        return true;
      })();
    `);

    await client.waitFor(js`
      !Array.from(document.querySelectorAll("#filter-tags .filter-tag"))
        .some((el) => el.textContent.trim() === ${maliciousTagName})
    `);

    await client.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll(".tab"));
        tabs.find((tab) => tab.textContent.includes("题目管理")).click();
        return true;
      })();
    `);

    const afterDeleteTag = await client.evaluate(`
      (() => ({
        activeFilterTagId: typeof activeFilterTagId === "undefined" ? null : activeFilterTagId,
        visibleQuestions: document.querySelectorAll("#questions-list .question-card").length,
        filterTexts: Array.from(document.querySelectorAll("#filter-tags .filter-tag")).map((el) => el.textContent.trim()),
      }))();
    `);

    assert(afterDeleteTag.activeFilterTagId === null, "Deleting the active filter tag did not clear the filter", afterDeleteTag);
    assert(afterDeleteTag.visibleQuestions === 1, "Question list stayed empty after deleting the active filter tag", afterDeleteTag);

    log("Creating a paper");
    await client.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll(".tab"));
        tabs.find((tab) => tab.textContent.includes("试卷管理")).click();
        return true;
      })();
    `);

    await client.evaluate(js`
      (() => {
        document.getElementById("paper-name").value = ${maliciousPaperName};
        const select = document.getElementById("paper-tag-select");
        Array.from(select.options).forEach((option) => {
          option.selected = option.textContent === ${normalTagName};
        });
        document.getElementById("paper-form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        return true;
      })();
    `);

    await client.waitFor(`document.querySelectorAll("#papers-list .paper-card").length === 1`);

    const paperState = await client.evaluate(`
      (() => ({
        paperTitles: Array.from(document.querySelectorAll("#papers-list .paper-card h3")).map((el) => el.textContent),
        xssFired: Boolean(window.__paperXss),
        questionCountText: document.querySelector("#papers-list .paper-card p")?.textContent || "",
      }))();
    `);

    assert(paperState.paperTitles.includes(maliciousPaperName), "Paper title was not rendered as text", paperState);
    assert(paperState.xssFired === false, "Paper title XSS payload executed", paperState);
    assert(paperState.questionCountText.includes("1"), "Paper did not include the expected question count", paperState);

    log("Exporting backup");
    const exportFilesBefore = listFiles(downloadDir);
    await client.evaluate(`
      (() => {
        document.querySelector(".toolbar .success").click();
        return true;
      })();
    `);

    const backupPath = await waitForDownloadedFile(downloadDir, exportFilesBefore, ".json", 10000);
    const backupData = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    const backupState = {
      fileName: path.basename(backupPath),
      questions: backupData.questions?.length || 0,
      tags: backupData.tags?.length || 0,
      questionTags: backupData.question_tags?.length || 0,
      papers: backupData.papers?.length || 0,
      paperQuestions: backupData.paper_questions?.length || 0,
    };

    assert(backupState.questions === 1, "Backup did not include the expected question count", backupState);
    assert(backupState.tags === 1, "Backup did not include the expected tag count", backupState);
    assert(backupState.questionTags === 1, "Backup did not include the expected question-tag links", backupState);
    assert(backupState.papers === 1, "Backup did not include the expected paper count", backupState);
    assert(backupState.paperQuestions === 1, "Backup did not include the expected paper-question links", backupState);

    log("Downloading PDF");
    const pdfFilesBefore = listFiles(downloadDir);
    await client.evaluate(`
      (() => {
        document.querySelector("#papers-list .paper-card button").click();
        return true;
      })();
    `);

    const pdfPath = await waitForDownloadedFile(downloadDir, pdfFilesBefore, ".pdf", 10000);
    const pdfHeader = fs.readFileSync(pdfPath).subarray(0, 4).toString("utf8");
    const pdfState = {
      fileName: path.basename(pdfPath),
      size: fs.statSync(pdfPath).size,
      header: pdfHeader,
    };

    assert(pdfState.header === "%PDF", "Downloaded file is not a PDF", pdfState);
    assert(pdfState.size > 0, "Downloaded PDF is empty", pdfState);

    log("Deleting the question and checking paper counts");
    await client.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll(".tab"));
        tabs.find((tab) => tab.textContent.includes("题目管理")).click();
        return true;
      })();
    `);

    await client.evaluate(`
      (() => {
        document.querySelector("#questions-list .question-card img").click();
        return true;
      })();
    `);

    await client.evaluate(`
      (() => {
        document.querySelector("#question-modal .danger").click();
        return true;
      })();
    `);

    await client.waitFor(`
      !document.getElementById("question-modal").classList.contains("active") &&
      typeof allQuestions !== "undefined" &&
      allQuestions.length === 0
    `);

    await client.evaluate(`
      (() => {
        const tabs = Array.from(document.querySelectorAll(".tab"));
        tabs.find((tab) => tab.textContent.includes("试卷管理")).click();
        return true;
      })();
    `);

    const finalPaperState = await client.evaluate(`
      (() => ({
        paperCountText: document.querySelector("#papers-list .paper-card p")?.textContent || "",
        questionCards: document.querySelectorAll("#questions-list .question-card").length,
        paperCards: document.querySelectorAll("#papers-list .paper-card").length,
      }))();
    `);

    assert(finalPaperState.paperCountText.includes("0"), "Paper count did not refresh after deleting the question", finalPaperState);
    assert(finalPaperState.paperCards === 1, "Paper disappeared unexpectedly after deleting a question", finalPaperState);

    return {
      tagState,
      questionState,
      filteredState,
      afterDeleteTag,
      paperState,
      backupState,
      pdfState,
      finalPaperState,
    };
  } finally {
    if (client) {
      client.close();
    }
    await cleanup(chrome.child, chrome.userDataDir, server);
    fs.rmSync(downloadDir, { recursive: true, force: true });
  }
}

runValidation()
  .then((summary) => {
    log("Validation passed");
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  })
  .catch((error) => {
    process.stderr.write(`[validate-e2e] Validation failed\n${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
