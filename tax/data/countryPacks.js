// Country tax packs for first-run setup. Rates are typical statutory defaults
// and can be edited after seeding. Always verify against current law.

const COUNTRY_PACKS = [
  {
    countryCode: 'AE',
    name: 'United Arab Emirates',
    regime: 'VAT',
    pricingModel: 'exclusive',
    filingFrequency: 'quarterly',
    recoverInputTax: true,
    types: [
      { code: 'VAT_STD', name: 'VAT Standard', rate: 5 },
      { code: 'VAT_ZERO', name: 'VAT Zero-Rated', rate: 0 },
      { code: 'VAT_EXEMPT', name: 'VAT Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export of goods/services', percentage: 100, requiresCertificate: false },
      { code: 'DIPLOMATIC', name: 'Diplomatic / government', percentage: 100, requiresCertificate: true },
    ],
  },
  {
    countryCode: 'SA',
    name: 'Saudi Arabia',
    regime: 'VAT',
    pricingModel: 'exclusive',
    filingFrequency: 'quarterly',
    recoverInputTax: true,
    types: [
      { code: 'VAT_STD', name: 'VAT Standard', rate: 15 },
      { code: 'VAT_ZERO', name: 'VAT Zero-Rated', rate: 0 },
      { code: 'VAT_EXEMPT', name: 'VAT Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export', percentage: 100, requiresCertificate: false },
    ],
  },
  {
    countryCode: 'GB',
    name: 'United Kingdom',
    regime: 'VAT',
    pricingModel: 'inclusive',
    filingFrequency: 'quarterly',
    recoverInputTax: true,
    types: [
      { code: 'VAT_STD', name: 'VAT Standard', rate: 20 },
      { code: 'VAT_RED', name: 'VAT Reduced', rate: 5 },
      { code: 'VAT_ZERO', name: 'VAT Zero-Rated', rate: 0 },
      { code: 'VAT_EXEMPT', name: 'VAT Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export / overseas supply', percentage: 100, requiresCertificate: false },
      { code: 'CHARITY', name: 'Charity', percentage: 100, requiresCertificate: true },
    ],
  },
  {
    countryCode: 'PK',
    name: 'Pakistan',
    regime: 'GST',
    pricingModel: 'exclusive',
    filingFrequency: 'monthly',
    recoverInputTax: true,
    types: [
      { code: 'GST_STD', name: 'GST Standard', rate: 18 },
      { code: 'GST_RED', name: 'GST Reduced', rate: 5 },
      { code: 'GST_ZERO', name: 'GST Zero-Rated', rate: 0 },
      { code: 'GST_EXEMPT', name: 'GST Exempt', rate: 0 },
      { code: 'WHT', name: 'Withholding Tax', rate: 10 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export', percentage: 100, requiresCertificate: false },
      { code: 'NTN_EXEMPT', name: 'NTN / SRB exemption', percentage: 100, requiresCertificate: true },
    ],
  },
  {
    countryCode: 'IN',
    name: 'India',
    regime: 'GST',
    pricingModel: 'exclusive',
    filingFrequency: 'monthly',
    recoverInputTax: true,
    types: [
      { code: 'GST_28', name: 'GST 28%', rate: 28 },
      { code: 'GST_18', name: 'GST 18%', rate: 18 },
      { code: 'GST_12', name: 'GST 12%', rate: 12 },
      { code: 'GST_5', name: 'GST 5%', rate: 5 },
      { code: 'GST_ZERO', name: 'GST 0%', rate: 0 },
      { code: 'GST_EXEMPT', name: 'GST Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export / SEZ', percentage: 100, requiresCertificate: true },
      { code: 'SEZ', name: 'SEZ unit', percentage: 100, requiresCertificate: true },
    ],
  },
  {
    countryCode: 'US',
    name: 'United States',
    regime: 'SALES_TAX',
    pricingModel: 'exclusive',
    filingFrequency: 'quarterly',
    recoverInputTax: false,
    types: [
      { code: 'SALES_TAX', name: 'Sales Tax (default)', rate: 0 },
      { code: 'EXEMPT', name: 'Tax Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'RESALE', name: 'Resale certificate', percentage: 100, requiresCertificate: true },
      { code: 'NON_PROFIT', name: 'Non-profit / 501(c)', percentage: 100, requiresCertificate: true },
      { code: 'GOVERNMENT', name: 'Government', percentage: 100, requiresCertificate: true },
    ],
  },
  {
    countryCode: 'AU',
    name: 'Australia',
    regime: 'GST',
    pricingModel: 'inclusive',
    filingFrequency: 'quarterly',
    recoverInputTax: true,
    types: [
      { code: 'GST_STD', name: 'GST', rate: 10 },
      { code: 'GST_ZERO', name: 'GST-free', rate: 0 },
      { code: 'GST_EXEMPT', name: 'Input-taxed', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export', percentage: 100, requiresCertificate: false },
    ],
  },
  {
    countryCode: 'CA',
    name: 'Canada',
    regime: 'GST',
    pricingModel: 'exclusive',
    filingFrequency: 'quarterly',
    recoverInputTax: true,
    types: [
      { code: 'GST', name: 'GST', rate: 5 },
      { code: 'HST', name: 'HST (harmonized)', rate: 13 },
      { code: 'GST_ZERO', name: 'GST Zero-Rated', rate: 0 },
      { code: 'GST_EXEMPT', name: 'GST Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export', percentage: 100, requiresCertificate: false },
      { code: 'RESALE', name: 'Resale', percentage: 100, requiresCertificate: true },
    ],
  },
  {
    countryCode: 'NZ',
    name: 'New Zealand',
    regime: 'GST',
    pricingModel: 'inclusive',
    filingFrequency: 'bimonthly',
    recoverInputTax: true,
    types: [
      { code: 'GST_STD', name: 'GST', rate: 15 },
      { code: 'GST_ZERO', name: 'GST Zero-Rated', rate: 0 },
      { code: 'GST_EXEMPT', name: 'GST Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export', percentage: 100, requiresCertificate: false },
    ],
  },
  {
    countryCode: 'DE',
    name: 'Germany',
    regime: 'VAT',
    pricingModel: 'inclusive',
    filingFrequency: 'monthly',
    recoverInputTax: true,
    types: [
      { code: 'VAT_STD', name: 'VAT Standard', rate: 19 },
      { code: 'VAT_RED', name: 'VAT Reduced', rate: 7 },
      { code: 'VAT_ZERO', name: 'VAT Zero-Rated', rate: 0 },
      { code: 'VAT_EXEMPT', name: 'VAT Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Intra-EU / export', percentage: 100, requiresCertificate: true },
    ],
  },
  {
    countryCode: 'FR',
    name: 'France',
    regime: 'VAT',
    pricingModel: 'inclusive',
    filingFrequency: 'monthly',
    recoverInputTax: true,
    types: [
      { code: 'VAT_STD', name: 'VAT Standard', rate: 20 },
      { code: 'VAT_RED', name: 'VAT Reduced', rate: 5.5 },
      { code: 'VAT_INT', name: 'VAT Intermediate', rate: 10 },
      { code: 'VAT_ZERO', name: 'VAT Zero-Rated', rate: 0 },
      { code: 'VAT_EXEMPT', name: 'VAT Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export / intra-EU', percentage: 100, requiresCertificate: true },
    ],
  },
  {
    countryCode: 'KE',
    name: 'Kenya',
    regime: 'VAT',
    pricingModel: 'exclusive',
    filingFrequency: 'monthly',
    recoverInputTax: true,
    types: [
      { code: 'VAT_STD', name: 'VAT Standard', rate: 16 },
      { code: 'VAT_ZERO', name: 'VAT Zero-Rated', rate: 0 },
      { code: 'VAT_EXEMPT', name: 'VAT Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export', percentage: 100, requiresCertificate: false },
    ],
  },
  {
    countryCode: 'NG',
    name: 'Nigeria',
    regime: 'VAT',
    pricingModel: 'exclusive',
    filingFrequency: 'monthly',
    recoverInputTax: true,
    types: [
      { code: 'VAT_STD', name: 'VAT Standard', rate: 7.5 },
      { code: 'VAT_ZERO', name: 'VAT Zero-Rated', rate: 0 },
      { code: 'VAT_EXEMPT', name: 'VAT Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export', percentage: 100, requiresCertificate: false },
    ],
  },
  {
    countryCode: 'ZA',
    name: 'South Africa',
    regime: 'VAT',
    pricingModel: 'inclusive',
    filingFrequency: 'bimonthly',
    recoverInputTax: true,
    types: [
      { code: 'VAT_STD', name: 'VAT Standard', rate: 15 },
      { code: 'VAT_ZERO', name: 'VAT Zero-Rated', rate: 0 },
      { code: 'VAT_EXEMPT', name: 'VAT Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export', percentage: 100, requiresCertificate: false },
    ],
  },
  {
    countryCode: 'SG',
    name: 'Singapore',
    regime: 'GST',
    pricingModel: 'exclusive',
    filingFrequency: 'quarterly',
    recoverInputTax: true,
    types: [
      { code: 'GST_STD', name: 'GST', rate: 9 },
      { code: 'GST_ZERO', name: 'GST Zero-Rated', rate: 0 },
      { code: 'GST_EXEMPT', name: 'GST Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export / international service', percentage: 100, requiresCertificate: false },
    ],
  },
  {
    countryCode: 'MY',
    name: 'Malaysia',
    regime: 'SST',
    pricingModel: 'exclusive',
    filingFrequency: 'bimonthly',
    recoverInputTax: false,
    types: [
      { code: 'SST_STD', name: 'Sales Tax', rate: 10 },
      { code: 'SST_SVC', name: 'Service Tax', rate: 8 },
      { code: 'SST_EXEMPT', name: 'Exempt', rate: 0 },
    ],
    exemptions: [
      { code: 'EXPORT', name: 'Export', percentage: 100, requiresCertificate: false },
    ],
  },
];

function getCountryPack(countryCode) {
  return COUNTRY_PACKS.find((p) => p.countryCode === countryCode) || null;
}

module.exports = { COUNTRY_PACKS, getCountryPack };
