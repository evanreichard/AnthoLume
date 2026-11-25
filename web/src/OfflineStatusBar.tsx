import { session } from './session';
import { Icon } from './Icon';
import styles from './OfflineReading.module.css';

export function OfflineStatusBar({ profile }: { profile?: string }) {
  return (
    <section className={styles.statusBar} aria-label="Offline controls">
      <div>
        {profile ? (
          <button
            className={styles.quiet}
            aria-label={`Switch Profile: ${profile}`}
            onClick={() => session.chooseOffline()}
          >
            <i aria-hidden="true" /> Offline · <strong>{profile}</strong>
            <Icon name="down" size={14} />
          </button>
        ) : (
          <span>
            <i aria-hidden="true" /> Offline
          </span>
        )}
        <button className={styles.quiet} onClick={() => void session.checkSession()}>
          <Icon name="refresh" size={16} />
          Reconnect
        </button>
      </div>
    </section>
  );
}
