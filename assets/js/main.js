(function () {
  const MONTHS_NO = [
    "jan", "feb", "mar", "apr", "mai", "jun",
    "jul", "aug", "sep", "okt", "nov", "des",
  ];

  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function $$(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function formatDate(iso) {
    const d = new Date(iso + "T12:00:00");
    return {
      day: String(d.getDate()).padStart(2, "0"),
      month: MONTHS_NO[d.getMonth()],
      year: d.getFullYear(),
      weekday: d.toLocaleDateString("nb-NO", { weekday: "short" }),
    };
  }

  function setCurrentNav() {
    const path = location.pathname.split("/").pop() || "index.html";
    $$(".nav a").forEach((a) => {
      const href = a.getAttribute("href");
      if (href === path || (path === "" && href === "index.html")) {
        a.setAttribute("aria-current", "page");
      }
    });
  }

  function initNav() {
    const toggle = $(".nav-toggle");
    const nav = $("#site-nav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", () => {
      const open = nav.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
  }

  async function loadJSON(path) {
    const res = await fetch(path);
    if (!res.ok) throw new Error("Kunne ikke hente " + path);
    return res.json();
  }

  function isUpcoming(m) {
    return m.status === "NS" || m.status === "TBD";
  }

  function isFinished(m) {
    return m.status === "FT";
  }

  function sortMatches(matches) {
    return [...matches].sort((a, b) => {
      const da = a.date + (a.kickoff || "");
      const db = b.date + (b.kickoff || "");
      return da.localeCompare(db);
    });
  }

  function renderScorers(m) {
    if (!m.scorers || !m.scorers.length) return "";
    const lines = m.scorers
      .map((s) => {
        const side = s.team === "home" ? m.home : m.away;
        return `${s.player} (${side}) ${s.minute}'`;
      })
      .join(" · ");
    return `<p><strong>Mål:</strong> ${lines}</p>`;
  }

  function renderStats(m) {
    if (!m.stats) return "";
    const s = m.stats;
    return `<p><strong>Statistikk:</strong> Ballbesittelse ${s.possession.home}–${s.possession.away} · Skudd ${s.shots.home}–${s.shots.away} · På mål ${s.shotsOnTarget.home}–${s.shotsOnTarget.away} · Corners ${s.corners.home}–${s.corners.away}</p>`;
  }

  function matchRow(m, { expandable = false } = {}) {
    const d = formatDate(m.date);
    const finished = isFinished(m);
    const score = finished && m.score ? `${m.score.home}–${m.score.away}` : "–";
    const detail =
      expandable && finished
        ? `<div class="match-detail">${renderScorers(m)}${renderStats(m)}<p>${m.venue || ""}</p></div>
           <button type="button" class="match__toggle" data-toggle>Vis detaljer</button>`
        : "";

    return `<article class="match${finished ? " match--result" : ""}" data-comp="${m.competitionShort}">
      <div class="match__when">
        <strong>${d.day}. ${d.month}</strong>
        ${d.weekday} · ${m.kickoff || "TBD"}
      </div>
      <div>
        <div class="match__teams">${m.home} – ${m.away}</div>
        <div class="match__comp">${m.competition}${m.venue ? " · " + m.venue : ""}</div>
      </div>
      <div>
        <div class="match__score">${score}</div>
        <div class="match__status">${finished ? "Fullført" : "Planlagt"}</div>
      </div>
      ${detail}
    </article>`;
  }

  function bindExpandables(root) {
    $$("[data-toggle]", root).forEach((btn) => {
      btn.addEventListener("click", () => {
        const row = btn.closest(".match");
        const open = row.classList.toggle("is-open");
        btn.textContent = open ? "Skjul detaljer" : "Vis detaljer";
      });
    });
  }

  async function renderHomeMatches() {
    const el = $("#home-matches");
    if (!el) return;
    try {
      const data = await loadJSON("assets/data/fixtures.json");
      const upcoming = sortMatches(data.matches.filter(isUpcoming)).slice(0, 3);
      if (!upcoming.length) {
        el.innerHTML = `<p class="empty-state">Ingen kommende kamper i datafilen ennå.</p>`;
        return;
      }
      el.innerHTML = `<div class="match-list">${upcoming.map((m) => matchRow(m)).join("")}</div>`;
    } catch {
      el.innerHTML = `<p class="empty-state">Kunne ikke laste kamper.</p>`;
    }
  }

  async function renderHomeNews() {
    const el = $("#home-news");
    if (!el) return;
    try {
      const data = await loadJSON("assets/data/news.json");
      const posts = [...data.posts]
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 3);
      el.innerHTML = `<div class="news-list">${posts
        .map((p) => {
          const d = formatDate(p.date);
          return `<a class="news-item" href="nyheter.html#${p.id}">
            <div class="news-item__date">${d.day}. ${d.month} ${d.year}</div>
            <div>
              <h3>${p.title}</h3>
              <p>${p.excerpt}</p>
            </div>
          </a>`;
        })
        .join("")}</div>`;
    } catch {
      el.innerHTML = `<p class="empty-state">Kunne ikke laste nyheter.</p>`;
    }
  }

  async function renderFixturesPage() {
    const el = $("#fixtures-root");
    if (!el) return;
    const meta = $("#fixtures-updated");
    try {
      const data = await loadJSON("assets/data/fixtures.json");
      if (meta) meta.textContent = `Sist oppdatert: ${data.updated}`;

      let filter = "all";
      const view = new URLSearchParams(location.search).get("view") || "upcoming";

      function apply() {
        let list = data.matches;
        if (view === "results") list = list.filter(isFinished);
        else if (view === "upcoming") list = list.filter(isUpcoming);

        if (filter === "cup") {
          list = list.filter((m) =>
            ["Cup", "FA", "EFL"].some((c) =>
              m.competitionShort.includes(c) || /cup/i.test(m.competition)
            )
          );
        } else if (filter === "league") {
          list = list.filter(
            (m) =>
              !/cup/i.test(m.competition) &&
              !["Cup", "FA"].includes(m.competitionShort)
          );
        }

        list = sortMatches(list);
        if (view === "results") list = list.reverse();

        if (!list.length) {
          el.innerHTML = `<p class="empty-state">Ingen kamper i dette filteret.</p>`;
          return;
        }

        el.innerHTML = `<div class="match-list">${list
          .map((m) => matchRow(m, { expandable: view === "results" }))
          .join("")}</div>`;
        bindExpandables(el);
      }

      $$("[data-filter]").forEach((btn) => {
        btn.addEventListener("click", () => {
          filter = btn.getAttribute("data-filter");
          $$("[data-filter]").forEach((b) => b.classList.remove("is-active"));
          btn.classList.add("is-active");
          apply();
        });
      });

      $$("[data-view]").forEach((a) => {
        if (a.getAttribute("data-view") === view) a.classList.add("is-active");
      });

      apply();
    } catch {
      el.innerHTML = `<p class="empty-state">Kunne ikke laste kamper.</p>`;
    }
  }

  async function renderNewsPage() {
    const el = $("#news-root");
    if (!el) return;
    try {
      const data = await loadJSON("assets/data/news.json");
      const posts = [...data.posts].sort((a, b) => b.date.localeCompare(a.date));
      const hash = location.hash.replace("#", "");

      el.innerHTML = posts
        .map((p) => {
          const d = formatDate(p.date);
          const paras = p.body
            .split(/\n\n+/)
            .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
            .join("");
          return `<article class="article" id="${p.id}" style="margin-bottom:3rem;padding-bottom:2rem;border-bottom:1px solid var(--line)">
            <div class="article__meta">${d.day}. ${d.month} ${d.year}</div>
            <h2 style="font-size:clamp(2rem,5vw,2.8rem);margin-bottom:1rem">${p.title}</h2>
            ${paras}
          </article>`;
        })
        .join("");

      if (hash) {
        const target = document.getElementById(hash);
        if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch {
      el.innerHTML = `<p class="empty-state">Kunne ikke laste nyheter.</p>`;
    }
  }

  setCurrentNav();
  initNav();
  renderHomeMatches();
  renderHomeNews();
  renderFixturesPage();
  renderNewsPage();
})();
