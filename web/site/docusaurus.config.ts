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
      title: "Skills Hub",
      items: [
        { type: "docSidebar", sidebarId: "docs", position: "left", label: "Docs" },
        // The hub is a self-contained static page under static/hub.
        { href: "/skillseal/hub/", label: "Skills", position: "left" },
        {
          href: "https://github.com/getskillseal/skillseal",
          label: "GitHub",
          position: "right",
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
