import { Package } from 'lucide-react'
import clsx from 'clsx'

/**
 * Imagen de producto con placeholder consistente.
 * @param {string}  src       - URL de la imagen (puede ser null/undefined)
 * @param {string}  alt       - Texto alternativo
 * @param {string}  className - Clases de tamaño y forma (ej: "w-9 h-9 rounded-lg")
 * @param {number}  iconSize  - Tamaño del icono Package en el placeholder
 */
export default function ProductImage({ src, alt = '', className = '', iconSize = 16 }) {
  if (src) {
    return (
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={clsx('object-cover border border-ink-100', className)}
      />
    )
  }
  return (
    <div className={clsx('bg-brand-50 border border-brand-100 flex items-center justify-center', className)}>
      <Package size={iconSize} className="text-brand-400" />
    </div>
  )
}
