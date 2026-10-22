export type ViewKind = "all" | "inbox" | "recent" | "favorite" | "collection" | "tag" | "source" | "trash";
export type SortKind = "added" | "title" | "size" | "recent";
export type ViewMode = "list" | "cards";

export interface NavView {
  kind: ViewKind;
  id?: string;
}

export interface ListParams {
  view: ViewKind;
  id?: string;
  search?: string;
  kinds?: string[];
  sort?: SortKind;
  limit?: number;
  offset?: number;
}

export interface ResourceItem {
  id: string;
  archiveNo: number;
  title: string;
  kind: string;
  status: string;
  favorite: boolean;
  inbox: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  path: string | null;
  ext: string | null;
  size: number | null;
  tags: string[];
  collectionCount: number;
  readingAt: string | null;
  readingProgress: number | null;
}

export interface ResourceFile {
  id: string;
  storage_kind: string;
  path: string;
  mime_type: string;
  ext: string;
  size: number;
  sha256: string;
}

export interface ResourceDetail extends ResourceItem {
  note: string | null;
  summary: string | null;
  extracted: string | null;
  files: ResourceFile[];
  collections: { id: string; name: string }[];
  tagDetails: { id: string; name: string; origin: string }[];
  reading: { locator: string; progress: number; updated_at: string } | null;
  source: { id: string; kind: string; label: string; root_path: string | null } | null;
}

export interface ListResult {
  items: ResourceItem[];
  total: number;
}

export interface Facets {
  all: number;
  inbox: number;
  recent: number;
  favorite: number;
  trash: number;
  collections: { id: string; name: string; n: number }[];
  tags: { id: string; name: string; n: number }[];
  sources: { id: string; label: string; kind: string; n: number }[];
}

export interface ImportProgress {
  phase: "scan" | "hash" | "save" | "done";
  index: number;
  total: number;
  current?: string;
  added?: number;
  duplicates?: number;
  skipped?: number;
  elapsedMs?: number;
}

export interface ImportResult extends ImportProgress {
  sourceId?: string;
  canceled?: boolean;
}

export interface WorkspaceState {
  view: NavView;
  search: string;
  kinds: string[];
  sort: SortKind;
  mode: ViewMode;
  selectedId: string | null;
  detailOpen: boolean;
}

export const KIND_LABEL: Record<string, string> = {
  pdf: "PDF",
  text: "文本",
  image: "图片",
  office: "Office",
  archive: "压缩包",
  other: "其他",
};

export const KIND_FILTERS = ["pdf", "text", "image", "office", "archive", "other"] as const;

export function isReadable(kind: string): boolean {
  return kind === "pdf" || kind === "text" || kind === "image";
}
