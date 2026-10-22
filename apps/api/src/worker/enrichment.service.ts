import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Kept in sync with the archive columns in src/document-archive.ts: the 3D
// shelves render one column per category.
export const documentCategories = ['技术工程', '研究报告', '商务财务', '个人资料', '其他'];

const MAX_INPUT_CHARS = 12000;
const MAX_SUMMARY_CHARS = 600;
const MAX_KEY_POINTS = 5;
const MAX_TAGS = 8;
const TIMEOUT_MS = 45000;
const ATTEMPTS = 2;

const instructions = `你是私人知识库的编目员。阅读用户提供的文档正文，只输出一个 JSON 对象，不要输出任何解释或代码围栏：
{"summary":"两到三句中文摘要，说明这是什么文档、讲了什么、结论或用途","keyPoints":["三到五条要点，每条不超过四十字"],"tags":["三到六个主题标签，名词短语，不带 #"],"category":"技术工程|研究报告|商务财务|个人资料|其他"}
分类必须依据内容而不是文件名：技术方案、代码、架构、运维、产品设计归入“技术工程”；论文、调研、分析、白皮书归入“研究报告”；合同、报价、发票、预算、财报归入“商务财务”；简历、证件、体检、个人记录归入“个人资料”；无法判断归入“其他”。`;

export type Refinement = {
  summary: string;
  keyPoints: string[];
  tags: string[];
  category: string;
};

export type EnrichmentOutcome =
  | { refinement: Refinement; error: null }
  | { refinement: null; error: string };

export function parseRefinement(content: unknown): Refinement | null {
  if (typeof content !== 'string') return null;
  // Tolerates ```json fences and any prose the model wraps around the object.
  const start = content.indexOf('{');
  const end = content.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try {
    value = JSON.parse(content.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const summary = typeof record.summary === 'string' ? record.summary.trim() : '';
  if (!summary) return null;
  const category = typeof record.category === 'string' ? record.category.trim() : '';
  // An unknown category would shelve the document under the wrong column.
  if (!documentCategories.includes(category)) return null;
  return {
    summary: summary.slice(0, MAX_SUMMARY_CHARS),
    keyPoints: list(record.keyPoints, MAX_KEY_POINTS, 120),
    tags: list(record.tags, MAX_TAGS, 24),
    category,
  };
}

function list(value: unknown, limit: number, maxLength: number) {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ]
    .slice(0, limit)
    .map((item) => item.slice(0, maxLength));
}

@Injectable()
export class EnrichmentService {
  constructor(private readonly config: ConfigService) {}

  /** Returns null when unconfigured or when there is nothing worth sending. */
  async refine(text: string): Promise<EnrichmentOutcome | null> {
    const baseUrl = this.config.get<string>('LLM_BASE_URL')?.trim();
    const apiKey = this.config.get<string>('LLM_API_KEY')?.trim();
    const model = this.config.get<string>('LLM_MODEL')?.trim();
    const source = text.trim();
    if (!baseUrl || !apiKey || !model || !source) return null;
    const body = JSON.stringify({
      model,
      temperature: 0.2,
      max_tokens: 900,
      stream: false,
      messages: [
        { role: 'system', content: instructions },
        { role: 'user', content: `文档正文：\n\n${source.slice(0, MAX_INPUT_CHARS)}` },
      ],
    });
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      let response: Response;
      try {
        response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body,
          redirect: 'error',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch {
        continue;
      }
      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        if (!retryable || attempt === ATTEMPTS - 1)
          return { refinement: null, error: `LLM returned HTTP ${response.status}` };
        continue;
      }
      let content: unknown;
      try {
        const payload = (await response.json()) as {
          choices?: { message?: { content?: unknown } }[];
        };
        content = payload?.choices?.[0]?.message?.content;
      } catch {
        continue;
      }
      const refinement = parseRefinement(content);
      if (refinement) return { refinement, error: null };
    }
    return { refinement: null, error: 'LLM unavailable or returned unusable output' };
  }
}
