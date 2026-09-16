#!/usr/bin/env node
/**
 * 版本号一致性 + manifest 元数据体检（CI 与本地共用）
 *
 * 用法：
 *   node .github/scripts/check-version.mjs                 只校验三文件互相一致
 *   node .github/scripts/check-version.mjs --tag 0.17.3    额外校验 manifest.version === tag
 *
 * 退出码：0 = 通过（可能带 warning），1 = 存在 error
 * 在 GitHub Actions 中运行时，warning / error 会额外输出 ::warning:: / ::error:: 注解
 */

import { readFileSync } from "node:fs";

const inActions = process.env.GITHUB_ACTIONS === "true";
const errors = [];
const warnings = [];
const notes = [];

function readJson(rel) {
  try {
    return JSON.parse(readFileSync(rel, "utf8"));
  } catch (e) {
    errors.push(`无法读取或解析 ${rel}：${e.message}`);
    return null;
  }
}

const manifest = readJson("manifest.json");
const pkg = readJson("package.json");
const versions = readJson("versions.json");

const SEMVER = /^\d+\.\d+\.\d+$/;

if (manifest && pkg && versions) {
  // ── 1. 三处版本号必须一致 ────────────────────────────────
  const mv = manifest.version;
  const pv = pkg.version;

  if (!SEMVER.test(mv ?? "")) errors.push(`manifest.json version "${mv}" 不是 x.y.z 格式`);
  if (!SEMVER.test(pv ?? "")) errors.push(`package.json version "${pv}" 不是 x.y.z 格式`);
  if (mv !== pv) errors.push(`版本号不一致：manifest.json=${mv} / package.json=${pv}`);

  const keys = Object.keys(versions);
  if (!keys.includes(mv)) {
    errors.push(`versions.json 缺少 ${mv} 条目（新版本必须追加，旧条目不删）`);
  } else if (versions[mv] !== manifest.minAppVersion) {
    errors.push(
      `versions.json["${mv}"]=${versions[mv]} 与 manifest.minAppVersion=${manifest.minAppVersion} 不一致`
    );
  }

  const newest = keys[keys.length - 1];
  if (newest !== mv) {
    warnings.push(`versions.json 最后一条是 ${newest}，当前版本是 ${mv}（应按时间顺序以最新版结尾）`);
  }
  notes.push(`versions.json 共 ${keys.length} 条记录，最新 ${newest}`);

  // ── 2. manifest 合规（按官方提交要求，非致命只提示）──────
  if (manifest.id !== String(manifest.id).toLowerCase()) warnings.push(`manifest id "${manifest.id}" 含大写字母`);
  if (String(manifest.id).includes("obsidian")) warnings.push(`manifest id 不应包含 "obsidian"`);
  if (String(manifest.id).endsWith("plugin")) warnings.push(`manifest id 不应以 "plugin" 结尾`);
  if (/plugin/i.test(manifest.name)) warnings.push(`manifest name "${manifest.name}" 不应含 "Plugin"`);
  if (/obsidian/i.test(manifest.name)) warnings.push(`manifest name "${manifest.name}" 不应含 "Obsidian"`);
  if (/^obsi/i.test(manifest.name)) warnings.push(`manifest name "${manifest.name}" 不应以 "Obsi" 开头`);
  if (/dian$/i.test(manifest.name)) warnings.push(`manifest name "${manifest.name}" 不应以 "dian" 结尾`);

  // ── 2b. description 硬红线（审核实测：命中即 Failed，必须当 error）──
  // 「Obsidian」在描述里是冗余的——目录语境已隐含；同理 "This plugin…" 也属冗余。
  const desc = manifest.description ?? "";
  if (/obsidian/i.test(desc)) {
    errors.push(`manifest description 不得包含 "Obsidian"（目录语境已隐含，冗余即驳回）`);
  }
  if (/^\s*this (is a |plugin )/i.test(desc)) {
    errors.push(`manifest description 不得以 "This plugin…" 开头（冗余）`);
  }
  if (desc.length > 250) errors.push(`manifest description 超过 250 字符（当前 ${desc.length}）`);
  if (!/[.?!)]$/.test(desc.trim())) {
    errors.push(`manifest description 必须以 . / ? / ! / ) 结尾（当前结尾 "${desc.trim().slice(-1)}"）`);
  }
  if (/[^\x20-\x7E]/.test(desc)) warnings.push("manifest description 含非 ASCII 字符（官方要求英文）");
  if (!manifest.author) errors.push("manifest author 为空");

  notes.push(`当前版本 ${mv}，minAppVersion ${manifest.minAppVersion}`);
  notes.push(`description（${desc.length} 字符）：${desc}`);
}

// ── 3. --tag 校验（发版时用）────────────────────────────────
const tagIdx = process.argv.indexOf("--tag");
if (tagIdx !== -1) {
  const tag = process.argv[tagIdx + 1];
  if (!tag) {
    errors.push("--tag 后面缺少版本号");
  } else if (manifest && tag !== manifest.version) {
    errors.push(`tag "${tag}" 与 manifest.json version "${manifest.version}" 不一致（tag 不加 v 前缀）`);
  } else if (manifest) {
    notes.push(`tag "${tag}" 与 manifest version 一致`);
  }
}

// ── 输出 ────────────────────────────────────────────────────
for (const n of notes) console.log(`  ${n}`);
for (const w of warnings) console.log(inActions ? `::warning::${w}` : `  [warn] ${w}`);
for (const e of errors) console.log(inActions ? `::error::${e}` : `  [error] ${e}`);

if (errors.length) {
  console.error(`\n版本检查未通过：${errors.length} 个错误 / ${warnings.length} 个提示`);
  process.exit(1);
}
console.log(`\n版本检查通过（${warnings.length} 个提示）`);
