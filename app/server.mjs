import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { dirname, extname, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const APP_ROOT = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(APP_ROOT, "..");
const EXERCISES_ROOT = join(REPO_ROOT, "exercises");
const SUMMARY_PATH = join(REPO_ROOT, "book", "src", "SUMMARY.md");
const DIST_ROOT = join(APP_ROOT, "dist");
const PORT = Number(process.env.PORT || 3001);
const RUN_TIMEOUT_MS = 90_000;
const MAX_CODE_BYTES = 300_000;

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function plainTitle(title) {
  return title.replaceAll("`", "").replaceAll("\\", "").trim();
}

async function loadExercises() {
  const summary = await readFile(SUMMARY_PATH, "utf8");
  const categories = [];
  const exercises = new Map();
  let currentCategory;

  for (const line of summary.split("\n")) {
    const match = line.match(/^(\s*)- \[(.+?)\]\((\d{2}_[^/]+)\/(\d{2}_[^)]+)\.md\)/);
    if (!match) continue;

    const [, indentation, rawTitle, categoryId, exerciseSlug] = match;
    const categoryTitle = plainTitle(rawTitle);
    if (indentation.length === 0) {
      currentCategory = {
        id: categoryId,
        title: categoryTitle,
        exercises: [],
      };
      categories.push(currentCategory);
    }

    if (!currentCategory || currentCategory.id !== categoryId) continue;

    const exerciseId = `${categoryId}/${exerciseSlug}`;
    const exerciseRoot = join(EXERCISES_ROOT, categoryId, exerciseSlug);
    const descriptionPath = join(REPO_ROOT, "book", "src", categoryId, `${exerciseSlug}.md`);

    try {
      let sourceName;
      let code;
      for (const candidate of ["lib.rs", "main.rs"]) {
        try {
          code = await readFile(join(exerciseRoot, "src", candidate), "utf8");
          sourceName = candidate;
          break;
        } catch {
          // Some packaging exercises start from a binary crate instead of a library crate.
        }
      }
      if (!sourceName) throw new Error("No Rust source file found.");
      const description = await readFile(descriptionPath, "utf8").catch(() => "");

      const exercise = {
        id: exerciseId,
        number: exercises.size + 1,
        categoryId,
        categoryTitle: categories.at(-1).title,
        slug: exerciseSlug,
        title: categoryTitle,
        sourceName,
        code,
        description,
        root: exerciseRoot,
      };
      currentCategory.exercises.push(exercise);
      exercises.set(exerciseId, exercise);
    } catch (error) {
      console.warn(`Skipping ${exerciseId}: ${error.message}`);
    }
  }

  return { categories, exercises };
}

const catalog = await loadExercises();

function publicCatalog() {
  return catalog.categories.map((category) => ({
    id: category.id,
    title: category.title,
    exercises: category.exercises.map(({ root, ...exercise }) => exercise),
  }));
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  response.end(body);
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_CODE_BYTES + 20_000) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(body || "{}"));
      } catch {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function runCargo(manifestPath, cwd, targetDir) {
  return new Promise((resolveRun) => {
    const output = [];
    let timedOut = false;
    const child = spawn(
      "cargo",
      ["test", "--manifest-path", manifestPath, "--color", "never"],
      {
        cwd,
        detached: true,
        env: {
          ...process.env,
          CARGO_TERM_COLOR: "never",
          CARGO_TARGET_DIR: targetDir,
          RUST_BACKTRACE: "1",
        },
      },
    );

    const append = (chunk) => {
      const remaining = 140_000 - output.join("").length;
      if (remaining > 0) output.push(chunk.toString().slice(0, remaining));
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, RUN_TIMEOUT_MS);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolveRun({ ok: false, output: `${error.message}\n`, timedOut: false, exitCode: null });
    });
    child.on("close", (exitCode, signal) => {
      clearTimeout(timer);
      resolveRun({
        ok: exitCode === 0 && !timedOut,
        output: output.join(""),
        timedOut,
        exitCode,
        signal,
      });
    });
  });
}

async function runExercise(exercise, code) {
  const runRoot = join(os.tmpdir(), `rust-exercises-${randomUUID()}`);
  const exerciseDestination = join(runRoot, "exercises", exercise.categoryId, exercise.slug);
  const targetDir = join(REPO_ROOT, ".rust-exercises-target");

  try {
    await mkdir(join(runRoot, "exercises", exercise.categoryId), { recursive: true });
    await cp(exercise.root, exerciseDestination, { recursive: true });
    await cp(join(REPO_ROOT, "helpers"), join(runRoot, "helpers"), { recursive: true });
    await mkdir(targetDir, { recursive: true });
    await writeFile(join(exerciseDestination, "src", exercise.sourceName), code, "utf8");

    const startedAt = Date.now();
    const result = await runCargo(
      join(exerciseDestination, "Cargo.toml"),
      exerciseDestination,
      targetDir,
    );
    return {
      ...result,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await rm(runRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function serveStatic(request, response) {
  let requestPath = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (requestPath === "/") requestPath = "/index.html";
  const candidate = normalize(join(DIST_ROOT, requestPath));
  const isInsideDist = candidate === DIST_ROOT || candidate.startsWith(`${DIST_ROOT}/`);
  if (!isInsideDist) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const filePath = await stat(candidate).then(() => candidate);
    const contentType = MIME_TYPES[extname(filePath)] || "application/octet-stream";
    response.writeHead(200, { "Content-Type": contentType });
    createReadStream(filePath).pipe(response);
  } catch {
    try {
      response.writeHead(200, { "Content-Type": MIME_TYPES[".html"] });
      createReadStream(join(DIST_ROOT, "index.html")).pipe(response);
    } catch {
      response.writeHead(404);
      response.end("Run npm run build before starting the server.");
    }
  }
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");

    if (request.method === "GET" && url.pathname === "/api/exercises") {
      sendJson(response, 200, { categories: publicCatalog(), count: catalog.exercises.size });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/run") {
      const body = await readJson(request);
      const exercise = catalog.exercises.get(body.exerciseId);
      const code = typeof body.code === "string" ? body.code : "";
      if (!exercise) {
        sendJson(response, 404, { error: "That exercise does not exist." });
        return;
      }
      if (!code || Buffer.byteLength(code, "utf8") > MAX_CODE_BYTES) {
        sendJson(response, 400, { error: "Code is missing or too large." });
        return;
      }

      const result = await runExercise(exercise, code);
      sendJson(response, 200, result);
      return;
    }

    if (request.method === "GET") {
      await serveStatic(request, response);
      return;
    }

    response.writeHead(405);
    response.end("Method not allowed");
  } catch (error) {
    console.error(error);
    sendJson(response, 500, { error: "The local runner could not complete the request." });
  }
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Rust Exercises API listening at http://127.0.0.1:${PORT}`);
  console.log(`Loaded ${catalog.exercises.size} exercises across ${catalog.categories.length} categories.`);
});
