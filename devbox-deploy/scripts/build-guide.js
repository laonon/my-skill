#!/usr/bin/env node
// 把 skill 的 SKILL.md 渲染成 /deploy/ 文档页
// 用法: node build-guide.js [输出路径]   （默认 /tmp/deploy-guide.html）
'use strict';

const fs = require('fs');
const path = require('path');

const SKILL = path.join(__dirname, '..', 'SKILL.md');
const OUT = process.argv[2] || '/tmp/deploy-guide.html';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const slug = (s) => s.replace(/`/g, '').trim()
  .replace(/[^\w\u4e00-\u9fa5-]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .toLowerCase();

// 行内：`code` / **bold** / [text](url)
function inline(s) {
  let out = esc(s);
  out = out.replace(/`([^`]+)`/g, (_, c) => '<code>' + c + '</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, t, u) => {
    const href = /^https?:|^\//.test(u) ? u : '#' + slug(u);
    return '<a href="' + href + '"' + (/^https?:/.test(u) ? ' target="_blank" rel="noopener"' : '') + '>' + t + '</a>';
  });
  return out;
}

let md = fs.readFileSync(SKILL, 'utf8').replace(/\r\n/g, '\n');
// 跳过开头 YAML frontmatter（--- ... ---）
if (/^---\s*\n/.test(md)) {
  const end = md.indexOf('\n---', 3);
  if (end > 0) md = md.slice(md.indexOf('\n', end + 1) + 1);
}
const lines = md.split('\n');

const body = [];
const toc = [];
let i = 0;

while (i < lines.length) {
  const line = lines[i];

  // 代码块
  if (/^```/.test(line)) {
    const lang = line.slice(3).trim();
    const buf = [];
    i++;
    while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
    i++;
    body.push('<pre class="code"' + (lang ? ' data-lang="' + esc(lang) + '"' : '') + '><code>' + esc(buf.join('\n')) + '</code></pre>');
    continue;
  }

  // 表格
  if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1])) {
    const head = line.trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim());
    i += 2;
    const rows = [];
    while (i < lines.length && /^\s*\|/.test(lines[i])) {
      rows.push(lines[i].trim().replace(/^\||\|$/g, '').split('|').map(s => s.trim()));
      i++;
    }
    let t = '<div class="tbl"><table><thead><tr>' +
      head.map(h => '<th>' + inline(h) + '</th>').join('') + '</tr></thead><tbody>';
    for (const r of rows) {
      t += '<tr>' + r.map(c => '<td>' + inline(c) + '</td>').join('') + '</tr>';
    }
    t += '</tbody></table></div>';
    body.push(t);
    continue;
  }

  // 标题
  const hm = line.match(/^(#{1,4})\s+(.*)$/);
  if (hm) {
    const level = hm[1].length;
    const text = hm[2].trim();
    const id = slug(text);
    if (level === 2 || level === 3) {
      toc.push({ level, text, id });
    }
    body.push('<h' + level + ' id="' + id + '">' + inline(text) +
      '<a class="anchor" href="#' + id + '" aria-hidden="true">#</a></h' + level + '>');
    i++;
    continue;
  }

  // 分隔线
  if (/^---+\s*$/.test(line)) { body.push('<hr>'); i++; continue; }

  // 引用
  if (/^>\s?/.test(line)) {
    const buf = [];
    while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
    body.push('<blockquote>' + inline(buf.join(' ')) + '</blockquote>');
    continue;
  }

  // 列表（含嵌套一层）
  if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
    const ordered = /^\s*\d+\./.test(line);
    let html = ordered ? '<ol>' : '<ul>';
    let depth = 0;
    while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
      const indent = lines[i].match(/^(\s*)/)[1].length;
      const text = lines[i].replace(/^\s*([-*]|\d+\.)\s+/, '');
      if (indent >= 2 && depth === 0) { html += '<ul class="sub">'; depth = 1; }
      else if (indent < 2 && depth === 1) { html += '</ul>'; depth = 0; }
      html += '<li>' + inline(text) + '</li>';
      i++;
    }
    if (depth === 1) html += '</ul>';
    html += ordered ? '</ol>' : '</ul>';
    body.push(html);
    continue;
  }

  // 空行
  if (!line.trim()) { i++; continue; }

  // 段落（合并连续行）
  const buf = [line];
  i++;
  while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|```|\s*\||>\s?|\s*([-*]|\d+\.)\s|---)/.test(lines[i])) {
    buf.push(lines[i]);
    i++;
  }
  body.push('<p>' + inline(buf.join(' ')) + '</p>');
}

const nav = toc.map(t =>
  '<a class="l' + t.level + '" href="#' + t.id + '">' + esc(t.text.replace(/`/g, '')) + '</a>'
).join('\n');

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>开发机部署指南 · guide.realsee.cn</title>
<link rel="icon" href="/favicon-32.png" sizes="32x32">
<style>
:root{
  --bg:#f7f8fa; --panel:#fff; --text:#101828; --text-2:#475467; --text-3:#98a2b3;
  --border:#eaecf0; --accent:#2563eb; --accent-soft:#eff4ff; --code-bg:#0f172a;
  --code-fg:#d7e3f4; --warn-bg:#fffaeb; --warn-bd:#fedf89;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;scroll-padding-top:24px}
body{margin:0;background:var(--bg);color:var(--text);
  font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;
  font-size:14px;line-height:1.75;-webkit-font-smoothing:antialiased}
.wrap{display:flex;max-width:1440px;margin:0 auto;align-items:flex-start}
.side{
  width:250px;flex:0 0 250px;position:sticky;top:0;height:100vh;overflow-y:auto;
  padding:26px 18px 40px;border-right:1px solid var(--border);background:var(--panel);
}
.brand{font-size:14px;font-weight:600;margin-bottom:4px}
.brand small{display:block;font-size:11.5px;color:var(--text-3);font-weight:400;margin-top:2px}
.nav{margin-top:20px;display:flex;flex-direction:column;gap:1px}
.nav a{
  display:block;padding:5px 9px;border-radius:6px;color:var(--text-2);text-decoration:none;
  font-size:12.5px;line-height:1.5;
}
.nav a:hover{background:var(--accent-soft);color:var(--accent)}
.nav a.l2{font-weight:500;color:var(--text);margin-top:6px}
.nav a.l3{padding-left:20px;font-size:12px;color:var(--text-3)}
.doc{flex:1;min-width:0;padding:34px 44px 90px;max-width:1000px}
.agent{
  background:var(--warn-bg);border:1px solid var(--warn-bd);border-radius:12px;
  padding:16px 18px;margin-bottom:30px;
}
.agent h3{margin:0 0 8px;font-size:13px;color:#93370d;font-weight:600}
.agent ol{margin:0;padding-left:20px;font-size:12.5px;color:#7a3b0e;line-height:1.85}
.agent code{background:#fef0c7;color:#93370d}
h1{font-size:26px;margin:0 0 8px;letter-spacing:-.01em}
h2{font-size:19px;margin:44px 0 14px;padding-top:10px;border-top:1px solid var(--border);letter-spacing:-.01em}
h3{font-size:15px;margin:26px 0 10px;color:var(--text)}
h4{font-size:13.5px;margin:20px 0 8px;color:var(--text-2)}
.anchor{opacity:0;margin-left:8px;color:var(--accent);text-decoration:none;font-weight:400}
h2:hover .anchor,h3:hover .anchor{opacity:.5}
p{margin:10px 0}
ul,ol{margin:10px 0;padding-left:22px}
li{margin:4px 0}
ul.sub{margin:4px 0 4px 2px;padding-left:18px}
ul.sub li{font-size:13px;color:var(--text-2)}
code{
  font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;
  background:#f2f4f7;color:#344054;padding:1.5px 5px;border-radius:4px;
}
pre.code{
  background:var(--code-bg);color:var(--code-fg);padding:14px 16px;border-radius:10px;
  overflow:auto;margin:12px 0;font-size:12px;line-height:1.8;
}
pre.code code{background:none;color:inherit;padding:0;font-size:inherit}
.tbl{overflow-x:auto;margin:14px 0;border:1px solid var(--border);border-radius:10px;background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:12.5px}
th{background:#f9fafb;text-align:left;font-weight:600;color:var(--text-2);
  padding:9px 12px;border-bottom:1px solid var(--border);white-space:nowrap}
td{padding:9px 12px;border-bottom:1px solid #f2f4f7;vertical-align:top;color:var(--text-2)}
tr:last-child td{border-bottom:none}
td strong{color:var(--text)}
blockquote{
  margin:12px 0;padding:10px 16px;border-left:3px solid var(--accent);
  background:var(--accent-soft);border-radius:0 8px 8px 0;color:#1e40af;font-size:13px;
}
hr{border:none;border-top:1px solid var(--border);margin:34px 0}
a{color:var(--accent)}
@media(max-width:900px){
  .side{display:none}
  .doc{padding:22px 18px 60px}
}
</style>
</head>
<body>
<div class="wrap">
  <aside class="side">
    <div class="brand">开发机部署指南<small>guide.realsee.cn</small></div>
    <nav class="nav">${nav}</nav>
  </aside>
  <main class="doc">
    <div class="agent">
      <h3>给 AI 的话（把这段直接贴给它）</h3>
      <ol>
        <li>先读这份文档，再动手；命令都在这里，别自己发明</li>
        <li>新应用走 <code>dvctl deploy</code>，端口自动分配，别申请固定端口</li>
        <li><b>发新版本用同名再传一次</b>（自动按更新处理，站点不中断）；<b>不要先 remove 再上传</b>，
            那会有整包上传那么长的空窗</li>
        <li>应用挂载在 <code>/apps/&lt;应用名&gt;/</code>，前端 base 必须设成这个子路径</li>
        <li>单包上限 500MB，更大的项目走镜像部署</li>
        <li>需要 MySQL 时给 <code>dvctl</code> 加 <code>--mysql</code>，连接串用 <code>host.docker.internal</code></li>
        <li>拿不准的地方以 SKILL.md 为准</li>
      </ol>
    </div>
    ${body.join('\n')}
  </main>
</div>
</body>
</html>
`;

fs.writeFileSync(OUT, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(1);
console.log('生成 ' + OUT + ' ' + kb + 'KB，目录项 ' + toc.length);
