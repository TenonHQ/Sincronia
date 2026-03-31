let scopesData = [];
let updateSetsCache = {};
let modalScopeKey = null;
let modalScopeSysId = null;

// --- API helpers ---

async function api(method, path, body) {
  const opts = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body) opts.body = JSON.stringify(body);
  const resp = await fetch(path, opts);
  if (!resp.ok) {
    const err = await resp.json().catch(function () {
      return { error: "Request failed" };
    });
    throw new Error(err.error || "Request failed");
  }
  return resp.json();
}

// --- Toast ---

function toast(message, type) {
  type = type || "success";
  var container = document.getElementById("toast-container");
  var el = document.createElement("div");
  el.className = "toast " + type;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(function () {
    el.remove();
  }, 4000);
}

// --- Load scopes ---

async function loadScopes() {
  try {
    var data = await api("GET", "/api/scopes");
    scopesData = data.scopes;
    renderScopes();
  } catch (e) {
    document.getElementById("scope-grid").innerHTML =
      '<div class="loading">Failed to load scopes: ' + e.message + "</div>";
  }
}

async function loadConfig() {
  try {
    var data = await api("GET", "/api/config");
    document.getElementById("instance-badge").textContent = data.instance;
  } catch (e) {
    // ignore
  }
}

// --- Render ---

function renderScopes() {
  var grid = document.getElementById("scope-grid");
  grid.innerHTML = "";

  scopesData.forEach(function (scope) {
    var card = document.createElement("div");
    card.className = "scope-card" + (scope.selected_update_set ? " has-selection" : "");
    card.id = "card-" + scope.scope;

    var selectedName = scope.selected_update_set ? scope.selected_update_set.name : "None";
    var selectedId = scope.selected_update_set ? scope.selected_update_set.sys_id : "";

    card.innerHTML =
      '<div class="scope-header">' +
        '<span class="scope-name">' + scope.scope + "</span>" +
        '<span class="scope-id">' + (scope.sys_id ? scope.sys_id.substring(0, 8) + "..." : "not found") + "</span>" +
      "</div>" +
      '<div class="display-name">' + scope.display_name + "</div>" +
      '<select class="update-set-select" id="select-' + scope.scope + '" onchange="onSelectChange(\'' + scope.scope + '\')">' +
        '<option value="">-- No Update Set --</option>' +
        '<option value="__loading" disabled>Loading...</option>' +
      "</select>" +
      '<div class="card-actions">' +
        '<button class="btn btn-primary" onclick="openCreateModal(\'' + scope.scope + "', '" + scope.sys_id + "')\" " + (!scope.sys_id ? "disabled" : "") + ">New</button>" +
        '<button class="btn btn-danger" id="close-btn-' + scope.scope + '" onclick="closeUpdateSet(\'' + scope.scope + '\')" disabled>Close</button>' +
        '<button class="btn btn-clear" id="clear-btn-' + scope.scope + '" onclick="clearSelection(\'' + scope.scope + '\')" ' + (!scope.selected_update_set ? "disabled" : "") + ">Clear</button>" +
      "</div>" +
      (scope.selected_update_set ? '<div class="selected-badge">Active for push</div>' : "");

    grid.appendChild(card);

    // Load update sets for this scope
    loadUpdateSets(scope.scope, selectedId);
  });
}

async function loadUpdateSets(scope, selectedId) {
  try {
    var data = await api("GET", "/api/update-sets/" + scope);
    updateSetsCache[scope] = data.update_sets;

    var select = document.getElementById("select-" + scope);
    select.innerHTML = '<option value="">-- No Update Set --</option>';

    data.update_sets.forEach(function (us) {
      var option = document.createElement("option");
      option.value = us.sys_id;
      option.textContent = us.name;
      if (us.sys_id === selectedId) option.selected = true;
      select.appendChild(option);
    });

    // Enable/disable close button
    var closeBtn = document.getElementById("close-btn-" + scope);
    if (closeBtn) closeBtn.disabled = !selectedId;
  } catch (e) {
    var select = document.getElementById("select-" + scope);
    if (select) {
      select.innerHTML = '<option value="" disabled>Failed to load</option>';
    }
  }
}

// --- Actions ---

async function onSelectChange(scope) {
  var select = document.getElementById("select-" + scope);
  var sysId = select.value;
  var name = select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : "";

  try {
    await api("POST", "/api/select-update-set", {
      scope: scope,
      update_set_sys_id: sysId,
      update_set_name: sysId ? name : null,
    });

    // Update local state
    var scopeData = scopesData.find(function (s) { return s.scope === scope; });
    if (scopeData) {
      scopeData.selected_update_set = sysId ? { sys_id: sysId, name: name } : null;
    }

    // Update card styling
    var card = document.getElementById("card-" + scope);
    if (card) {
      if (sysId) {
        card.classList.add("has-selection");
      } else {
        card.classList.remove("has-selection");
      }
    }

    // Update buttons
    var closeBtn = document.getElementById("close-btn-" + scope);
    if (closeBtn) closeBtn.disabled = !sysId;
    var clearBtn = document.getElementById("clear-btn-" + scope);
    if (clearBtn) clearBtn.disabled = !sysId;

    // Update badge
    var badge = card ? card.querySelector(".selected-badge") : null;
    if (sysId && !badge) {
      var b = document.createElement("div");
      b.className = "selected-badge";
      b.textContent = "Active for push";
      card.appendChild(b);
    } else if (!sysId && badge) {
      badge.remove();
    }

    toast(sysId ? "Selected: " + name : "Cleared selection for " + scope);
  } catch (e) {
    toast("Failed to save: " + e.message, "error");
  }
}

async function clearSelection(scope) {
  var select = document.getElementById("select-" + scope);
  if (select) select.value = "";
  await onSelectChange(scope);
}

async function closeUpdateSet(scope) {
  var select = document.getElementById("select-" + scope);
  var sysId = select ? select.value : "";
  if (!sysId) return;

  var name = select.options[select.selectedIndex] ? select.options[select.selectedIndex].textContent : "";
  if (!confirm("Close update set \"" + name + "\"?")) return;

  try {
    await api("PATCH", "/api/update-set/" + sysId + "/close");

    // Clear selection and reload
    await api("POST", "/api/select-update-set", {
      scope: scope,
      update_set_sys_id: "",
      update_set_name: null,
    });

    var scopeData = scopesData.find(function (s) { return s.scope === scope; });
    if (scopeData) scopeData.selected_update_set = null;

    toast("Closed: " + name);
    loadUpdateSets(scope, "");

    var card = document.getElementById("card-" + scope);
    if (card) {
      card.classList.remove("has-selection");
      var badge = card.querySelector(".selected-badge");
      if (badge) badge.remove();
    }
    var clearBtn = document.getElementById("clear-btn-" + scope);
    if (clearBtn) clearBtn.disabled = true;
    var closeBtn = document.getElementById("close-btn-" + scope);
    if (closeBtn) closeBtn.disabled = true;
  } catch (e) {
    toast("Failed to close: " + e.message, "error");
  }
}

// --- Modal ---

function openCreateModal(scope, scopeSysId) {
  modalScopeKey = scope;
  modalScopeSysId = scopeSysId;
  document.getElementById("modal-scope").value = scope;
  document.getElementById("modal-name").value = "";
  document.getElementById("modal-description").value = "";
  document.getElementById("create-modal").classList.add("active");
  document.getElementById("modal-name").focus();
}

function closeModal() {
  document.getElementById("create-modal").classList.remove("active");
  modalScopeKey = null;
  modalScopeSysId = null;
}

async function createUpdateSet() {
  var name = document.getElementById("modal-name").value.trim();
  if (!name) {
    toast("Name is required", "error");
    return;
  }

  var btn = document.getElementById("modal-create-btn");
  btn.disabled = true;
  btn.textContent = "Creating...";

  try {
    var data = await api("POST", "/api/update-set", {
      name: name,
      scope_sys_id: modalScopeSysId,
      description: document.getElementById("modal-description").value.trim(),
    });

    var newSysId = data.update_set.sys_id;

    // Auto-select the new update set
    await api("POST", "/api/select-update-set", {
      scope: modalScopeKey,
      update_set_sys_id: newSysId,
      update_set_name: name,
    });

    var scopeData = scopesData.find(function (s) { return s.scope === modalScopeKey; });
    if (scopeData) {
      scopeData.selected_update_set = { sys_id: newSysId, name: name };
    }

    toast("Created: " + name);
    closeModal();

    // Reload that scope's update sets
    loadUpdateSets(modalScopeKey, newSysId);

    // Update card
    var card = document.getElementById("card-" + modalScopeKey);
    if (card) {
      card.classList.add("has-selection");
      var badge = card.querySelector(".selected-badge");
      if (!badge) {
        var b = document.createElement("div");
        b.className = "selected-badge";
        b.textContent = "Active for push";
        card.appendChild(b);
      }
    }
    var closeBtn = document.getElementById("close-btn-" + modalScopeKey);
    if (closeBtn) closeBtn.disabled = false;
    var clearBtn = document.getElementById("clear-btn-" + modalScopeKey);
    if (clearBtn) clearBtn.disabled = false;
  } catch (e) {
    toast("Failed to create: " + e.message, "error");
  } finally {
    btn.disabled = false;
    btn.textContent = "Create";
  }
}

// --- Keyboard ---

document.addEventListener("keydown", function (e) {
  if (e.key === "Escape") closeModal();
});

// --- Init ---

loadConfig();
loadScopes();
