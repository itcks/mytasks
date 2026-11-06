document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role");
  const username = localStorage.getItem("username") || "";

  if (!token || role !== "admin") {
    window.location.href = "/login.html";
    return;
  }

  const statusSelect = document.getElementById("status-select");
  const limitSelect = document.getElementById("limit-select");
  const usersTbody = document.querySelector("#users-table tbody");
  const tasksTbody = document.querySelector("#tasks-table tbody");
  const prevPageBtn = document.getElementById("prev-page");
  const nextPageBtn = document.getElementById("next-page");
  const pageInfoEl = document.getElementById("page-info");

  let users = [];
  let currentPage = 1;
  let totalItems = 0;

  function setAuthHeader() {
    return {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      }
    };
  }

  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      ...setAuthHeader(),
      ...options,
      headers: { ...setAuthHeader().headers, ...(options.headers || {}) }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Ошибка запроса");
    }
    return res.json();
  }

  function formatDate(dateString) {
    if (!dateString) return "—";
    const date = new Date(String(dateString).replace(' ', 'T'));
    return isNaN(date.getTime()) ? "—" : date.toLocaleString();
  }

  async function createUser(username, password, role) {
    await apiFetch("/api/register", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    if (role !== "user") {
      const created = await apiFetch("/api/users");
      const u = created.find(x => x.username === username);
      if (u) {
        await apiFetch(`/api/users/${u.id}/role`, {
          method: "PUT",
          body: JSON.stringify({ role })
        });
      }
    }
  }

  document.getElementById("user-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("new-username").value.trim();
    const password = document.getElementById("new-password").value;
    const role = document.getElementById("new-role").value;
    if (!username || !password) return;
    try {
      await createUser(username, password, role);
      document.getElementById("new-username").value = "";
      document.getElementById("new-password").value = "";
      fetchUsers();
    } catch (err) {
      alert(err.message);
    }
  });

  async function fetchUsers() {
    users = await apiFetch("/api/users");
    usersTbody.innerHTML = "";
    users.forEach(u => {
      const tr = document.createElement("tr");
      const sel = document.createElement("select");
      ["user", "engineer", "admin"].forEach(r => {
        const opt = document.createElement("option");
        opt.value = r;
        opt.textContent = r;
        if (u.role === r) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.onchange = async () => {
        try {
          await apiFetch(`/api/users/${u.id}/role`, {
            method: "PUT",
            body: JSON.stringify({ role: sel.value })
          });
        } catch (err) {
          alert(err.message);
          fetchUsers();
        }
      };
      const tdSel = document.createElement("td");
      tdSel.appendChild(sel);
      const tdDel = document.createElement("td");
      const delBtn = document.createElement("button");
      delBtn.textContent = "Удалить";
      delBtn.onclick = async () => {
        if (!confirm(`Удалить пользователя ${u.username}?`)) return;
        try {
          await apiFetch(`/api/users/${u.id}`, { method: "DELETE" });
          fetchUsers();
        } catch (err) {
          alert(err.message);
        }
      };
      tdDel.appendChild(delBtn);
      tr.innerHTML = `<td>${u.id}</td><td>${u.username}</td>`;
      tr.appendChild(tdSel);
      tr.appendChild(tdDel);
      usersTbody.appendChild(tr);
    });
  }

  async function fetchTasks() {
    try {
      const data = await apiFetch(
        `/api/todos?scope=all&page=${currentPage}&limit=${limitSelect.value}&status=${statusSelect.value}`
      );
      totalItems = data.total;
      renderTasks(data.items);
      renderPagination();
    } catch (err) {
      alert(err.message);
    }
  }

  function renderTasks(items) {
    tasksTbody.innerHTML = "";
    items.forEach(t => {
      const tr = document.createElement("tr");

      const sel = document.createElement("select");
      sel.innerHTML = '<option value="">— не назначен —</option>';
      users.filter(u => u.role === "engineer" || u.role === "admin").forEach(u => {
        const opt = document.createElement("option");
        opt.value = u.id;
        opt.textContent = u.username;
        if (t.assigned_to === u.id) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.onchange = async () => {
        try {
          await apiFetch(`/api/todos/${t.id}`, {
            method: "PUT",
            body: JSON.stringify({ assignedTo: sel.value || null })
          });
          fetchTasks();
        } catch (err) {
          alert(err.message);
        }
      };

      const tdAction = document.createElement("td");
      tdAction.appendChild(sel);
      const delBtn = document.createElement("button");
      delBtn.textContent = "Удалить";
      delBtn.onclick = async () => {
        if (!confirm("Удалить задачу?")) return;
        try {
          await apiFetch(`/api/todos/${t.id}`, { method: "DELETE" });
          fetchTasks();
        } catch (err) {
          alert(err.message);
        }
      };
      tdAction.appendChild(delBtn);

      tr.innerHTML = `
        <td>${t.text}</td>
        <td>${t.creator_name || "—"}</td>
        <td>${t.assignee_name || "—"}</td>
        <td>${formatDate(t.created_at)}</td>
        <td>${formatDate(t.due_date)}</td>
        <td>${t.completed ? "выполнена" : "активна"}</td>`;
      tr.appendChild(tdAction);
      tasksTbody.appendChild(tr);
    });
  }

  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(totalItems / parseInt(limitSelect.value)));
    pageInfoEl.textContent = `Стр. ${currentPage} из ${totalPages} (всего ${totalItems})`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
  }

  document.getElementById("logout-btn").addEventListener("click", () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    window.location.href = "/login.html";
  });

  document.getElementById("user-info").textContent = `Привет, ${username}! (admin)`;

  statusSelect.addEventListener("change", () => {
    currentPage = 1;
    fetchTasks();
  });
  limitSelect.addEventListener("change", () => {
    currentPage = 1;
    fetchTasks();
  });
  prevPageBtn.addEventListener("click", () => {
    if (currentPage > 1) {
      currentPage--;
      fetchTasks();
    }
  });
  nextPageBtn.addEventListener("click", () => {
    currentPage++;
    fetchTasks();
  });

  // --- Отчёты ---
  async function fetchReports() {
    const from = document.getElementById("report-from").value;
    const to = document.getElementById("report-to").value;
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    try {
      const data = await apiFetch(`/api/reports?${params}`);
      const t = data.totals;
      document.querySelector("#report-totals tbody").innerHTML =
        `<tr><td>${t.total}</td><td>${t.done || 0}</td><td>${t.in_progress || 0}</td><td>${t.fresh || 0}</td><td>${t.overdue || 0}</td></tr>`;
      const rows = data.byEngineer.map(e =>
        `<tr><td>${e.engineer}</td><td>${e.total}</td><td>${e.done || 0}</td><td>${e.overdue || 0}</td><td>${e.avg_hours ?? "—"}</td></tr>`
      ).join("");
      document.querySelector("#report-engineers tbody").innerHTML =
        rows || "<tr><td colspan='5'>Нет данных</td></tr>";
    } catch (err) {
      alert(err.message);
    }
  }

  document.getElementById("report-btn").addEventListener("click", fetchReports);

  fetchUsers().then(fetchTasks);
  fetchReports();
});
