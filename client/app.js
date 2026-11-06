document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("todo-form");
  const input = document.getElementById("todo-input");
  const planDateInput = document.getElementById("todo-plan-date");
  const dueDateInput = document.getElementById("todo-due-date");
  const prioritySelect = document.getElementById("todo-priority");
  const tagInput = document.getElementById("todo-tag");
  const repeatSelect = document.getElementById("todo-repeat");
  const assigneeSelect = document.getElementById("todo-assignee");
  const assigneeField = document.getElementById("assignee-field");
  const list = document.getElementById("todo-list");
  const sortSelect = document.getElementById("sort-select");
  const statusSelect = document.getElementById("status-select");
  const priorityFilter = document.getElementById("priority-filter");
  const tagFilter = document.getElementById("tag-filter");
  const searchInput = document.getElementById("search-input");
  const limitSelect = document.getElementById("limit-select");
  const calendarEl = document.getElementById("calendar");
  const prevPageBtn = document.getElementById("prev-page");
  const nextPageBtn = document.getElementById("next-page");
  const pageInfoEl = document.getElementById("page-info");
  const notifBtn = document.getElementById("notif-btn");
  const notifBadge = document.getElementById("notif-badge");
  const notifPanel = document.getElementById("notif-panel");
  const notifList = document.getElementById("notif-list");
  const notifReadBtn = document.getElementById("notif-read-btn");

  const modal = document.getElementById("modal");
  const commentInput = document.getElementById("comment-input");
  const completeBtn = document.getElementById("complete-btn");

  const editModal = document.getElementById("edit-modal");
  const editText = document.getElementById("edit-text");
  const editPlan = document.getElementById("edit-plan");
  const editDue = document.getElementById("edit-due");
  const editPriority = document.getElementById("edit-priority");
  const editTag = document.getElementById("edit-tag");
  const editRepeat = document.getElementById("edit-repeat");
  const editSaveBtn = document.getElementById("edit-save-btn");

  const infoModal = document.getElementById("info-modal");
  const attachList = document.getElementById("attach-list");
  const attachInput = document.getElementById("attach-input");
  const historyList = document.getElementById("history-list");

  const errorEl = document.getElementById("error-message") || null;

  const STATUS_LABELS = { new: "Новая", in_progress: "В работе", done: "Выполнена", rejected: "Отклонена" };
  const PRIORITY_LABELS = { low: "Низкий", medium: "Средний", high: "Высокий" };

  let currentTaskId = null;
  let editTaskId = null;
  let infoTaskId = null;
  let todos = [];
  let users = [];
  let currentToken = localStorage.getItem("token") || "";
  let currentRole = localStorage.getItem("role") || "user";
  const username = localStorage.getItem("username") || "";
  let currentPage = 1;
  let totalItems = 0;
  let calendarMonth = new Date();
  calendarMonth.setDate(1);
  let searchTimer = null;

  function showError(message) {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = "block";
    } else {
      alert(message);
    }
  }

  function authHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentToken}`
    };
  }

  async function apiFetch(url, options = {}) {
    const res = await fetch(url, {
      ...options,
      headers: { ...authHeaders(), ...(options.headers || {}) }
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Ошибка запроса");
    }
    return res.json();
  }

  async function fetchTodos() {
    try {
      const status = statusSelect.value;
      const params = new URLSearchParams({
        page: currentPage,
        limit: limitSelect.value,
        sort: sortSelect.value === "created_at" ? "created" : (sortSelect.value === "due_date" ? "due" : "priority")
      });
      if (["done", "all", "new", "in_progress", "rejected"].includes(status)) params.set("status", status);
      if (priorityFilter.value) params.set("priority", priorityFilter.value);
      if (tagFilter.value.trim()) params.set("tag", tagFilter.value.trim());
      if (searchInput.value.trim()) params.set("q", searchInput.value.trim());
      const data = await apiFetch(`/api/todos?${params}`);
      todos = data.items;
      totalItems = data.total;
      renderTodos();
      renderCalendar();
      renderPagination();
    } catch (err) {
      showError(err.message || "Не удалось загрузить задачи");
      console.error(err);
    }
  }

  async function fetchUsers() {
    if (currentRole !== "admin") return;
    try {
      users = await apiFetch("/api/users");
      assigneeSelect.innerHTML = '<option value="">— не назначен —</option>';
      users
        .filter(u => u.role === "engineer" || u.role === "admin")
        .forEach(u => {
          const opt = document.createElement("option");
          opt.value = u.id;
          opt.textContent = u.username;
          assigneeSelect.appendChild(opt);
        });
      assigneeSelect.style.display = "";
      assigneeField.style.display = "";
    } catch (err) {
      console.error(err);
    }
  }

  async function addTodo(todo) {
    return await apiFetch("/api/todos", {
      method: "POST",
      body: JSON.stringify({
        text: todo.text,
        createdAt: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
        dueDate: todo.dueDate || null,
        planDate: todo.planDate || null,
        priority: todo.priority,
        tag: todo.tag || null,
        repeatRule: todo.repeatRule,
        assignedTo: todo.assignedTo || undefined
      })
    });
  }

  async function updateTodo(id, updates) {
    try {
      return await apiFetch(`/api/todos/${id}`, {
        method: "PUT",
        body: JSON.stringify(updates)
      });
    } catch (err) {
      showError(err.message || "Не удалось обновить задачу");
      console.error(err);
    }
  }

  async function deleteTodo(id) {
    try {
      return await apiFetch(`/api/todos/${id}`, { method: "DELETE" });
    } catch (err) {
      showError(err.message || "Не удалось удалить задачу");
      console.error(err);
    }
  }

  // --- Уведомления ---
  async function fetchNotifications() {
    if (!currentToken) return;
    try {
      const data = await apiFetch("/api/notifications");
      if (data.unread > 0) {
        notifBadge.textContent = data.unread;
        notifBadge.style.display = "";
      } else {
        notifBadge.style.display = "none";
      }
      notifList.innerHTML = "";
      data.items.forEach(n => {
        const li = document.createElement("li");
        li.className = n.read ? "" : "unread";
        const typeIcon = { assigned: "👤", status: "🔄", reminder: "⏰", overdue: "⚠️" }[n.type] || "💬";
        li.innerHTML = `${typeIcon} ${n.text}<br><small>${new Date(String(n.created_at).replace(' ', 'T')).toLocaleString()}</small>`;
        li.onclick = () => {
          notifPanel.style.display = "none";
          if (n.task_id) {
            currentPage = 1;
            fetchTodos().then(() => jumpToTask(n.task_id));
          }
        };
        notifList.appendChild(li);
      });
    } catch (err) {
      console.error(err);
    }
  }

  notifBtn.addEventListener("click", () => {
    notifPanel.style.display = notifPanel.style.display === "none" ? "block" : "none";
    if (notifPanel.style.display === "block") fetchNotifications();
  });

  notifReadBtn.addEventListener("click", async () => {
    await apiFetch("/api/notifications/read", { method: "POST" });
    fetchNotifications();
  });

  // --- Рендер списка ---
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function truncate(text, len) {
    return text.length > len ? text.slice(0, len) + "…" : text;
  }

  function jumpToTask(taskId) {
    const el = list.querySelector(`[data-task-id="${taskId}"]`);
    if (el) {
      document.querySelectorAll("li.highlight").forEach(x => x.classList.remove("highlight"));
      el.classList.add("highlight");
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => el.classList.remove("highlight"), 3000);
    }
  }

  function renderTodos() {
    list.innerHTML = "";

    todos.forEach((todo) => {
      const li = document.createElement("li");
      li.className = todo.completed ? "completed" : "";
      li.dataset.taskId = todo.id;

      const now = new Date();
      const dueDate = todo.due_date ? new Date(String(todo.due_date).replace(' ', 'T')) : null;

      if (!todo.completed) {
        if (dueDate && dueDate > now && (dueDate - now) < 24 * 60 * 60 * 1000) {
          li.style.backgroundColor = "#fff8dc";
        }
        if (dueDate && dueDate < now) {
          li.classList.add("overdue");
        }
      }

      const top = document.createElement("div");
      top.className = "todo-top";
      const taskText = document.createElement("strong");
      taskText.textContent = todo.text;
      top.appendChild(taskText);

      const chips = document.createElement("span");
      chips.className = "chips";
      let chipsHtml = `<span class="chip status-${todo.status}">${STATUS_LABELS[todo.status] || todo.status}</span>`;
      if (todo.priority !== "medium") {
        chipsHtml += `<span class="chip prio-${todo.priority}">${PRIORITY_LABELS[todo.priority]}</span>`;
      }
      if (todo.tag) {
        chipsHtml += `<span class="chip tag">${escapeHtml(todo.tag)}</span>`;
      }
      if (todo.repeat_rule && todo.repeat_rule !== "none") {
        const rr = { daily: "🔁 день", weekly: "🔁 неделя", monthly: "🔁 месяц" }[todo.repeat_rule];
        chipsHtml += `<span class="chip">${rr}</span>`;
      }
      if (todo.attachments > 0) {
        chipsHtml += `<span class="chip">📎 ${todo.attachments}</span>`;
      }
      chips.innerHTML = chipsHtml;
      top.appendChild(chips);
      li.appendChild(top);

      const info = document.createElement("div");
      info.className = "todo-info";

      info.innerHTML = `Создано: ${formatDate(todo.created_at)}`;
      if (todo.plan_at) {
        info.innerHTML += ` | Задача на: ${formatDate(todo.plan_at)}`;
      }
      if (todo.due_date) {
        info.innerHTML += ` | Срок: ${formatDate(todo.due_date)}`;
      }
      info.innerHTML += ` | Автор: ${todo.creator_name || "—"}`;
      if (todo.assignee_name) {
        info.innerHTML += ` | Исполнитель: ${todo.assignee_name}`;
      }
      if (todo.completed_at) {
        info.innerHTML += ` | Завершено: ${formatDate(todo.completed_at)}`;
        if (todo.comment) {
          info.innerHTML += `<br><i>"${escapeHtml(todo.comment)}"</i>`;
        }
      }
      li.appendChild(info);

      const actions = document.createElement("div");
      actions.className = "actions";

      // Смена статуса
      const statusSel = document.createElement("select");
      Object.entries(STATUS_LABELS).forEach(([val, label]) => {
        const opt = document.createElement("option");
        opt.value = val;
        opt.textContent = label;
        if (todo.status === val) opt.selected = true;
        statusSel.appendChild(opt);
      });
      statusSel.onchange = () => {
        const upd = { status: statusSel.value };
        if (statusSel.value === "done") {
          modal.style.display = "block";
          currentTaskId = todo.id;
          return;
        }
        updateTodo(todo.id, upd).then(() => fetchTodos());
      };
      actions.appendChild(statusSel);

      // Редактирование — владелец или админ
      if (currentRole === "admin" || todo.user_id === Number(localStorage.getItem("userId") || 0)) {
        const editBtn = document.createElement("button");
        editBtn.textContent = "✎";
        editBtn.title = "Редактировать";
        editBtn.onclick = () => openEditModal(todo);
        actions.appendChild(editBtn);
      }

      // Детали (история + вложения)
      const infoBtn = document.createElement("button");
      infoBtn.textContent = "ℹ";
      infoBtn.title = "История и вложения";
      infoBtn.onclick = () => openInfoModal(todo);
      actions.appendChild(infoBtn);

      if (currentRole === "admin") {
        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "🗑";
        deleteBtn.title = "Удалить";
        deleteBtn.onclick = () => {
          if (confirm("Удалить задачу?")) {
            deleteTodo(todo.id).then(() => fetchTodos());
          }
        };
        actions.appendChild(deleteBtn);
      }

      li.appendChild(actions);
      list.appendChild(li);
    });
  }

  function formatDate(dateString) {
    if (!dateString) return "—";
    const date = new Date(String(dateString).replace(' ', 'T'));
    return isNaN(date.getTime()) ? "Неверная дата" : date.toLocaleString();
  }

  function toInputValue(s) {
    if (!s) return "";
    const d = new Date(String(s).replace(' ', 'T'));
    if (isNaN(d.getTime())) return "";
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // --- Редактирование ---
  function openEditModal(todo) {
    editTaskId = todo.id;
    editText.value = todo.text;
    editPlan.value = toInputValue(todo.plan_at);
    editDue.value = toInputValue(todo.due_date);
    editPriority.value = todo.priority || "medium";
    editTag.value = todo.tag || "";
    editRepeat.value = todo.repeat_rule || "none";
    editModal.style.display = "block";
  }

  editSaveBtn.addEventListener("click", async () => {
    if (!editTaskId) return;
    await updateTodo(editTaskId, {
      text: editText.value,
      planDate: editPlan.value ? editPlan.value.replace('T', ' ') + ':00' : null,
      dueDate: editDue.value ? editDue.value.replace('T', ' ') + ':00' : null,
      priority: editPriority.value,
      tag: editTag.value.trim() || null,
      repeatRule: editRepeat.value
    });
    editModal.style.display = "none";
    editTaskId = null;
    fetchTodos();
  });

  // --- Детали задачи: вложения и история ---
  function openInfoModal(todo) {
    infoTaskId = todo.id;
    infoModal.style.display = "block";
    loadAttachments();
    loadHistory();
  }

  async function loadAttachments() {
    attachList.innerHTML = "";
    try {
      const items = await apiFetch(`/api/todos/${infoTaskId}/attachments`);
      if (!items.length) {
        attachList.innerHTML = "<li class='muted'>Нет вложений</li>";
      }
      items.forEach(a => {
        const li = document.createElement("li");
        const link = document.createElement("a");
        link.href = `/api/attachments/${a.id}`;
        link.textContent = `${a.filename} (${Math.round(a.size / 1024)} КБ)`;
        link.target = "_blank";
        li.appendChild(link);
        attachList.appendChild(li);
      });
    } catch (err) {
      attachList.innerHTML = `<li class='muted'>${escapeHtml(err.message)}</li>`;
    }
  }

  attachInput.addEventListener("change", async () => {
    const file = attachInput.files[0];
    if (!file || !infoTaskId) return;
    if (file.size > 10 * 1024 * 1024) {
      alert("Файл больше 10 МБ");
      return;
    }
    const buf = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    try {
      await apiFetch(`/api/todos/${infoTaskId}/attachments`, {
        method: "POST",
        body: JSON.stringify({ filename: file.name, mime: file.type, dataBase64: base64 })
      });
      attachInput.value = "";
      loadAttachments();
      fetchTodos();
    } catch (err) {
      alert(err.message);
    }
  });

  async function loadHistory() {
    historyList.innerHTML = "";
    try {
      const items = await apiFetch(`/api/todos/${infoTaskId}/history`);
      items.forEach(h => {
        const li = document.createElement("li");
        li.innerHTML = `<small>${new Date(String(h.created_at).replace(' ', 'T')).toLocaleString()} — ${escapeHtml(h.username || "система")}</small><br>${escapeHtml(h.details || h.action)}`;
        historyList.appendChild(li);
      });
    } catch (err) {
      historyList.innerHTML = `<li class='muted'>${escapeHtml(err.message)}</li>`;
    }
  }

  // --- Календарь ---
  function renderCalendar() {
    if (!calendarEl) return;
    const year = calendarMonth.getFullYear();
    const month = calendarMonth.getMonth();
    const today = new Date();

    const monthNames = [
      "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
      "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
    ];

    const byDay = {};
    todos.forEach(t => {
      if (!t.due_date || t.completed || t.status === 'done') return;
      const d = new Date(String(t.due_date).replace(' ', 'T'));
      if (d.getFullYear() === year && d.getMonth() === month) {
        const day = d.getDate();
        (byDay[day] = byDay[day] || []).push(t);
      }
    });

    const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    let html = `<div class="calendar-header">
      <button id="cal-prev">&laquo;</button>
      <strong>${monthNames[month]} ${year}</strong>
      <button id="cal-next">&raquo;</button>
    </div><table class="calendar-table"><tr><th>Пн</th><th>Вт</th><th>Ср</th><th>Чт</th><th>Пт</th><th>Сб</th><th>Вс</th></tr><tr>`;

    for (let i = 0; i < firstWeekday; i++) html += "<td></td>";

    for (let day = 1; day <= daysInMonth; day++) {
      const isToday = today.getFullYear() === year && today.getMonth() === month && today.getDate() === day;
      const cls = [
        isToday ? "today" : "",
        byDay[day] ? "has-tasks" : ""
      ].filter(Boolean).join(" ");
      let tasksHtml = "";
      if (byDay[day]) {
        tasksHtml = byDay[day].slice(0, 2).map(t =>
          `<div class="cal-task prio-${t.priority}" data-task-id="${t.id}" title="${escapeHtml(t.text)}">${escapeHtml(truncate(t.text, 10))}</div>`
        ).join("");
        const rest = byDay[day].length - 2;
        if (rest > 0) tasksHtml += `<div class="cal-count">+${rest}</div>`;
      }
      html += `<td class="${cls}">${day}${tasksHtml}</td>`;
      if ((firstWeekday + day) % 7 === 0 && day < daysInMonth) html += "</tr><tr>";
    }
    html += "</tr></table>";

    calendarEl.innerHTML = html;

    calendarEl.querySelectorAll(".cal-task").forEach(el => {
      el.onclick = () => jumpToTask(el.dataset.taskId);
    });
    document.getElementById("cal-prev").onclick = () => {
      calendarMonth.setMonth(calendarMonth.getMonth() - 1);
      renderCalendar();
    };
    document.getElementById("cal-next").onclick = () => {
      calendarMonth.setMonth(calendarMonth.getMonth() + 1);
      renderCalendar();
    };
  }

  function renderPagination() {
    const totalPages = Math.max(1, Math.ceil(totalItems / parseInt(limitSelect.value)));
    pageInfoEl.textContent = `Стр. ${currentPage} из ${totalPages} (всего ${totalItems})`;
    prevPageBtn.disabled = currentPage <= 1;
    nextPageBtn.disabled = currentPage >= totalPages;
  }

  // --- Обработчики ---

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const planDate = planDateInput.value ? planDateInput.value.replace('T', ' ') + ':00' : null;
    const dueDate = dueDateInput.value ? dueDateInput.value.replace('T', ' ') + ':00' : null;
    const assignedTo = assigneeField.style.display !== "none" ? assigneeSelect.value : undefined;

    if (text !== "") {
      const savedTodo = await addTodo({
        text, dueDate, planDate,
        priority: prioritySelect.value,
        tag: tagInput.value.trim(),
        repeatRule: repeatSelect.value,
        assignedTo
      });
      if (savedTodo) {
        input.value = "";
        planDateInput.value = "";
        dueDateInput.value = "";
        tagInput.value = "";
        fetchTodos();
      }
    }
  });

  completeBtn.addEventListener("click", async () => {
    const comment = commentInput.value.trim();
    if (currentTaskId) {
      await updateTodo(currentTaskId, {
        status: "done",
        comment,
        completedAt: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
      });
      modal.style.display = "none";
      commentInput.value = "";
      currentTaskId = null;
      fetchTodos();
    }
  });

  document.querySelectorAll(".close").forEach(btn => {
    btn.addEventListener("click", () => {
      document.getElementById(btn.dataset.modal).style.display = "none";
    });
  });

  sortSelect.addEventListener("change", fetchTodos);
  statusSelect.addEventListener("change", () => { currentPage = 1; fetchTodos(); });
  priorityFilter.addEventListener("change", () => { currentPage = 1; fetchTodos(); });
  limitSelect.addEventListener("change", () => { currentPage = 1; fetchTodos(); });
  tagFilter.addEventListener("change", () => { currentPage = 1; fetchTodos(); });
  searchInput.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { currentPage = 1; fetchTodos(); }, 300);
  });
  prevPageBtn.addEventListener("click", () => { if (currentPage > 1) { currentPage--; fetchTodos(); } });
  nextPageBtn.addEventListener("click", () => { currentPage++; fetchTodos(); });

  // --- Страницы входа ---
  const registerForm = document.getElementById("register-form");
  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("reg-username").value;
    const password = document.getElementById("reg-password").value;
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Ошибка регистрации");
      }
      alert("Регистрация успешна! Теперь войдите.");
      window.location.href = "/login.html";
    } catch (err) {
      showError(err.message);
    }
  });

  const loginForm = document.getElementById("login-form");
  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!res.ok) throw new Error("Неверное имя пользователя или пароль");
      const data = await res.json();
      currentToken = data.token;
      currentRole = data.role;
      localStorage.setItem("token", data.token);
      localStorage.setItem("role", data.role);
      localStorage.setItem("username", username);
      const me = await apiFetch("/api/users").catch(() => []);
      const meUser = me.find(u => u.username === username);
      if (meUser) localStorage.setItem("userId", meUser.id);
      window.location.href = "/index.html";
    } catch (err) {
      showError(err.message);
    }
  });

  // --- index.html ---
  if (window.location.pathname.endsWith("index.html") || window.location.pathname === "/") {
    if (!currentToken) {
      window.location.href = "/login.html";
    } else {
      const boardBtn = document.getElementById("board-btn");
      boardBtn.addEventListener("click", () => { window.location.href = "/board.html"; });

      if (currentRole === "admin") {
        const adminBtn = document.getElementById("admin-btn");
        adminBtn.style.display = "";
        adminBtn.addEventListener("click", () => { window.location.href = "/admin.html"; });
      }

      fetchUsers().then(fetchTodos);
      fetchNotifications();
      setInterval(fetchNotifications, 30000);

      document.getElementById("logout-btn").addEventListener("click", () => {
        localStorage.removeItem("token");
        localStorage.removeItem("role");
        localStorage.removeItem("username");
        localStorage.removeItem("userId");
        window.location.href = "/login.html";
      });

      const userInfoEl = document.getElementById("user-info");
      if (userInfoEl && username) {
        userInfoEl.textContent = `Привет, ${username}! (${currentRole})`;
      }
    }
  }
});
