"use strict";

const dataPrefix = "window.BENCHMARK_DATA = ";
const categories = [
  { id: "overview", label: "Overview" },
  { id: "size", label: "Binary size" },
  { id: "timing", label: "Build & run" },
  { id: "compiler", label: "Compiler" },
  { id: "runtime", label: "Language/runtime" },
];
const colors = [
  "#1769aa",
  "#1b7f5a",
  "#c47d00",
  "#b33b3b",
  "#7656a8",
  "#00838f",
  "#5f6368",
  "#ad3d78",
];
const state = {
  activeCategory: "overview",
  activeKind: "main",
  charts: [],
  data: null,
  selected: null,
  series: [],
};

const elements = {
  categoryTabs: document.getElementById("category-tabs"),
  charts: document.getElementById("charts"),
  commitLink: document.getElementById("commit-link"),
  kindTabs: document.getElementById("kind-tabs"),
  repositoryLink: document.getElementById("repository-link"),
  seriesKind: document.getElementById("series-kind"),
  seriesSelect: document.getElementById("series-select"),
  seriesTitle: document.getElementById("series-title"),
  status: document.getElementById("status"),
  updatedAt: document.getElementById("updated-at"),
};

function safePath(path) {
  return /^(main|branches\/[a-z0-9._-]+|pulls\/[1-9][0-9]*)\/$/.test(path);
}

function baseBenchmarkName(name) {
  const packageIndex = name.indexOf(" (");
  return packageIndex < 0 ? name : name.slice(0, packageIndex);
}

function displayName(name) {
  return baseBenchmarkName(name)
    .replace(/^Benchmark/, "")
    .replace(/^binary\//, "")
    .replace(/^(compile|run)\//, "");
}

function suite(platform, suffix) {
  return state.data?.entries?.[`${platform} ${suffix}`] || [];
}

function platformsFor(suffix) {
  const result = [];
  const ending = ` ${suffix}`;
  for (const name of Object.keys(state.data?.entries || {})) {
    if (name.endsWith(ending)) {
      result.push(name.slice(0, -ending.length));
    }
  }
  return [...new Set(result)].sort((a, b) => {
    const order = { Linux: 0, macOS: 1 };
    return (order[a] ?? 2) - (order[b] ?? 2) || a.localeCompare(b);
  });
}

function benchmarkKeys(entries, predicate, key = (name) => name) {
  const keys = new Set();
  for (const entry of entries) {
    for (const bench of entry.benches || []) {
      const value = key(bench.name);
      if (predicate(value, bench)) {
        keys.add(value);
      }
    }
  }
  return [...keys].sort();
}

function latestValues(entries, metrics, key) {
  const values = [];
  for (const entry of entries) {
    for (const metric of metrics) {
      const bench = (entry.benches || []).find((item) => key(item.name) === metric);
      if (bench && Number.isFinite(bench.value) && bench.value > 0) {
        values.push(bench.value);
      }
    }
  }
  return values;
}

function chartSpec(title, platform, entries, metrics, options = {}) {
  if (entries.length === 0 || metrics.length === 0) {
    return null;
  }
  const key = options.key || ((name) => name);
  const values = latestValues(entries, metrics, key);
  const min = Math.min(...values);
  const max = Math.max(...values);
  return {
    entries,
    key,
    logarithmic: min > 0 && max / min >= 1000,
    metrics,
    platform,
    title,
    unit: options.unit || "",
  };
}

function sizeSpecs(platform, overviewOnly) {
  const entries = suite(platform, "program binary size");
  const names = benchmarkKeys(entries, () => true);
  const specs = [
    chartSpec("Executable file size", platform, entries, names.filter((name) => name.endsWith("/file")), {
      unit: "bytes",
    }),
  ];
  if (!overviewOnly) {
    const workloads = [...new Set(names.map((name) => name.split("/")[1]).filter(Boolean))].sort();
    for (const workload of workloads) {
      specs.push(chartSpec(
        `${workload} sections`,
        platform,
        entries,
        names.filter((name) => name.startsWith(`binary/${workload}/`) && !name.endsWith("/file")),
        { unit: "bytes" },
      ));
    }
  }
  return specs;
}

function timingSpecs(platform, overviewOnly) {
  const entries = suite(platform, "program build and run time");
  const names = benchmarkKeys(entries, () => true);
  const specs = [];
  if (!overviewOnly) {
    specs.push(chartSpec(
      "Build time",
      platform,
      entries,
      names.filter((name) => name.startsWith("compile/")),
      { unit: "ns" },
    ));
  }
  specs.push(chartSpec(
    "Process time",
    platform,
    entries,
    names.filter((name) => name.startsWith("run/")),
    { unit: "ns" },
  ));
  return specs;
}

function coreGroup(name) {
  switch (true) {
    case /^Benchmark(MergeCompilerFlags|MergeLinkerFlags|LookupPCRandom)$/.test(name):
      return "compiler";
    case /^Benchmark(Global|TLS|GLS)Read$/.test(name):
      return "local-read";
    case /^Benchmark(Global|TLS|GLS)Write$/.test(name):
      return "local-write";
    case /^Benchmark(DirectCall|InterfaceCall)$/.test(name):
      return "calls";
    case /^Benchmark(Defer|RuntimeGetG)$/.test(name):
      return "runtime";
    case /^BenchmarkGoroutine$/.test(name):
      return "goroutine";
    case /^BenchmarkChannel/.test(name):
      return "channels";
    default:
      return "other";
  }
}

function coreSpecs(platform, category) {
  const entries = suite(platform, "compiler and core language");
  const names = benchmarkKeys(entries, () => true, baseBenchmarkName);
  const definitions = category === "compiler"
    ? [{ id: "compiler", title: "Compiler helpers" }]
    : [
        { id: "local-read", title: "Local storage reads" },
        { id: "local-write", title: "Local storage writes" },
        { id: "calls", title: "Call dispatch" },
        { id: "runtime", title: "Runtime control flow" },
        { id: "goroutine", title: "Goroutine creation" },
        { id: "channels", title: "Channels" },
        { id: "other", title: "Other core benchmarks" },
      ];
  return definitions.map((definition) => chartSpec(
    definition.title,
    platform,
    entries,
    names.filter((name) => coreGroup(name) === definition.id),
    { key: baseBenchmarkName, unit: "ns/op" },
  ));
}

function specsForActiveCategory() {
  const specs = [];
  if (state.activeCategory === "overview" || state.activeCategory === "size") {
    for (const platform of platformsFor("program binary size")) {
      specs.push(...sizeSpecs(platform, state.activeCategory === "overview"));
    }
  }
  if (state.activeCategory === "overview" || state.activeCategory === "timing") {
    for (const platform of platformsFor("program build and run time")) {
      specs.push(...timingSpecs(platform, state.activeCategory === "overview"));
    }
  }
  if (state.activeCategory === "compiler" || state.activeCategory === "runtime") {
    for (const platform of platformsFor("compiler and core language")) {
      specs.push(...coreSpecs(platform, state.activeCategory));
    }
  }
  return specs.filter(Boolean);
}

function formatValue(value, unit) {
  if (!Number.isFinite(value)) {
    return "";
  }
  if (unit === "bytes") {
    if (value >= 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
    if (value >= 1024) return `${(value / 1024).toFixed(1)} KiB`;
    return `${Math.round(value)} B`;
  }
  if (unit === "ns" || unit === "ns/op") {
    const suffix = unit === "ns/op" ? "/op" : "";
    if (value >= 1e9) return `${(value / 1e9).toFixed(2)} s${suffix}`;
    if (value >= 1e6) return `${(value / 1e6).toFixed(2)} ms${suffix}`;
    if (value >= 1e3) return `${(value / 1e3).toFixed(2)} us${suffix}`;
    return `${value.toFixed(2)} ns${suffix}`;
  }
  return `${value} ${unit}`;
}

function renderChart(spec) {
  const card = document.createElement("article");
  card.className = "chart-card";
  const header = document.createElement("header");
  header.className = "chart-header";
  const title = document.createElement("h3");
  title.textContent = spec.title;
  const meta = document.createElement("span");
  meta.className = "chart-meta";
  meta.textContent = `${spec.platform} · ${spec.unit}${spec.logarithmic ? " · log" : ""}`;
  header.append(title, meta);

  const frame = document.createElement("div");
  frame.className = "chart-frame";
  const canvas = document.createElement("canvas");
  frame.appendChild(canvas);
  card.append(header, frame);
  elements.charts.appendChild(card);

  const datasets = spec.metrics.map((metric, index) => ({
    label: displayName(metric),
    data: spec.entries.map((entry) => {
      const bench = (entry.benches || []).find((item) => spec.key(item.name) === metric);
      return bench && Number.isFinite(bench.value) ? bench.value : null;
    }),
    borderColor: colors[index % colors.length],
    backgroundColor: colors[index % colors.length],
    borderWidth: 2,
    pointRadius: spec.entries.length <= 2 ? 3 : 1.5,
    pointHoverRadius: 5,
    spanGaps: true,
    tension: 0.12,
  }));
  const chart = new Chart(canvas, {
    type: "line",
    data: {
      labels: spec.entries.map((entry) => entry.commit.id.slice(0, 8)),
      datasets,
    },
    options: {
      animation: false,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: {
          align: "start",
          labels: { boxHeight: 8, boxWidth: 20, usePointStyle: false },
          position: "bottom",
        },
        tooltip: {
          callbacks: {
            afterTitle(items) {
              const entry = spec.entries[items[0].dataIndex];
              return entry.commit.message || "";
            },
            label(item) {
              return `${item.dataset.label}: ${formatValue(item.parsed.y, spec.unit)}`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
          title: { display: true, text: "commit" },
        },
        y: {
          beginAtZero: !spec.logarithmic,
          type: spec.logarithmic ? "logarithmic" : "linear",
          ticks: { callback: (value) => formatValue(Number(value), spec.unit) },
        },
      },
      onClick(_event, active) {
        if (active.length > 0) {
          const url = spec.entries[active[0].index].commit.url;
          if (url) window.open(url, "_blank", "noopener");
        }
      },
    },
  });
  state.charts.push(chart);
}

function renderCharts() {
  for (const chart of state.charts) chart.destroy();
  state.charts = [];
  elements.charts.replaceChildren();
  const specs = specsForActiveCategory();
  if (specs.length === 0) {
    elements.status.textContent = "No benchmark samples have been published for this category.";
    return;
  }
  elements.status.textContent = "";
  for (const spec of specs) renderChart(spec);
}

function renderCategoryTabs() {
  elements.categoryTabs.replaceChildren();
  for (const category of categories) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = category.label;
    button.dataset.category = category.id;
    button.setAttribute("aria-selected", String(category.id === state.activeCategory));
    button.addEventListener("click", () => {
      state.activeCategory = category.id;
      renderCategoryTabs();
      renderCharts();
    });
    elements.categoryTabs.appendChild(button);
  }
}

function selectSeries(series) {
  state.selected = series;
  const path = series.path.replace(/\/$/, "");
  const url = new URL(window.location.href);
  url.searchParams.set("series", path);
  history.replaceState(null, "", url);
  loadSeries(series);
}

function renderSeriesPicker() {
  const choices = state.series.filter((series) => series.kind === state.activeKind);
  elements.seriesSelect.replaceChildren();
  for (const series of choices) {
    const option = document.createElement("option");
    option.value = series.path;
    option.textContent = series.label;
    elements.seriesSelect.appendChild(option);
  }
  elements.seriesSelect.disabled = choices.length === 0;
  if (choices.length === 0) {
    state.selected = null;
    state.data = null;
    elements.seriesTitle.textContent = "No benchmark series";
    renderCharts();
    return;
  }
  const selected = choices.find((series) => state.selected?.path === series.path) || choices[0];
  elements.seriesSelect.value = selected.path;
  selectSeries(selected);
}

async function readBenchmarkData(path) {
  const response = await fetch(`${path}data.js`, { cache: "no-store" });
  if (!response.ok) throw new Error(`benchmark data returned HTTP ${response.status}`);
  const source = await response.text();
  if (!source.startsWith(dataPrefix)) throw new Error("benchmark data has an invalid prefix");
  return JSON.parse(source.slice(dataPrefix.length));
}

async function loadSeries(series) {
  elements.status.textContent = "Loading benchmark samples...";
  elements.seriesKind.textContent = series.kind === "pull" ? "Pull request" : series.kind;
  elements.seriesTitle.textContent = series.label;
  elements.commitLink.textContent = series.sha ? series.sha.slice(0, 12) : "";
  elements.commitLink.href = series.sourceUrl || "#";
  elements.updatedAt.textContent = series.updatedAt ? new Date(series.updatedAt).toLocaleString() : "";
  try {
    state.data = await readBenchmarkData(series.path);
    const repository = state.data.repoUrl || `https://github.com/${location.hostname.split(".")[0]}/llgo`;
    elements.repositoryLink.href = repository;
    elements.repositoryLink.textContent = repository.replace("https://github.com/", "");
    renderCharts();
  } catch (error) {
    state.data = null;
    elements.charts.replaceChildren();
    elements.status.textContent = `Unable to load benchmark history: ${error.message}`;
  }
}

function setKind(kind) {
  state.activeKind = kind;
  for (const button of elements.kindTabs.querySelectorAll("button[data-kind]")) {
    button.setAttribute("aria-selected", String(button.dataset.kind === kind));
  }
  renderSeriesPicker();
}

async function initialize() {
  renderCategoryTabs();
  for (const button of elements.kindTabs.querySelectorAll("button[data-kind]")) {
    button.addEventListener("click", () => setKind(button.dataset.kind));
  }
  elements.seriesSelect.addEventListener("change", () => {
    const series = state.series.find((item) => item.path === elements.seriesSelect.value);
    if (series) selectSeries(series);
  });

  try {
    const response = await fetch("series.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`series index returned HTTP ${response.status}`);
    const index = await response.json();
    state.series = (Array.isArray(index.series) ? index.series : []).filter((item) => safePath(item.path));
    if (!state.series.some((item) => item.kind === "main")) {
      state.series.unshift({
        kind: "main",
        id: "main",
        label: "main",
        path: "main/",
        sha: "",
        sourceUrl: "",
        updatedAt: "",
      });
    }
    const requested = new URLSearchParams(location.search).get("series");
    state.selected = state.series.find((item) => item.path.replace(/\/$/, "") === requested) || state.series[0];
    state.activeKind = state.selected.kind;
    setKind(state.activeKind);
  } catch (error) {
    elements.seriesTitle.textContent = "Benchmark history unavailable";
    elements.status.textContent = error.message;
  }
}

initialize();
