/**
 * context/CompanyFeaturesContext.jsx
 * Provee los feature flags, tipo de negocio, moneda y formateo de precios
 * a todas las páginas del admin.
 * Se alimenta de los datos ya cargados en AdminLayout (companiesAPI.getMe).
 */
import { createContext, useContext, useMemo } from 'react'

const DEFAULT_FEATURES = {
  physical_location: true,
  expiration_dates:  false,
  batch_tracking:    false,
  serial_numbers:    false,
  variants:          false,
  multi_unit:        false,
  tags:              true,
  barcodes_qr:       true,
  auto_reorder:      false,
  public_catalog:    true,
}

// ── Catálogo de monedas ───────────────────────────────────────────────
export const CURRENCIES = [
  // ── Norteamérica ──────────────────────────────
  { code: 'USD', symbol: '$',   name: 'Dólar estadounidense'  },
  { code: 'CAD', symbol: 'C$',  name: 'Dólar canadiense'      },
  { code: 'MXN', symbol: '$',   name: 'Peso mexicano'         },
  // ── Centroamérica ─────────────────────────────
  { code: 'GTQ', symbol: 'Q',   name: 'Quetzal guatemalteco'  },
  { code: 'HNL', symbol: 'L',   name: 'Lempira hondureño'     },
  { code: 'NIO', symbol: 'C$',  name: 'Córdoba nicaragüense'  },
  { code: 'CRC', symbol: '₡',   name: 'Colón costarricense'   },
  { code: 'PAB', symbol: 'B/.',  name: 'Balboa panameño'       },
  { code: 'DOP', symbol: 'RD$', name: 'Peso dominicano'       },
  // ── Sudamérica ────────────────────────────────
  { code: 'COP', symbol: '$',   name: 'Peso colombiano'       },
  { code: 'VES', symbol: 'Bs.', name: 'Bolívar venezolano'    },
  { code: 'PEN', symbol: 'S/',  name: 'Sol peruano'           },
  { code: 'BRL', symbol: 'R$',  name: 'Real brasileño'        },
  { code: 'BOB', symbol: 'Bs.', name: 'Boliviano'             },
  { code: 'ARS', symbol: '$',   name: 'Peso argentino'        },
  { code: 'CLP', symbol: '$',   name: 'Peso chileno'          },
  { code: 'UYU', symbol: '$U',  name: 'Peso uruguayo'         },
  { code: 'PYG', symbol: '₲',   name: 'Guaraní paraguayo'     },
  // ── Internacional ─────────────────────────────
  { code: 'EUR', symbol: '€',   name: 'Euro'                  },
]

const CompanyFeaturesContext = createContext({
  features:     DEFAULT_FEATURES,
  hasFeature:   () => false,
  businessType: 'general',
  currency:     'USD',
  formatPrice:  (n) => `$${Number(n).toLocaleString()}`,
})

export function CompanyFeaturesProvider({ features, businessType, currency, children }) {
  const merged   = { ...DEFAULT_FEATURES, ...(features || {}) }
  const hasFeature = (name) => merged[name] === true

  const currencyCode = currency || 'USD'
  const currencyInfo = CURRENCIES.find(c => c.code === currencyCode) || CURRENCIES[0]

  const formatPrice = useMemo(() => (amount) => {
    if (amount == null || isNaN(amount)) return `${currencyInfo.symbol}0`
    const num = Number(amount)
    // Monedas sin decimales
    const noDecimals = ['CLP', 'PYG', 'JPY']
    const decimals = noDecimals.includes(currencyCode) ? 0 : 2
    return `${currencyInfo.symbol}${num.toLocaleString('es-419', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    })}`
  }, [currencyCode, currencyInfo.symbol])

  return (
    <CompanyFeaturesContext.Provider value={{
      features: merged,
      hasFeature,
      businessType: businessType || 'general',
      currency: currencyCode,
      formatPrice,
    }}>
      {children}
    </CompanyFeaturesContext.Provider>
  )
}

export const useCompanyFeatures = () => useContext(CompanyFeaturesContext)
export { DEFAULT_FEATURES }
