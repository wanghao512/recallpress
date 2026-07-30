import { hopeTheme } from "vuepress-theme-hope";

import navbar from "./navbar.js";
import sidebar from "./sidebar.js";

export default hopeTheme({
  navbar,
  navbarLayout: {
    start: ["Brand"],
    center: [],
    end: ["Links", "Outlook", "Search"],
  },
  sidebar,
  displayFooter: false,

  markdown: {
    codeTabs: true,
    gfm: true,
    mark: true,
    math: {
      type: "katex",
    },
    tabs: true,
    tasklist: true,
  },

  plugins: {
    icon: {
      prefix: "fa6-solid:",
    },
  },
});
