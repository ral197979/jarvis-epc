/** @type {import('tailwindcss').Config} */
// Denver Engineering Next — "Industrial Precision System" design tokens.
// Derived 1:1 from the Google Stitch DESIGN.md so Stitch-generated class names
// (bg-primary, text-on-surface, surface-container-*, outline-variant, error-container…)
// resolve directly. Status colors added from the commissioning lifecycle palette.
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './frontend/src/**/*.{ts,tsx}',
    './design-system/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // ── Structural ────────────────────────────────────────────────
        primary: '#091426',
        'on-primary': '#ffffff',
        'primary-container': '#1e293b',
        'on-primary-container': '#8590a6',
        'primary-fixed': '#d8e3fb',
        'primary-fixed-dim': '#bcc7de',
        'on-primary-fixed': '#111c2d',
        'on-primary-fixed-variant': '#3c475a',
        'inverse-primary': '#bcc7de',

        secondary: '#0058be',
        'on-secondary': '#ffffff',
        'secondary-container': '#2170e4',
        'on-secondary-container': '#fefcff',
        'secondary-fixed': '#d8e2ff',
        'secondary-fixed-dim': '#adc6ff',

        tertiary: '#040057',
        'on-tertiary': '#ffffff',
        'tertiary-container': '#0d0093',

        // ── Surfaces ──────────────────────────────────────────────────
        background: '#f8f9ff',
        'on-background': '#0b1c30',
        surface: '#f8f9ff',
        'on-surface': '#0b1c30',
        'on-surface-variant': '#45474c',
        'surface-variant': '#d3e4fe',
        'surface-dim': '#cbdbf5',
        'surface-bright': '#f8f9ff',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#eff4ff',
        'surface-container': '#e5eeff',
        'surface-container-high': '#dce9ff',
        'surface-container-highest': '#d3e4fe',
        'inverse-surface': '#213145',
        'inverse-on-surface': '#eaf1ff',

        outline: '#75777d',
        'outline-variant': '#c5c6cd',

        // ── Status / lifecycle (inviolable) ───────────────────────────
        error: '#ba1a1a',
        'on-error': '#ffffff',
        'error-container': '#ffdad6',
        'on-error-container': '#93000a',
        success: '#16a34a',
        'success-container': '#dcfce7',
        warning: '#f97316',
        'warning-container': '#ffedd5',
        danger: '#dc2626',
        info: '#3b82f6',
        'status-gray': '#64748b',
      },
      borderRadius: {
        DEFAULT: '0.25rem',
        sm: '0.125rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
      },
      spacing: {
        base: '4px',
        xs: '4px',
        sm: '8px',
        md: '16px',
        lg: '24px',
        xl: '32px',
        gutter: '16px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        'display-lg': ['36px', { lineHeight: '44px', letterSpacing: '-0.02em', fontWeight: '700' }],
        'headline-md': ['24px', { lineHeight: '32px', letterSpacing: '-0.01em', fontWeight: '600' }],
        'headline-sm': ['18px', { lineHeight: '28px', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px' }],
        'body-md': ['14px', { lineHeight: '20px' }],
        'body-sm': ['12px', { lineHeight: '16px' }],
        'label-md': ['12px', { lineHeight: '16px', letterSpacing: '0.02em', fontWeight: '500' }],
        'label-sm': ['10px', { lineHeight: '12px', letterSpacing: '0.04em', fontWeight: '500' }],
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(11 28 48 / 0.06), 0 1px 3px 0 rgb(11 28 48 / 0.04)',
        md: '0 4px 12px -2px rgb(11 28 48 / 0.10)',
        lg: '0 12px 28px -6px rgb(11 28 48 / 0.16)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'slide-in-right': 'slide-in-right 200ms cubic-bezier(0.16,1,0.3,1)',
      },
    },
  },
  plugins: [],
}
