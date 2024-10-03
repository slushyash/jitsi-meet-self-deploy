// app.js

const express = require("express");
const { createProxyMiddleware } = require("http-proxy-middleware");
const path = require("path");
const fs = require("fs");

const app = express();

// Configuration
const PORT = process.env.PORT || 4001;
const PROXY_TARGET = process.env.WEBPACK_DEV_SERVER_PROXY_TARGET || "https://8x8.vc";

// Path to the jitsi-meet submodule
const JITSI_MEET_PATH =
  process.env.NODE_ENV === "development"
    ? path.join(__dirname, "..", "jitsi-meet")
    : path.join(__dirname, "jitsi-meet");

// Function to determine if a request should be served locally
function shouldServeLocally(reqPath, acceptsHtml) {
  const localPaths = [
    /^\/css\//,
    /^\/doc\//,
    /^\/fonts\//,
    /^\/images\//,
    /^\/lang\//,
    /^\/sounds\//,
    /^\/static\//,
  ];

  // Check if path matches any of the local paths or ends with .wasm
  for (const regex of localPaths) {
    if (regex.test(reqPath)) {
      return true;
    }
  }

  if (reqPath.endsWith(".map") || reqPath.endsWith(".wasm") || reqPath.endsWith(".js")) {
    return true;
  }

  if (
    reqPath === "/external_api.js" ||
    (reqPath.startsWith("/vpaas") && acceptsHtml) ||
    reqPath.startsWith("/build")
  ) {
    return true;
  }

  // Special handling for /libs/
  // FIXME: no longer needed with resolveJsPath?
  if (reqPath.startsWith("/libs/")) {
    const minJsPath = path.join(JITSI_MEET_PATH, "libs", reqPath);
    if (reqPath.endsWith(".min.js") && !fs.existsSync(minJsPath)) {
      // Replace .min.js with .js
      reqPath = reqPath.replace(".min.js", ".js");
    }
    return true;
  }

  return false;
}

function resolveJsPath(filePath) {
  // Check if the file exists

  const existsInJitsiDir = (p) => fs.existsSync(path.join(JITSI_MEET_PATH, p));

  if (fs.existsSync(path.join(JITSI_MEET_PATH, filePath))) {
    return filePath;
  }

  // Check if the path ends with .js and is not already .min.js
  if (filePath.endsWith(".js") && !filePath.endsWith(".min.js")) {
    const minPath = filePath.replace(/\.js$/, ".min.js");
    if (fs.existsSync(path.join(JITSI_MEET_PATH, minPath))) {
      return minPath;
    }
  }

  // Check if the path ends with .min.js, try without .min
  if (filePath.endsWith(".min.js")) {
    const normalJsPath = filePath.replace(/\.min\.js$/, ".js");
    if (fs.existsSync(path.join(JITSI_MEET_PATH, normalJsPath))) {
      return normalJsPath;
    }
  }

  return null;
}

function isRootFilePath(filePath) {
  const dirName = path.dirname(filePath);
  return dirName === "." || dirName === "" || dirName === "/";
}

// Serve static assets
app.use((req, res, next) => {
  console.log(`Attmpting to serve ${req.path}`);
  const acceptsHtml = req.get("Accept")?.includes("text/html") ?? false;

  if (shouldServeLocally(req.path, acceptsHtml)) {
    // let topDir = "build";
    let filePath = req.path;

    if (filePath.startsWith("/vpaas") && acceptsHtml) {
      filePath = "/index.html"; // HACK
    }

    if (isRootFilePath(filePath)) {
      filePath = path.join("build", filePath);
    }

    if (filePath.endsWith(".js")) {
      filePath = resolveJsPath(filePath);
    }

    // if (filePath === "/external_api.js") {
    //   filePath = "/external_api.min.js";
    // }

    const options = {
      root: JITSI_MEET_PATH,
      // Optional: set headers, etc.
    };

    console.log(`    Serving ${req.path} locally at ${filePath}`);

    res.sendFile(filePath, options, (err) => {
      if (err) {
        console.log(`    Error serving ${req.path} locally: ${err}`);
        res.status(404).send("Not Found");
      }
    });
  } else {
    console.log(`    Proxying ${req.path} to ${PROXY_TARGET}`);
    next();
  }
});

// Proxy middleware for all other requests
app.use(
  "/",
  createProxyMiddleware({
    target: PROXY_TARGET,
    changeOrigin: true,
    secure: false,
    onProxyReq: (proxyReq, req, res) => {
      // Optionally modify the proxy request here
    },
    onError: (err, req, res) => {
      res.status(500).send("Proxy Error");
    },
    headers: {
      Host: new URL(PROXY_TARGET).host,
    },
  }),
);

const isLocal = process.env.NODE_ENV !== "production";

// Start the server
if (isLocal) {
  // HTTPS configuration for local development
  const https = require("https");
  const certsPath = path.join(__dirname, "certs"); // Path to your certs directory
  const sslOptions = {
    key: fs.readFileSync(path.join(certsPath, "localhost-key.pem")),
    cert: fs.readFileSync(path.join(certsPath, "localhost.pem")),
  };

  https.createServer(sslOptions, app).listen(PORT, () => {
    console.log(`Express HTTPS server running on https://localhost:${PORT}`);
  });
} else {
  // Export the Express app as a Serverless Function for Vercel
  module.exports = (req, res) => {
    app(req, res);
  };
}

// // Start the server
// app.listen(PORT, () => {
//   console.log(`Express server running on port ${PORT}`);
// });
