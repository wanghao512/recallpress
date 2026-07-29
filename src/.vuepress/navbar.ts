import { navbar } from "vuepress-theme-hope";

import knowledgeBase from "./knowledgeBase.js";

export default navbar([
  {
    text: "首页",
    icon: "house",
    link: "/",
  },
  {
    text: knowledgeBase.name,
    icon: "graduation-cap",
    link: "/interview/",
  },
]);
