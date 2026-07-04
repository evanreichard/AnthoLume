import { Link } from 'react-router-dom';
import type { Column } from './Table';

interface DocumentRow {
  document_id?: string;
  author?: string;
  title?: string;
}

// Shared "Document" Column - Progress and Activity render the same author/title link to the doc.
export const documentColumn: Column<DocumentRow> = {
  id: 'document',
  header: 'Document',
  render: row => (
    <Link to={`/documents/${row.document_id}`} className="text-secondary-600 hover:underline">
      {row.author || 'Unknown'} - {row.title || 'Unknown'}
    </Link>
  ),
};
