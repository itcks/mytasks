(function () {
  const KEY = "theme";

  function auto() {
    const h = new Date().getHours();
    return (h >= 20 || h < 7) ? "dark" : "light";
  }

  function apply(t) {
    document.documentElement.dataset.theme = t;
  }

  apply(localStorage.getItem(KEY) || auto());

  window.addEventListener("DOMContentLoaded", () => {
    const btn = document.getElementById("theme-toggle");
    if (!btn) return;

    function current() {
      return document.documentElement.dataset.theme;
    }

    function label() {
      btn.textContent = current() === "dark" ? "☀ День" : "🌙 Ночь";
    }

    btn.addEventListener("click", () => {
      const next = current() === "dark" ? "light" : "dark";
      apply(next);
      localStorage.setItem(KEY, next);
      label();
    });

    label();
  });

  // Автоперевод по времени суток, если пользователь не выбирал вручную
  setInterval(() => {
    if (!localStorage.getItem(KEY)) apply(auto());
  }, 60 * 1000);
})();
