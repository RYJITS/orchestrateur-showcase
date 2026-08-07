const state = {
  registry: null,
  projects: [],
  tasksRegistry: null,
  tasks: [],
  taskStore: [],
  filter: "",
  taskCadence: "all",
  taskOwner: "all",
  executor: "script",
  editingTaskId: "",
  editingSubtaskId: "",
  editingSubtaskParentId: ""
};

const els = {
  total: document.getElementById("metric-total"),
  public: document.getElementById("metric-public"),
  blocked: document.getElementById("metric-blocked"),
  private: document.getElementById("metric-private"),
  registryDate: document.getElementById("registry-date"),
  projectCount: document.getElementById("project-count"),
  table: document.getElementById("project-table"),
  search: document.getElementById("project-search"),
  runStatus: document.getElementById("run-status"),
  runLog: document.getElementById("run-log"),
  reports: document.getElementById("reports-list"),
  refreshReports: document.getElementById("refresh-reports"),
  taskCount: document.getElementById("task-count"),
  taskSummary: document.getElementById("task-summary"),
  taskCadence: document.getElementById("task-cadence-filter"),
  taskOwner: document.getElementById("task-owner-filter"),
  taskTable: document.getElementById("task-table"),
  globalExecutor: document.getElementById("global-executor"),
  taskForm: document.getElementById("task-form"),
  subtaskForm: document.getElementById("subtask-form"),
  taskTitleInput: document.getElementById("task-title-input"),
  taskWhenInput: document.getElementById("task-when-input"),
  taskOwnerInput: document.getElementById("task-owner-input"),
  taskCadenceInput: document.getElementById("task-cadence-input"),
  taskExecutorInput: document.getElementById("task-executor-input"),
  subtaskParentInput: document.getElementById("subtask-parent-input"),
  subtaskTitleInput: document.getElementById("subtask-title-input"),
  subtaskWhenInput: document.getElementById("subtask-when-input"),
  subtaskOwnerInput: document.getElementById("subtask-owner-input"),
  subtaskCadenceInput: document.getElementById("subtask-cadence-input"),
  subtaskExecutorInput: document.getElementById("subtask-executor-input"),
  storeCount: document.getElementById("store-count"),
  taskStoreList: document.getElementById("task-store-list")
};

await refreshAll();

document.addEventListener("click", async (event) => {
  const pauseButton = event.target.closest("[data-task-pause]");
  if (pauseButton) {
    await toggleTaskPause(pauseButton);
    return;
  }
  const editButton = event.target.closest("[data-task-edit]");
  if (editButton) {
    editTask(editButton);
    return;
  }
  const deleteButton = event.target.closest("[data-task-delete]");
  if (deleteButton) {
    await deleteTask(deleteButton);
    return;
  }
  const installButton = event.target.closest("[data-task-install]");
  if (installButton) {
    await installStoredTask(installButton.dataset.taskInstall);
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (actionButton) {
    await runAction({
      action: actionButton.dataset.action,
      taskId: actionButton.dataset.taskId || undefined,
      executor: executorForButton(actionButton)
    });
    return;
  }
  const projectAction = event.target.closest("[data-project-action]");
  if (projectAction) {
    await runAction({
      scope: "project",
      action: projectAction.dataset.projectAction,
      projectId: projectAction.dataset.projectId,
      executor: state.executor
    });
    return;
  }
  const openProject = event.target.closest("[data-open-project]");
  if (openProject) {
    await openProjectFolder(openProject.dataset.openProject);
  }
});

els.search.addEventListener("input", () => {
  state.filter = els.search.value.trim().toLowerCase();
  renderProjects();
});

els.taskCadence.addEventListener("change", () => {
  state.taskCadence = els.taskCadence.value;
  renderTasks();
});

els.taskOwner.addEventListener("change", () => {
  state.taskOwner = els.taskOwner.value;
  renderTasks();
});

els.globalExecutor.addEventListener("change", () => {
  state.executor = els.globalExecutor.value;
  renderTaskForms();
  renderTasks();
});

els.taskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveTask({
    kind: "task",
    id: state.editingTaskId || undefined,
    title: els.taskTitleInput.value,
    when: els.taskWhenInput.value,
    owner: els.taskOwnerInput.value,
    cadence: els.taskCadenceInput.value,
    executor: els.taskExecutorInput.value
  });
  els.taskForm.reset();
  state.editingTaskId = "";
});

els.subtaskForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await saveTask({
    kind: "subtask",
    id: state.editingSubtaskId || undefined,
    parentId: els.subtaskParentInput.value,
    title: els.subtaskTitleInput.value,
    when: els.subtaskWhenInput.value,
    owner: els.subtaskOwnerInput.value,
    cadence: els.subtaskCadenceInput.value,
    executor: els.subtaskExecutorInput.value
  });
  els.subtaskForm.reset();
  state.editingSubtaskId = "";
  state.editingSubtaskParentId = "";
});

els.refreshReports.addEventListener("click", refreshReports);

async function refreshAll() {
  const [registry, tasks] = await Promise.all([fetchJson("/api/registry"), fetchJson("/api/tasks"), refreshReports()]);
  state.registry = registry;
  state.projects = registry.projects || [];
  state.tasksRegistry = tasks;
  state.tasks = tasks.tasks || [];
  state.taskStore = tasks.taskStore || [];
  renderMetrics();
  renderExecutors();
  renderTaskFilters();
  renderTaskForms();
  renderTaskSummary();
  renderTasks();
  renderTaskStore();
  renderProjects();
}

async function refreshReports() {
  const reports = await fetchJson("/api/reports");
  renderReports(reports);
  return reports;
}

function renderMetrics() {
  const projects = state.projects;
  els.total.textContent = projects.length;
  els.public.textContent = projects.filter((project) => /PUBLIC/.test(project.status || "")).length;
  els.blocked.textContent = projects.filter((project) => /BLOCKED|FAIL|SENSITIVE/.test(`${project.status} ${project.securityStatus}`)).length;
  els.private.textContent = projects.filter((project) => /PRIVATE|ARCHIVE/.test(project.status || "")).length;
  els.registryDate.textContent = formatDate(state.registry?.generatedAt);
}

function renderProjects() {
  const rows = state.projects
    .filter((project) => matchesFilter(project))
    .sort((a, b) => statusRank(a) - statusRank(b) || a.name.localeCompare(b.name, "fr"));
  els.projectCount.textContent = `${rows.length} projet${rows.length > 1 ? "s" : ""}`;
  els.table.innerHTML = rows.map(renderProjectRow).join("");
}

function renderTaskFilters() {
  const cadences = state.tasksRegistry?.cadences || {};
  const owners = state.tasksRegistry?.owners || {};
  els.taskCadence.innerHTML = [
    `<option value="all">Toutes</option>`,
    ...Object.entries(cadences).map(([id, item]) => `<option value="${escapeHtml(id)}">${escapeHtml(item.label)}</option>`)
  ].join("");
  els.taskOwner.innerHTML = [
    `<option value="all">Tous</option>`,
    ...Object.entries(owners).map(([id, item]) => `<option value="${escapeHtml(id)}">${escapeHtml(item.label)}</option>`)
  ].join("");
  els.taskCadence.value = state.taskCadence;
  els.taskOwner.value = state.taskOwner;
}

function renderExecutors() {
  els.globalExecutor.innerHTML = executorOptions(state.executor);
  els.globalExecutor.value = state.executor;
}

function renderTaskForms() {
  els.taskOwnerInput.innerHTML = ownerOptions("codex");
  els.taskCadenceInput.innerHTML = cadenceOptions("on-demand");
  els.taskExecutorInput.innerHTML = executorOptions(state.executor);
  els.subtaskOwnerInput.innerHTML = ownerOptions("codex");
  els.subtaskCadenceInput.innerHTML = cadenceOptions("on-demand");
  els.subtaskExecutorInput.innerHTML = executorOptions(state.executor);
  els.subtaskParentInput.innerHTML = state.tasks.length
    ? state.tasks.map((task) => `<option value="${escapeHtml(task.id)}">${escapeHtml(task.title)}</option>`).join("")
    : `<option value="">Aucune tache</option>`;
}

function renderTaskSummary() {
  const summary = state.tasksRegistry?.summary || {};
  const routineCounts = summary.routineCounts || {};
  els.taskSummary.innerHTML = [
    ["Taches", summary.total || 0],
    ["Sous-taches", summary.subtasks || 0],
    ["Critiques", summary.critical || 0],
    ["En pause", summary.paused || 0],
    ["Store", summary.store || 0]
  ].map(([label, value]) => `
    <div class="task-summary-item">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `).join("");
}

function renderTasks() {
  const rows = state.tasks
    .filter((task) => state.taskCadence === "all" || task.cadence === state.taskCadence || task.routines?.includes?.(state.taskCadence))
    .filter((task) => state.taskOwner === "all" || task.owner === state.taskOwner)
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || cadenceRank(a.cadence) - cadenceRank(b.cadence) || a.title.localeCompare(b.title, "fr"));

  els.taskCount.textContent = `${rows.length} tache${rows.length > 1 ? "s" : ""}`;
  els.taskTable.innerHTML = rows.map(renderTaskBlock).join("");
}

function renderTaskBlock(task) {
  return [
    renderTaskRow(task),
    ...(task.subtasks || []).map((subtask) => renderSubtaskRow(task, subtask))
  ].join("");
}

function renderTaskRow(task) {
  const cadence = state.tasksRegistry?.cadences?.[task.cadence];
  const owner = state.tasksRegistry?.owners?.[task.owner];
  const guards = (task.guards || []).slice(0, 3).map((guard) => `<li>${escapeHtml(guard)}</li>`).join("");
  const paused = task.paused || task.status === "paused";
  return `
    <tr class="${paused ? "is-paused" : ""}">
      <td>
        <div class="task-name">
          <strong>${escapeHtml(task.title)}</strong>
          <span>${escapeHtml(task.purpose)}</span>
          ${task.when?.label ? `<small>${escapeHtml(task.when.label)}</small>` : ""}
          <div class="task-routines">${(task.routines || []).map((routine) => `<em>${escapeHtml(routineLabel(routine))}</em>`).join("")}</div>
        </div>
      </td>
      <td>${badge(cadence?.label || task.cadence)}</td>
      <td>
        <div class="task-owner">
          <strong>${escapeHtml(owner?.label || task.owner)}</strong>
          <span>${escapeHtml(owner?.role || "")}</span>
        </div>
      </td>
      <td>${escapeHtml(task.appliesTo)}</td>
      <td><code class="task-command">${escapeHtml(task.command)}</code></td>
      <td>
        <ul class="task-guards">${guards}</ul>
      </td>
      <td>
        <div class="task-action-cell">
          ${badge(task.priority || "standard")}
          ${paused ? badge("PAUSE") : badge("ACTIVE")}
          <label class="row-executor">
            <span>Executeur</span>
            <select data-task-executor="${escapeHtml(task.id)}">
              ${executorOptions(task.executor || state.executor)}
            </select>
          </label>
          ${task.action ? `
            <button class="small-button task-run-button" data-action="${escapeHtml(task.action)}" data-task-id="${escapeHtml(task.id)}" type="button">
              <svg><use href="#icon-play"></use></svg>
              <span>Lancer</span>
            </button>
          ` : ""}
          <button class="small-button" data-task-edit="${escapeHtml(task.id)}" data-kind="task" type="button">Modifier</button>
          <button class="small-button" data-task-pause="${escapeHtml(task.id)}" data-kind="task" type="button">${paused ? "Reprendre" : "Pause"}</button>
          <button class="small-button danger-button" data-task-delete="${escapeHtml(task.id)}" data-kind="task" type="button">Store</button>
        </div>
      </td>
    </tr>
  `;
}

function renderSubtaskRow(parent, subtask) {
  const cadence = state.tasksRegistry?.cadences?.[subtask.cadence];
  const owner = state.tasksRegistry?.owners?.[subtask.owner];
  const paused = subtask.paused || subtask.status === "paused";
  const guards = (subtask.guards || []).slice(0, 2).map((guard) => `<li>${escapeHtml(guard)}</li>`).join("");
  return `
    <tr class="subtask-row ${paused ? "is-paused" : ""}">
      <td>
        <div class="task-name">
          <strong>${escapeHtml(subtask.title)}</strong>
          <span>${escapeHtml(subtask.purpose || "")}</span>
          ${subtask.when?.label ? `<small>${escapeHtml(subtask.when.label)}</small>` : ""}
        </div>
      </td>
      <td>${badge(cadence?.label || subtask.cadence)}</td>
      <td>
        <div class="task-owner">
          <strong>${escapeHtml(owner?.label || subtask.owner)}</strong>
          <span>${escapeHtml(owner?.role || "")}</span>
        </div>
      </td>
      <td>${escapeHtml(parent.title)}</td>
      <td><code class="task-command">${escapeHtml(subtask.command || "")}</code></td>
      <td><ul class="task-guards">${guards}</ul></td>
      <td>
        <div class="task-action-cell">
          ${paused ? badge("PAUSE") : badge("ACTIVE")}
          <label class="row-executor">
            <span>Executeur</span>
            <select data-task-executor="${escapeHtml(subtask.id)}">
              ${executorOptions(subtask.executor || parent.executor || state.executor)}
            </select>
          </label>
          ${subtask.action ? `
            <button class="small-button task-run-button" data-action="${escapeHtml(subtask.action)}" data-task-id="${escapeHtml(subtask.id)}" type="button">
              <svg><use href="#icon-play"></use></svg>
              <span>Lancer</span>
            </button>
          ` : ""}
          <button class="small-button" data-task-edit="${escapeHtml(subtask.id)}" data-parent-id="${escapeHtml(parent.id)}" data-kind="subtask" type="button">Modifier</button>
          <button class="small-button" data-task-pause="${escapeHtml(subtask.id)}" data-parent-id="${escapeHtml(parent.id)}" data-kind="subtask" type="button">${paused ? "Reprendre" : "Pause"}</button>
          <button class="small-button danger-button" data-task-delete="${escapeHtml(subtask.id)}" data-parent-id="${escapeHtml(parent.id)}" data-kind="subtask" type="button">Store</button>
        </div>
      </td>
    </tr>
  `;
}

function renderTaskStore() {
  els.storeCount.textContent = `${state.taskStore.length} disponible${state.taskStore.length > 1 ? "s" : ""}`;
  els.taskStoreList.innerHTML = state.taskStore.length
    ? state.taskStore.map((task) => `
      <article class="store-item">
        <div>
          <strong>${escapeHtml(task.title)}</strong>
          <span>${escapeHtml(task.purpose || task.command || "")}</span>
        </div>
        <button class="small-button" data-task-install="${escapeHtml(task.id)}" type="button">
          <svg><use href="#icon-check"></use></svg>
          <span>Installer</span>
        </button>
      </article>
    `).join("")
    : `<p class="eyebrow">Store vide</p>`;
}

function renderProjectRow(project) {
  return `
    <tr>
      <td>
        <div class="project-name">
          <strong>${escapeHtml(cleanName(project.name))}</strong>
          <span>${escapeHtml(project.relativePath || project.path)}</span>
        </div>
      </td>
      <td>${badge(project.status)}</td>
      <td>${badge(project.securityStatus)}</td>
      <td>${badge(project.functionalityStatus)}</td>
      <td>${project.git?.hasGit ? badge(project.git.dirty ? "DIRTY" : "OK") : badge("NO_GIT")}</td>
      <td>
        <div class="project-actions">
          <button title="Dossier" data-open-project="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-folder"></use></svg>
          </button>
          <button title="Audit initial" data-project-action="initial" data-project-id="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-file"></use></svg>
          </button>
          <button title="Securite" data-project-action="security" data-project-id="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-shield"></use></svg>
          </button>
          <button title="Architecture" data-project-action="architecture" data-project-id="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-file"></use></svg>
          </button>
          <button title="Optimisation" data-project-action="optimization" data-project-id="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-check"></use></svg>
          </button>
          <button title="Fonctionnement" data-project-action="functionality" data-project-id="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-check"></use></svg>
          </button>
          <button title="Reparation dry-run" data-project-action="repair" data-project-id="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-check"></use></svg>
          </button>
          <button title="Fiche" data-project-action="fiches" data-project-id="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-file"></use></svg>
          </button>
          <button title="Archivage dry-run" data-project-action="archive" data-project-id="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-folder"></use></svg>
          </button>
          <button title="GitHub dry-run" data-project-action="github" data-project-id="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-link"></use></svg>
          </button>
          <button title="GitHub sync dry-run" data-project-action="githubSync" data-project-id="${escapeHtml(project.id)}" type="button">
            <svg><use href="#icon-link"></use></svg>
          </button>
          ${project.links?.github ? `<a title="GitHub" href="${escapeHtml(project.links.github)}" target="_blank" rel="noreferrer"><svg><use href="#icon-link"></use></svg></a>` : ""}
        </div>
      </td>
    </tr>
  `;
}

function routineLabel(value) {
  return state.tasksRegistry?.cadences?.[value]?.label || value;
}

function executorOptions(selected) {
  const executors = state.tasksRegistry?.executors || {};
  return Object.entries(executors)
    .map(([id, item]) => `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("");
}

function ownerOptions(selected) {
  const owners = state.tasksRegistry?.owners || {};
  return Object.entries(owners)
    .map(([id, item]) => `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("");
}

function cadenceOptions(selected) {
  const cadences = state.tasksRegistry?.cadences || {};
  return Object.entries(cadences)
    .map(([id, item]) => `<option value="${escapeHtml(id)}" ${id === selected ? "selected" : ""}>${escapeHtml(item.label)}</option>`)
    .join("");
}

function executorForButton(button) {
  const row = button.closest("tr");
  const rowSelect = row?.querySelector("[data-task-executor]");
  return rowSelect?.value || state.executor || "script";
}

function priorityRank(value = "") {
  return ({ critique: 0, haute: 1, moyenne: 2, basse: 3 })[value] ?? 4;
}

function cadenceRank(value = "") {
  return ({ daily: 0, weekly: 1, monthly: 2, "before-change": 3, "after-change": 4, "before-publication": 5, "on-demand": 6 })[value] ?? 7;
}

function renderReports(groups) {
  els.reports.innerHTML = groups.map((group) => `
    <section class="report-group">
      <h3>${escapeHtml(group.type)}</h3>
      ${group.files.length
        ? group.files.map((file) => `<a href="#" title="${escapeHtml(file.path)}">${escapeHtml(file.name)}</a>`).join("")
        : `<p class="eyebrow">Aucun rapport</p>`}
    </section>
  `).join("");
}

async function runAction(payload) {
  setRunState("En cours", `Action: ${payload.scope === "project" ? `${payload.action} / ${payload.projectId}` : payload.action}`);
  try {
    const result = await fetchJson("/api/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setRunState(result.exitCode === 0 ? "OK" : "Erreur", formatRunResult(result));
  } catch (error) {
    setRunState("Erreur", error.message);
  }
  await refreshAll();
}

async function saveTask(payload) {
  if (!payload.title?.trim()) return;
  try {
    await fetchJson("/api/tasks/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    setRunState("OK", `${payload.kind === "subtask" ? "Sous-tache" : "Tache"} ajoutee`);
  } catch (error) {
    setRunState("Erreur", error.message);
  }
  await refreshAll();
}

function editTask(button) {
  const kind = button.dataset.kind || "task";
  if (kind === "subtask") {
    const parent = state.tasks.find((task) => task.id === button.dataset.parentId);
    const subtask = parent?.subtasks?.find((item) => item.id === button.dataset.taskEdit);
    if (!subtask) return;
    state.editingSubtaskId = subtask.id;
    state.editingSubtaskParentId = parent.id;
    els.subtaskParentInput.value = parent.id;
    els.subtaskTitleInput.value = subtask.title || "";
    els.subtaskWhenInput.value = subtask.when?.label || "";
    els.subtaskOwnerInput.value = subtask.owner || "codex";
    els.subtaskCadenceInput.value = subtask.cadence || "on-demand";
    els.subtaskExecutorInput.value = subtask.executor || state.executor;
    setRunState("Edition", `Sous-tache: ${subtask.title}`);
    return;
  }

  const task = state.tasks.find((item) => item.id === button.dataset.taskEdit);
  if (!task) return;
  state.editingTaskId = task.id;
  els.taskTitleInput.value = task.title || "";
  els.taskWhenInput.value = task.when?.label || "";
  els.taskOwnerInput.value = task.owner || "codex";
  els.taskCadenceInput.value = task.cadence || "on-demand";
  els.taskExecutorInput.value = task.executor || state.executor;
  setRunState("Edition", `Tache: ${task.title}`);
}

async function toggleTaskPause(button) {
  try {
    await fetchJson("/api/tasks/pause", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: button.dataset.taskPause,
        parentId: button.dataset.parentId || undefined,
        kind: button.dataset.kind || "task"
      })
    });
    setRunState("OK", "Pause mise a jour");
  } catch (error) {
    setRunState("Erreur", error.message);
  }
  await refreshAll();
}

async function deleteTask(button) {
  try {
    await fetchJson("/api/tasks/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: button.dataset.taskDelete,
        parentId: button.dataset.parentId || undefined,
        kind: button.dataset.kind || "task"
      })
    });
    setRunState("OK", "Tache deplacee dans le store");
  } catch (error) {
    setRunState("Erreur", error.message);
  }
  await refreshAll();
}

async function installStoredTask(id) {
  try {
    await fetchJson("/api/tasks/install", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id })
    });
    setRunState("OK", "Tache installee depuis le store");
  } catch (error) {
    setRunState("Erreur", error.message);
  }
  await refreshAll();
}

async function openProjectFolder(projectId) {
  try {
    await fetchJson("/api/open-project", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId })
    });
    setRunState("OK", `Dossier ouvert: ${projectId}`);
  } catch (error) {
    setRunState("Erreur", error.message);
  }
}

function setRunState(status, text) {
  els.runStatus.textContent = status;
  els.runLog.textContent = text || "";
}

function formatRunResult(result) {
  return [
    `Executeur: ${result.executor || "script"}`,
    `Portee: ${result.scope || "all-projects"}`,
    result.preflight ? `Pre-scan: exit ${result.preflight.exitCode}` : "",
    `Commande: npm ${result.args?.join(" ") || result.script}`,
    `Exit: ${result.exitCode}`,
    `Duree: ${result.durationMs} ms`,
    result.stdout ? `\nSTDOUT\n${result.stdout}` : "",
    result.stderr ? `\nSTDERR\n${result.stderr}` : ""
  ].filter(Boolean).join("\n");
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text };
  }
  if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
  return payload;
}

function matchesFilter(project) {
  if (!state.filter) return true;
  const haystack = [
    project.name,
    project.path,
    project.status,
    project.securityStatus,
    project.functionalityStatus,
    ...(project.stack || [])
  ].join(" ").toLowerCase();
  return haystack.includes(state.filter);
}

function statusRank(project) {
  const value = `${project.status} ${project.securityStatus}`;
  if (/SENSITIVE|FAIL|BLOCKED/.test(value)) return 0;
  if (/PUBLIC/.test(value)) return 1;
  if (/PRIVATE/.test(value)) return 2;
  if (/ARCHIVE/.test(value)) return 3;
  return 4;
}

function badge(value = "UNKNOWN") {
  const className = badgeClass(value);
  return `<span class="badge ${className}">${escapeHtml(value)}</span>`;
}

function badgeClass(value) {
  if (/OK|PUBLIC/.test(value)) return "badge-ok";
  if (/FAIL|SENSITIVE|BLOCKED/.test(value)) return "badge-fail";
  if (/PRIVATE|ARCHIVE/.test(value)) return "badge-private";
  return "badge-warn";
}

function cleanName(name) {
  return String(name).replace(/^\d+_/, "").replace(/_/g, " ");
}

function formatDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-CH", {
    dateStyle: "short",
    timeStyle: "medium"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
