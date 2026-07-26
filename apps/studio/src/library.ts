/**
 * Client for the template library (`apps/api/src/templates.ts`).
 *
 * Every save carries the `rev` the document was loaded at. The server answers
 * 409 when someone else saved first, which surfaces here as `StaleError` so the
 * studio can offer to reload instead of quietly losing one of the two edits.
 */
import { parseTemplate, type Template } from '@pdftc/schema';
import type { DocMeta } from './state';

export interface TemplateSummary extends DocMeta {
  createdAt: number;
  updatedAt: number;
}

export interface TemplateRecord extends TemplateSummary {
  template: Template;
  data: unknown;
}

export class StaleError extends Error {
  constructor(readonly rev: number) {
    super('เทมเพลตนี้ถูกบันทึกโดยคนอื่นหลังจากที่คุณเปิด');
  }
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`/api/templates${path}`, {
    ...init,
    headers: init?.body ? { 'content-type': 'application/json' } : undefined,
  });
  if (res.status === 409) throw new StaleError((await res.json()).rev);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText);
  return res.status === 204 ? null : res.json();
}

export function listTemplates(): Promise<TemplateSummary[]> {
  return request('') as Promise<TemplateSummary[]>;
}

export async function getTemplate(id: string): Promise<TemplateRecord> {
  const record = (await request(`/${id}`)) as TemplateRecord;
  // The studio edits a parsed template; a stored one may predate a schema change.
  return { ...record, template: parseTemplate(record.template) };
}

export function createTemplate(input: { name: string; template: Template; data: unknown }): Promise<TemplateRecord> {
  return request('', { method: 'POST', body: JSON.stringify(input) }) as Promise<TemplateRecord>;
}

export function saveTemplate(id: string, patch: { rev: number; name?: string; template?: Template; data?: unknown }): Promise<TemplateRecord> {
  return request(`/${id}`, { method: 'PUT', body: JSON.stringify(patch) }) as Promise<TemplateRecord>;
}

export function duplicateTemplate(id: string, name?: string): Promise<TemplateRecord> {
  return request(`/${id}/duplicate`, { method: 'POST', body: JSON.stringify({ name }) }) as Promise<TemplateRecord>;
}

export async function deleteTemplate(id: string): Promise<void> {
  await request(`/${id}`, { method: 'DELETE' });
}
