import { clsx } from 'clsx';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'gold' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'relative inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap ' +
  'transition-[transform,box-shadow,background-color,border-color,color,opacity] duration-200 ease-(--ease-swift) ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45';

const variants: Record<ButtonVariant, string> = {
  // Brand crimson: the one call to action on a screen.
  primary:
    'bg-linear-to-b from-velvet-bright to-velvet text-white shadow-[0_10px_30px_-12px_rgb(219_32_41/0.85)] ' +
    'hover:shadow-[0_12px_38px_-10px_rgb(255_67_75/0.9)] hover:brightness-110',
  // Screen-light gold: actions about the customer's own seats.
  gold:
    'bg-linear-to-b from-marquee-bright via-marquee to-[#d99a24] text-night-950 shadow-[0_8px_28px_-10px_rgb(240_181_69/0.7)] ' +
    'hover:shadow-[0_10px_36px_-8px_rgb(240_181_69/0.9)] hover:brightness-105',
  secondary: 'border border-cream/20 bg-cream/[0.03] text-cream hover:border-cream/45 hover:bg-cream/[0.08]',
  ghost: 'text-sand hover:bg-cream/[0.06] hover:text-cream',
  danger: 'border border-bad/40 bg-bad/[0.06] text-bad hover:border-bad/70 hover:bg-bad/[0.12]',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-6 text-[0.95rem]',
  lg: 'h-14 px-8 text-lg',
};

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Icon before the label (after it, visually, in RTL — flex handles the mirroring). */
  icon?: ReactNode;
  /** Icon after the label. */
  iconEnd?: ReactNode;
  loading?: boolean;
  block?: boolean;
  className?: string;
  children?: ReactNode;
}

export type ButtonProps = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'> & {
    /** Render as a router link instead of a <button>. */
    to?: string;
  };

/**
 * The app's button. Pass `to` to get a link that looks the same.
 *   <Button variant="primary" size="lg" iconEnd={<ArrowRight className="rtl:-scale-x-100" />}>…</Button>
 */
export function Button({
  variant = 'primary',
  size = 'md',
  icon,
  iconEnd,
  loading = false,
  block = false,
  className,
  children,
  to,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  const classes = clsx(base, variants[variant], sizes[size], block && 'w-full', className);
  const content = (
    <>
      {loading ? <Spinner size={size === 'lg' ? 20 : 16} /> : icon}
      {children}
      {!loading && iconEnd}
    </>
  );

  if (to !== undefined) {
    const inactive = disabled || loading;
    return (
      <Link
        to={to}
        className={classes}
        aria-disabled={inactive || undefined}
        tabIndex={inactive ? -1 : undefined}
        onClick={inactive ? (event) => event.preventDefault() : undefined}
      >
        {content}
      </Link>
    );
  }

  return (
    <button type={type} className={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {content}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name — required because there is no visible text. */
  label: string;
  icon: ReactNode;
  variant?: 'glass' | 'ghost' | 'solid';
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
}

const iconSizes = { sm: 'size-9', md: 'size-11', lg: 'size-12' } as const;

/** Round icon-only button with a tooltip-friendly accessible name. */
export function IconButton({
  label,
  icon,
  variant = 'ghost',
  size = 'md',
  active = false,
  className,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={active || undefined}
      className={clsx(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-[background-color,color,border-color,transform] duration-200 active:scale-95 disabled:pointer-events-none disabled:opacity-40',
        iconSizes[size],
        variant === 'glass' && 'glass text-cream hover:text-marquee-bright',
        variant === 'ghost' && 'text-sand hover:bg-cream/[0.07] hover:text-cream',
        variant === 'solid' && 'bg-night-700 text-cream hover:bg-night-600',
        active && 'text-marquee! ring-1 ring-marquee/50',
        className,
      )}
      {...rest}
    >
      {icon}
    </button>
  );
}
