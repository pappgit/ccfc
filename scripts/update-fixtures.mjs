#!/usr/bin/env node
/**
 * Oppdater Coventry-kampprogram fra API-Football.
 *
 * Gratisplan: 100 req/dag. Dette scriptet er hardcapped til få kall:
 *  - 1× team lookup (kun hvis TEAM_ID mangler)
 *  - 1× fixtures for sesongen (liga + cup i ett kall)
 *  - inntil MAX_DETAIL_BATCHES × fixtures?ids=… (maks 20 id/kall) for FT-detaljer
 *
 * Env:
 *  - API_FOOTBALL_KEY (påkravd)
 *  - SEASON (default: 2026 = 2026/27)
 *  - TEAM_ID (default: 1346 Coventry City — hopper over search-kall)
 *  - MAX_DETAIL_BATCHES (default: 2 → maks ~40 kamper med detaljer / kjøring)
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "assets/data/fixtures.json");

const API = "https://v3.football.api-sports.io";
const KEY = process.env.API_FOOTBALL_KEY;
const SEASON = Number(process.env.SEASON || 2026);
const TEAM_ID = Number(process.env.TEAM_ID || 1346);
const MAX_DETAIL_BATCHES = Number(process.env.MAX_DETAIL_BATCHES || 2);
const TZ = "Europe/Oslo";

if (!KEY) {
  console.error("Mangler API_FOOTBALL_KEY");
  process.exit(1);
}

let calls = 0;
let remaining = null;

async function api(path) {
  calls += 1;
  const res = await fetch(`${API}${path}`, {
    headers: { "x-apisports-key": KEY },
  });
  const rem = res.headers.get("x-ratelimit-requests-remaining");
  if (rem != null) remaining = Number(rem);

  const body = await res.json();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${JSON.stringify(body.errors || body)}`);
  }
  if (body.errors && Object.keys(body.errors).length) {
    throw new Error(`API error ${path}: ${JSON.stringify(body.errors)}`);
  }
  console.log(`API #${calls} ${path} → ${body.results ?? "?"} results (remaining today: ${remaining ?? "?"})`);
  return body;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function shortComp(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("premier")) return "PL";
  if (n.includes("fa cup") || n === "fa cup") return "FA";
  if (n.includes("league cup") || n.includes("efl cup") || n.includes("carabao")) return "Cup";
  if (n.includes("community shield")) return "CS";
  if (n.includes("championship")) return "CH";
  return (name || "UK").slice(0, 3).toUpperCase();
}

function partsInOslo(iso) {
  const d = new Date(iso);
  const date = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
  const kickoff = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
  return { date, kickoff };
}

function mapStatus(short) {
  if (["FT", "AET", "PEN"].includes(short)) return "FT";
  if (["NS", "TBD", "PST"].includes(short)) return short === "PST" ? "NS" : short;
  if (["1H", "2H", "HT", "ET", "BT", "P", "LIVE"].includes(short)) return short;
  return short || "NS";
}

function extractScorers(fixture, events) {
  if (!events?.length) return [];
  const homeId = fixture.teams.home.id;
  return events
    .filter((e) => e.type === "Goal" && e.detail !== "Missed Penalty")
    .map((e) => ({
      player: e.player?.name || "Ukjent",
      team: e.team?.id === homeId ? "home" : "away",
      minute: e.time?.elapsed ?? null,
      detail: e.detail || null,
    }));
}

function extractStats(statistics) {
  if (!statistics || statistics.length < 2) return null;
  const byTeam = Object.fromEntries(
    statistics.map((s) => [s.team.id, Object.fromEntries((s.statistics || []).map((x) => [x.type, x.value]))])
  );
  const homeId = statistics[0].team.id;
  const awayId = statistics[1].team.id;
  const h = byTeam[homeId] || {};
  const a = byTeam[awayId] || {};
  const num = (v) => {
    if (v == null) return null;
    if (typeof v === "number") return v;
    const m = String(v).replace("%", "");
    const n = Number(m);
    return Number.isFinite(n) ? n : null;
  };
  return {
    possession: { home: num(h["Ball Possession"]), away: num(a["Ball Possession"]) },
    shots: { home: num(h["Total Shots"]), away: num(a["Total Shots"]) },
    shotsOnTarget: { home: num(h["Shots on Goal"]), away: num(a["Shots on Goal"]) },
    corners: { home: num(h["Corner Kicks"]), away: num(a["Corner Kicks"]) },
  };
}

function mapFixture(item, details) {
  const src = details || item;
  const { date, kickoff } = partsInOslo(src.fixture.date);
  const status = mapStatus(src.fixture.status?.short);
  const finished = status === "FT";
  const scorers = extractScorers(src, src.events);
  const stats = extractStats(src.statistics);

  return {
    id: String(src.fixture.id),
    date,
    kickoff,
    competition: src.league?.name || "Unknown",
    competitionShort: shortComp(src.league?.name),
    home: src.teams.home.name,
    away: src.teams.away.name,
    venue: src.fixture.venue?.name || null,
    status,
    score: finished
      ? { home: src.goals?.home ?? src.score?.fulltime?.home, away: src.goals?.away ?? src.score?.fulltime?.away }
      : null,
    scorers: scorers.length ? scorers : [],
    stats: stats,
  };
}

function needsDetails(match) {
  if (match.status !== "FT") return false;
  const noScorers = !match.scorers || match.scorers.length === 0;
  const noStats = !match.stats;
  // 0-0 uten scorers er ok, men hent stats uansett første gang
  return noStats || (noScorers && match.score && (match.score.home > 0 || match.score.away > 0));
}

async function main() {
  let teamId = TEAM_ID;
  if (!teamId) {
    const search = await api("/teams?search=Coventry");
    const hit = (search.response || []).find((t) =>
      /coventry city/i.test(t.team?.name || "")
    );
    if (!hit) throw new Error("Fant ikke Coventry City");
    teamId = hit.team.id;
  }

  const list = await api(`/fixtures?team=${teamId}&season=${SEASON}`);
  const items = list.response || [];
  if (!items.length) {
    console.warn("Ingen kamper returnert — sjekk season/team eller gratisplan-dekning.");
  }

  let previous = { matches: [] };
  try {
    previous = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    /* first run */
  }
  const prevById = Object.fromEntries((previous.matches || []).map((m) => [String(m.id), m]));

  // Base map uten events/stats (liste-endepunktet har dem sjelden)
  let matches = items.map((item) => {
    const base = mapFixture(item);
    const prev = prevById[base.id];
    if (prev && base.status === "FT") {
      return {
        ...base,
        scorers: prev.scorers?.length ? prev.scorers : base.scorers,
        stats: prev.stats || base.stats,
      };
    }
    return base;
  });

  const needing = matches
    .filter(needsDetails)
    .sort((a, b) => b.date.localeCompare(a.date)); // nyeste FT først

  const batches = chunk(
    needing.map((m) => m.id),
    20
  ).slice(0, MAX_DETAIL_BATCHES);

  if (remaining != null && remaining < batches.length + 2) {
    console.warn(`Lav kvote (${remaining}) — hopper over detalj-kall denne gangen.`);
  } else {
    for (const ids of batches) {
      if (remaining != null && remaining <= 5) {
        console.warn("Stopper detalj-kall for å spare gratisplan-kvote.");
        break;
      }
      const detail = await api(`/fixtures?ids=${ids.join("-")}`);
      const byId = Object.fromEntries((detail.response || []).map((f) => [String(f.fixture.id), f]));
      matches = matches.map((m) => {
        const d = byId[m.id];
        return d ? mapFixture(d, d) : m;
      });
    }
  }

  matches.sort((a, b) => (a.date + a.kickoff).localeCompare(b.date + b.kickoff));

  const today = new Date().toISOString().slice(0, 10);
  const out = {
    team: "Coventry City",
    teamId,
    season: SEASON,
    updated: today,
    source: "api-football",
    apiCallsUsed: calls,
    note: "Oppdatert via API-Football. Mandagsjobb holder kvoten lav (få kall/dag).",
    matches,
  };

  writeFileSync(OUT, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `Skrev ${matches.length} kamper til ${OUT} (${calls} API-kall, remaining≈${remaining ?? "?"})`
  );
  console.log(
    `Kommende: ${matches.filter((m) => m.status === "NS" || m.status === "TBD").length}, FT: ${matches.filter((m) => m.status === "FT").length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
