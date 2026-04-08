#!/usr/bin/env node

/**
 * Google OAuth2 Setup Script
 *
 * One-time CLI tool to obtain a refresh token for Google API access.
 * Opens a browser for consent, runs a local callback server, and prints
 * the refresh token to add to your .env file.
 *
 * Usage:
 *   node dist/setup.js
 *   npm run setup (from the google-auth package)
 *
 * Requires GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in env or .env file.
 */

import http from "http";
import { URL } from "url";
import fs from "fs";
import path from "path";
import { OAuth2Client } from "google-auth-library";

var REDIRECT_URI = "http://localhost:3000/callback";
var PORT = 3000;

var DEFAULT_SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
];

function loadEnv(): void {
  try {
    require("dotenv").config();
  } catch (e) {
    // dotenv not available — env vars must be set manually
  }
}

function getEnvVar(name: string): string {
  var value = process.env[name];
  if (!value) {
    console.error("ERROR: " + name + " is not set.");
    console.error("");
    console.error("Set it in your environment or .env file before running setup.");
    console.error("");
    console.error("To get these credentials:");
    console.error("1. Go to https://console.cloud.google.com/apis/credentials");
    console.error("2. Create an OAuth 2.0 Client ID (Desktop application type)");
    console.error("3. Add " + REDIRECT_URI + " as an authorized redirect URI");
    process.exit(1);
  }
  return value;
}

function findEnvFile(): string | null {
  var envPath = path.resolve(process.cwd(), ".env");
  if (fs.existsSync(envPath)) {
    return envPath;
  }
  return null;
}

function writeTokenToEnv(token: string): boolean {
  var envPath = findEnvFile();
  if (!envPath) {
    return false;
  }

  var content = fs.readFileSync(envPath, "utf-8");
  var lines = content.split("\n");
  var found = false;
  var updated: string[] = [];

  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    if (line.indexOf("GOOGLE_REFRESH_TOKEN") === 0) {
      updated.push("GOOGLE_REFRESH_TOKEN=" + token);
      found = true;
    } else {
      updated.push(line);
    }
  }

  if (!found) {
    updated.push("GOOGLE_REFRESH_TOKEN=" + token);
  }

  fs.writeFileSync(envPath, updated.join("\n"), "utf-8");
  return true;
}

function openBrowser(url: string): void {
  var command: string;
  var args: string[];

  if (process.platform === "darwin") {
    command = "open";
    args = [url];
  } else if (process.platform === "win32") {
    command = "cmd";
    args = ["/c", "start", url];
  } else {
    command = "xdg-open";
    args = [url];
  }

  var spawn = require("child_process").spawn;
  var child = spawn(command, args, { stdio: "ignore", detached: true });
  child.unref();
}

async function run(): Promise<void> {
  loadEnv();

  var clientId = getEnvVar("GOOGLE_CLIENT_ID");
  var clientSecret = getEnvVar("GOOGLE_CLIENT_SECRET");

  var oauth2Client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);

  var authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: DEFAULT_SCOPES,
  });

  console.log("");
  console.log("=== Google OAuth2 Setup ===");
  console.log("");
  console.log("Opening browser for authorization...");
  console.log("");
  console.log("If the browser does not open, visit this URL manually:");
  console.log(authUrl);
  console.log("");

  openBrowser(authUrl);

  return new Promise(function (resolve, reject) {
    var server = http.createServer(async function (req, res) {
      if (!req.url || !req.url.startsWith("/callback")) {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      var parsedUrl = new URL(req.url, "http://localhost:" + PORT);
      var code = parsedUrl.searchParams.get("code");
      var error = parsedUrl.searchParams.get("error");

      if (error) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<h1>Authorization failed</h1><p>Error: " + error + "</p><p>You can close this tab.</p>");
        console.error("Authorization failed: " + error);
        server.close();
        reject(new Error("Authorization failed: " + error));
        return;
      }

      if (!code) {
        res.writeHead(400, { "Content-Type": "text/html" });
        res.end("<h1>Missing authorization code</h1><p>You can close this tab.</p>");
        server.close();
        reject(new Error("No authorization code received"));
        return;
      }

      try {
        var tokenResponse = await oauth2Client.getToken(code);
        var tokens = tokenResponse.tokens;

        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>Authorization successful!</h1>" +
            "<p>You can close this tab and return to the terminal.</p>"
        );

        console.log("Authorization successful!");
        console.log("");

        if (tokens.refresh_token) {
          var wrote = writeTokenToEnv(tokens.refresh_token);
          if (wrote) {
            console.log("GOOGLE_REFRESH_TOKEN written to .env");
          } else {
            console.log("No .env file found in " + process.cwd());
            console.log("Add this to your .env manually:");
            console.log("GOOGLE_REFRESH_TOKEN=" + tokens.refresh_token);
          }
        } else {
          console.log("WARNING: No refresh token received.");
          console.log("This happens if you previously authorized this app.");
          console.log("Revoke access at https://myaccount.google.com/permissions");
          console.log("then run this setup again.");
        }
        console.log("");
        console.log("IMPORTANT: If your Google Cloud app is in 'Testing' status,");
        console.log("refresh tokens expire after 7 days. Set the app to 'In production'");
        console.log("or 'Internal' (Google Workspace) for long-lived tokens.");

        server.close();
        resolve();
      } catch (err) {
        res.writeHead(500, { "Content-Type": "text/html" });
        res.end("<h1>Token exchange failed</h1><p>Check the terminal for details.</p>");
        console.error("Token exchange failed:", err);
        server.close();
        reject(err);
      }
    });

    server.listen(PORT, function () {
      console.log("Listening for callback on http://localhost:" + PORT + "/callback");
    });
  });
}

run().catch(function (err) {
  console.error("Setup failed:", err);
  process.exit(1);
});
