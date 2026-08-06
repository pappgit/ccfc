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

  async function loadNewsPosts() {
    // Prefer Supabase; fall back to static JSON
    try {
      if (window.supabase && window.CCFC_SUPABASE) {
        const client = window.supabase.createClient(
          window.CCFC_SUPABASE.url,
          window.CCFC_SUPABASE.anonKey
        );
        const { data, error } = await client
          .from("news_posts")
          .select("slug,title,excerpt,body,image_url,published_at,show_on_home")
          .eq("published", true)
          .order("published_at", { ascending: false });
        if (!error && data?.length) {
          return data.map((p) => ({
            id: p.slug,
            date: (p.published_at || "").slice(0, 10),
            title: p.title,
            excerpt: p.excerpt,
            body: p.body,
            image: p.image_url || "",
            show_on_home: p.show_on_home !== false,
          }));
        }
      }
    } catch {
      /* fall through */
    }
    const data = await loadJSON("assets/data/news.json");
    return (data.posts || []).map((p) => ({
      ...p,
      image: p.image || "",
      show_on_home: true,
    }));
  }

  function newsImageHtml(url, className, alt) {
    const src = String(url || "").trim();
    if (!src) return "";
    const resolved = window.CCFCContent?.assetPath
      ? window.CCFCContent.assetPath(src)
      : src;
    const safeSrc = String(resolved)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
    const safeAlt = String(alt || "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
    return `<img class="${className}" src="${safeSrc}" alt="${safeAlt}" loading="lazy" decoding="async" />`;
  }

  async function renderHomeNews() {
    const el = $("#home-news");
    if (!el) return;
    try {
      const posts = (await loadNewsPosts())
        .filter((p) => p.show_on_home)
        .slice(0, 3);
      if (!posts.length) {
        el.innerHTML = `<p class="empty-state">Ingen nyheter publisert ennå.</p>`;
        return;
      }
      el.innerHTML = `<div class="news-list">${posts
        .map((p) => {
          const d = formatDate(p.date || "2026-01-01");
          const img = newsImageHtml(p.image, "news-item__image", p.title || "");
          return `<a class="news-item" href="nyheter.html#${p.id}">
            <div class="news-item__date">${d.day}. ${d.month} ${d.year}</div>
            <div>
              <h3>${p.title}</h3>
              <p>${p.excerpt}</p>
              ${img}
            </div>
          </a>`;
        })
        .join("")}</div>`;
    } catch {
      el.innerHTML = `<p class="empty-state">Kunne ikke laste nyheter.</p>`;
    }
  }

  async function renderNewsPage() {
    const el = $("#news-root");
    if (!el) return;
    try {
      const posts = await loadNewsPosts();
      const hash = location.hash.replace("#", "");

      el.innerHTML = posts
        .map((p) => {
          const d = formatDate(p.date || "2026-01-01");
          const paras = (p.body || "")
            .split(/\n\n+/)
            .map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`)
            .join("");
          const img = newsImageHtml(p.image, "article__image", p.title || "");
          return `<article class="article" id="${p.id}" style="margin-bottom:3rem;padding-bottom:2rem;border-bottom:1px solid var(--line)">
            <div class="article__meta">${d.day}. ${d.month} ${d.year}</div>
            <h2 style="font-size:clamp(1.5rem,4vw,2.2rem);margin-bottom:1rem">${p.title}</h2>
            ${img}
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

  const RUMOR_TAG_LABELS = {
    rykte: "Rykte",
    bekreftet: "Bekreftet",
    avvist: "Avvist",
  };

  function escapeText(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function safeHttpUrl(url) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    try {
      const u = new URL(raw, location.origin);
      if (u.protocol === "http:" || u.protocol === "https:") return u.href;
    } catch {
      /* ignore */
    }
    return "";
  }

  async function loadRumorPosts() {
    try {
      if (window.supabase && window.CCFC_SUPABASE) {
        const client = window.supabase.createClient(
          window.CCFC_SUPABASE.url,
          window.CCFC_SUPABASE.anonKey
        );
        const { data, error } = await client
          .from("rumor_posts")
          .select("slug,title,summary,source_name,source_url,tag,published_at")
          .eq("published", true)
          .order("published_at", { ascending: false });
        if (!error && data?.length) {
          return data.map((p) => ({
            id: p.slug,
            date: (p.published_at || "").slice(0, 10),
            title: p.title,
            summary: p.summary,
            source_name: p.source_name || "",
            source_url: p.source_url || "",
            tag: p.tag || "rykte",
          }));
        }
      }
    } catch {
      /* fall through */
    }
    const data = await loadJSON("assets/data/rumors.json");
    return data.posts || [];
  }

  async function renderRumorsPage() {
    const el = $("#rumors-root");
    if (!el) return;
    try {
      const posts = await loadRumorPosts();
      if (!posts.length) {
        el.innerHTML = `<p class="empty-state">Ingen rykter publisert ennå. Kom tilbake i transfervinduet.</p>`;
        return;
      }

      el.innerHTML = `<div class="rumor-list">${posts
        .map((p) => {
          const d = formatDate(p.date || "2026-01-01");
          const tag = RUMOR_TAG_LABELS[p.tag] ? p.tag : "rykte";
          const tagLabel = RUMOR_TAG_LABELS[tag];
          const tagClass =
            tag === "rykte" ? "" : ` rumor-item__tag--${tag}`;
          const href = safeHttpUrl(p.source_url);
          const sourceName = escapeText(p.source_name || "Kilde");
          const sourceHtml = href
            ? `<a href="${escapeText(href)}" target="_blank" rel="noopener noreferrer">Les hos ${sourceName}</a>`
            : sourceName
              ? `Kilde: ${sourceName}`
              : "";
          return `<article class="rumor-item" id="${escapeText(p.id)}">
            <div class="rumor-item__date">${d.day}. ${d.month} ${d.year}</div>
            <div>
              <div class="rumor-item__tag${tagClass}">${tagLabel}</div>
              <h2>${escapeText(p.title)}</h2>
              <p class="rumor-item__summary">${escapeText(p.summary)}</p>
              ${sourceHtml ? `<div class="rumor-item__meta">${sourceHtml}</div>` : ""}
            </div>
          </article>`;
        })
        .join("")}</div>`;
    } catch {
      el.innerHTML = `<p class="empty-state">Kunne ikke laste ryktebørsen.</p>`;
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

  function parseUkDate(dmy) {
    // DD/MM/YYYY
    const [dd, mm, yyyy] = dmy.split("/").map(Number);
    return new Date(yyyy, mm - 1, dd);
  }

  function formatUkDate(dmy) {
    const d = parseUkDate(dmy);
    return `${String(d.getDate()).padStart(2, "0")}. ${MONTHS_NO[d.getMonth()]}`;
  }

  function renderSeason(season) {
    const r = season.record;
    const g = season.goals;
    const a = season.averages;
    const t = season.totals;
    const h = season.home;
    const aw = season.away;

    const playerBlock = season.players
      ? `<div class="section__head" style="margin-top:2rem"><p class="tag">Spillere</p><h2>Spillerstatistikk</h2></div>
         <div class="stat-table-wrap"><table class="stat-table"><thead><tr>
           <th>Spiller</th><th>Pos</th><th>K</th><th>Min</th><th>Mål</th><th>Assist</th><th>Gult</th><th>Rødt</th>
         </tr></thead><tbody>
         ${season.players
           .map(
             (p) => `<tr>
               <td>${p.name}</td>
               <td>${p.position || "–"}</td>
               <td>${p.apps ?? "–"}</td>
               <td>${p.minutes ?? "–"}</td>
               <td>${p.goals ?? "–"}</td>
               <td>${p.assists ?? "–"}</td>
               <td>${p.yellow ?? "–"}</td>
               <td>${p.red ?? "–"}</td>
             </tr>`
           )
           .join("")}
         </tbody></table></div>`
      : `<div class="callout">
           <strong>Spillerstatistikk:</strong> Klar for API-Football
           (<code>/players?team=…&amp;season=${season.id.slice(0, 4)}</code>).
           Gratis plan: 100 kall/dag — nok til engangsimport av begge sesongene inn i JSON.
         </div>`;

    const matches = [...season.matches].sort((x, y) =>
      parseUkDate(x.date) - parseUkDate(y.date)
    );

    return `
      <p class="tag">${season.competition} · ${season.label}</p>
      <div class="stat-grid">
        <div class="stat-cell">
          <div class="stat-cell__label">Poeng</div>
          <div class="stat-cell__value stat-cell__value--sky">${r.pts}</div>
          <div class="stat-cell__hint">${r.w}–${r.d}–${r.l} · ${season.played} kamper</div>
        </div>
        <div class="stat-cell">
          <div class="stat-cell__label">Mål</div>
          <div class="stat-cell__value">${g.for}–${g.against}</div>
          <div class="stat-cell__hint">Diff ${g.diff > 0 ? "+" : ""}${g.diff}</div>
        </div>
        <div class="stat-cell">
          <div class="stat-cell__label">Skudd / kamp</div>
          <div class="stat-cell__value">${a.shots ?? "–"}</div>
          <div class="stat-cell__hint">${a.shotsOnTarget ?? "–"} på mål</div>
        </div>
        <div class="stat-cell">
          <div class="stat-cell__label">Corners / kamp</div>
          <div class="stat-cell__value">${a.corners ?? "–"}</div>
          <div class="stat-cell__hint">${t.yellow ?? 0} gule · ${t.red ?? 0} røde</div>
        </div>
      </div>

      <div class="stat-grid" style="margin-bottom:2.5rem">
        <div class="stat-cell">
          <div class="stat-cell__label">Hjemme</div>
          <div class="stat-cell__value">${h.w}–${h.d}–${h.l}</div>
          <div class="stat-cell__hint">${h.played} kamper</div>
        </div>
        <div class="stat-cell">
          <div class="stat-cell__label">Borte</div>
          <div class="stat-cell__value">${aw.w}–${aw.d}–${aw.l}</div>
          <div class="stat-cell__hint">${aw.played} kamper</div>
        </div>
        <div class="stat-cell">
          <div class="stat-cell__label">Mål snitt</div>
          <div class="stat-cell__value">${a.gf ?? "–"}</div>
          <div class="stat-cell__hint">Sluppet inn ${a.ga ?? "–"}</div>
        </div>
        <div class="stat-cell">
          <div class="stat-cell__label">Skudd totalt</div>
          <div class="stat-cell__value">${t.shots ?? "–"}</div>
          <div class="stat-cell__hint">${t.shotsOnTarget ?? "–"} på mål</div>
        </div>
      </div>

      ${playerBlock}

      <div class="section__head">
        <p class="tag">Kamp for kamp</p>
        <h2>Kampstatistikk</h2>
        <p>Skudd, på mål, corners, kort — Coventry sitt tall per kamp.</p>
      </div>
      <div class="stat-table-wrap">
        <table class="stat-table">
          <thead>
            <tr>
              <th>Dato</th>
              <th>Motstander</th>
              <th>Res</th>
              <th>Score</th>
              <th>Skudd</th>
              <th>På mål</th>
              <th>Corners</th>
              <th>Fouls</th>
              <th>Kort</th>
            </tr>
          </thead>
          <tbody>
            ${matches
              .map((m) => {
                const c = m.coventry;
                const opp = c.venue === "H" ? m.away : m.home;
                const where = c.venue === "H" ? "H" : "B";
                return `<tr>
                  <td>${formatUkDate(m.date)}</td>
                  <td>${where} · ${opp}</td>
                  <td class="res-${c.result}">${c.result}</td>
                  <td>${m.score.home}–${m.score.away}</td>
                  <td>${c.shots ?? "–"}</td>
                  <td>${c.shotsOnTarget ?? "–"}</td>
                  <td>${c.corners ?? "–"}</td>
                  <td>${c.fouls ?? "–"}</td>
                  <td>${c.yellow ?? 0}/${c.red ?? 0}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>
      <p class="tag">Kilde: ${season.source} · Oppdatert i datafil</p>
    `;
  }

  async function renderStatsPage() {
    const root = $("#stats-root");
    const tabs = $("#season-tabs");
    if (!root || !tabs) return;

    try {
      const data = await loadJSON("assets/data/championship-stats.json");
      let active = data.seasons[0]?.id;

      function paint() {
        tabs.innerHTML = data.seasons
          .map(
            (s) =>
              `<button type="button" class="filter-btn${s.id === active ? " is-active" : ""}" data-season="${s.id}">${s.label}</button>`
          )
          .join("");

        $$("[data-season]", tabs).forEach((btn) => {
          btn.addEventListener("click", () => {
            active = btn.getAttribute("data-season");
            paint();
          });
        });

        const season = data.seasons.find((s) => s.id === active);
        root.innerHTML = season
          ? renderSeason(season)
          : `<p class="empty-state">Ingen sesong valgt.</p>`;
      }

      paint();
    } catch {
      root.innerHTML = `<p class="empty-state">Kunne ikke laste statistikk.</p>`;
    }
  }

  function initHeroSlideshow(slides, intervalMs) {
    const root = document.querySelector("[data-hero-slideshow]");
    const host = $("#hero-slides");
    const dotsHost = $("#hero-dots");
    if (!root || !host) return;

    // Tear down previous timer/listeners when CMS re-inits the slideshow
    if (root._heroCleanup) {
      root._heroCleanup();
      root._heroCleanup = null;
    }

    const list = (slides || [])
      .map((s) => {
        if (typeof s === "string") return { url: s, alt: "" };
        return { url: s?.url || "", alt: s?.alt || "" };
      })
      .filter((s) => s.url);

    if (list.length) {
      const assetPath = window.CCFCContent?.assetPath
        ? (u) => window.CCFCContent.assetPath(u)
        : (u) => u;
      host.innerHTML = list
        .map((s, i) => {
          const src = assetPath(s.url)
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;");
          const alt = (s.alt || "Coventry City i aksjon")
            .replace(/&/g, "&amp;")
            .replace(/"/g, "&quot;")
            .replace(/</g, "&lt;");
          const eager = i === 0
            ? 'fetchpriority="high"'
            : 'loading="lazy"';
          return `<div class="hero__slide${i === 0 ? " is-active" : ""}"><img src="${src}" alt="${alt}" width="1920" height="1080" decoding="async" ${eager} /></div>`;
        })
        .join("");
    }

    const slideEls = $$(".hero__slide", host);
    if (!slideEls.length) return;

    if (dotsHost) {
      dotsHost.innerHTML = slideEls
        .map(
          (_, i) =>
            `<button type="button" class="hero__dot${i === 0 ? " is-active" : ""}" role="tab" aria-label="Bilde ${i + 1}" aria-selected="${i === 0 ? "true" : "false"}" data-slide="${i}"></button>`
        )
        .join("");
    }

    let index = 0;
    let timer = null;
    const delay = Math.max(3000, Number(intervalMs) || 6500);
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function goTo(next) {
      index = ((next % slideEls.length) + slideEls.length) % slideEls.length;
      slideEls.forEach((el, i) => el.classList.toggle("is-active", i === index));
      if (dotsHost) {
        $$(".hero__dot", dotsHost).forEach((dot, i) => {
          const on = i === index;
          dot.classList.toggle("is-active", on);
          dot.setAttribute("aria-selected", on ? "true" : "false");
        });
      }
    }

    function start() {
      stop();
      if (reduceMotion || slideEls.length < 2) return;
      timer = window.setInterval(() => goTo(index + 1), delay);
    }

    function stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    }

    function onDotClick(e) {
      const btn = e.target.closest("[data-slide]");
      if (!btn) return;
      goTo(Number(btn.getAttribute("data-slide")));
      start();
    }

    function onVisibility() {
      if (document.hidden) stop();
      else start();
    }

    dotsHost?.addEventListener("click", onDotClick);
    root.addEventListener("mouseenter", stop);
    root.addEventListener("mouseleave", start);
    document.addEventListener("visibilitychange", onVisibility);

    root._heroCleanup = () => {
      stop();
      dotsHost?.removeEventListener("click", onDotClick);
      root.removeEventListener("mouseenter", stop);
      root.removeEventListener("mouseleave", start);
      document.removeEventListener("visibilitychange", onVisibility);
    };

    start();
  }

  setCurrentNav();
  initNav();
  renderHomeMatches();
  renderHomeNews();
  renderFixturesPage();
  renderNewsPage();
  renderRumorsPage();
  renderStatsPage();

  // Wire up markup slides immediately; CMS may replace them when ready
  initHeroSlideshow(null, 6500);

  document.addEventListener("ccfc:content-ready", (e) => {
    const content = e.detail;
    if (!document.querySelector("[data-hero-slideshow]")) return;
    const slides = content?.home?.heroSlides;
    if (!Array.isArray(slides) || !slides.length) return;
    initHeroSlideshow(slides, content?.home?.heroSlideInterval);
  });
})();
