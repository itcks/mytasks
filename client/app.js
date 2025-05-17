document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("todo-form");
  const input = document.getElementById("todo-input");
  const dueDateInput = document.getElementById("todo-due-date");
  const list = document.getElementById("todo-list");
  const sortSelect = document.getElementById("sort-select");
  const modal = document.getElementById("modal");
  const commentInput = document.getElementById("comment-input");
  const completeBtn = document.getElementById("complete-btn");
  const closeBtn = document.querySelector(".close");

  const registerForm = document.getElementById("register-form") || null;
  const loginForm = document.getElementById("login-form") || null;

  let currentTaskIndex = null;
  let currentTaskId = null;
  let todos = [];
  let currentToken = localStorage.getItem("token") || "";
  const username = localStorage.getItem("username") || "";

  // Элементы для отображения ошибок
  const errorEl = document.getElementById("error-message") || null;
  const userInfoEl = document.getElementById("user-info") || null;

  function showError(message) {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.style.display = "block";
    } else {
      alert(message);
    }
  }

  function hideError() {
    if (errorEl) errorEl.style.display = "none";
  }

  function setAuthHeader() {
    return {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${currentToken}`
      }
    };
  }

  async function fetchTodos() {
    try {
      const res = await fetch("/api/todos", setAuthHeader());
      if (!res.ok) throw new Error("Ошибка загрузки задач");
      todos = await res.json();
      renderTodos();
    } catch (err) {
      showError("Не удалось загрузить задачи");
      console.error(err);
    }
  }

  async function addTodo(todo) {
    const token = localStorage.getItem("token");
    const response = await fetch("/api/todos", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({
        text: todo.text,
        createdAt: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''),
        dueDate: todo.dueDate || null
      })
    });

    return await response.json(); // Сервер вернёт полный объект с датами
  }

  async function updateTodo(id, updates) {
    try {
      const res = await fetch(`/api/todos/${id}`, {
        ...setAuthHeader(),
        method: "PUT",
        body: JSON.stringify(updates)
      });
      if (!res.ok) throw new Error("Ошибка обновления задачи");
      return await res.json();
    } catch (err) {
      showError("Не удалось обновить задачу");
      console.error(err);
    }
  }

  async function deleteTodo(id) {
    try {
      const res = await fetch(`/api/todos/${id}`, {
        ...setAuthHeader(),
        method: "DELETE"
      });
      if (!res.ok) throw new Error("Ошибка удаления задачи");
      return await res.json();
    } catch (err) {
      showError("Не удалось удалить задачу");
      console.error(err);
    }
  }

  async function registerUser(username, password) {
    try {
      const res = await fetch("/api/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!res.ok) throw new Error("Ошибка регистрации");
      const data = await res.json();
      return data;
    } catch (err) {
      showError("Ошибка регистрации");
      console.error(err);
    }
  }

  async function loginUser(username, password) {
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password })
      });
      if (!res.ok) throw new Error("Ошибка входа");
      const data = await res.json();
      return data.token;
    } catch (err) {
      showError("Неверное имя пользователя или пароль");
      console.error(err);
    }
  }

  function saveToken(token, username) {
    currentToken = token;
    localStorage.setItem("token", token);
    localStorage.setItem("username", username);
    window.location.href = "/index.html";
  }

  function logoutUser() {
    currentToken = "";
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    window.location.href = "/login.html";
  }

  function formatDate(dateString) {
    if (!dateString) return "—";

    const date = new Date(dateString.replace(' ', 'T'));
    return isNaN(date.getTime()) ? "Неверная дата" : date.toLocaleString();
  }

  function renderTodos() {
    list.innerHTML = "";
    const sortBy = sortSelect.value;

    // Локальная сортировка
    todos.sort((a, b) => {
      const aDate = new Date(a[sortBy]?.replace(' ', 'T') || Infinity);
      const bDate = new Date(b[sortBy]?.replace(' ', 'T') || Infinity);
      return aDate - bDate;
    });

    todos.forEach((todo, index) => {
      const li = document.createElement("li");
      li.className = todo.completed ? "completed" : "";

      const now = new Date();
      const createdAt = new Date(todo.created_at?.replace(' ', 'T'));
      const dueDate = todo.due_date ? new Date(todo.due_date?.replace(' ', 'T')) : null;

      // Цветовая индикация
      if (!todo.completed) {
        if ((now - createdAt) < 24 * 60 * 60 * 1000) {
          li.style.backgroundColor = "#e6ffe6"; // зелёный
        }
        if (dueDate && !todo.completed && dueDate > now && (dueDate - now) < 24 * 60 * 60 * 1000) {
          li.style.backgroundColor = "#fff8dc"; // жёлтый
        }
        if (dueDate && dueDate < now) {
          li.classList.add("overdue"); // красный стиль
        }
      }

      const taskText = document.createElement("strong");
      taskText.textContent = todo.text;

      const info = document.createElement("div");
      info.className = "todo-info";

      info.innerHTML = `Создано: ${formatDate(todo.created_at)}`;
      if (todo.due_date) {
        info.innerHTML += ` | Срок: ${formatDate(todo.due_date)}`;
      }
      if (todo.completed_at) {
        info.innerHTML += ` | Завершено: ${formatDate(todo.completed_at)}`;
        if (todo.comment) {
          info.innerHTML += `<br><i>"${todo.comment}"</i>`;
        }
      }

      const actions = document.createElement("div");
      actions.className = "actions";

      const toggleBtn = document.createElement("button");
      toggleBtn.textContent = todo.completed ? "Отменить" : "Готово";
      toggleBtn.onclick = () => {
        if (todo.completed) {
          updateTodo(todo.id, { completed: false }).then(() => fetchTodos());
        } else {
          modal.style.display = "block";
          currentTaskId = todo.id;
          currentTaskIndex = index;
        }
      };

      const deleteBtn = document.createElement("button");
      deleteBtn.textContent = "Удалить";
      deleteBtn.onclick = () => {
        deleteTodo(todo.id).then(() => fetchTodos());
      };

      actions.appendChild(toggleBtn);
      actions.appendChild(deleteBtn);

      li.appendChild(taskText);
      li.appendChild(document.createElement("br"));
      li.appendChild(info);
      li.appendChild(actions);

      list.appendChild(li);
    });
  }

  // --- Обработчики событий ---

  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    const dueDate = dueDateInput.value;

    if (text !== "") {
      const newTodo = {
        text,
        dueDate
      };

      const savedTodo = await addTodo(newTodo);
      if (savedTodo) {
        todos.push(savedTodo); // ✅ Сохранённый объект уже содержит даты от сервера
        input.value = "";
        dueDateInput.value = "";
        fetchTodos(); // ✅ Получаем актуальные данные с датами
      }
    }
  });

  completeBtn?.addEventListener("click", async () => {
    const comment = commentInput.value.trim();
    if (currentTaskId) {
      await updateTodo(currentTaskId, {
        completed: true,
        comment,
        completedAt: new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')
      });
      modal.style.display = "none";
      commentInput.value = "";
      currentTaskId = null;
      fetchTodos(); // ✅ Обновляем список с сервера
    }
  });

  closeBtn?.addEventListener("click", () => {
    modal.style.display = "none";
  });

  sortSelect?.addEventListener("change", () => {
    renderTodos(); // ✅ Пересортировываем локально
  });

  registerForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();
    const username = document.getElementById("reg-username").value;
    const password = document.getElementById("reg-password").value;
    const result = await registerUser(username, password);
    if (result) {
      alert("Регистрация успешна! Теперь войдите.");
      window.location.href = "/login.html";
    }
  });

  loginForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    hideError();
    const username = document.getElementById("login-username").value;
    const password = document.getElementById("login-password").value;
    const token = await loginUser(username, password);
    if (token) {
      saveToken(token, username);
    }
  });

  // --- Проверка доступа к index.html ---
  if (window.location.pathname.endsWith("index.html")) {
    const token = localStorage.getItem("token");
    if (!token) {
      window.location.href = "/login.html";
    } else {
      fetchTodos();

      const logoutBtn = document.getElementById("logout-btn");
      const userInfoEl = document.getElementById("user-info");

      if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
          logoutUser();
        });
      }

      if (userInfoEl) {
        const storedUsername = localStorage.getItem("username");
        if (storedUsername) {
          userInfoEl.textContent = `Привет, ${storedUsername}!`;
        }
      }
    }
  }
});