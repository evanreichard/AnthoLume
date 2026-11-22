import { Link, useNavigate } from 'react-router';
import { ReaderScreen } from '../reading/ReaderScreen';
import { useSession } from '../session';
import { bookPath } from '../library';
import { useBookRef } from './bookRef';
import styles from '../App.module.css';

export function Component() {
  const book = useBookRef();
  const { access } = useSession();
  const navigate = useNavigate();
  if (!book) return <main><h1>Book not available for this account</h1><Link to="/library">Return to Library</Link></main>;
  return <div className={styles.readerViewport}><ReaderScreen book={book} onClose={() => { if (access.kind === 'offline') navigate('/library', { replace: true }); else if (window.history.state?.idx > 0) navigate(-1); else navigate(bookPath(book), { replace: true }); }} /></div>;
}
