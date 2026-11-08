import type { CheckParams, CheckResult, LivePatchProvider, Release, ReleaseFile, ReportEvent } from './types';

type FetchLike = (input: string, init?: any) => Promise<{ ok: boolean; status: number; json(): Promise<any>; text(): Promise<string> }>;

const DEFAULT_TIMEOUT_MS = 15000;

async function request(fetchImpl: FetchLike, url: string, init: any, timeoutMs: number) {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;
  try {
    const res = await fetchImpl(url, { ...init, signal: controller?.signal });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`LivePatch: HTTP ${res.status} from ${url}${body ? `: ${body.slice(0, 200)}` : ''}`);
    }
    return res;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseCheck(data: any, fileUrl: (file: any) => string): CheckResult {
  if (!data || typeof data !== 'object') throw new Error('LivePatch: invalid check response');
  if (data.status === 'rollback') return { status: 'rollback' };
  if (data.status !== 'update' || !data.release) return { status: 'up_to_date' };
  const r = data.release;
  if (typeof r.id !== 'string' || typeof r.bundlePath !== 'string' || !Array.isArray(r.files)) {
    throw new Error('LivePatch: invalid release in check response');
  }
  const files: ReleaseFile[] = r.files.map((f: any) => {
    if (typeof f.path !== 'string' || typeof f.sha256 !== 'string') {
      throw new Error('LivePatch: invalid file entry in release');
    }
    return { path: f.path, sha256: f.sha256, size: typeof f.size === 'number' ? f.size : undefined, url: fileUrl(f) };
  });
  const release: Release = {
    id: r.id,
    bundlePath: r.bundlePath,
    files,
    mandatory: !!r.mandatory,
    message: r.message ?? null,
    size: typeof r.size === 'number' ? r.size : undefined,
    createdAt: r.createdAt,
  };
  return { status: 'update', release };
}

export interface SupabaseProviderOptions {
  /** https://<project>.supabase.co */
  url: string;
  /** Public anon key (the same one the app already uses) */
  anonKey: string;
  /** Storage bucket with release files. default "livepatch" */
  bucket?: string;
  timeoutMs?: number;
  fetch?: FetchLike;
}

/**
 * Updates from your own Supabase project. Run supabase/livepatch.sql once, then
 * publish with `npx livepatch release`.
 */
export function supabaseProvider(options: SupabaseProviderOptions): LivePatchProvider {
  const base = options.url.replace(/\/+$/, '');
  const bucket = options.bucket ?? 'livepatch';
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl: FetchLike = options.fetch ?? ((...args) => (globalThis as any).fetch(...args));
  const headers = {
    'Content-Type': 'application/json',
    apikey: options.anonKey,
    Authorization: `Bearer ${options.anonKey}`,
  };
  const rpc = (name: string, body: object) =>
    request(fetchImpl, `${base}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs);

  return {
    async check(p: CheckParams): Promise<CheckResult> {
      const res = await rpc('livepatch_check', {
        p_platform: p.platform,
        p_app_version: p.appVersion,
        p_channel: p.channel,
        p_bundle_id: p.bundleId,
        p_device_id: p.deviceId,
      });
      const data = await res.json();
      return parseCheck(data, (f) => `${base}/storage/v1/object/public/${bucket}/files/${f.sha256}`);
    },
    async report(e: ReportEvent): Promise<void> {
      await rpc('livepatch_report', {
        p_release_id: e.releaseId,
        p_event: e.type,
        p_platform: e.platform,
        p_app_version: e.appVersion,
        p_channel: e.channel,
        p_device_id: e.deviceId,
        p_message: e.message ?? null,
      });
    },
  };
}

export interface HttpProviderOptions {
  /**
   * GET endpoint called with ?platform=&appVersion=&channel=&bundleId=&deviceId=
   * It returns {status:"up_to_date"} | {status:"rollback"} |
   * {status:"update", release:{id, bundlePath, mandatory, message, files:[{path, sha256, size, url}]}}.
   * Relative file urls are resolved against the check URL.
   */
  checkUrl: string;
  /** Optional POST endpoint receiving ReportEvent JSON */
  reportUrl?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  fetch?: FetchLike;
}

/** Updates from any server that speaks the small JSON protocol above. */
export function httpProvider(options: HttpProviderOptions): LivePatchProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fetchImpl: FetchLike = options.fetch ?? ((...args) => (globalThis as any).fetch(...args));
  return {
    async check(p: CheckParams): Promise<CheckResult> {
      const qs = [
        ['platform', p.platform],
        ['appVersion', p.appVersion],
        ['channel', p.channel],
        ['bundleId', p.bundleId ?? ''],
        ['deviceId', p.deviceId],
      ]
        .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
        .join('&');
      const sep = options.checkUrl.includes('?') ? '&' : '?';
      const url = `${options.checkUrl}${sep}${qs}`;
      const res = await request(fetchImpl, url, { method: 'GET', headers: options.headers }, timeoutMs);
      return parseCheck(await res.json(), (f) => resolveUrl(String(f.url ?? ''), options.checkUrl));
    },
    report: options.reportUrl
      ? async (e: ReportEvent) => {
          await request(
            fetchImpl,
            options.reportUrl!,
            { method: 'POST', headers: { 'Content-Type': 'application/json', ...options.headers }, body: JSON.stringify(e) },
            timeoutMs,
          );
        }
      : undefined,
  };
}

function resolveUrl(url: string, base: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  if (!url) throw new Error('LivePatch: file entry without url');
  const origin = base.match(/^https?:\/\/[^/]+/i)?.[0] ?? '';
  if (url.startsWith('/')) return origin + url;
  return base.replace(/[?#].*$/, '').replace(/[^/]*$/, '') + url;
}
