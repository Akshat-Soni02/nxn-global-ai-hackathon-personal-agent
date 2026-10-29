// pnpm release: publishes what `pnpm package` built as a GitHub Release (docs/design.md, "Deployment"; DEPLOY.md):
// Shadow-<version>.dmg, Shadow.dmg (the same file, the stable name the website downloads:
// releases/latest/download/Shadow.dmg) and the extension zip, tagged with the version in package.json, on the commit
// you are on (push it first). Published again for the same version, its files are replaced, so a fix can go out
// without a new version. With the GitHub CLI it uses `gh`; without it, GitHub's API with GITHUB_TOKEN or the token
// git already uses for github.com. Usage: pnpm release [--draft] [--notes <file>]
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";

const repo = join(import.meta.dirname, "..");
const version =
  (JSON.parse(readFileSync(join(repo, "package.json"), "utf8")) as { version?: string }).version ?? "0.1.0";
const dmg = join(repo, "dist", `Shadow-${version}.dmg`);
const zip = join(repo, "dist", "shadow-extension.zip");
for (const file of [dmg, zip]) {
  if (!existsSync(file)) {
    console.error(`missing ${file}: run pnpm package first`);
    process.exit(1);
  }
}
const stable = join(repo, "dist", "Shadow.dmg");
copyFileSync(dmg, stable);
const assets = [dmg, stable, zip];

const args = process.argv.slice(2);
const draft = args.includes("--draft");
const notesFile = args.includes("--notes") ? args[args.indexOf("--notes") + 1] : undefined;
const tag = `v${version}`;
const git = (...a: string[]) => execFileSync("git", a, { cwd: repo, encoding: "utf8" }).trim();
const commit = git("rev-parse", "HEAD");

const hasGh = (() => {
  try {
    execFileSync("gh", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

if (hasGh) {
  let exists = true;
  try {
    execFileSync("gh", ["release", "view", tag], { cwd: repo, stdio: "ignore" });
  } catch {
    exists = false;
  }
  const command = exists
    ? ["release", "upload", tag, ...assets, "--clobber"]
    : [
        "release",
        "create",
        tag,
        ...assets,
        "--target",
        commit,
        "--title",
        `Shadow ${version}`,
        ...(notesFile ? ["--notes-file", notesFile] : ["--generate-notes"]),
        ...(draft ? ["--draft"] : []),
      ];
  console.log(`gh ${command.join(" ")}`);
  execFileSync("gh", command, { cwd: repo, stdio: "inherit" });
} else {
  await viaApi();
}
console.log(`published ${tag}: the website's button downloads releases/latest/download/Shadow.dmg.`);

async function viaApi(): Promise<void> {
  const remote = git("remote", "get-url", "origin");
  const slug = /github\.com[:/]([^/]+\/[^/.]+)(?:\.git)?$/.exec(remote)?.[1];
  if (!slug) throw new Error(`origin isn't a GitHub repository: ${remote}`);
  const token =
    process.env.GITHUB_TOKEN ??
    /password=(.+)/
      .exec(
        execFileSync("git", ["credential", "fill"], { input: "protocol=https\nhost=github.com\n\n", encoding: "utf8" }),
      )?.[1]
      ?.trim();
  if (!token) throw new Error("no GitHub token: set GITHUB_TOKEN, or install the GitHub CLI and run gh auth login");
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" };
  const api = `https://api.github.com/repos/${slug}`;
  const call = async <T>(url: string, init: RequestInit = {}): Promise<T> => {
    const res = await fetch(url, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`${init.method ?? "GET"} ${url}: ${res.status} ${await res.text()}`);
    return (res.status === 204 ? undefined : await res.json()) as T;
  };
  type Release = { id: number; upload_url: string; html_url: string; assets: { id: number; name: string }[] };
  let release: Release;
  const found = await fetch(`${api}/releases/tags/${tag}`, { headers });
  if (found.ok) {
    release = (await found.json()) as Release;
    console.log(`${tag} exists: replacing its files`);
  } else {
    release = await call<Release>(`${api}/releases`, {
      method: "POST",
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: commit,
        name: `Shadow ${version}`,
        draft,
        ...(notesFile ? { body: readFileSync(notesFile, "utf8") } : { generate_release_notes: true }),
      }),
    });
    console.log(`created ${tag}`);
  }
  const upload = release.upload_url.replace(/\{.*\}$/, "");
  for (const file of assets) {
    const name = basename(file);
    const old = release.assets.find((a) => a.name === name);
    if (old) await call(`${api}/releases/assets/${old.id}`, { method: "DELETE" });
    console.log(`uploading ${name} (${Math.round(statSync(file).size / 1e6)} MB)`);
    await call(`${upload}?name=${encodeURIComponent(name)}`, {
      method: "POST",
      headers: {
        "Content-Type": name.endsWith(".zip") ? "application/zip" : "application/x-apple-diskimage",
      },
      body: readFileSync(file),
    });
  }
  console.log(release.html_url);
}
