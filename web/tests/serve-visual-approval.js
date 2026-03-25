#!/usr/bin/env node

/**
 * Visual Regression Approval Server
 *
 * Scans Playwright snapshot/test-results directories, serves a side-by-side
 * comparison UI, and provides approve/reject endpoints.
 *
 * Usage: node tests/serve-visual-approval.js
 * Then open http://localhost:9400
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const PORT = 9400;
const ROOT = path.resolve(__dirname, "..");
const SNAPSHOTS_DIR = path.join(__dirname, "visual-regression.spec.ts-snapshots");
const TEST_RESULTS_DIR = path.join(ROOT, "test-results");
const UI_FILE = path.join(__dirname, "visual-approval.html");

function scanChanges() {
  const changes = [];

  if (!fs.existsSync(TEST_RESULTS_DIR)) {
    return changes;
  }

  const resultDirs = fs.readdirSync(TEST_RESULTS_DIR).filter((d) => {
    return (
      d.startsWith("visual-regression-") &&
      fs.statSync(path.join(TEST_RESULTS_DIR, d)).isDirectory()
    );
  });

  for (const dir of resultDirs) {
    const dirPath = path.join(TEST_RESULTS_DIR, dir);
    const files = fs.readdirSync(dirPath);

    const actualFile = files.find((f) => f.endsWith("-actual.png"));
    if (!actualFile) continue;

    const baseName = actualFile.replace("-actual.png", "");
    const diffFile = files.find((f) => f === `${baseName}-diff.png`);
    const expectedFile = files.find((f) => f === `${baseName}-expected.png`);

    // Find matching baseline in snapshots dir
    const baselineFile = `${baseName}-chromium-darwin.png`;
    const baselinePath = path.join(SNAPSHOTS_DIR, baselineFile);
    const hasBaseline = fs.existsSync(baselinePath);

    // Derive a human-readable test name from the directory name
    // e.g., "visual-regression-Visual-R-3f345-p-1440×900-home-page-layout-chromium"
    // We'll extract from the actual filename instead
    const testName = baseName
      .replace(/-/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());

    changes.push({
      id: baseName,
      testName,
      dirName: dir,
      actualFile,
      diffFile: diffFile || null,
      expectedFile: expectedFile || null,
      baselineFile: hasBaseline ? baselineFile : null,
      hasBaseline,
    });
  }

  return changes;
}

function serveImage(res, filePath) {
  if (!fs.existsSync(filePath)) {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const data = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": "image/png",
    "Cache-Control": "no-cache",
  });
  res.end(data);
}

function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // Serve the HTML UI
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const html = fs.readFileSync(UI_FILE, "utf-8");
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(html);
    return;
  }

  // API: list changes
  if (url.pathname === "/api/changes") {
    const changes = scanChanges();
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(changes));
    return;
  }

  // Serve images from test-results
  // /images/result/<dirName>/<filename>
  if (url.pathname.startsWith("/images/result/")) {
    const parts = url.pathname.replace("/images/result/", "").split("/");
    if (parts.length === 2) {
      const filePath = path.join(TEST_RESULTS_DIR, decodeURIComponent(parts[0]), decodeURIComponent(parts[1]));
      serveImage(res, filePath);
      return;
    }
  }

  // Serve images from snapshots baseline
  // /images/baseline/<filename>
  if (url.pathname.startsWith("/images/baseline/")) {
    const filename = decodeURIComponent(url.pathname.replace("/images/baseline/", ""));
    const filePath = path.join(SNAPSHOTS_DIR, filename);
    serveImage(res, filePath);
    return;
  }

  // POST /approve — copy all actuals to baselines
  if (url.pathname === "/approve" && req.method === "POST") {
    const changes = scanChanges();
    let approved = 0;
    const errors = [];

    for (const change of changes) {
      const actualPath = path.join(TEST_RESULTS_DIR, change.dirName, change.actualFile);
      const baselineFile = `${change.id}-chromium-darwin.png`;
      const baselinePath = path.join(SNAPSHOTS_DIR, baselineFile);

      try {
        fs.copyFileSync(actualPath, baselinePath);
        approved++;
      } catch (err) {
        errors.push(`Failed to copy ${change.id}: ${err.message}`);
      }
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: errors.length === 0,
        approved,
        total: changes.length,
        errors,
        message:
          errors.length === 0
            ? `Approved ${approved} screenshot(s). Baselines updated.`
            : `Approved ${approved}/${changes.length}. Some errors occurred.`,
      })
    );
    return;
  }

  // POST /reject
  if (url.pathname === "/reject" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        success: true,
        message:
          "Changes rejected. Fix the visual issues and re-run: npm run test:visual",
      })
    );
    return;
  }

  // API: get analysis of what code changed and why screenshots differ
  if (url.pathname === "/api/analysis") {
    try {
      const analysis = generateAnalysis();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(analysis));
    } catch (err) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
    return;
  }

  res.writeHead(404);
  res.end("Not found");
}

/**
 * Analyze git diff of UI files to explain why screenshots changed.
 * Returns a map of screenshot name → explanation string.
 */
function generateAnalysis() {
  // Get uncommitted changes in UI files
  let diff = "";
  try {
    diff = execSync(
      "git diff HEAD -- components/ app/page.tsx components/ui/",
      { cwd: ROOT, encoding: "utf-8", maxBuffer: 1024 * 1024 }
    );
  } catch {
    // If no uncommitted changes, check last commit
    try {
      diff = execSync(
        "git diff HEAD~1 -- components/ app/page.tsx components/ui/",
        { cwd: ROOT, encoding: "utf-8", maxBuffer: 1024 * 1024 }
      );
    } catch {
      diff = "";
    }
  }

  if (!diff.trim()) {
    return { explanations: {} };
  }

  // Parse the diff to find which files changed and what changed
  const fileChanges = [];
  const fileSections = diff.split(/^diff --git /m).filter(Boolean);

  for (const section of fileSections) {
    const fileMatch = section.match(/a\/(.*?) b\//);
    if (!fileMatch) continue;
    const filename = fileMatch[1];

    // Extract added/removed lines (simplified)
    const added = [];
    const removed = [];
    for (const line of section.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) {
        added.push(line.slice(1).trim());
      } else if (line.startsWith("-") && !line.startsWith("---")) {
        removed.push(line.slice(1).trim());
      }
    }

    fileChanges.push({ filename, added, removed });
  }

  // Build explanations per screenshot based on which files affect which views
  const explanations = {};
  const changes = scanChanges();

  // Map of screenshot → relevant file patterns
  const screenshotFileMap = {
    "desktop-home": ["Navbar", "Filters", "ListingCard", "page.tsx", "ui/"],
    "desktop-detail": ["ListingDetail", "page.tsx"],
    "mobile-home": ["Navbar", "Filters", "ListingCard", "page.tsx", "ui/"],
    "mobile-swipe": ["SwipeCard", "SwipeView", "SwipeOnboarding", "page.tsx"],
    "mobile-filters": ["Filters", "FilterChip", "TagButton", "TextButton", "SegmentedControl"],
    "tablet-home": ["Navbar", "Filters", "ListingCard", "page.tsx", "ui/"],
  };

  for (const change of changes) {
    const key = change.id;
    const patterns = screenshotFileMap[key] || [];
    const relevantChanges = fileChanges.filter((fc) =>
      patterns.some((p) => fc.filename.includes(p))
    );

    if (relevantChanges.length === 0) {
      explanations[key] = "No matching code changes found — may be caused by data or timing differences.";
      continue;
    }

    // Build a one-line summary of what changed
    const changedFiles = relevantChanges.map((fc) => fc.filename.split("/").pop());
    const allAdded = relevantChanges.flatMap((fc) => fc.added);

    // Detect high-level change categories
    const hints = [];
    if (allAdded.some((l) => l.includes("min-h-[44px]") || l.includes("min-w-[44px]"))) hints.push("touch targets increased to 44px");
    if (allAdded.some((l) => l.includes("overflow-x-clip"))) hints.push("overflow clipping added");
    if (allAdded.some((l) => l.includes("tooltip") || l.includes("group-hover:opacity"))) hints.push("tooltip added");
    if (allAdded.some((l) => l.includes("Favorites") || l.includes("Hidden") || l.includes("dropdown"))) hints.push("nav items moved to dropdown");
    if (allAdded.some((l) => l.includes("SwipeView") || l.includes("swipe"))) hints.push("swipe mode added");
    if (allAdded.some((l) => l.includes("px-") || l.includes("py-") || l.includes("gap-") || l.includes("padding"))) hints.push("spacing adjusted");

    if (hints.length > 0) {
      explanations[key] = hints.join(" · ") + ` — in ${changedFiles.join(", ")}`;
    } else {
      explanations[key] = `${changedFiles.join(", ")} modified (${relevantChanges.reduce((n, fc) => n + fc.added.length, 0)} lines changed)`;
    }
  }

  return { explanations, fileCount: fileChanges.length };
}

const server = http.createServer(handleRequest);

server.listen(PORT, () => {
  console.log(`\n  Visual Regression Review UI`);
  console.log(`  ──────────────────────────`);
  console.log(`  http://localhost:${PORT}\n`);

  const changes = scanChanges();
  if (changes.length === 0) {
    console.log("  ✓ No visual changes detected — all screenshots match baselines.\n");
  } else {
    console.log(`  ${changes.length} screenshot(s) with changes:\n`);
    for (const c of changes) {
      console.log(`    • ${c.testName}`);
    }
    console.log("");
  }
});
