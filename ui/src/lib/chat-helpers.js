import { upsertMessageInList, textFromContents, toolResultKind, parseReadResult, parseLsResult, parseGrepResult, parseBashResult, parseBrowserResult, parseSubAgentResult, parseWorkflowLintResult } from './session-view.js';

export function safeAttachmentURL(value) {
  try {
    const parsed = new URL(String(value || ''));
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return '';
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    if (!host || host === 'localhost' || host.endsWith('.localhost')) return '';
    if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return '';
    const octets = host.match(/^172\.(\d{1,3})\./);
    if (octets && Number(octets[1]) >= 16 && Number(octets[1]) <= 31) return '';
    if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return '';
    return parsed.href;
  } catch {
    return '';
  }
}


export function formatImageSize(bytes) {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}



export function mergeSubAgents(existing = [], incoming = []) {
  const byID = new Map();
  for (const item of existing) {
    if (item?.id) byID.set(item.id, item);
  }
  for (const item of incoming) {
    if (!item?.id) continue;
    byID.set(item.id, { ...byID.get(item.id), ...item });
  }
  return Array.from(byID.values()).sort((a, b) => {
    const left = Date.parse(a.startedAt || a.updatedAt || '') || 0;
    const right = Date.parse(b.startedAt || b.updatedAt || '') || 0;
    if (left !== right) return left - right;
    return String(a.id).localeCompare(String(b.id));
  });
}


export function mergeMessageLists(base = [], live = []) {
  let out = [...base];
  for (const item of live) {
    out = upsertMessageInList(out, item);
  }
  return out;
}


export function buildSessionEventSummary(runEvents = [], capabilityEvents = [], workDir = '', model = '') {
  const runs = mergeRunEvents(runEvents);
  const currentModel = model && model !== 'default' ? model : '';
  const matchingRuns = runs.filter((run) => {
    if (!run.usage) return false;
    if (currentModel && run.model && run.model !== currentModel) return false;
    if (workDir && run.workDir && run.workDir !== workDir) return false;
    return true;
  });
  const totals = runs.reduce((acc, run) => {
    if (!run.usage) return acc;
    acc.promptTokens += run.usage.promptTokens;
    acc.completionTokens += run.usage.completionTokens;
    acc.totalTokens += run.usage.totalTokens;
    acc.cacheReadTokens += run.usage.cacheReadTokens;
    acc.cacheWriteTokens += run.usage.cacheWriteTokens;
    return acc;
  }, { promptTokens: 0, completionTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  return {
    visible: runs.length > 0 || capabilityEvents.length > 0,
    lastRun: runs[0] || null,
    runCount: runs.length,
    capabilityCount: capabilityEvents.length,
    model: currentModel || runs[0]?.model || '',
    workDir: workDir || runs[0]?.workDir || '',
    matchingRuns: matchingRuns.length,
    ...totals
  };
}


export function buildSubAgentSummary(agents = [], translate = (key) => key) {
  const list = (agents || []).filter((item) => item?.id);
  const running = list.filter((item) => item.status === 'running' || item.status === 'ready').length;
  const failed = list.filter((item) => item.status === 'error' || item.status === 'failed').length;
  const done = list.filter((item) => item.status === 'done' || item.status === 'destroyed').length;
  return {
    visible: list.length > 0,
    count: list.length,
    running,
    failed,
    done,
    label: running > 0
      ? translate('chat.subagents.running', { count: running, total: list.length })
      : failed > 0
        ? translate('chat.subagents.failed', { count: failed, total: list.length })
        : translate('chat.subagents.done', { count: done || list.length, total: list.length })
  };
}


export function mergeRunEvents(events = []) {
  const byRun = new Map();
  for (const event of events) {
    const runId = event.runId || event.id || '';
    if (!runId) continue;
    const run = byRun.get(runId) || {
      runId,
      eventType: '',
      status: '',
      source: '',
      data: null,
      model: '',
      mode: '',
      workDir: '',
      timestamp: '',
      usage: null
    };
    const eventTime = Date.parse(event.timestamp || '') || 0;
    const runTime = Date.parse(run.timestamp || '') || 0;
    if (eventTime >= runTime) {
      run.timestamp = event.timestamp || run.timestamp;
      run.eventType = event.eventType || run.eventType;
      run.status = event.status || run.status;
    }
    if (event.model) run.model = event.model;
    if (event.mode) run.mode = event.mode;
    if (event.source) run.source = event.source;
    if (event.data && typeof event.data === 'object') run.data = { ...(run.data || {}), ...event.data };
    if (event.data?.workDir) run.workDir = event.data.workDir;
    const usage = normalizeRunUsage(event.data?.usage);
    if (usage) run.usage = usage;
    byRun.set(runId, run);
  }
  return Array.from(byRun.values())
    .sort((a, b) => (Date.parse(b.timestamp || '') || 0) - (Date.parse(a.timestamp || '') || 0));
}


export function normalizeRunUsage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const promptTokens = readNumber(raw, ['prompt_tokens', 'promptTokens', 'inputTokens', 'input']);
  const completionTokens = readNumber(raw, ['completion_tokens', 'completionTokens', 'outputTokens', 'output']);
  const cacheReadTokens = readNumber(raw, ['cache_read_tokens', 'cacheReadTokens', 'cacheRead', 'cached_tokens']);
  const cacheWriteTokens = readNumber(raw, ['cache_write_tokens', 'cacheWriteTokens', 'cacheWrite']);
  const explicitTotal = readNumber(raw, ['total_tokens', 'totalTokens']);
  const totalTokens = explicitTotal || promptTokens + completionTokens;
  if (promptTokens === 0 && completionTokens === 0 && totalTokens === 0 && cacheReadTokens === 0 && cacheWriteTokens === 0) return null;
  return { promptTokens, completionTokens, totalTokens, cacheReadTokens, cacheWriteTokens };
}


export function readNumber(source, keys) {
  for (const key of keys) {
    const value = Number(source?.[key]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}


export function isCronRun(run) {
  return run?.source === 'cron' || Boolean(run?.data?.cronJobId);
}


export function cronRunName(run) {
  return run?.data?.cronJobName || '';
}


export function formatCompactTokens(value) {
  const n = Number(value) || 0;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return String(n);
}


export function formatCacheRate(summary) {
  if (!summary || summary.promptTokens <= 0) return '--';
  const pct = Math.min(100, Math.max(0, (summary.cacheReadTokens / summary.promptTokens) * 100));
  return `${Math.round(pct)}%`;
}


export function compactPath(path) {
  if (!path) return '';
  const normalized = String(path).replace(/\/$/, '');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 2) return normalized || '/';
  return `.../${parts.slice(-2).join('/')}`;
}


export function compactWorkDir(path) {
  if (!path) return '';
  const parts = String(path).split('/').filter(Boolean);
  if (parts.length === 0) return '/';
  return parts[parts.length - 1];
}


export function formatEventTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}


export function normalizeToolResultDetail(detail) {
  if (!detail) return { content: '', images: [] };
  const images = [];
  for (const block of detail.contents || []) {
    if (block.type !== 'image' || !block.image?.data || !block.image?.mimeType) continue;
    images.push({
      name: block.image.mimeType,
      type: block.image.mimeType,
      size: block.image.bytes || block.image.originalBytes || 0,
      dataUrl: `data:${block.image.mimeType};base64,${block.image.data}`
    });
  }
  const content = detail.content || textFromContents(detail.contents);
  return {
    toolName: detail.toolName || '',
    kind: toolResultKind(detail.toolName, content),
    content: detail.content || textFromContents(detail.contents),
    images,
    readLines: parseReadResult(content),
    lsEntries: parseLsResult(content),
    grepMatches: parseGrepResult(content),
    bashResult: parseBashResult(content),
    browserResult: parseBrowserResult(content),
    subAgentResult: parseSubAgentResult(content),
    workflowLintResult: parseWorkflowLintResult(content)
  };
}
