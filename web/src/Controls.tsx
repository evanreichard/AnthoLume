import { useId, type AnchorHTMLAttributes, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref, type SelectHTMLAttributes } from 'react';
import { Link, NavLink, type LinkProps } from 'react-router';
import { Icon } from './Icon';
import styles from './Controls.module.css';

export function IconButton({ type = 'button', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & { 'aria-label': string }) {
  return <button {...props} type={type} className={styles.iconButton} />;
}

export function BackPill({ children, ...props }: Omit<LinkProps, 'className'>) {
  return <Link {...props} className={styles.back}><Icon name="back" size={16} />{children}</Link>;
}

export function SectionTabs({ label, items }: { label: string; items: readonly { to: string; label: string }[] }) {
  return <nav className={styles.sectionTabs} aria-label={label}>
    {items.map(item => <NavLink key={item.to} to={item.to} end>{item.label}</NavLink>)}
  </nav>;
}

export function SegmentedControl<T extends string>({ label, options, value, onChange, className }: { label: string; options: readonly (readonly [T, string])[]; value: T; onChange: (value: T) => void; className?: string }) {
  return <div className={[styles.segmentedControl, className].filter(Boolean).join(' ')} role="group" aria-label={label}>
    {options.map(([id, text]) => <button key={id} type="button" aria-pressed={value === id} onClick={() => { if (value !== id) onChange(id); }}><span>{text}</span></button>)}
  </div>;
}

type ControlSize = 'full' | 'slim';

export function JoinedActions({ label, children, size = 'full' }: { label: string; children: ReactNode; size?: ControlSize }) {
  return <div className={styles.joinedActions} data-size={size} role="group" aria-label={label}>{children}</div>;
}

export function JoinedAction({ children, tone, ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & { tone?: 'danger' }) {
  return <button {...props} type="button" data-tone={tone}><span>{children}</span></button>;
}

export function JoinedActionLink({ children, ...props }: Omit<LinkProps, 'className'>) {
  return <Link {...props}><span>{children}</span></Link>;
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

type ButtonStyle = { size?: ControlSize; tone?: 'primary' | 'danger' };

export function Button({ children, size = 'full', tone, type = 'button', ...props }: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> & ButtonStyle & { ref?: Ref<HTMLButtonElement> }) {
  return <button {...props} type={type} className={styles.button} data-size={size} data-tone={tone}><span>{children}</span></button>;
}

export function AddPill({ label, ...props }: Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'disabled' | 'onClick'> & { label: string }) {
  return <button {...props} type="button" className={styles.pillIcon} aria-label={label} title={label}><span><Icon name="add" size={16} /></span></button>;
}

type ButtonLinkProps = ButtonStyle & (Omit<LinkProps, 'className' | 'href'> | Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className'>);

export function ButtonLink({ children, size = 'full', tone, ...props }: ButtonLinkProps) {
  const appearance = { className: styles.button, 'data-size': size, 'data-tone': tone };
  const face = <span>{children}</span>;
  return 'to' in props ? <Link {...props} {...appearance}>{face}</Link> : <a {...props} {...appearance}>{face}</a>;
}

export function Dropdown({ size = 'full', stretch = false, ...props }: Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'size'> & { size?: ControlSize; stretch?: boolean }) {
  return <span className={styles.dropdown} data-size={size} data-stretch={stretch || undefined}><select {...props} /></span>;
}

export function Pager({ label, page, total, hasNext, onPageChange }: { label: string; page: number; total?: number; hasNext: boolean; onPageChange: (page: number) => void }) {
  return <nav className={styles.pager} aria-label={label}>
    <Button size="slim" aria-disabled={page <= 1} onClick={() => { if (page > 1) onPageChange(page - 1); }}>Previous</Button>
    <span role="status">{total == null ? `Page ${page}` : `${page} of ${total}`}</span>
    <Button size="slim" aria-disabled={!hasNext} onClick={() => { if (hasNext) onPageChange(page + 1); }}>Next</Button>
  </nav>;
}

function Chevron() {
  return <span className={styles.chevron} aria-hidden="true" />;
}

type RowContent = { label: ReactNode; subtitle?: ReactNode; value?: ReactNode; leading?: ReactNode; divider?: boolean };
type ActionRowProps = RowContent & (
  | ({ to: LinkProps['to'] } & Pick<LinkProps, 'aria-label'>)
  | ({ to?: never } & Pick<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'disabled' | 'aria-label' | 'aria-expanded' | 'aria-controls'>)
);

export function ActionRows({ children }: { children: ReactNode }) {
  return <div className={styles.actionRows}>{children}</div>;
}

export function ActionRow(props: ActionRowProps) {
  const valueId = useId();
  const { label, subtitle, value, leading, divider, 'aria-label': accessibleName } = props;
  const labelId = useId();
  const subtitleId = useId();
  const attrs = {
    className: styles.actionRow,
    'data-divider': divider || undefined,
    'aria-label': accessibleName,
    'aria-labelledby': accessibleName ? undefined : labelId,
    'aria-describedby': [subtitle == null ? null : subtitleId, value == null ? null : valueId].filter(Boolean).join(' ') || undefined,
  };
  const content = <>
    <span id={subtitle == null ? labelId : undefined} className={styles.actionLabel}>{leading}{subtitle == null ? label :
      <span className={styles.actionLabelStack}>
        <span id={labelId}>{label}</span>
        <span id={subtitleId} className={styles.actionSubtitle}>{subtitle}</span>
      </span>}</span>
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
