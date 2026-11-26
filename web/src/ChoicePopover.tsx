import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import panelStyles from './ActionPanel.module.css';
import styles from './ChoicePopover.module.css';
import { IconButton, JoinedAction } from './Controls';
import { Icon } from './Icon';
import { useActionPanel } from './useActionPanel';

type Choice<T extends string> = {
  value: T;
  label: string;
  description?: string;
  icon?: ReactNode;
  disabled?: boolean;
};

export type ChoiceDisclosure = { open: boolean; onOpen: () => void; onClose: () => void };

type ChoicePopoverProps<T extends string> = {
  label: string;
  triggerLabel?: string;
  trigger: ReactNode;
  descriptionId?: string;
  presentation?: 'icon' | 'joined';
  disabled?: boolean;
  options: readonly Choice<T>[];
  value?: T;
  onChange: (value: T) => void;
  disclosure?: ChoiceDisclosure;
};

export function ChoicePopover<T extends string>({
  label,
  triggerLabel = label,
  trigger: face,
  descriptionId,
  presentation = 'icon',
  disabled,
  options,
  value,
  onChange,
  disclosure,
}: ChoicePopoverProps<T>) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = disclosure?.open ?? localOpen;
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const focusedPanel = useRef(false);
  const joined = presentation === 'joined';
  const actions = useActionPanel(open, trigger, panel, () => {
    focusedPanel.current = false;
    if (disclosure) disclosure.onClose();
    else setLocalOpen(false);
  });
  useLayoutEffect(() => {
    if (open && joined) {
      panel.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    }
    // History Dismissal - Back can remove a focused choice without a dismissal event.
    if (!open && focusedPanel.current) {
      focusedPanel.current = false;
      if (document.activeElement === document.body) trigger.current?.focus({ preventScroll: true });
    }
  }, [open, joined]);

  const Trigger = joined ? JoinedAction : IconButton;
  const contents = (
    <>
      <Trigger
        {...actions.events}
        ref={trigger}
        aria-label={triggerLabel}
        aria-describedby={descriptionId}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={joined ? triggerLabel : undefined}
        disabled={disabled}
        onClick={() => {
          if (open) actions.dismiss(true);
          else {
            trigger.current?.focus({ preventScroll: true });
            if (disclosure) disclosure.onOpen();
            else setLocalOpen(true);
          }
        }}
      >
        {face}
      </Trigger>
      {open && (
        <div
          {...actions.events}
          ref={panel}
          id={panelId}
          role="group"
          aria-label={label}
          className={`${panelStyles.panel} ${styles.options}`}
          data-joined={joined || undefined}
          onFocus={() => {
            focusedPanel.current = true;
          }}
        >
          {options.map((choice) => (
            <button
              key={choice.value}
              type="button"
              disabled={choice.disabled}
              aria-label={choice.disabled ? undefined : choice.label}
              aria-description={choice.disabled ? undefined : choice.description}
              aria-pressed={value === choice.value}
              onClick={() => {
                focusedPanel.current = false;
                trigger.current?.focus({ preventScroll: true });
                // Controlled Selection - The caller can update its value and close the popover in one navigation.
                onChange(choice.value);
                if (!disclosure) setLocalOpen(false);
              }}
            >
              {choice.icon}
              <span>
                {choice.label}
                {choice.description && <small>{choice.description}</small>}
              </span>
              {value === choice.value && <Icon name="check" size={joined ? 16 : 17} />}
            </button>
          ))}
        </div>
      )}
    </>
  );
  return joined ? contents : <div className={styles.control}>{contents}</div>;
}
