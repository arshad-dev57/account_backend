'use strict';

const { randomUUID } = require('crypto');
const prisma = require('../prisma/client');

const OPERATIONAL_BUSINESS_TYPES = [
  'Trading',
  'Manufacturing',
  'Retail',
  'Distribution',
  'Services',
  'Other',
];

const SALES_MODELS = ['standard', 'installment', 'both'];
const PURCHASE_MODELS = ['standard', 'installment'];
const INSTALLMENT_REVENUE_POLICIES = ['full_on_sale', 'as_collected'];
const INSTALLMENT_FREQUENCIES = ['weekly', 'biweekly', 'monthly', 'quarterly'];

const DEFAULT_CONFIG = {
  operationalBusinessType: 'Other',
  salesModel: 'standard',
  purchaseModel: 'standard',
  installmentRevenuePolicy: 'full_on_sale',
  allowChildConfigOverride: true,
  inheritedFromParent: false,
  sourceParentCompanyId: null,
};

function normalizeEnum(value, allowed, fallback) {
  if (value == null || value === '') return fallback;
  const v = String(value).trim();
  const match = allowed.find((a) => a.toLowerCase() === v.toLowerCase());
  return match || fallback;
}

function validateConfigPatch(patch = {}, { partial = true } = {}) {
  const errors = [];
  const data = {};

  if (!partial || patch.operationalBusinessType !== undefined) {
    const v = normalizeEnum(
      patch.operationalBusinessType,
      OPERATIONAL_BUSINESS_TYPES,
      null
    );
    if (!v) errors.push('Invalid operationalBusinessType');
    else data.operationalBusinessType = v;
  }

  if (!partial || patch.salesModel !== undefined) {
    const v = normalizeEnum(patch.salesModel, SALES_MODELS, null);
    if (!v) errors.push('Invalid salesModel (standard | installment | both)');
    else data.salesModel = v;
  }

  if (!partial || patch.purchaseModel !== undefined) {
    const v = normalizeEnum(patch.purchaseModel, PURCHASE_MODELS, null);
    if (!v) errors.push('Invalid purchaseModel (standard | installment)');
    else data.purchaseModel = v;
  }

  if (!partial || patch.installmentRevenuePolicy !== undefined) {
    const v = normalizeEnum(
      patch.installmentRevenuePolicy,
      INSTALLMENT_REVENUE_POLICIES,
      null
    );
    if (!v) errors.push('Invalid installmentRevenuePolicy');
    else data.installmentRevenuePolicy = v;
  }

  if (patch.allowChildConfigOverride !== undefined) {
    data.allowChildConfigOverride = Boolean(patch.allowChildConfigOverride);
  }

  return { ok: errors.length === 0, errors, data };
}

function toPublicConfig(row, extras = {}) {
  if (!row) return null;
  const salesModel = row.salesModel || DEFAULT_CONFIG.salesModel;
  const purchaseModel = row.purchaseModel || DEFAULT_CONFIG.purchaseModel;
  return {
    id: row.id,
    companyId: row.companyId,
    operationalBusinessType: row.operationalBusinessType || DEFAULT_CONFIG.operationalBusinessType,
    salesModel,
    purchaseModel,
    installmentRevenuePolicy:
      row.installmentRevenuePolicy || DEFAULT_CONFIG.installmentRevenuePolicy,
    allowChildConfigOverride:
      row.allowChildConfigOverride ?? DEFAULT_CONFIG.allowChildConfigOverride,
    inheritedFromParent: Boolean(row.inheritedFromParent),
    sourceParentCompanyId: row.sourceParentCompanyId || null,
    capabilities: {
      allowStandardSales: salesModel === 'standard' || salesModel === 'both',
      allowInstallmentSales: salesModel === 'installment' || salesModel === 'both',
      allowStandardPurchase: purchaseModel === 'standard',
      allowInstallmentPurchase: purchaseModel === 'installment',
      showInstallmentSalesUi: salesModel === 'installment' || salesModel === 'both',
      showInstallmentPurchaseUi: purchaseModel === 'installment',
    },
    ...extras,
  };
}

function configFieldsFromRow(row) {
  if (!row) return { ...DEFAULT_CONFIG };
  return {
    operationalBusinessType: row.operationalBusinessType || DEFAULT_CONFIG.operationalBusinessType,
    salesModel: row.salesModel || DEFAULT_CONFIG.salesModel,
    purchaseModel: row.purchaseModel || DEFAULT_CONFIG.purchaseModel,
    installmentRevenuePolicy:
      row.installmentRevenuePolicy || DEFAULT_CONFIG.installmentRevenuePolicy,
    allowChildConfigOverride:
      row.allowChildConfigOverride ?? DEFAULT_CONFIG.allowChildConfigOverride,
  };
}

async function getCompanyWithParent(companyId) {
  if (!companyId) return null;
  return prisma.company.findUnique({
    where: { id: companyId },
    select: {
      id: true,
      parentCompanyId: true,
      name: true,
      businessConfig: true,
    },
  });
}

/**
 * Resolve effective business config for a company.
 * Prefers the company's own row; if missing, walks parent chain and materializes a copy
 * so children never silently fall back to "standard".
 */
async function resolveEffectiveCompanyConfig(companyId) {
  if (!companyId) {
    return toPublicConfig({
      id: null,
      companyId: null,
      ...DEFAULT_CONFIG,
    });
  }

  if (!prisma.companyBusinessConfig) {
    throw Object.assign(
      new Error(
        'Prisma client is stale (companyBusinessConfig missing). Restart the backend after prisma generate.'
      ),
      { statusCode: 503, code: 'PRISMA_CLIENT_STALE' }
    );
  }

  let company = await getCompanyWithParent(companyId);
  if (!company) {
    return toPublicConfig({
      id: null,
      companyId,
      ...DEFAULT_CONFIG,
    });
  }

  if (company.businessConfig) {
    return toPublicConfig(company.businessConfig);
  }

  // Walk parents for a config to inherit, then materialize on this company
  const seen = new Set([company.id]);
  let parentId = company.parentCompanyId;
  let parentConfig = null;
  let sourceParentId = null;

  while (parentId) {
    if (seen.has(parentId)) break;
    seen.add(parentId);
    const parent = await getCompanyWithParent(parentId);
    if (!parent) break;
    if (parent.businessConfig) {
      parentConfig = parent.businessConfig;
      sourceParentId = parent.id;
      break;
    }
    parentId = parent.parentCompanyId;
  }

  const seed = parentConfig
    ? {
        ...configFieldsFromRow(parentConfig),
        inheritedFromParent: true,
        sourceParentCompanyId: sourceParentId,
      }
    : { ...DEFAULT_CONFIG };

  const created = await prisma.companyBusinessConfig.create({
    data: {
      id: randomUUID(),
      companyId: company.id,
      ...seed,
    },
  });

  return toPublicConfig(created, {
    backfilled: true,
    inheritedFromParent: Boolean(parentConfig),
  });
}

async function seedCompanyBusinessConfig(companyId, input = {}, options = {}) {
  if (!companyId) throw Object.assign(new Error('Company context required'), { statusCode: 400 });

  const existing = await prisma.companyBusinessConfig.findUnique({ where: { companyId } });
  if (existing && !options.replace) {
    return toPublicConfig(existing);
  }

  const { ok, errors, data } = validateConfigPatch(
    { ...DEFAULT_CONFIG, ...input },
    { partial: false }
  );
  if (!ok) {
    throw Object.assign(new Error(errors.join('; ')), { statusCode: 400, errors });
  }

  const payload = {
    ...data,
    inheritedFromParent: Boolean(options.inheritedFromParent),
    sourceParentCompanyId: options.sourceParentCompanyId || null,
  };

  if (existing && options.replace) {
    const updated = await prisma.companyBusinessConfig.update({
      where: { companyId },
      data: payload,
    });
    return toPublicConfig(updated);
  }

  const created = await prisma.companyBusinessConfig.create({
    data: {
      id: randomUUID(),
      companyId,
      ...payload,
    },
  });
  return toPublicConfig(created);
}

/**
 * Seed child config by copying the parent's effective config.
 */
async function inheritBusinessConfigFromParent(childCompanyId, parentCompanyId) {
  if (!childCompanyId || !parentCompanyId) {
    return seedCompanyBusinessConfig(childCompanyId, DEFAULT_CONFIG);
  }
  const parentEffective = await resolveEffectiveCompanyConfig(parentCompanyId);
  return seedCompanyBusinessConfig(
    childCompanyId,
    {
      operationalBusinessType: parentEffective.operationalBusinessType,
      salesModel: parentEffective.salesModel,
      purchaseModel: parentEffective.purchaseModel,
      installmentRevenuePolicy: parentEffective.installmentRevenuePolicy,
      allowChildConfigOverride: parentEffective.allowChildConfigOverride,
    },
    {
      replace: true,
      inheritedFromParent: true,
      sourceParentCompanyId: parentCompanyId,
    }
  );
}

async function getParentOverridePolicy(companyId) {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { parentCompanyId: true },
  });
  if (!company?.parentCompanyId) {
    return { isChild: false, allowOverride: true, parentCompanyId: null };
  }
  const parentConfig = await resolveEffectiveCompanyConfig(company.parentCompanyId);
  return {
    isChild: true,
    allowOverride: parentConfig.allowChildConfigOverride !== false,
    parentCompanyId: company.parentCompanyId,
    parentConfig,
  };
}

/**
 * Update company business config with inheritance / override rules.
 * Does not rewrite historical transactions when the model changes.
 */
async function updateCompanyBusinessConfig(companyId, patch = {}, { force = false } = {}) {
  if (!companyId) throw Object.assign(new Error('Company context required'), { statusCode: 400 });

  const current = await resolveEffectiveCompanyConfig(companyId);
  const parentPolicy = await getParentOverridePolicy(companyId);

  if (parentPolicy.isChild && !parentPolicy.allowOverride && !force) {
    throw Object.assign(
      new Error(
        'Parent company policy does not allow this child company to change its business model configuration'
      ),
      { statusCode: 403, code: 'CHILD_CONFIG_LOCKED' }
    );
  }

  const { ok, errors, data } = validateConfigPatch(patch, { partial: true });
  if (!ok) {
    throw Object.assign(new Error(errors.join('; ')), { statusCode: 400, errors });
  }

  if (Object.keys(data).length === 0) {
    return current;
  }

  // Warn-level guards for model switches that could affect workflows (caller surfaces warning)
  const warnings = [];
  if (data.salesModel && data.salesModel !== current.salesModel) {
    warnings.push(
      'Changing sales model does not alter historical invoices or accounting entries. Existing installment schedules remain unchanged.'
    );
  }
  if (data.purchaseModel && data.purchaseModel !== current.purchaseModel) {
    warnings.push(
      'Changing purchase model does not alter historical purchase invoices or accounting entries.'
    );
  }

  const updated = await prisma.companyBusinessConfig.upsert({
    where: { companyId },
    create: {
      id: randomUUID(),
      companyId,
      ...DEFAULT_CONFIG,
      ...data,
      inheritedFromParent: false,
      sourceParentCompanyId: null,
    },
    update: {
      ...data,
      inheritedFromParent: false,
      sourceParentCompanyId: null,
    },
  });

  // Optionally mirror allowChildConfigOverride + non-overridden children when parent updates
  if (data.allowChildConfigOverride !== undefined || data.salesModel || data.purchaseModel) {
    const children = await prisma.company.findMany({
      where: { parentCompanyId: companyId },
      select: { id: true, businessConfig: true },
    });
    for (const child of children) {
      if (!child.businessConfig) {
        await inheritBusinessConfigFromParent(child.id, companyId);
        continue;
      }
      if (child.businessConfig.inheritedFromParent) {
        await prisma.companyBusinessConfig.update({
          where: { companyId: child.id },
          data: {
            operationalBusinessType:
              data.operationalBusinessType ?? updated.operationalBusinessType,
            salesModel: data.salesModel ?? updated.salesModel,
            purchaseModel: data.purchaseModel ?? updated.purchaseModel,
            installmentRevenuePolicy:
              data.installmentRevenuePolicy ?? updated.installmentRevenuePolicy,
            allowChildConfigOverride:
              data.allowChildConfigOverride ?? updated.allowChildConfigOverride,
            inheritedFromParent: true,
            sourceParentCompanyId: companyId,
          },
        });
      }
    }
  }

  return { ...toPublicConfig(updated), warnings };
}

function assertInstallmentSalesAllowed(config, { isInstallment } = {}) {
  if (!isInstallment) return;
  const caps = config?.capabilities || toPublicConfig(config)?.capabilities;
  if (!caps?.allowInstallmentSales) {
    throw Object.assign(
      new Error(
        'Installment-based sales are not enabled for this company. Update Business Configuration or choose a standard sale.'
      ),
      { statusCode: 403, code: 'INSTALLMENT_SALES_DISABLED' }
    );
  }
}

function assertInstallmentPurchaseAllowed(config, { isInstallment } = {}) {
  if (!isInstallment) return;
  const caps = config?.capabilities || toPublicConfig(config)?.capabilities;
  if (!caps?.allowInstallmentPurchase) {
    throw Object.assign(
      new Error(
        'Installment-based purchases are not enabled for this company. Update Business Configuration or choose a standard purchase.'
      ),
      { statusCode: 403, code: 'INSTALLMENT_PURCHASE_DISABLED' }
    );
  }
}

function parseBusinessConfigFromRequestBody(body = {}) {
  const raw = {
    operationalBusinessType:
      body.operationalBusinessType ||
      body.businessCategory ||
      body.operational_business_type,
    salesModel: body.salesModel || body.sales_model,
    purchaseModel: body.purchaseModel || body.purchase_model,
    installmentRevenuePolicy:
      body.installmentRevenuePolicy || body.installment_revenue_policy,
    allowChildConfigOverride:
      body.allowChildConfigOverride !== undefined
        ? body.allowChildConfigOverride === true ||
          body.allowChildConfigOverride === 'true' ||
          body.allowChildConfigOverride === '1'
        : undefined,
  };

  // Only include keys that were actually provided
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    if (v !== undefined && v !== null && v !== '') out[k] = v;
  }
  return out;
}

module.exports = {
  OPERATIONAL_BUSINESS_TYPES,
  SALES_MODELS,
  PURCHASE_MODELS,
  INSTALLMENT_REVENUE_POLICIES,
  INSTALLMENT_FREQUENCIES,
  DEFAULT_CONFIG,
  validateConfigPatch,
  toPublicConfig,
  resolveEffectiveCompanyConfig,
  seedCompanyBusinessConfig,
  inheritBusinessConfigFromParent,
  updateCompanyBusinessConfig,
  getParentOverridePolicy,
  assertInstallmentSalesAllowed,
  assertInstallmentPurchaseAllowed,
  parseBusinessConfigFromRequestBody,
  configFieldsFromRow,
};
