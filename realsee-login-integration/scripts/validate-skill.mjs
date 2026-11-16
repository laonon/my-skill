#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const skillFile = path.join(skillDir, 'SKILL.md');
const requiredReferences = [
  'references/architecture-and-flows.md',
  'references/server-reference-implementation.md',
  'references/security-checklist.md',
  'references/frontend-otp-sso.md',
  'references/configuration-and-validation.md',
];

function fail(message) {
  console.error(`校验失败：${message}`);
  process.exit(1);
}

function read(relative) {
  const file = path.join(skillDir, relative);
  if (!fs.existsSync(file) || !fs.statSync(file).isFile()) fail(`缺少文件 ${relative}`);
  return fs.readFileSync(file, 'utf8');
}

const skill = read('SKILL.md');
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
if (!frontmatter) fail('SKILL.md 缺少 YAML frontmatter');

for (const field of ['name:', 'description:', 'license:', 'compatibility:', 'metadata:', 'author:', 'version:', 'updated:']) {
  if (!frontmatter[1].includes(field)) fail(`frontmatter 缺少 ${field}`);
}
if (!/^name:\s*realsee-login-integration\s*$/m.test(frontmatter[1])) {
  fail('Skill name 必须为 realsee-login-integration');
}
if (!/^\s*version:\s*"2\.\d+\.\d+"\s*$/m.test(frontmatter[1])) {
  fail('version 必须是 2.x.y，并带引号');
}

const files = [['SKILL.md', skill]];
for (const relative of requiredReferences) {
  if (!skill.includes(`\`${relative}\``)) fail(`SKILL.md 未引用 ${relative}`);
  files.push([relative, read(relative)]);
}

for (const [relative, content] of files) {
  const fences = content.match(/^```/gm) || [];
  if (fences.length % 2 !== 0) fail(`${relative} 的 Markdown 代码围栏未闭合`);
  if (!content.endsWith('\n')) fail(`${relative} 文件末尾缺少换行`);
}

const combined = files.map(([relative, content]) => `\n### ${relative}\n${content}`).join('\n');

const forbiddenPatterns = [
  ['macOS 绝对用户路径', /\/Users\/[A-Za-z0-9._-]+\//],
  ['Linux 个人 home 绝对路径', /\/home\/[A-Za-z0-9._-]+\//],
  ['私网 IPv4', /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/],
  ['中国大陆手机号', /\b1[3-9]\d{9}\b/],
  ['PEM 私钥', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['疑似固定 commit、token 或 secret', /\b[a-f0-9]{40,128}\b/i],
  ['项目特定默认 source', /\bSSO_VR_APP\b/],
  ['项目特定 Cookie 名', /\b(?:vibe_session|console_session)\b/],
  ['真实内网域名', /\b(?:guide|login)\.realsee\.cn\b/],
  ['未占位的密码赋值', /(?:PASSWORD|PASSWD|SESSION_SECRET)\s*=\s*(?!<)[^\s`]+/i],
];

for (const [label, pattern] of forbiddenPatterns) {
  if (pattern.test(combined)) fail(`发现${label}`);
}

const requiredConcepts = [
  '服务端',
  'checkLogin',
  'HttpOnly',
  'SameSite',
  'AUTH_MODE',
  '访问令牌',
  '滑动续期',
  '每次请求',
  '最低权限',
  'local',
  'dual',
  'state',
  'callback',
  'Origin',
  '限流',
  'bootstrap',
  'one-time-code',
  'correlation ID',
  '不发送真实短信',
  '真实登录',
];

for (const concept of requiredConcepts) {
  if (!combined.includes(concept)) fail(`缺少关键主题：${concept}`);
}

if (!skill.includes('references/server-reference-implementation.md')) {
  fail('SKILL.md 必须引用服务端参考实现');
}

console.log(`Skill 校验通过：${files.length} 个 Markdown 文件，未发现高风险敏感模式。`);
