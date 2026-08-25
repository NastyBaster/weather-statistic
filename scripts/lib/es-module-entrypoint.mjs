import { fileURLToPath } from "node:url";
import { posix, resolve } from "node:path";

function normalizeWindowsPath(value) {
  let normalized = value.replaceAll("/", "\\");
  if (/^\\[a-zA-Z]:\\/.test(normalized)) normalized = normalized.slice(1);
  if (/^[a-zA-Z]:/.test(normalized)) normalized = `${normalized[0].toLowerCase()}${normalized.slice(1)}`;
  return normalized;
}

function windowsPathFromFileUrl(fileUrl) {
  const parsed = new URL(fileUrl);
  if (parsed.protocol !== "file:" || parsed.hostname) return null;
  return normalizeWindowsPath(decodeURIComponent(parsed.pathname));
}

export function isDirectEsModule(importMetaUrl, argvEntry, { platform = process.platform } = {}) {
  if (typeof importMetaUrl !== "string" || typeof argvEntry !== "string" || argvEntry.length === 0) return false;
  try {
    if (platform === "win32") {
      return windowsPathFromFileUrl(importMetaUrl) === normalizeWindowsPath(argvEntry);
    }
    if (platform === process.platform) return fileURLToPath(importMetaUrl) === resolve(argvEntry);
    const parsed = new URL(importMetaUrl);
    return parsed.protocol === "file:" && decodeURIComponent(parsed.pathname) === posix.resolve(argvEntry);
  } catch {
    return false;
  }
}
