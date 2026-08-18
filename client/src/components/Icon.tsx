import React from 'react';

/**
 * The icon set.
 *
 * One grid (24), one stroke (1.5), round caps and joins, currentColor
 * throughout. Every glyph is drawn here rather than borrowed from a font
 * or an emoji, so weight and terminal shape stay consistent with Archivo
 * next to them at 13–14px.
 *
 * Icons are decorative by default: the control that wraps one carries the
 * accessible name. Pass `title` only where the icon is the whole message.
 */

interface IconProps extends React.SVGProps<SVGSVGElement> {
    size?: number;
    title?: string;
}

const Svg: React.FC<IconProps & { children: React.ReactNode }> = ({
    size = 18, title, children, ...rest
}) => (
    <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden={title ? undefined : true}
        role={title ? 'img' : undefined}
        focusable="false"
        {...rest}
    >
        {title && <title>{title}</title>}
        {children}
    </svg>
);

export const SearchIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <circle cx="10.75" cy="10.75" r="6.5" />
        <path d="M15.6 15.6 20 20" />
    </Svg>
);

export const CalendarIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <rect x="3.25" y="5.25" width="17.5" height="15.5" rx="2.25" />
        <path d="M8 3.25v4M16 3.25v4M3.25 10h17.5" />
        <path d="M12 13.4v4.2M9.9 15.5h4.2" />
    </Svg>
);

/** Outline by default; `filled` is the same silhouette so the toggle does
 *  not shift a pixel between states. */
export const StarIcon: React.FC<IconProps & { filled?: boolean }> = ({ filled, ...p }) => (
    <Svg {...p}>
        <path
            d="M12 3.6l2.68 5.43 5.99.87-4.34 4.23 1.03 5.97L12 17.28l-5.36 2.82 1.03-5.97L3.33 9.9l5.99-.87z"
            fill={filled ? 'currentColor' : 'none'}
        />
    </Svg>
);

export const PlusIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <path d="M12 5.5v13M5.5 12h13" />
    </Svg>
);

export const MinusIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <path d="M5.5 12h13" />
    </Svg>
);

export const CloseIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <path d="M6.4 6.4l11.2 11.2M17.6 6.4L6.4 17.6" />
    </Svg>
);

export const SunIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.4M12 19v2.4M21.4 12H19M5 12H2.6M18.65 5.35l-1.7 1.7M7.05 16.95l-1.7 1.7M18.65 18.65l-1.7-1.7M7.05 7.05l-1.7-1.7" />
    </Svg>
);

export const MoonIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <path d="M20.8 13.15A8.8 8.8 0 1110.85 3.2a6.85 6.85 0 009.95 9.95z" />
    </Svg>
);

export const ClockIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <circle cx="12" cy="12" r="8.6" />
        <path d="M12 6.9V12l3.4 2" />
    </Svg>
);

export const ChevronDownIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <path d="M5.5 9.25L12 15.75l6.5-6.5" />
    </Svg>
);

export const ArrowLeftIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <path d="M19 12H5M11 6l-6 6 6 6" />
    </Svg>
);

export const ArrowRightIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <path d="M5 12h14M13 6l6 6-6 6" />
    </Svg>
);

/** A tray seen head-on. Stands in for the board itself: brand mark,
 *  "nothing found", "nothing on this plate". */
export const TrayIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <path d="M3.4 10.6h17.2a8.6 8.6 0 01-17.2 0z" />
        <path d="M2.6 20.4h18.8" />
        <path d="M8.6 7.4c0-1.5 1.3-1.9 1.3-3.1M12.4 7.4c0-1.9 1.3-2.3 1.3-3.6M16.2 7.4c0-1.5 1.3-1.9 1.3-3.1" />
    </Svg>
);

export const CheckIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <path d="M5 12.6l4.6 4.6L19 7.2" />
    </Svg>
);

export const AlertIcon: React.FC<IconProps> = (p) => (
    <Svg {...p}>
        <circle cx="12" cy="12" r="8.6" />
        <path d="M12 7.6v5.2M12 16.2h.01" />
    </Svg>
);

/** Google's mark, in Google's colors. The sign-in button is the one place a
 *  foreign brand belongs, and a recolored version would misrepresent it. */
export const GoogleIcon: React.FC<{ size?: number }> = ({ size = 15 }) => (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="#4285F4" d="M23.52 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h6.47a5.53 5.53 0 01-2.4 3.63v3h3.88c2.27-2.09 3.57-5.17 3.57-8.87z" />
        <path fill="#34A853" d="M12 24c3.24 0 5.96-1.08 7.95-2.91l-3.88-3.01c-1.08.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.95H1.26v3.09A12 12 0 0012 24z" />
        <path fill="#FBBC05" d="M5.27 14.28a7.21 7.21 0 010-4.56V6.63H1.26a12 12 0 000 10.74z" />
        <path fill="#EA4335" d="M12 4.77c1.77 0 3.35.61 4.6 1.8l3.44-3.44C17.95 1.19 15.24 0 12 0A12 12 0 001.26 6.63l4.01 3.09C6.22 6.88 8.87 4.77 12 4.77z" />
    </svg>
);
