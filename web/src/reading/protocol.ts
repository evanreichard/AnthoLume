import type { S } from './types';
import { revisionPattern } from './wire';
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const fraction = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;
export function validProblem(value: unknown, status: number): value is S['Problem'] {
  if (!object(value)) return false;
  const keys = Object.keys(value).sort().join(',');
  return (keys === 'code,detail,status,title,type' || keys === 'code,current_revision,detail,status,title,type') && value.status === status && Number.isInteger(status) && status >= 400 && status <= 599 && ['type', 'title', 'code', 'detail'].every(k => typeof value[k] === 'string') && (!('current_revision' in value) || (typeof value.current_revision === 'string' && revisionPattern.test(value.current_revision)));
}
export function validState(value: unknown, documentId: string): value is S['ReadingState'] {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'device_id,document_id,fraction,position,revision,updated_at') return false;
  return value.document_id === documentId && typeof value.revision === 'string' && revisionPattern.test(value.revision) && (value.position === null || (typeof value.position === 'string' && value.position.length <= 4096)) && (value.fraction === null || fraction(value.fraction)) && (value.device_id === null || typeof value.device_id === 'string') && (value.updated_at === null || (typeof value.updated_at === 'string' && Number.isFinite(Date.parse(value.updated_at))));
}
export function validDevice(value: unknown, id: string): value is S['Device'] { return object(value) && Object.keys(value).sort().join(',') === 'id,name' && value.id === id && typeof value.name === 'string' && value.name.length > 0 && value.name.length <= 128; }
