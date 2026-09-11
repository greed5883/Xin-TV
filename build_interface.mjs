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
    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`${field} must use HTTP(S)`);
    }
    return parsed.href;
}

const sourceUrl = httpUrl(settings.source_url, "source_url");
const response = await fetch(sourceUrl, {headers: {Accept: "application/json"}});
if (!response.ok) throw new Error(`Upstream request failed: HTTP ${response.status}`);

const upstream = await response.json();
const config = structuredClone(upstream);
const brand = String(settings.brand_name || "xin").trim() || "xin";
const date = new Intl.DateTimeFormat("sv-SE", {timeZone: "Asia/Shanghai"}).format(new Date());

const logo = httpUrl(settings.logo_url, "logo_url");
const wallpaper = httpUrl(settings.wallpaper_url, "wallpaper_url");
if (logo) config.logo = logo;
else delete config.logo;
if (wallpaper) config.wallpaper = wallpaper;
else delete config.wallpaper;

const homeSite = config.sites?.find((site) => site.key === "Douban");
const updateSite = config.sites?.find((site) => site.key === "Doubanaaaa");
if (!homeSite || !updateSite) throw new Error("Upstream home marker sites changed");
homeSite.name = String(settings.home_title || `${brand} | 免费分享`);
updateSite.name = String(settings.update_title_template || `${brand} | 更新日期: {date}`)
    .replaceAll("{date}", date);

const parserLabels = Array.isArray(settings.parser_labels) && settings.parser_labels.length
    ? settings.parser_labels.map(String)
    : [`${brand}-1`, `${brand}-2`, `${brand}-3`];
config.parses?.slice(0, parserLabels.length).forEach((parser, index) => {
    parser.name = parserLabels[index];
});

function stableSite(site) {
    const copy = structuredClone(site);
    if (["Douban", "Doubanaaaa"].includes(copy.key)) delete copy.name;
    return copy;
}

function stableParser(parser) {
    const copy = structuredClone(parser);
    delete copy.name;
    return copy;
}

const invariants = [
    ["spider", upstream.spider, config.spider],
    ["sites", upstream.sites.map(stableSite), config.sites.map(stableSite)],
    ["parses", upstream.parses.map(stableParser), config.parses.map(stableParser)],
    ["doh", upstream.doh, config.doh],
    ["rules", upstream.rules, config.rules],
    ["ads", upstream.ads, config.ads],
    ["lives", upstream.lives, config.lives],
    ["headers", upstream.headers, config.headers],
];
for (const [name, before, after] of invariants) {
    if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error(`Playback-related section changed unexpectedly: ${name}`);
    }
}

const serialized = `${JSON.stringify(config, null, 2)}\n`;
const visibleBrandLeaks = [...new Set(serialized.match(/王小二|王二小|放牛娃/g) || [])];
if (visibleBrandLeaks.length) {
    throw new Error(`Author-facing text remains: ${visibleBrandLeaks.join(", ")}`);
}

await mkdir(dirname(outputPath), {recursive: true});
await writeFile(outputPath, serialized, "utf8");
console.log(JSON.stringify({
    output: outputPath,
    source: sourceUrl,
    brand,
    date,
    sites: config.sites.length,
    logo: config.logo || "app default",
    wallpaper: config.wallpaper || "app default",
    visibleAuthorText: visibleBrandLeaks,
    playbackFieldsPreserved: true,
}, null, 2));
