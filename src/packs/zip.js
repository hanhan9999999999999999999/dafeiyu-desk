// 纯 Node 的 ZIP 解包器。
//
// 为什么自己写：发布包只带 src/，node_modules 不进安装包，所以任何第三方解压库
// 在用户机器上都不存在。Windows 自带的 tar.exe 能解 zip，但它对不同系统版本、
// 不同 Path 环境的行为不一致，而且报错信息没法用。ZIP 的目录结构足够简单：
// 中央目录 + 每个文件一段原始 deflate 流，zlib 是 Node 内置的 —— 一百多行就能
// 做到「可靠、可诊断、有上限」。
//
// 只支持模型导入真正会遇到的情况：
//   · 存储（method 0）与 deflate（method 8）—— 这两者覆盖 99.9% 的模型包
//   · UTF-8 名字标记；没有标记时按 UTF-8 试解，坏了退回 GBK（国内压缩软件常见）
//   · zip64 不处理（模型包不可能超过 4GB，遇到就明确报错）
// 加密、分卷、其它压缩算法一律拒绝并说明原因 —— 猜着解只会解出损坏的模型。

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const SIG_ZIP64_EOCD = 0x06064b50;

const DEFAULT_LIMITS = {
  files: 6000,
  totalBytes: 1.4 * 1024 * 1024 * 1024,
  fileBytes: 260 * 1024 * 1024,
  ratioGuard: 220,           // 单文件解压后 / 压缩前 的上限，防压缩炸弹
};

// Windows 上文件名不能带这些字符；模型资源里偶尔有（下载站改过名）。
const BAD_CHARS = /[<>:"|?*\u0000-\u001f]/g;

function decodeName(buf, flags) {
  if (flags & 0x800) return buf.toString("utf8");
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("\ufffd")) return utf8;
  try {
    return new TextDecoder("gbk").decode(buf);
  } catch (e) {
    return buf.toString("latin1");
  }
}

// 条目名归一化：分隔符统一、去掉盘符/绝对路径、拒绝 .. 穿越。
// 返回 "" 表示这条不该被写出去（目录项、macOS 垃圾、隐藏文件）。
function safeEntryName(raw) {
  let n = String(raw || "").replace(/\\/g, "/");
  if (!n || n.endsWith("/")) return "";
  // 有些压缩工具会把整条路径写成绝对路径
  n = n.replace(/^[a-zA-Z]:/, "").replace(/^\/+/, "");
  const parts = [];
  for (const seg of n.split("/")) {
    if (!seg || seg === "." ) continue;
    if (seg === "..") return "";                 // 穿越直接丢弃，不报错
    if (seg === "__MACOSX") return "";
    if (seg.startsWith("._")) return "";         // macOS 资源分叉
    if (seg === ".DS_Store" || seg === "Thumbs.db" || seg === "desktop.ini") return "";
    parts.push(seg.replace(BAD_CHARS, "_").trim());
  }
  if (!parts.length) return "";
  // 单段过长会让 Windows 报 ENAMETOOLONG，截断保留扩展名
  const out = parts.map((s) => (s.length > 120 ? s.slice(0, 100) + s.slice(-16) : s));
  return out.join("/");
}

function readEocd(buf) {
  // EOCD 在文件末尾，注释最长 65535，所以最多往回找 66KB
  const min = Math.max(0, buf.length - 66000);
  for (let i = buf.length - 22; i >= min; i -= 1) {
    if (buf.readUInt32LE(i) !== SIG_EOCD) continue;
    const commentLen = buf.readUInt16LE(i + 20);
    if (i + 22 + commentLen > buf.length) continue;
    const count = buf.readUInt16LE(i + 10);
    const cdSize = buf.readUInt32LE(i + 12);
    const cdOffset = buf.readUInt32LE(i + 16);
    if (cdOffset === 0xffffffff || count === 0xffff) {
      throw new Error("这个压缩包用了 ZIP64 格式（通常超过 4GB），请解压后导入文件夹");
    }
    if (cdOffset + cdSize > buf.length) continue;
    return { count, cdOffset, cdSize };
  }
  // 空包 / 只有目录的包会找不到 EOCD，给一句人话
  throw new Error("不是有效的 ZIP 文件（找不到目录区）");
}

function parseCentralDirectory(buf, eocd) {
  const entries = [];
  let p = eocd.cdOffset;
  for (let i = 0; i < eocd.count; i += 1) {
    if (p + 46 > buf.length) throw new Error("ZIP 目录区被截断");
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error("ZIP 目录项签名不对（文件可能损坏）");
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOff = buf.readUInt32LE(p + 42);
    const nameBuf = buf.subarray(p + 46, p + 46 + nameLen);
    entries.push({
      rawName: decodeName(nameBuf, flags),
      flags,
      method,
      crc,
      csize,
      usize,
      localOff,
    });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function extractEntryData(buf, ent) {
  const off = ent.localOff;
  if (off + 30 > buf.length || buf.readUInt32LE(off) !== SIG_LOCAL) {
    throw new Error(`文件头损坏：${ent.rawName}`);
  }
  const nameLen = buf.readUInt16LE(off + 26);
  const extraLen = buf.readUInt16LE(off + 28);
  const start = off + 30 + nameLen + extraLen;
  if (start + ent.csize > buf.length) throw new Error(`文件被截断：${ent.rawName}`);
  const raw = buf.subarray(start, start + ent.csize);

  if (ent.method === 0) return Buffer.from(raw);
  if (ent.method === 8) {
    const cap = Math.max(ent.usize, 1);
    return zlib.inflateRawSync(raw, { maxOutputLength: cap + 1024 });
  }
  if (ent.method === 12) throw new Error(`不支持 BZIP2 压缩：${ent.rawName}（请重新打包成普通 zip）`);
  if (ent.method === 14) throw new Error(`不支持 LZMA 压缩：${ent.rawName}（请重新打包成普通 zip）`);
  throw new Error(`不支持的压缩方式 ${ent.method}：${ent.rawName}`);
}

/**
 * 把 zip 解到 destDir。返回 { files, bytes, skipped, dirs }。
 * 只写普通文件；目录按需创建；超出上限立即停止并保留已解出的内容。
 */
function extractZip(zipPath, destDir, opts) {
  const lim = Object.assign({}, DEFAULT_LIMITS, opts || {});
  const buf = fs.readFileSync(zipPath);
  const eocd = readEocd(buf);
  const entries = parseCentralDirectory(buf, eocd);
  const stat = { files: 0, bytes: 0, skipped: [], dirs: 0, entries: entries.length };

  fs.mkdirSync(destDir, { recursive: true });
  const root = path.resolve(destDir);

  for (const ent of entries) {
    if (stat.files >= lim.files || stat.bytes >= lim.totalBytes) {
      stat.skipped.push("超过上限，剩余文件未解压");
      break;
    }
    if (ent.flags & 0x1) {
      stat.skipped.push(`加密条目：${ent.rawName}`);
      continue;
    }
    const rel = safeEntryName(ent.rawName);
    if (!rel) continue;
    if (ent.usize > lim.fileBytes) {
      stat.skipped.push(`单文件过大（${Math.round(ent.usize / 1048576)}MB）：${rel}`);
      continue;
    }
    if (ent.csize > 0 && ent.usize / ent.csize > lim.ratioGuard && ent.usize > 8 * 1024 * 1024) {
      stat.skipped.push(`压缩比异常，疑似压缩炸弹：${rel}`);
      continue;
    }

    const dst = path.join(root, rel);
    const relCheck = path.relative(root, dst);
    if (relCheck.startsWith("..") || path.isAbsolute(relCheck)) {
      stat.skipped.push(`路径越界：${ent.rawName}`);
      continue;
    }

    let data;
    try {
      data = extractEntryData(buf, ent);
    } catch (e) {
      stat.skipped.push(`${rel}：${e.message}`);
      continue;
    }
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, data);
    stat.files += 1;
    stat.bytes += data.length;
  }

  // 目录项不算失败，但如果一个文件都没解出来要给明确的错
  if (!stat.files) {
    const why = stat.skipped.length ? stat.skipped.slice(0, 3).join("；") : "压缩包里没有文件";
    throw new Error("解压后没有任何文件 —— " + why);
  }
  return stat;
}

function isZipFile(p) {
  try {
    const fd = fs.openSync(p, "r");
    const b = Buffer.alloc(4);
    fs.readSync(fd, b, 0, 4, 0);
    fs.closeSync(fd);
    return b.readUInt32LE(0) === SIG_LOCAL || b.readUInt32LE(0) === SIG_EOCD;
  } catch (e) {
    return false;
  }
}

module.exports = { extractZip, isZipFile, safeEntryName, DEFAULT_LIMITS };
