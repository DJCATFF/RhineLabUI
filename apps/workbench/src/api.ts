import type { Facets, ImportResult, JobsSummary, ListParams, ListResult, ResourceDetail } from "./types";

function library() {
  const bridge = window.desk?.library;
  if (!bridge) throw new Error("资料库接口不可用，请通过桌面应用启动工作台");
  return bridge;
}

export const api = {
  info: () => library().info(),
  list: (params: ListParams) => library().list(params) as Promise<ListResult>,
  get: (id: string) => library().get(id) as Promise<ResourceDetail | null>,
  facets: () => library().facets() as Promise<Facets>,
  update: (id: string, patch: { title?: string; favorite?: boolean; note?: string; inbox?: boolean }) =>
    library().update(id, patch) as Promise<ResourceDetail | null>,
  setTags: (id: string, names: string[]) => library().setTags(id, names) as Promise<ResourceDetail | null>,
  setCollections: (id: string, ids: string[]) => library().setCollections(id, ids) as Promise<ResourceDetail | null>,
  createCollection: (name: string) => library().createCollection(name),
  trash: (ids: string[]) => library().trash(ids),
  restore: (ids: string[]) => library().restore(ids),
  touch: (id: string) => library().touch(id),
  reading: (id: string, locator: string, progress: number) => library().reading(id, locator, progress),
  open: (id: string) => library().open(id),
  reveal: (id: string) => library().reveal(id),
  importFolder: () => library().importFolder() as Promise<ImportResult>,
  jobs: () => library().jobs() as Promise<JobsSummary>,
  retryExtraction: (id: string) => library().retryExtraction(id),
  retryFailedExtractions: () => library().retryFailedExtractions(),
};

function toBase64Url(input: string): string {
  const bytes = new TextEncoder().encode(input);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function assetUrl(target: string | null | undefined): string | null {
  if (!target) return null;
  return `asset://local/${toBase64Url(target)}`;
}

export function formatSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10240 ? 1 : 0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parentPath(target: string | null | undefined): string {
  if (!target) return "—";
  const index = Math.max(target.lastIndexOf("\\"), target.lastIndexOf("/"));
  return index > 0 ? target.slice(0, index) : target;
}

export function archiveLabel(no: number): string {
  return `D-${String(no).padStart(3, "0")}`;
}
