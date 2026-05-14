/**
 * context/CompanyFeaturesContext.jsx
 * Provee los feature flags de la empresa a todas las páginas del admin.
 * Se alimenta de los datos ya cargados en AdminLayout (companiesAPI.getMe).
 */
import { createContext, useContext } from 'react'

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
}

const CompanyFeaturesContext = createContext({
  features: DEFAULT_FEATURES,
  hasFeature: () => false,
  businessType: 'general',
})

export function CompanyFeaturesProvider({ features, businessType, children }) {
  const merged = { ...DEFAULT_FEATURES, ...(features || {}) }
  const hasFeature = (name) => merged[name] === true

  return (
    <CompanyFeaturesContext.Provider value={{ features: merged, hasFeature, businessType: businessType || 'general' }}>
      {children}
    </CompanyFeaturesContext.Provider>
  )
}

export const useCompanyFeatures = () => useContext(CompanyFeaturesContext)
export { DEFAULT_FEATURES }
