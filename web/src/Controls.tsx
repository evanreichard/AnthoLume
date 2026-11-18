import { useId, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { Link, NavLink, type LinkProps } from 'react-router';
import { Icon } from './Icon';
import { PageHeader } from './ui';
import styles from './Controls.module.css';

export function BackPill({ children, ...props }: Omit<LinkProps, 'className'>) {
  return <Link {...props} className={styles.back}><Icon name="back" size={16} />{children}</Link>;
}

export function WorkspaceHeader({ title, backTo, backLabel }: { title: string; backTo: LinkProps['to']; backLabel: string }) {
  return <PageHeader title={title} leading={<BackPill to={backTo} aria-label={`Back to ${backLabel}`}>{backLabel}</BackPill>} />;
}

export function SectionTabs({ label, items }: { label: string; items: readonly { to: string; label: string }[] }) {
  return <nav className={styles.sectionTabs} aria-label={label}>
    {items.map(item => <NavLink key={item.to} to={item.to} end>{item.label}</NavLink>)}
  </nav>;
}

export function Card({ as: Tag = 'section', density = 'regular', className, ...props }: HTMLAttributes<HTMLElement> & { as?: 'section' | 'article'; density?: 'regular' | 'compact' }) {
  return <Tag {...props} className={[density === 'compact' ? styles.compactCard : styles.paddedSurface, className].filter(Boolean).join(' ')} />;
}

export function CardHeader({ title, id, subtitle, leading, action }: { title: ReactNode; id?: string; subtitle?: ReactNode; leading?: ReactNode; action?: ReactNode }) {
  return <div className={styles.cardHeader}>
    <div className={styles.cardIdentity}>{leading}<div>
      <h2 id={id} className={styles.cardTitle}>{title}</h2>
      {subtitle != null && <p>{subtitle}</p>}
    </div></div>
    {action}
  </div>;
}

type CompactTone = { tone?: 'primary' };
type CompactButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & CompactTone;
type CompactLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'> & CompactTone;

export function CompactPill({ children, tone, type = 'button', ...props }: CompactButtonProps) {
  return <button {...props} type={type} className={styles.compactPill} data-tone={tone}><span>{children}</span></button>;
}

export function CompactPillLink({ children, tone, ...props }: CompactLinkProps) {
  return <a {...props} className={styles.compactPill} data-tone={tone}><span>{children}</span></a>;
}

export function PillSelect({ stretch = false, ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className'> & { stretch?: boolean }) {
  const select = <select {...props} className={styles.pillSelect} data-stretch={stretch || undefined} />;
  return stretch ? select : <span className={styles.compactSelect}>{select}</span>;
}

export function Pager({ label, page, total, hasNext, onPageChange }: { label: string; page: number; total?: number; hasNext: boolean; onPageChange: (page: number) => void }) {
  return <nav className={styles.pager} aria-label={label}>
    <CompactPill aria-disabled={page <= 1} onClick={() => { if (page > 1) onPageChange(page - 1); }}>Previous</CompactPill>
    <span role="status">{total == null ? `Page ${page}` : `${page} of ${total}`}</span>
    <CompactPill aria-disabled={!hasNext} onClick={() => { if (hasNext) onPageChange(page + 1); }}>Next</CompactPill>
  </nav>;
}

function Chevron() {
  return <span className={styles.chevron} aria-hidden="true" />;
}

type RowContent = { label: ReactNode; value?: ReactNode; leading?: ReactNode; divider?: boolean };
type ActionRowProps = RowContent & (
  | ({ to: LinkProps['to'] } & Pick<LinkProps, 'aria-label'>)
  | ({ to?: never } & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'aria-label' | 'aria-expanded' | 'aria-controls'>)
);

export function ActionRows({ children }: { children: ReactNode }) {
  return <div className={styles.actionRows}>{children}</div>;
}

export function ActionRow(props: ActionRowProps) {
  const valueId = useId();
  const { label, value, leading, divider, 'aria-label': accessibleName } = props;
  const labelId = useId();
  const attrs = {
    className: styles.actionRow,
    'data-divider': divider || undefined,
    'aria-label': accessibleName,
    'aria-labelledby': accessibleName ? undefined : labelId,
    'aria-describedby': value == null ? undefined : valueId,
  };
  const content = <>
    <span id={labelId} className={styles.actionLabel}>{leading}{label}</span>
    {value != null && <small className={styles.actionValue} id={valueId}>{value}</small>}
    <Chevron />
  </>;
  if (props.to !== undefined) return <Link {...attrs} to={props.to}>{content}</Link>;
  return <button {...attrs} type="button" disabled={props.disabled} onClick={props.onClick} aria-expanded={props['aria-expanded']} aria-controls={props['aria-controls']}>{content}</button>;
}

export function Disclosure({ title, children, open, inset = false, trailing }: { title: ReactNode; children: ReactNode; open?: boolean; inset?: boolean; trailing?: ReactNode }) {
  return <details open={open} className={inset ? styles.disclosure : `${styles.surface} ${styles.disclosure}`}>
    <summary><span>{title}</span>{trailing && <span className={styles.disclosureTrailing}>{trailing}</span>}</summary><div className={styles.disclosureBody}>{children}</div>
  </details>;
}
