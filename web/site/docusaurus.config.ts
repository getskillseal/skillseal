import type { Config } from "@docusaurus/types";
import type * as Preset from "@docusaurus/preset-classic";

// Same platform as the upstream Skills Hub docs: Docusaurus 3, classic preset,
// docs-with-sidebar, breadcrumbs, right-hand table of contents, prev/next
// pagination, and an edit link on every page.
const config: Config = {
  title: "Skills Hub",
  tagline: "Content addressed agent skills, verified before they run",
  favicon: "img/favicon.svg",

  url: "https://getskillseal.github.io",
  baseUrl: "/skillseal/",
  organizationName: "getskillseal",
  projectName: "skillseal",
  trailingSlash: false,

  onBrokenLinks: "warn",
  onBrokenMarkdownLinks: "warn",

  i18n: { defaultLocale: "en", locales: ["en"] },

  presets: [
    [
      "classic",
      {
        docs: {
          sidebarPath: "./sidebars.ts",
          routeBasePath: "docs",
          breadcrumbs: true,
          showLastUpdateTime: false,
          editUrl:
            "https://github.com/getskillseal/skillseal/tree/main/web/site/",
        },
        blog: false,
        theme: { customCss: "./src/css/custom.css" },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: { defaultMode: "dark", disableSwitch: true, respectPrefersColorScheme: false },
    navbar: {
      // Mirror the homepage top menu: seal mark + wordmark, then the same
      // links in the same order. The hub is a self-contained static page under
      // static/hub, so its links are plain hrefs, not doc routes.
      title: "SkillSeal",
      logo: { alt: "SkillSeal", src: "img/favicon.svg", href: "/skillseal/hub/" },
      items: [
        { href: "/skillseal/hub/#skills", label: "Agent Skills", position: "left" },
        { href: "/skillseal/hub/seal.html", label: "Seal a skill", position: "left" },
        { href: "/skillseal/hub/seal.html#verify", label: "Verify a skill", position: "left" },
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs" },
        {
          href: "https://github.com/getskillseal/skillseal",
          position: "right",
          "aria-label": "GitHub",
          html:
            '<span class="nav-gh"><svg viewBox="0 0 24 24" fill="currentColor" width="15" height="15" aria-hidden="true"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49v-1.7c-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.1-1.5-1.1-1.5-.9-.63.07-.62.07-.62 1 .07 1.53 1.05 1.53 1.05.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.55-1.14-4.55-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9v2.82c0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>GitHub</span>',
        },
      ],
    },
    footer: {
      style: "dark",
      copyright:
        "A natural evolution of the open Agent Skills format · MIT License · 2026",
    },
    tableOfContents: { minHeadingLevel: 2, maxHeadingLevel: 3 },
  } satisfies Preset.ThemeConfig,
};

export default config;
