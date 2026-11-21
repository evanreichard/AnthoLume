import type { components } from '../api/schema.gen';

export type ProgressEvent = components['schemas']['ProgressEvent'];
export type ActivityEvent = components['schemas']['ActivityEvent'];
export type Receipt = components['schemas']['Receipt'];
export type Submission = { kind: 'progress'; payload: ProgressEvent } | { kind: 'activity'; payload: ActivityEvent };
export const revisionPattern = /^(0|[1-9][0-9]{0,17})$/;
const fraction = (value: number) => Number.isFinite(value) && value >= 0 && value <= 1;
export const validProgressPosition = (position: string, value: number) => typeof position === 'string' && position.length > 0 && position.length <= 4096 && fraction(value);
const identifier = (value: string) => typeof value === 'string' && value.length > 0 && value.length <= 128;
const timestamp = (value: string) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value));

export function validSubmission(event: Submission): boolean {
  const value = event.payload;
  const fields = event.kind === 'progress' ? 'base_revision,device_id,document_id,event_id,fraction,observed_at,position' : 'device_id,document_id,duration,end_fraction,event_id,start_fraction,start_time';
  if (Object.keys(value).sort().join(',') !== fields) return false;
  if (!identifier(value.event_id) || !identifier(value.document_id) || !identifier(value.device_id)) return false;
  if (event.kind === 'progress') {
    const p = event.payload;
    return typeof p.base_revision === 'string' && revisionPattern.test(p.base_revision) && validProgressPosition(p.position, p.fraction) && timestamp(p.observed_at);
  }
  const a = event.payload;
  return Number.isInteger(a.duration) && a.duration >= 0 && a.duration <= 86400 && timestamp(a.start_time) && fraction(a.start_fraction) && fraction(a.end_fraction) && a.start_fraction <= a.end_fraction;
}

// Receipt Gate - Match the API client's progress predicate, then bind kind/revision to the persisted request, not an untrusted ID list.
export function receiptFor(value: unknown, event: Submission): value is Receipt {
  if (typeof value !== 'object' || value === null || Object.keys(value).sort().join(',') !== 'event_id,kind,revision') return false;
  if (!('event_id' in value) || value.event_id !== event.payload.event_id || !('kind' in value) || value.kind !== event.kind || !('revision' in value)) return false;
  if (event.kind === 'activity') return value.revision === null;
  return typeof value.revision === 'string' && /^[1-9][0-9]{0,17}$/.test(value.revision) && revisionPattern.test(event.payload.base_revision) && BigInt(value.revision) === BigInt(event.payload.base_revision) + 1n;
}
