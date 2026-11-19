import { useParams, useSearchParams } from 'react-router';
import type { BookRef } from '../reading';
import { useSession } from '../session';

export function useBookRef(): BookRef | null {
  const { kind, id } = useParams();
  const [params] = useSearchParams();
  const { access } = useSession();
  if (!id || id.length > 128) return null;
  if (kind !== 'server' || access.kind !== 'authenticated') return null;
  if (params.get('account') !== access.account.userId || params.get('origin') !== access.account.origin) return null;
  return { kind: 'server', account: access.account, documentId: id };
}
