const DEFAULT_SETTINGS = {
  theme: "auto",
  center: true,
  width: "900",
  fontFamily: "system",
  fontSize: 16,
  lineHeight: 1.6,
  autoRefresh: true,
  autoRefreshInterval: 3,
  autoOutline: true,
  gfm: true,
  tables: true,
  taskLists: true,
  highlight: true,
  mermaid: true,
  wikilinks: true,
  frontmatter: true,
  smartypants: false,
  breaks: false,
  customCss: "",
};

const FONT_STACKS = {
  system: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

const Settings = {
  current: { ...DEFAULT_SETTINGS },

  async load() {
    let stored = {};
    try {
      stored = JSON.parse(localStorage.getItem("mdviewer-settings") || "{}");
    } catch {
      /* corrupt or missing, fall back to defaults */
    }
    this.current = { ...DEFAULT_SETTINGS, ...stored };
    return this.current;
  },

  async save() {
    localStorage.setItem("mdviewer-settings", JSON.stringify(this.current));
  },

  async update(patch) {
    this.current = { ...this.current, ...patch };
    await this.save();
    this.apply();
  },

  async reset() {
    this.current = { ...DEFAULT_SETTINGS };
    await this.save();
    this.apply();
    this.syncFormFromSettings();
  },

  isDarkMode() {
    const s = this.current;
    return s.theme === "auto"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : ["dark", "nord", "solarized-dark"].includes(s.theme);
  },

  apply() {
    const s = this.current;
    const root = document.documentElement;

    if (s.theme === "auto") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", s.theme);
    }
    const isDark = this.isDarkMode();
    const lightHljs = document.getElementById("hljs-theme-light");
    const darkHljs = document.getElementById("hljs-theme-dark");
    if (lightHljs) lightHljs.disabled = isDark;
    if (darkHljs) darkHljs.disabled = !isDark;

    root.style.setProperty("--md-font-size", s.fontSize + "px");
    root.style.setProperty("--md-line-height", s.lineHeight);
    root.style.setProperty("--md-font-family", FONT_STACKS[s.fontFamily] || FONT_STACKS.system);
    root.style.setProperty("--content-width", s.width === "none" ? "none" : s.width + "px");

    const wrapper = document.getElementById("content-wrapper");
    wrapper.classList.toggle("centered", !!s.center);

    document.getElementById("custom-css-style").textContent = s.customCss || "";

    const indicator = document.getElementById("refresh-indicator");
    if (indicator) indicator.classList.toggle("hidden", !s.autoRefresh);
  },

  syncFormFromSettings() {
    const s = this.current;
    document.getElementById("opt-theme").value = s.theme;
    document.getElementById("opt-center").checked = s.center;
    document.getElementById("opt-width").value = s.width;
    document.getElementById("opt-font-family").value = s.fontFamily;
    document.getElementById("opt-font-size").value = s.fontSize;
    document.getElementById("opt-font-size-val").textContent = s.fontSize + "px";
    document.getElementById("opt-line-height").value = s.lineHeight;
    document.getElementById("opt-line-height-val").textContent = s.lineHeight;
    document.getElementById("opt-autorefresh").checked = s.autoRefresh;
    document.getElementById("opt-autorefresh-interval").value = s.autoRefreshInterval;
    document.getElementById("opt-outline").checked = s.autoOutline;
    document.getElementById("opt-gfm").checked = s.gfm;
    document.getElementById("opt-tables").checked = s.tables;
    document.getElementById("opt-tasklists").checked = s.taskLists;
    document.getElementById("opt-highlight").checked = s.highlight;
    document.getElementById("opt-mermaid").checked = s.mermaid;
    document.getElementById("opt-wikilinks").checked = s.wikilinks;
    document.getElementById("opt-frontmatter").checked = s.frontmatter;
    document.getElementById("opt-smartypants").checked = s.smartypants;
    document.getElementById("opt-breaks").checked = s.breaks;
    document.getElementById("opt-custom-css").value = s.customCss;
  },

  bindForm(onChangeExtra) {
    const bind = (id, key, transform = (v) => v) => {
      const el = document.getElementById(id);
      const evt = el.type === "checkbox" ? "change" : el.tagName === "SELECT" ? "change" : "input";
      el.addEventListener(evt, () => {
        const raw = el.type === "checkbox" ? el.checked : el.value;
        this.update({ [key]: transform(raw) });
        if (onChangeExtra) onChangeExtra(key);
      });
    };

    bind("opt-theme", "theme");
    bind("opt-center", "center");
    bind("opt-width", "width");
    bind("opt-font-family", "fontFamily");
    bind("opt-font-size", "fontSize", (v) => {
      document.getElementById("opt-font-size-val").textContent = v + "px";
      return Number(v);
    });
    bind("opt-line-height", "lineHeight", (v) => {
      document.getElementById("opt-line-height-val").textContent = v;
      return Number(v);
    });
    bind("opt-autorefresh", "autoRefresh");
    bind("opt-autorefresh-interval", "autoRefreshInterval", Number);
    bind("opt-outline", "autoOutline");
    bind("opt-gfm", "gfm");
    bind("opt-tables", "tables");
    bind("opt-tasklists", "taskLists");
    bind("opt-highlight", "highlight");
    bind("opt-mermaid", "mermaid");
    bind("opt-wikilinks", "wikilinks");
    bind("opt-frontmatter", "frontmatter");
    bind("opt-smartypants", "smartypants");
    bind("opt-breaks", "breaks");
    bind("opt-custom-css", "customCss");

    document.getElementById("btn-reset-settings").addEventListener("click", () => this.reset());
  },
};
