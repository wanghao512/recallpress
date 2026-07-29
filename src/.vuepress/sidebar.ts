import { sidebar } from "vuepress-theme-hope";

import knowledgeBase from "./knowledgeBase.js";

export default sidebar({
  "/": [
    "",
    {
      text: knowledgeBase.name,
      icon: "graduation-cap",
      prefix: "interview/",
      link: "interview/",
      children: "structure",
    },
  ],
});
