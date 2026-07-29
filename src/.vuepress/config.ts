import { defineUserConfig } from "vuepress";

import knowledgeBase from "./knowledgeBase.js";
import theme from "./theme.js";

export default defineUserConfig({
  base: "/",

  lang: "zh-CN",
  title: knowledgeBase.name,
  description: knowledgeBase.description,

  theme,
});
