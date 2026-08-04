#!/usr/bin/env node
/**
 * Oppdater Coventry-kampprogram.
 *
 * Gratisplan API-Football dekker kun sesong ~2022–2024 (ikke 2026/27).
 * For inneværende sesong bruker vi derfor football-data.org (PL gratis forever).
 *
 * Env (prioritet):
 *  1) FOOTBALL_DATA_API_KEY  → football-data.org (anbefalt for 2026/27, gratis)
 *  2) API_FOOTBALL_KEY       → api-football (kun hvis sesongen er innenfor planen)
 *
 * Kvote: typisk 1–2 kall per kjøring.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "assets/data/fixtures.json");

const SEASON = Number(process.env.SEASON || 2026);
const TZ = "Europe/Oslo";
const FD_KEY = process.env.FOOTBALL_DATA_API_KEY;
const AF_KEY = process.env.API_FOOTBALL_KEY;
const AF_TEAM_ID = Number(process.env.TEAM_ID || 1346);
const MAX_DETAIL_BATCHES = Number(process.env.MAX_DETAIL_BATCHES || 2);

let calls = 0;

function today() {
  return new Date().toISOString().slice(0, 10);
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

function shortComp(name) {
  const n = (name || "").toLowerCase();
  if (n.includes("premier")) return "PL";
  if (n.includes("fa cup")) return "FA";
  if (n.includes("league cup") || n.includes("efl") || n.includes("carabao")) return "Cup";
  if (n.includes("community")) return "CS";
  if (n.includes("championship")) return "CH";
  return (name || "UK").slice(0, 3).toUpperCase();
}

function isCoventry(name) {
  return /coventry/i.test(name || "");
}

function loadPrevious() {
  try {
    return JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    return { matches: [] };
  }
}

function writeOut(payload) {
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
}

/* ——— football-data.org (gratis PL) ——— */
async function fetchFootballData() {
  const headers = { "X-Auth-Token": FD_KEY };
  const comps = ["PL", "FAC"]; // Premier League + FA Cup (gratis tier)
  const matches = [];

  for (const code of comps) {
    calls += 1;
    const url = `https://api.football-data.org/v4/competitions/${code}/matches?season=${SEASON}`;
    const res = await fetch(url, { headers });
    const body = await res.json();
    if (!res.ok) {
      // League Cup code can differ; skip soft-fail for non-PL
      console.warn(`football-data ${code}: HTTP ${res.status} ${body.message || ""}`);
      continue;
    }
    const list = (body.matches || []).filter(
      (m) => isCoventry(m.homeTeam?.name) || isCoventry(m.awayTeam?.name)
    );
    console.log(`football-data ${code}: ${list.length} Coventry-kamper (${calls} kall)`);
    for (const m of list) {
      const { date, kickoff } = partsInOslo(m.utcDate);
      const finished = m.status === "FINISHED";
      const statusMap = {
        SCHEDULED: "NS",
        TIMED: "NS",
        POSTPONED: "NS",
        SUSPENDED: "NS",
        CANCELLED: "NS",
        IN_PLAY: "LIVE",
        PAUSED: "LIVE",
        FINISHED: "FT",
        AWARDED: "FT",
      };
      matches.push({
        id: String(m.id),
        date,
        kickoff,
        competition: m.competition?.name || code,
        competitionShort: shortComp(m.competition?.name || code),
        home: m.homeTeam?.name || m.homeTeam?.shortName,
        away: m.awayTeam?.name || m.awayTeam?.shortName,
        venue: m.venue || null,
        status: statusMap[m.status] || "NS",
        score: finished
          ? {
              home: m.score?.fullTime?.home ?? null,
              away: m.score?.fullTime?.away ?? null,
            }
          : null,
        scorers: [],
        stats: null,
      });
    }
  }

  // Dedupe by id
  const byId = Object.fromEntries(matches.map((m) => [m.id, m]));
  return Object.values(byId).sort((a, b) =>
    (a.date + a.kickoff).localeCompare(b.date + b.kickoff)
  );
}

/* ——— API-Football (kun når sesong er innenfor gratis/betalt plan) ——— */
async function apiFootball(path) {
  calls += 1;
  const res = await fetch(`https://v3.football.api-sports.io${path}`, {
    headers: { "x-apisports-key": AF_KEY },
  });
  const rem = res.headers.get("x-ratelimit-requests-remaining");
  const body = await res.json();
  console.log(`API-Football #${calls} ${path} (remaining: ${rem ?? "?"})`);
  if (body.errors && Object.keys(body.errors).length) {
    const err = new Error(JSON.stringify(body.errors));
    err.apiErrors = body.errors;
    throw err;
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return body;
}

function mapAfFixture(src) {
  const { date, kickoff } = partsInOslo(src.fixture.date);
  const short = src.fixture.status?.short || "NS";
  const status = ["FT", "AET", "PEN"].includes(short)
    ? "FT"
    : ["NS", "TBD", "PST"].includes(short)
      ? short === "PST"
        ? "NS"
        : short
      : short;
  const finished = status === "FT";
  const homeId = src.teams.home.id;
  const scorers = (src.events || [])
    .filter((e) => e.type === "Goal" && e.detail !== "Missed Penalty")
    .map((e) => ({
      player: e.player?.name || "Ukjent",
      team: e.team?.id === homeId ? "home" : "away",
      minute: e.time?.elapsed ?? null,
    }));
  let stats = null;
  if (src.statistics?.length >= 2) {
    const pack = Object.fromEntries(
      src.statistics.map((s) => [
        s.team.id,
        Object.fromEntries((s.statistics || []).map((x) => [x.type, x.value])),
      ])
    );
    const h = pack[src.statistics[0].team.id] || {};
    const a = pack[src.statistics[1].team.id] || {};
    const num = (v) => {
      if (v == null) return null;
      const n = Number(String(v).replace("%", ""));
      return Number.isFinite(n) ? n : null;
    };
    stats = {
      possession: { home: num(h["Ball Possession"]), away: num(a["Ball Possession"]) },
      shots: { home: num(h["Total Shots"]), away: num(a["Total Shots"]) },
      shotsOnTarget: { home: num(h["Shots on Goal"]), away: num(a["Shots on Goal"]) },
      corners: { home: num(h["Corner Kicks"]), away: num(a["Corner Kicks"]) },
    };
  }
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
      ? { home: src.goals?.home, away: src.goals?.away }
      : null,
    scorers,
    stats,
  };
}

async function fetchApiFootball() {
  const list = await apiFootball(`/fixtures?team=${AF_TEAM_ID}&season=${SEASON}`);
  let matches = (list.response || []).map(mapAfFixture);
  const needing = matches
    .filter((m) => m.status === "FT" && (!m.stats || (m.score && (m.score.home || m.score.away) && !m.scorers.length)))
    .map((m) => m.id);
  const batches = [];
  for (let i = 0; i < needing.length; i += 20) batches.push(needing.slice(i, i + 20));
  for (const ids of batches.slice(0, MAX_DETAIL_BATCHES)) {
    const detail = await apiFootball(`/fixtures?ids=${ids.join("-")}`);
    const byId = Object.fromEntries((detail.response || []).map((f) => [String(f.fixture.id), f]));
    matches = matches.map((m) => (byId[m.id] ? mapAfFixture(byId[m.id]) : m));
  }
  return matches.sort((a, b) => (a.date + a.kickoff).localeCompare(b.date + b.kickoff));
}

async function main() {
  const previous = loadPrevious();
  let matches = null;
  let source = null;

  if (FD_KEY) {
    matches = await fetchFootballData();
    source = "football-data.org";
  } else if (AF_KEY) {
    try {
      matches = await fetchApiFootball();
      source = "api-football";
    } catch (err) {
      const msg = String(err.apiErrors?.plan || err.message || err);
      if (/Free plans do not have access to this season/i.test(msg)) {
        console.error(
          "\nAPI-Football gratisplan dekker ikke sesong",
          SEASON,
          "\n→ Behold eksisterende fixtures.json",
          "\n→ For auto-synk av 2026/27: legg til gratis nøkkel FOOTBALL_DATA_API_KEY",
          "\n   (registrer på https://www.football-data.org/client/register)",
          "\n→ Eller oppgrader API-Football til Pro.\n"
        );
        process.exit(0);
      }
      throw err;
    }
  } else {
    console.error("Mangler FOOTBALL_DATA_API_KEY eller API_FOOTBALL_KEY");
    process.exit(1);
  }

  if (!matches?.length) {
    console.warn("Ingen kamper hentet — beholder eksisterende fil.");
    process.exit(0);
  }

  // Behold scorers/stats fra tidligere der API ikke leverer dem
  const prevByKey = Object.fromEntries(
    (previous.matches || []).map((m) => [`${m.date}|${m.home}|${m.away}`, m])
  );
  matches = matches.map((m) => {
    const prev = prevByKey[`${m.date}|${m.home}|${m.away}`];
    if (!prev) return m;
    return {
      ...m,
      venue: m.venue || prev.venue,
      scorers: m.scorers?.length ? m.scorers : prev.scorers || [],
      stats: m.stats || prev.stats || null,
    };
  });

  writeOut({
    team: "Coventry City",
    season: SEASON,
    updated: today(),
    source,
    apiCallsUsed: calls,
    note: "Oppdatert automatisk. Kickoff kan endres gjennom sesongen (TV).",
    matches,
  });

  console.log(
    `Skrev ${matches.length} kamper (${source}, ${calls} kall). NS=${matches.filter((m) => m.status === "NS").length} FT=${matches.filter((m) => m.status === "FT").length}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
