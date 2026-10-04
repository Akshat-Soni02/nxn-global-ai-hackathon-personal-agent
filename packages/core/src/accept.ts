// What kind of file a step takes, in the HTML accept syntax: ".pdf", "image/*", "image/png", comma-separated. It is the
// page's own <input accept>, or else the kind of file you recorded with (a photo: any image). The daemon checks the
// file you give before a run starts (choose-file.ts) and the player checks it again at the upload, against the page.
// Pure, with no imports: the extension bundles it.

// By extension, as Chrome types a File on macOS. Extensions of the same type count as the same (jpg and jpeg).
const MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jfif: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  bmp: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  svg: "image/svg+xml",
  psd: "image/vnd.adobe.photoshop",
  dng: "image/x-adobe-dng", // camera raw files
  cr2: "image/x-canon-cr2",
  cr3: "image/x-canon-cr3",
  nef: "image/x-nikon-nef",
  arw: "image/x-sony-arw",
  raf: "image/x-fuji-raf",
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  avi: "video/x-msvideo",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  aac: "audio/aac",
  flac: "audio/flac",
  ogg: "audio/ogg",
  pdf: "application/pdf",
  txt: "text/plain",
  csv: "text/csv",
  htm: "text/html",
  html: "text/html",
  md: "text/markdown",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};
const FAMILIES = ["image", "video", "audio"];

const baseName = (path: string) => path.split("/").pop() ?? path;
const tokensOf = (accept: string | undefined) =>
  (accept ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);

export function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export const mimeOf = (path: string): string | undefined => MIME[extensionOf(path)];

// Whether a file (by its name) is one an accept list takes. No list takes anything.
export function matchesAccept(path: string, accept: string | undefined): boolean {
  const tokens = tokensOf(accept);
  if (tokens.length === 0) return true;
  const name = baseName(path).toLowerCase();
  const mime = mimeOf(path);
  return tokens.some((t) => {
    if (t === "*" || t === "*/*") return true;
    if (t.startsWith(".")) return name.endsWith(t) || (mime !== undefined && MIME[t.slice(1)] === mime);
    if (t.endsWith("/*")) return mime?.startsWith(t.slice(0, -1)) ?? false;
    return t === mime;
  });
}

// The rule for files like the one you recorded with: any image, video or audio file for those, else the same extension.
// No extension, no rule. An extension this table doesn't know is kept in the rule as well, so the next file like the
// recorded one passes even though only the page knew it was an image.
export function kindOf(path: string, mime?: string): string | undefined {
  const ext = extensionOf(path);
  const type = mimeOf(path) ?? (mime || undefined);
  const family = type?.split("/")[0];
  if (family && FAMILIES.includes(family)) return MIME[ext] || !ext ? `${family}/*` : `${family}/*,.${ext}`;
  if (!ext) return undefined;
  const same = MIME[ext] ? Object.keys(MIME).filter((e) => MIME[e] === MIME[ext]) : [ext];
  return same.map((e) => `.${e}`).join(",");
}

// Why a file is the wrong kind, in words, or undefined when it is fine.
export function wrongKind(path: string, accept: string | undefined): string | undefined {
  if (matchesAccept(path, accept)) return undefined;
  const wanted = tokensOf(accept).map((t) => {
    const family = t.endsWith("/*") ? t.slice(0, -2) : "";
    if (FAMILIES.includes(family)) return family === "audio" ? "audio files" : `${family}s`;
    if (t.startsWith(".")) return `${t} files`;
    const ext = Object.keys(MIME).find((e) => MIME[e] === t); // application/pdf: .pdf files
    return ext ? `.${ext} files` : t;
  });
  return `${baseName(path)} is the wrong kind of file: this step takes ${wanted.join(" or ")}`;
}
