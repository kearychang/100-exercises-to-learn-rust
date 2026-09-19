import { basicSetup } from "codemirror";
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  toggleComment,
} from "@codemirror/commands";
import { rust } from "@codemirror/lang-rust";
import { syntaxHighlighting, defaultHighlightStyle } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import "./styles.css";

const STATUS_KEY = "rust-exercises:status";
const CODE_KEY_PREFIX = "rust-exercises:code:";

const state = {
  categories: [],
  exercises: [],
  activeId: null,
  editor: null,
  statuses: readStatuses(),
  sidebarCollapsed: false,
};

const app = document.querySelector("#app");

function readStatuses() {
  try {
    return JSON.parse(localStorage.getItem(STATUS_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStatuses() {
  localStorage.setItem(STATUS_KEY, JSON.stringify(state.statuses));
}

function setStatus(exerciseId, status) {
  state.statuses[exerciseId] = status;
  saveStatuses();
  updateSidebarStatuses();
  updateProgress();
}

function getStatus(exerciseId) {
  return state.statuses[exerciseId] || "idle";
}

function statusLabel(status) {
  if (status === "done") return "done";
  if (status === "error") return "error";
  return "not started";
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getExercise(exerciseId) {
  return state.exercises.find((exercise) => exercise.id === exerciseId);
}

function renderShell() {
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar" aria-label="Exercise navigation">
        <div class="brand-lockup">
          <div class="brand-mark">R/</div>
          <div class="brand-copy"><strong>Rust Exercises</strong><span>Local Lab</span></div>
        </div>
        <div class="sidebar-summary">
          <div class="summary-topline"><span>COURSE PROGRESS</span><strong id="progress-count">0 / 0</strong></div>
          <div class="progress-track"><span id="progress-bar"></span></div>
        </div>
        <nav id="exercise-nav" class="exercise-nav"></nav>
        <div class="sidebar-footer"><span class="status-key"><i class="legend-dot done"></i> cleared</span><span class="status-key"><i class="legend-dot error"></i> needs work</span></div>
      </aside>
      <main class="main-area">
        <header class="topbar">
          <button id="sidebar-toggle" class="icon-button" type="button" aria-label="Collapse sidebar" title="Collapse sidebar"><span class="menu-icon">☰</span></button>
          <div class="breadcrumb"><span id="breadcrumb-category">Loading course</span><span class="slash">/</span><strong id="breadcrumb-exercise">Please wait</strong></div>
          <div class="topbar-actions"><span class="local-badge"><i></i> local runner</span><a href="https://rust-exercises.com/100-exercises/" target="_blank" rel="noreferrer" class="source-link">Course site ↗</a></div>
        </header>
        <section class="workspace">
          <div class="exercise-heading">
            <div>
              <div class="eyebrow" id="exercise-number">EXERCISE 01</div>
              <h1 id="exercise-title">Loading exercise…</h1>
            </div>
            <button id="brief-toggle" class="brief-button" type="button">View brief <span>↗</span></button>
          </div>
          <div id="exercise-brief" class="exercise-brief" hidden></div>
          <section class="editor-card">
            <div class="panel-bar"><span id="source-file"><i class="file-dot"></i> src / lib.rs</span><span class="editor-hint">Ctrl + / to comment</span></div>
            <div id="editor" class="editor-host"></div>
          </section>
          <section class="output-card">
            <div class="output-header"><div><span class="panel-label">RUN OUTPUT</span><span id="run-status" class="run-status">ready</span></div><button id="run-button" class="run-button" type="button"><span class="play-icon">▶</span> Submit &amp; run <kbd>⌘↵</kbd></button></div>
            <textarea id="output" class="output-area" readonly spellcheck="false" placeholder="Compiler and test output will appear here."></textarea>
          </section>
          <div class="workspace-footer"><span><i class="secure-dot"></i> Runs against the local Rust toolchain</span><span id="run-time"></span></div>
        </section>
      </main>
    </div>
  `;

  document.querySelector("#sidebar-toggle").addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    document.querySelector(".app-shell").classList.toggle("sidebar-collapsed", state.sidebarCollapsed);
    const button = document.querySelector("#sidebar-toggle");
    button.setAttribute("aria-label", state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
    button.setAttribute("title", state.sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
  });
  document.querySelector("#run-button").addEventListener("click", runActiveExercise);
  document.querySelector("#brief-toggle").addEventListener("click", () => {
    const brief = document.querySelector("#exercise-brief");
    const isHidden = brief.hasAttribute("hidden");
    brief.toggleAttribute("hidden", !isHidden);
    document.querySelector("#brief-toggle").innerHTML = isHidden ? "Hide brief <span>↗</span>" : "View brief <span>↗</span>";
  });
}

function renderNavigation() {
  const nav = document.querySelector("#exercise-nav");
  nav.innerHTML = state.categories
    .map(
      (category, categoryIndex) => `
        <section class="category-section ${categoryIndex === 0 ? "is-open" : ""}">
          <button class="category-button" type="button" aria-expanded="${categoryIndex === 0}">
            <span class="category-chevron">⌄</span><span class="category-number">0${categoryIndex + 1}</span><span class="category-name">${escapeHtml(category.title)}</span><span class="category-total">${String(category.exercises.length).padStart(2, "0")}</span>
          </button>
          <div class="category-exercises">
            ${category.exercises
              .map(
                (exercise) => `
                  <button class="exercise-link status-${getStatus(exercise.id)}" data-exercise-id="${escapeHtml(exercise.id)}" type="button">
                    <span class="exercise-status" aria-hidden="true"></span><span class="exercise-link-number">${String(exercise.number).padStart(2, "0")}</span><span class="exercise-link-title">${escapeHtml(exercise.title)}</span><span class="exercise-status-label">${statusLabel(getStatus(exercise.id))}</span>
                  </button>
                `,
              )
              .join("")}
          </div>
        </section>
      `,
    )
    .join("");

  nav.querySelectorAll(".category-button").forEach((button) => {
    button.addEventListener("click", () => {
      const section = button.closest(".category-section");
      const open = section.classList.toggle("is-open");
      button.setAttribute("aria-expanded", String(open));
    });
  });
  nav.querySelectorAll(".exercise-link").forEach((button) => {
    button.addEventListener("click", () => selectExercise(button.dataset.exerciseId));
  });
}

function updateSidebarStatuses() {
  document.querySelectorAll(".exercise-link").forEach((button) => {
    const status = getStatus(button.dataset.exerciseId);
    button.classList.remove("status-idle", "status-done", "status-error");
    button.classList.add(`status-${status}`);
    button.querySelector(".exercise-status-label").textContent = statusLabel(status);
  });
}

function updateProgress() {
  const done = state.exercises.filter((exercise) => getStatus(exercise.id) === "done").length;
  const errors = state.exercises.filter((exercise) => getStatus(exercise.id) === "error").length;
  document.querySelector("#progress-count").textContent = `${done} / ${state.exercises.length}`;
  document.querySelector("#progress-bar").style.width = `${state.exercises.length ? (done / state.exercises.length) * 100 : 0}%`;
  document.querySelector(".sidebar-summary").title = errors ? `${errors} exercise${errors === 1 ? "" : "s"} need${errors === 1 ? "s" : ""} another pass` : "Keep going";
}

function selectExercise(exerciseId) {
  const exercise = getExercise(exerciseId);
  if (!exercise) return;
  state.activeId = exerciseId;
  const storedCode = localStorage.getItem(`${CODE_KEY_PREFIX}${exercise.id}`);
  const code = storedCode ?? exercise.code;

  document.querySelector("#breadcrumb-category").textContent = exercise.categoryTitle;
  document.querySelector("#breadcrumb-exercise").textContent = exercise.title;
  document.querySelector("#exercise-number").textContent = `EXERCISE ${String(exercise.number).padStart(2, "0")} / ${String(state.exercises.length).padStart(2, "0")}`;
  document.querySelector("#exercise-title").textContent = exercise.title;
  document.querySelector("#source-file").innerHTML = `<i class="file-dot"></i> src / ${escapeHtml(exercise.sourceName || "lib.rs")}`;
  const brief = document.querySelector("#exercise-brief");
  brief.textContent = exercise.description.replace(/^#.*\n/gm, "").trim();
  brief.hidden = true;
  document.querySelector("#brief-toggle").innerHTML = "View brief <span>↗</span>";
  document.querySelectorAll(".exercise-link").forEach((button) => button.classList.toggle("active", button.dataset.exerciseId === exerciseId));

  if (state.editor) state.editor.destroy();
  state.editor = new EditorView({
    state: EditorState.create({
      doc: code,
      extensions: [
        basicSetup,
        lineNumbers(),
        history(),
        drawSelection(),
        highlightActiveLine(),
        syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
        oneDark,
        rust(),
        keymap.of([
          ...defaultKeymap,
          ...historyKeymap,
          indentWithTab,
          { key: "Mod-/", run: toggleComment },
          { key: "Mod-Enter", run: () => { runActiveExercise(); return true; } },
        ]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) localStorage.setItem(`${CODE_KEY_PREFIX}${exercise.id}`, update.state.doc.toString());
        }),
        EditorView.theme({
          "&": { height: "100%" },
          ".cm-scroller": { overflow: "auto" },
          ".cm-content": { minHeight: "420px", padding: "20px 0 28px" },
          ".cm-gutters": { minHeight: "100%" },
        }),
      ],
    }),
    parent: document.querySelector("#editor"),
  });
  document.querySelector("#output").value = "";
  document.querySelector("#run-status").textContent = getStatus(exercise.id) === "done" ? "cleared" : "ready";
  document.querySelector("#run-status").className = `run-status ${getStatus(exercise.id)}`;
  document.querySelector("#run-time").textContent = "";
}

window.addEventListener("storage", (event) => {
  if (event.storageArea !== localStorage || event.key !== STATUS_KEY) return;
  state.statuses = readStatuses();
  updateSidebarStatuses();
  updateProgress();
  if (state.activeId) {
    const status = getStatus(state.activeId);
    const runStatus = document.querySelector("#run-status");
    if (runStatus && runStatus.textContent !== "compiling") {
      runStatus.textContent = status === "done" ? "cleared" : "ready";
      runStatus.className = `run-status ${status === "done" ? "done" : ""}`;
    }
  }
});

async function runActiveExercise() {
  const exercise = getExercise(state.activeId);
  if (!exercise || !state.editor) return;
  const runButton = document.querySelector("#run-button");
  const runStatus = document.querySelector("#run-status");
  const output = document.querySelector("#output");
  runButton.disabled = true;
  runButton.innerHTML = '<span class="spinner"></span> Running…';
  runStatus.textContent = "compiling";
  runStatus.className = "run-status running";
  output.value = "Compiling and running the exercise…";
  const startedAt = performance.now();

  try {
    const response = await fetch("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ exerciseId: exercise.id, code: state.editor.state.doc.toString() }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "The runner rejected the request.");

    const outputText = result.output?.trim() || (result.ok ? "Tests passed with no additional output." : "The process exited without output.");
    output.value = result.ok
      ? `✓ Exercise cleared\n\n${outputText}`
      : `${result.timedOut ? "✕ Run timed out" : "✕ Exercise needs another pass"}\n\n${outputText}`;
    setStatus(exercise.id, result.ok ? "done" : "error");
    runStatus.textContent = result.ok ? "cleared" : result.timedOut ? "timed out" : "failed";
    runStatus.className = `run-status ${result.ok ? "done" : "error"}`;
    document.querySelector("#run-time").textContent = `${result.durationMs || Math.round(performance.now() - startedAt)} ms`;
  } catch (error) {
    output.value = `✕ Could not run exercise\n\n${error.message}`;
    setStatus(exercise.id, "error");
    runStatus.textContent = "runner error";
    runStatus.className = "run-status error";
  } finally {
    runButton.disabled = false;
    runButton.innerHTML = '<span class="play-icon">▶</span> Submit &amp; run <kbd>⌘↵</kbd>';
  }
}

async function start() {
  renderShell();
  try {
    const response = await fetch("/api/exercises");
    const data = await response.json();
    state.categories = data.categories;
    state.exercises = state.categories.flatMap((category) => category.exercises);
    renderNavigation();
    updateProgress();
    selectExercise(state.exercises[0]?.id);
  } catch (error) {
    document.querySelector("#exercise-title").textContent = "Could not load the course";
    document.querySelector("#output").value = error.message;
  }
}

start();
