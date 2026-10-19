import {readFile, mkdir, writeFile} from "node:fs/promises";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const projectRoot = dirname(fileURLToPath(import.meta.url));
const settingsPath = resolve(projectRoot, process.argv[2] || "settings.json");
const outputPath = resolve(projectRoot, "docs/index.json");
const settings = JSON.parse(await readFile(settingsPath, "utf8"));

function httpUrl(value, field) {
    if (!value) return "";
    let parsed;
    try {
        parsed = new URL(value);
    } catch {
        throw new Error(`${field} must be a complete URL`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error(`${field} must use HTTP(S)`);
    }
    return parsed.href;
}

function sourceEntries() {
    const configured = Array.isArray(settings.source_urls)
        ? settings.source_urls
        : [settings.source_url];
    return configured.map((entry, index) => {
        const value = typeof entry === "string" ? {url: entry} : entry;
        if (!value || typeof value !== "object") {
            throw new Error(`source_urls[${index}] must be a URL or object`);
        }
        return {
            name: String(value.name || `source-${index + 1}`),
            url: String(value.url || ""),
        };
    }).filter((entry) => entry.url);
}

async function fetchSource(entry) {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const response = await fetch(entry.url, {
                headers: {Accept: "application/json", "User-Agent": "xin-tv-config/1.0"},
                signal: AbortSignal.timeout(30000),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            if (!data || typeof data !== "object" || Array.isArray(data)) {
                throw new Error("response is not a JSON object");
            }
            if (!Array.isArray(data.sites) || data.sites.length === 0) {
                throw new Error("JSON is missing a non-empty sites array");
            }
            if (!data.sites.every((site) => site && typeof site === "object" && site.key && site.api)) {
                throw new Error("sites array has an invalid entry (expected key and api)");
            }
            return data;
        } catch (error) {
            lastError = error;
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 2000));
        }
    }
    throw new Error(`failed after 3 attempts: ${lastError.message}`);
}

const candidates = sourceEntries();
if (!candidates.length) throw new Error("Configure at least one source URL");

let upstream;
let selectedSource;
const failures = [];
for (const candidate of candidates) {
    try {
        const normalized = {...candidate, url: httpUrl(candidate.url, `${candidate.name}.url`)};
        upstream = await fetchSource(normalized);
        selectedSource = normalized;
        break;
    } catch (error) {
        failures.push(`${candidate.name}: ${error.message}`);
    }
}
if (!upstream) throw new Error(`All source URLs failed\n${failures.join("\n")}`);

const config = structuredClone(upstream);
const brand = String(settings.brand_name || "xin").trim() || "xin";
const date = new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Shanghai"}).format(new Date());

const logo = httpUrl(settings.logo_url, "logo_url");
const wallpaper = httpUrl(settings.wallpaper_url, "wallpaper_url");
if (logo) config.logo = logo;
else if (Object.prototype.hasOwnProperty.call(config, "logo")) delete config.logo;
if (wallpaper) config.wallpaper = wallpaper;
else if (Object.prototype.hasOwnProperty.call(config, "wallpaper")) delete config.wallpaper;

function setSiteName(key, value) {
    if (!Array.isArray(config.sites)) return false;
    const site = config.sites.find((item) => item && item.key === key);
    if (!site) return false;
    site.name = String(value);
    return true;
}

const siteOverrides = settings.site_name_overrides || {
    Douban: `${brand} | 免费分享`,
    Doubanaaaa: `${brand} | 更新日期: {date}`,
};
const missingSiteOverrides = [];
for (const [key, value] of Object.entries(siteOverrides)) {
    const name = String(value).replaceAll("{brand}", brand).replaceAll("{date}", date);
    if (!setSiteName(key, name)) missingSiteOverrides.push(key);
}

const parserLabels = Array.isArray(settings.parser_labels) && settings.parser_labels.length
    ? settings.parser_labels.map(String)
    : [`${brand}-1`, `${brand}-2`, `${brand}-3`];
if (Array.isArray(config.parses)) {
    config.parses.slice(0, parserLabels.length).forEach((parser, index) => {
        if (parser && typeof parser === "object") parser.name = parserLabels[index];
    });
}

// Replace only display-like values. URLs, API class names, keys and playback data are untouched.
const displayKeys = new Set(["name", "title", "author", "description", "remark", "message"]);
const replacements = Array.isArray(settings.display_replacements)
    ? settings.display_replacements
    : [];
function replaceDisplayText(node, key = "") {
    if (typeof node === "string") {
        if (!displayKeys.has(key)) return node;
        return replacements.reduce((value, item) => {
            const from = String(item?.from ?? "");
            return from ? value.split(from).join(String(item.to ?? "")) : value;
        }, node);
    }
    if (Array.isArray(node)) return node.map((item) => replaceDisplayText(item, key));
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(Object.entries(node).map(([childKey, value]) => [
        childKey,
        replaceDisplayText(value, childKey),
    ]));
}
const replacedConfig = replaceDisplayText(config);
for (const key of Object.keys(config)) delete config[key];
Object.assign(config, replacedConfig);

function comparable(node, key = "") {
    if (key === "logo" || key === "wallpaper" || displayKeys.has(key)) return undefined;
    if (Array.isArray(node)) return node.map((item) => comparable(item, key));
    if (!node || typeof node !== "object") return node;
    return Object.fromEntries(Object.entries(node)
        .map(([childKey, value]) => [childKey, comparable(value, childKey)])
        .filter(([, value]) => value !== undefined));
}
if (JSON.stringify(comparable(upstream)) !== JSON.stringify(comparable(config))) {
    throw new Error("A non-display field changed unexpectedly; playback data was not written");
}

const serialized = `${JSON.stringify(config, null, 2)}\n`;
const blockedTerms = Array.isArray(settings.blocked_terms)
    ? settings.blocked_terms.map(String).filter(Boolean)
    : ["王小二", "王二小", "放牛娃"];
function displayText(node, key = "") {
    if (typeof node === "string") return displayKeys.has(key) ? node : "";
    if (Array.isArray(node)) return node.map((item) => displayText(item, key)).join("\n");
    if (!node || typeof node !== "object") return "";
    return Object.entries(node).map(([childKey, value]) => displayText(value, childKey)).join("\n");
}
const visibleDisplayText = displayText(config);
const visibleBrandLeaks = blockedTerms.filter((term) => visibleDisplayText.includes(term));
if (visibleBrandLeaks.length) {
    throw new Error(`Author-facing text remains in display fields: ${visibleBrandLeaks.join(", ")}`);
}

await mkdir(dirname(outputPath), {recursive: true});
await writeFile(outputPath, serialized, "utf8");
console.log(JSON.stringify({
    output: outputPath,
    source: selectedSource.url,
    sourceName: selectedSource.name,
    failedSources: failures,
    brand,
    date,
    sites: Array.isArray(config.sites) ? config.sites.length : 0,
    logo: config.logo || "app default",
    wallpaper: config.wallpaper || "app default",
    missingSiteOverrides,
    visibleAuthorText: visibleBrandLeaks,
    playbackFieldsPreserved: true,
}, null, 2));
