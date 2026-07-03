const withOpacity = cssVariable => `rgb(var(${cssVariable}) / <alpha-value>)`;

const buildScale = scaleName => ({
  50: withOpacity(`--${scaleName}-50`),
  100: withOpacity(`--${scaleName}-100`),
  200: withOpacity(`--${scaleName}-200`),
  300: withOpacity(`--${scaleName}-300`),
  400: withOpacity(`--${scaleName}-400`),
  500: withOpacity(`--${scaleName}-500`),
  600: withOpacity(`--${scaleName}-600`),
  700: withOpacity(`--${scaleName}-700`),
  800: withOpacity(`--${scaleName}-800`),
  900: withOpacity(`--${scaleName}-900`),
  DEFAULT: withOpacity(`--${scaleName}-500`),
  foreground: withOpacity(`--${scaleName}-foreground`),
});

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        canvas: withOpacity('--canvas'),
        surface: withOpacity('--surface'),
        'surface-muted': withOpacity('--surface-muted'),
        'surface-strong': withOpacity('--surface-strong'),
        overlay: withOpacity('--overlay'),
        content: withOpacity('--content'),
        'content-muted': withOpacity('--content-muted'),
        'content-subtle': withOpacity('--content-subtle'),
        'content-inverse': withOpacity('--content-inverse'),
        border: withOpacity('--border'),
        'border-muted': withOpacity('--border-muted'),
        'border-strong': withOpacity('--border-strong'),
        white: withOpacity('--white'),
        black: withOpacity('--black'),
        gray: buildScale('neutral'),
        purple: buildScale('primary'),
        blue: buildScale('secondary'),
        yellow: buildScale('warning'),
        red: buildScale('error'),
        primary: buildScale('primary'),
        secondary: buildScale('secondary'),
        tertiary: buildScale('tertiary'),
      },
    },
  },
  plugins: [],
};
