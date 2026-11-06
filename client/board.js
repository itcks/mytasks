document.addEventListener("DOMContentLoaded", () => {
  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role") || "user";
  const username = localStorage.getItem("username") || "";
  const userId = Number(localStorage.getItem("userId") || 0);

  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  const STATUS_LABELS = { new: "Новые", in_progress: "В работе", done: "Выполнена", rejected: "Отклонена" };
  const STATUSES = ["new", "in_progress", "done", "rejected"];
  const PRIORITY_LABELS = { low: "Низкий", medium: "Средний", high: "Высокий" };
  const board = document.getElementById("board");
  let tasks = [];

  function authHeaders() {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    };
  }

  async function apiFetch(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...authHeaders(), ...(options.headers || {}) } });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Ошибка запроса");
    }
    return res.json();
  }

  async function moveTask(task, newStatus) {
    try {
      await apiFetch(`/api/todos/${task.id}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus })
      });
      loadTasks();
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadTasks() {
    tasks = [];
    // Загружаем по статусам без лимита
    for (const s of STATUSES) {
      const data = await apiFetch(`/api/todos?limit=100&status=${s}`);
      tasks.push(...data.items);
    }
    render();
  }

  function setupTouchDrag(card, task) {
    let ghost = null;
    let startX = 0, startY = 0;
    let timer = null;
    let dragging = false;

    function endDrag(cancelled) {
      clearTimeout(timer);
      document.removeEventListener("touchmove", onMove, { passive: false });
      document.removeEventListener("touchend", onEnd);
      card.classList.remove("dragging");
      if (ghost) {
        ghost.remove();
        ghost = null;
      }
      document.querySelectorAll(".board-col.over").forEach(c => c.classList.remove("over"));
      if (!dragging) return;
      dragging = false;
      if (cancelled) return;
      const colEl = document.elementFromPoint(lastX, lastY)?.closest(".board-col");
      if (colEl && colEl.dataset.status && colEl.dataset.status !== task.status) {
        moveTask(task, colEl.dataset.status);
      }
    }

    let lastX = 0, lastY = 0;
    function onMove(e) {
      const t = e.touches[0];
      lastX = t.clientX;
      lastY = t.clientY;
      if (!dragging) {
        if (Math.abs(t.clientX - startX) > 10 || Math.abs(t.clientY - startY) > 10) {
          endDrag(true);
        }
        return;
      }
      e.preventDefault();
      ghost.style.left = (t.clientX - ghost.offsetWidth / 2) + "px";
      ghost.style.top = (t.clientY - 20) + "px";
      document.querySelectorAll(".board-col").forEach(c => {
        c.classList.toggle("over", c === document.elementFromPoint(lastX, lastY)?.closest(".board-col"));
      });
    }

    function onEnd() {
      endDrag(false);
    }

    card.addEventListener("touchstart", e => {
      const t = e.touches[0];
      startX = t.clientX;
      startY = t.clientY;
      timer = setTimeout(() => {
        dragging = true;
        card.classList.add("dragging");
        ghost = card.cloneNode(true);
        ghost.className = "card ghost";
        ghost.style.cssText = `position:fixed;left:${t.clientX}px;top:${t.clientY}px;width:${card.offsetWidth}px;pointer-events:none;z-index:1000;box-shadow:0 8px 20px rgba(0,0,0,.3);margin:0;`;
        document.body.appendChild(ghost);
        if (navigator.vibrate) navigator.vibrate(30);
      }, 250);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
    }, { passive: true });
  }

  function render() {
    board.innerHTML = "";
    for (const s of STATUSES) {
      const col = document.createElement("div");
      col.className = "board-col";
      col.dataset.status = s;
      const head = document.createElement("h3");
      head.textContent = `${STATUS_LABELS[s]} (${tasks.filter(t => t.status === s).length})`;
      col.appendChild(head);

      tasks.filter(t => t.status === s).forEach(t => {
        const card = document.createElement("div");
        card.className = "card prio-" + t.priority;
        card.draggable = true;
        card.dataset.id = t.id;
        let html = `<strong>${t.text}</strong>`;
        const bits = [];
        if (t.assignee_name) bits.push(t.assignee_name);
        if (t.tag) bits.push(t.tag);
        if (bits.length) html += `<div class="card-meta">${bits.map(b => b).join(" · ")}</div>`;
        if (t.priority !== "medium") html += `<div class="card-meta">${PRIORITY_LABELS[t.priority]}</div>`;
        if (t.due_date) html += `<div class="card-meta">⏰ ${new Date(String(t.due_date).replace(' ', 'T')).toLocaleString()}</div>`;
        card.innerHTML = html;
        card.addEventListener("dragstart", e => {
          e.dataTransfer.setData("text/plain", t.id);
          card.classList.add("dragging");
        });
        card.addEventListener("dragend", () => card.classList.remove("dragging"));

        // Кнопки переноса между колонками (надёжнее на мобильных)
        const moveRow = document.createElement("div");
        moveRow.className = "card-move";
        const idx = STATUSES.indexOf(s);
        if (idx > 0) {
          const left = document.createElement("button");
          left.textContent = "← " + STATUS_LABELS[STATUSES[idx - 1]];
          left.onclick = () => moveTask(t, STATUSES[idx - 1]);
          moveRow.appendChild(left);
        }
        if (idx < STATUSES.length - 1) {
          const right = document.createElement("button");
          right.textContent = STATUS_LABELS[STATUSES[idx + 1]] + " →";
          right.onclick = () => moveTask(t, STATUSES[idx + 1]);
          moveRow.appendChild(right);
        }
        if (moveRow.children.length) card.appendChild(moveRow);

        setupTouchDrag(card, t);
        col.appendChild(card);
      });

      col.addEventListener("dragover", e => {
        e.preventDefault();
        col.classList.add("over");
      });
      col.addEventListener("dragleave", () => col.classList.remove("over"));
      col.addEventListener("drop", async e => {
        e.preventDefault();
        col.classList.remove("over");
        const id = e.dataTransfer.getData("text/plain");
        const task = tasks.find(t => String(t.id) === id);
        if (!task || task.status === s) return;
        try {
          await apiFetch(`/api/todos/${id}`, {
            method: "PUT",
            body: JSON.stringify({ status: s })
          });
          loadTasks();
        } catch (err) {
          alert(err.message);
        }
      });

      board.appendChild(col);
    }
  }

  document.getElementById("logout-btn").addEventListener("click", () => {
    localStorage.removeItem("token");
    localStorage.removeItem("role");
    localStorage.removeItem("username");
    localStorage.removeItem("userId");
    window.location.href = "/login.html";
  });
  document.getElementById("back-btn").addEventListener("click", () => {
    window.location.href = "/index.html";
  });
  document.getElementById("user-info").textContent = `Привет, ${username}! (${role})`;

  loadTasks();
});
