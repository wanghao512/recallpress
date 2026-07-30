---
home: true
icon: house
# knowledge-base-home-title
title: "我的知识库"
heroText: "把每次对话，沉淀成真正属于你的知识库"
tagline: 使用 RecallPress 同步 ChatGPT 问答、自动整理题目，并以 Markdown 永久保存在本地 VuePress 项目中。
actions:
  - text: 进入知识库
    icon: arrow-right
    link: ./interview/
    type: primary

  - text: 查看同步内容
    icon: comments
    link: ./interview/chatgpt/
---

<div class="kb-home-shell">
  <section class="kb-proof-strip" aria-label="核心特性">
    <div><strong>LOCAL FIRST</strong><span>内容与密钥留在本机</span></div>
    <div><strong>MARKDOWN</strong><span>不锁定格式，随时迁移</span></div>
    <div><strong>MULTI LIBRARY</strong><span>学习、课程、项目一键切换</span></div>
  </section>
  <section class="kb-home-section kb-home-flow">
    <div class="kb-section-copy">
      <p class="kb-eyebrow">FROM CHAT TO KNOWLEDGE</p>
      <h2>不是收藏整段对话，<br>而是整理成可复习的知识。</h2>
      <p>助手会识别真正值得保存的问题，过滤提示词和格式约束，再结合已有目录完成分类与去重。每一道问题，最终都会成为一张独立、清晰的知识卡片。</p>
    </div>
    <div class="kb-pipeline" aria-label="同步处理流程">
      <article class="kb-pipeline-card kb-pipeline-source">
        <span>01 · CHATGPT</span>
        <strong>为什么 Attention<br>要除以 √dₖ？</strong>
        <small>当前页面中的完整问答</small>
      </article>
      <div class="kb-pipeline-bridge" aria-hidden="true"><i></i><b>筛选 · 分类 · 去重</b></div>
      <article class="kb-pipeline-card kb-pipeline-result">
        <span>02 · VUEPRESS</span>
        <strong>Transformer 高频面试题</strong>
        <small>10. Attention 分数为什么要除以 √dₖ？</small>
        <div class="kb-file-chip">Markdown · 已保存</div>
      </article>
    </div>
  </section>
  <section class="kb-feature-section">
    <div class="kb-section-heading">
      <div>
        <p class="kb-eyebrow">BUILT FOR YOUR OWN SYSTEM</p>
        <h2>从一次问答，长成一套知识体系</h2>
      </div>
      <p>保留 VuePress 的开放与可编辑，同时减少手动复制、整理和维护目录的重复工作。</p>
    </div>
    <div class="kb-feature-grid">
      <article>
        <span class="kb-feature-index">01</span>
        <h3>智能收录</h3>
        <p>区分真实知识问题与系统提示词，只保存以后仍值得阅读的内容。</p>
      </article>
      <article>
        <span class="kb-feature-index">02</span>
        <h3>自动归档</h3>
        <p>优先复用已有分类，确实没有合适位置时再创建稳定的新分类。</p>
      </article>
      <article>
        <span class="kb-feature-index">03</span>
        <h3>多知识库</h3>
        <p>为课程笔记、项目文档或复习资料分别保存目录、模型与分类规则。</p>
      </article>
      <article>
        <span class="kb-feature-index">04</span>
        <h3>本地可控</h3>
        <p>生成标准 Markdown 文件；可以继续编辑、Git 管理，也可以部署成网站。</p>
      </article>
    </div>
  </section>
  <section class="kb-quickstart">
    <div>
      <p class="kb-eyebrow">QUICK START</p>
      <h2>三步建立你的知识库</h2>
      <ol>
        <li><b>01</b><span>运行本地服务</span></li>
        <li><b>02</b><span>在 ChatGPT 完成问答</span></li>
        <li><b>03</b><span>点击扩展按钮完成同步</span></li>
      </ol>
    </div>
    <div class="kb-terminal" aria-label="启动命令">
      <div class="kb-terminal-top"><i></i><i></i><i></i><span>knowledge-base</span></div>
      <pre><code><em>$</em> pnpm install<br><em>$</em> pnpm dev:sync<br><br><span>✓ VuePress</span>  http://localhost:8080<br><span>✓ Sync API</span> http://127.0.0.1:3847</code></pre>
    </div>
  </section>
  <p class="kb-home-footnote"><span></span>浏览器扩展只读取当前页面已经显示的问答，不读取 ChatGPT 账号、Cookie 或密码。</p>
</div>
