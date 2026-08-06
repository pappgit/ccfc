#!/usr/bin/env node
/**
 * Hent overgangsrykter fra RSS-kilder i admin, filtrér på søkeord, skriv rumors.json.
 *
 * Leser (valgfritt) fra Supabase site_settings:
 *   - rumor_keywords: { keywords: string[] }
 *   - rumor_sources:  { sources: { name, url }[] }
 *
 * Env (valgfritt — fallback leser supabase-config.js / innebygde defaults):
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT = join(ROOT, "assets/data/rumors.json");

const DEFAULT_KEYWORDS = ["Coventry", "Sky Blues", "CCFC", "CBS Arena"];
const DEFAULT_CONTEXT_TERMS = [
  "transfer",
  "rumour",
  "rumor",
  "gossip",
  "sign",
  "signing",
  "deal",
  "loan",
  "bid",
  "linked",
  "target",
  "move",
  "join",
  "agreed",
];
const DEFAULT_SOURCES = [
  {
    name: "Coventry Telegraph",
    url: "https://www.coventrytelegraph.net/sport/football/rss.xml",
  },
  {
    name: "Guardian Transfer",
    url: "https://www.theguardian.com/football/transfer-window/rss",
  },
];

const UA = "CoventryCityScandinavia-Rumors/1.0 (+https://github.com/pappgit/ccfc)";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function readSupabaseConfig() {
  try {
    const raw = readFileSync(join(ROOT, "assets/js/supabase-config.js"), "utf8");
    const url = raw.match(/url:\s*"([^"]+)"/)?.[1];
    const anonKey = raw.match(/anonKey:\s*"([^"]+)"/)?.[1];
    return { url, anonKey };
  } catch {
    return {};
  }
}

function getSupabaseCreds() {
  const fileCfg = readSupabaseConfig();
  return {
    url: process.env.SUPABASE_URL || fileCfg.url || "",
    anonKey: process.env.SUPABASE_ANON_KEY || fileCfg.anonKey || "",
  };
}

async function loadSetting(key) {
  const { url, anonKey } = getSupabaseCreds();
  if (!url || !anonKey) return null;
  const endpoint = `${url.replace(/\/$/, "")}/rest/v1/site_settings?key=eq.${encodeURIComponent(key)}&select=value`;
  const res = await fetch(endpoint, {
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
  });
  if (!res.ok) {
    console.warn(`Kunne ikke hente ${key}: HTTP ${res.status}`);
    return null;
  }
  const rows = await res.json();
  return rows?.[0]?.value || null;
}

async function loadKeywords() {
  try {
    const remote = await loadSetting("rumor_keywords");
    const list = Array.isArray(remote?.keywords)
      ? remote.keywords.map((k) => String(k).trim()).filter(Boolean)
      : [];
    const context = Array.isArray(remote?.context_terms)
      ? remote.context_terms.map((k) => String(k).trim()).filter(Boolean)
      : DEFAULT_CONTEXT_TERMS;
    return {
      keywords: list.length ? list : DEFAULT_KEYWORDS,
      contextTerms: context,
    };
  } catch (err) {
    console.warn("Søkeord-fallback:", err.message || err);
    return { keywords: DEFAULT_KEYWORDS, contextTerms: DEFAULT_CONTEXT_TERMS };
  }
}

async function loadSources() {
  try {
    const remote = await loadSetting("rumor_sources");
    const list = Array.isArray(remote?.sources)
      ? remote.sources
          .map((s) => ({
            name: String(s.name || "").trim(),
            url: String(s.url || "").trim(),
          }))
          .filter((s) => s.url)
      : [];
    return list.length ? list : DEFAULT_SOURCES;
  } catch (err) {
    console.warn("Kilde-fallback:", err.message || err);
    return DEFAULT_SOURCES;
  }
}

function stripCdata(s) {
  return String(s || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .trim();
}

function stripHtml(s) {
  return stripCdata(s)
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function extractTag(block, tag) {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i");
  const m = block.match(re);
  return m ? stripCdata(m[1]).trim() : "";
}

function parseRssItems(xml) {
  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRegex.exec(xml))) {
    const block = m[1];
    const title = stripHtml(extractTag(block, "title"));
    let link = extractTag(block, "link");
    if (!link) {
      const guid = extractTag(block, "guid");
      if (/^https?:\/\//i.test(guid)) link = guid;
    }
    link = stripHtml(link).replace(/&amp;/g, "&");
    const description = stripHtml(extractTag(block, "description"));
    const pubDate =
      extractTag(block, "pubDate") ||
      extractTag(block, "dc:date") ||
      extractTag(block, "published") ||
      "";
    if (title && link) {
      items.push({ title, link, description, pubDate });
    }
  }
  return items;
}

async function fetchRss(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  return parseRssItems(xml);
}

function matchesKeywords(item, keywords) {
  const hay = `${item.title} ${item.description}`.toLowerCase();
  return keywords.some((k) => hay.includes(String(k).toLowerCase()));
}

function matchesContext(item, contextTerms) {
  if (!contextTerms?.length) return true;
  const hay = `${item.title} ${item.description}`.toLowerCase();
  return contextTerms.some((k) => hay.includes(String(k).toLowerCase()));
}

function toDate(pubDate) {
  if (!pubDate) return today();
  const d = new Date(pubDate);
  if (Number.isNaN(d.getTime())) return today();
  return d.toISOString().slice(0, 10);
}

function slugify(title, url) {
  const base = String(title || url || "rykte")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return base || `rykte-${Date.now()}`;
}

function summarize(description, max = 240) {
  const text = stripHtml(description);
  if (text.length <= max) return text;
  return text.slice(0, max - 1).trimEnd() + "…";
}

async function main() {
  const { keywords, contextTerms } = await loadKeywords();
  const sources = await loadSources();
  console.log(`Søkeord (${keywords.length}): ${keywords.join(", ")}`);
  console.log(`Kontekst-filter (${contextTerms.length}): ${contextTerms.join(", ") || "(av)"}`);
  console.log(`Kilder (${sources.length}): ${sources.map((s) => s.name).join(", ")}`);

  const posts = [];
  const seenUrls = new Set();
  const seenSlugs = new Set();

  for (const source of sources) {
    try {
      console.log(`Henter ${source.name}: ${source.url}`);
      const items = await fetchRss(source.url);
      const matched = items.filter(
        (item) => matchesKeywords(item, keywords) && matchesContext(item, contextTerms)
      );
      console.log(`  ${items.length} saker, ${matched.length} treff på søkeord+kontekst`);

      for (const item of matched) {
        const url = item.link;
        if (seenUrls.has(url)) continue;
        seenUrls.add(url);

        let id = slugify(item.title, url);
        if (seenSlugs.has(id)) id = `${id}-${posts.length + 1}`;
        seenSlugs.add(id);

        posts.push({
          id,
          date: toDate(item.pubDate),
          title: item.title,
          summary: summarize(item.description),
          source_name: source.name,
          source_url: url,
          tag: "rykte",
          auto: true,
        });
      }
    } catch (err) {
      console.warn(`Feil for ${source.name}:`, err.message || err);
    }
  }

  posts.sort((a, b) => String(b.date).localeCompare(String(a.date)));

  const payload = {
    updated: today(),
    keywords,
    context_terms: contextTerms,
    sources: sources.map((s) => ({ name: s.name, url: s.url })),
    posts: posts.slice(0, 50),
  };

  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`Skrev ${payload.posts.length} rykter til ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
