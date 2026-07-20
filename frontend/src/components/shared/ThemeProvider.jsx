/**
 * components/shared/ThemeProvider.jsx
 * Inyecta los colores de la empresa como CSS variables globales.
 * Funciona para el admin panel y el catálogo público.
 */

const DEFAULT_PRIMARY = '#f97316'
const DEFAULT_BG      = '#fafafa'
const DEFAULT_TEXT    = '#171717'

function getContrastColor(hex) {
  const normalized = /^#[0-9a-f]{3}$/i.test(hex)
    ? `#${hex.slice(1).split('').map(char => char + char).join('')}`
    : hex

  if (!/^#[0-9a-f]{6}$/i.test(normalized)) return '#ffffff'

  const channels = [1, 3, 5].map(index => {
    const value = parseInt(normalized.slice(index, index + 2), 16) / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  const luminance = 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  return luminance > 0.45 ? '#171717' : '#ffffff'
}

export default function ThemeProvider({ settings }) {
  const primary = settings?.primary_color || DEFAULT_PRIMARY
  const bgColor = settings?.bg_color      || DEFAULT_BG
  const textColor = settings?.text_color  || DEFAULT_TEXT
  const contrastColor = getContrastColor(primary)

  const css = `
    :root {
      --brand-primary: ${primary};
      --brand-dark:    color-mix(in srgb, ${primary} 82%, black);
      --brand-light:   color-mix(in srgb, ${primary} 18%, white);
      --brand-muted:   color-mix(in srgb, ${primary} 9%,  white);
      --brand-ring:    color-mix(in srgb, ${primary} 35%, transparent);
      --brand-contrast: ${contrastColor};
      --page-bg:       ${bgColor};
      --page-text:     ${textColor};
    }

    /* Clases utilitarias de Tailwind usadas inline en JSX (catálogo, admin) */
    .text-brand-500 {
      color: ${primary} !important;
    }
    .text-brand-600 {
      color: color-mix(in srgb, ${primary} 82%, black) !important;
    }
    .text-brand-700 {
      color: color-mix(in srgb, ${primary} 68%, black) !important;
    }
    .bg-brand-500 {
      background-color: ${primary} !important;
    }
    .bg-brand-500.text-white,
    .from-brand-500.to-brand-600.text-white {
      color: ${contrastColor} !important;
    }
    .bg-brand-50 {
      background-color: color-mix(in srgb, ${primary} 9%, white) !important;
    }
    .bg-brand-100 {
      background-color: color-mix(in srgb, ${primary} 18%, white) !important;
    }
    .border-brand-100 {
      border-color: color-mix(in srgb, ${primary} 20%, white) !important;
    }
    .border-brand-200 {
      border-color: color-mix(in srgb, ${primary} 30%, white) !important;
    }
    .border-brand-400, .border-brand-500 {
      border-color: ${primary} !important;
    }
    .ring-brand-400, .focus\\:ring-brand-400:focus {
      --tw-ring-color: color-mix(in srgb, ${primary} 50%, transparent) !important;
    }
    .shadow-glow {
      box-shadow: 0 0 0 4px color-mix(in srgb, ${primary} 20%, transparent) !important;
    }
    .from-brand-500 {
      --tw-gradient-from: ${primary} !important;
    }
    .to-brand-600 {
      --tw-gradient-to: color-mix(in srgb, ${primary} 85%, black) !important;
    }
    .hover\\:bg-brand-50:hover {
      background-color: color-mix(in srgb, ${primary} 9%, white) !important;
    }
    .hover\\:bg-brand-600:hover {
      background-color: color-mix(in srgb, ${primary} 85%, black) !important;
    }
    .hover\\:text-brand-600:hover {
      color: color-mix(in srgb, ${primary} 82%, black) !important;
    }
    .hover\\:text-brand-700:hover {
      color: color-mix(in srgb, ${primary} 68%, black) !important;
    }
    .hover\\:border-brand-300:hover, .hover\\:border-brand-400:hover {
      border-color: color-mix(in srgb, ${primary} 60%, white) !important;
    }
    .animate-pulse-soft {
      background-color: color-mix(in srgb, ${primary} 70%, white) !important;
    }
  `

  return <style dangerouslySetInnerHTML={{ __html: css }} />
}
