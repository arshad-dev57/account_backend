'use strict';

/**
 * HTTP layer for the ERPNext-shaped HR documents. Everything the screens need
 * comes from here: the workspace tree, the document metadata (so the frontend
 * renders forms from the same field definitions the backend validates), the
 * CRUD endpoints and the server-enforced status transitions.
 */

const docs = require('../services/hrDocumentService');
const nav = require('../services/hrWorkspaceNav');
const numberCards = require('../services/hrNumberCards');
const dashboardCharts = require('../services/hrDashboardCharts');
const reports = require('../services/hrReports');
const { registry, MANAGER_ONLY } = require('../services/hrDocumentRegistry');
const { requireCompany, companyIdOf, isHrAdminRole } = require('../utils/hrAccess');
const { getEffectivePermissions } = require('../services/permissionService');

const WORKSPACES = nav.workspaces.reduce((map, ws) => ({ ...map, [ws.slug]: ws }), {});

// ERPNext hides the setup-style sections of a workspace from non-HR users. The
// section names mirror whatever the live workspace sidebars use ("Masters",
// "Leave Setup", "Tax & Exemption Setup", …), so the rule is matched on the
// name rather than a fixed list.
function isManagerSection(name) {
  const value = String(name || '');
  return /setup|masters|tools|settings/i.test(value) || value === 'Reports';
}

function fail(res, error) {
  const status = error instanceof docs.HttpError ? error.status : error.status || 500;
  if (status >= 500) console.error('[hr-docs]', error);
  return res.status(status).json({
    success: false,
    message: error.message || 'Something went wrong',
    errors: error.extra?.errors
  });
}

function wrap(handler) {
  return async (req, res) => {
    const companyId = requireCompany(req, res);
    if (!companyId) return undefined;
    try {
      const payload = await handler(req, res, companyId);
      if (!res.headersSent) res.json({ success: true, data: payload });
      return undefined;
    } catch (error) {
      return fail(res, error);
    }
  };
}

// Loads the caller's granular hr.* grants once per request so the document
// service can widen (never narrow) its role checks with them.
async function loadPermissions(req, _res, next) {
  const userId = req.user?.id || req.user?._id;
  const companyId = companyIdOf(req);
  if (!userId || !companyId) return next();
  try {
    const effective = await getEffectivePermissions(userId, companyId);
    req.hrPermissions = new Set(effective.permissions || []);
    req.hrIsAdmin = Boolean(effective.isAdmin);
  } catch (error) {
    console.error('[hr-docs] permission lookup', error.message);
  }
  return next();
}

function itemHref(slug, item) {
  if (item.resource) return `/hr/${slug}/${item.resource}`;
  if (item.href) return item.href;
  if (item.report) return `/hr/${slug}/report/${item.report}`;
  return null;
}

function isHrManager(req) {
  const perms = req.hrPermissions || new Set();
  return (
    isHrAdminRole(req.user?.role) ||
    Boolean(req.hrIsAdmin) ||
    [...perms].some((p) => p.startsWith('hr.') && !p.endsWith('.view'))
  );
}

function hiddenForEmployee(item) {
  return isManagerSection(item.section || item.label);
}

function itemAvailable(item) {
  if (item.available === false) return false;
  // A report is only linkable when the report registry can actually compute it.
  if (item.kind === 'report' && item.report) return Boolean(reports.reports[item.report]);
  // Documents without a registry entry stay greyed so the sidebar never 404s.
  if ((item.kind === 'document' || item.kind === 'settings') && item.resource) {
    return Boolean(registry[item.resource]);
  }
  return true;
}

function decorateItem(slug, item, manager) {
  const children = item.items
    ? item.items.filter((child) => manager || !hiddenForEmployee(child)).map((child) => decorateItem(slug, child, manager))
    : undefined;
  // An employee gets no section header for a group they cannot enter, the same
  // way the ERPNext sidebar drops a block whose links are all filtered out.
  if (children && !children.length) return null;
  return {
    ...item,
    available: itemAvailable(item),
    href: itemHref(slug, item),
    items: children
  };
}

function workspacesOf(req) {
  const manager = isHrManager(req);
  return {
    isManager: manager,
    trackingLinks: nav.trackingLinks,
    workspaces: nav.workspaces.map((ws) => ({
      slug: ws.slug,
      label: ws.label,
      icon: ws.icon,
      items: ws.items
        .filter((item) => manager || !hiddenForEmployee(item))
        .map((item) => decorateItem(ws.slug, item, manager))
        .filter(Boolean),
      // registered masters the ERPNext sidebar does not link
      extraDocuments: (nav.extraDocuments[ws.slug] || [])
        .filter((extra) => manager || !MANAGER_ONLY.has(extra.resource))
        .map((extra) => ({
          ...extra,
          kind: 'document',
          available: true,
          href: `/hr/${ws.slug}/${extra.resource}`
        }))
    }))
  };
}

function documentsMeta(req, _res, companyId) {
  const workspace = req.query.workspace ? String(req.query.workspace) : null;
  if (workspace && !WORKSPACES[workspace]) throw new docs.HttpError(404, `Unknown workspace: ${workspace}`);
  return {
    workspaces: nav.workspaces.map((ws) => ({ slug: ws.slug, label: ws.label })),
    descriptors: docs.descriptors(workspace)
  };
}

function documentMeta(req, _res, companyId) {
  const descriptor = docs.descriptorOf(req.params.resource);
  if (!descriptor) throw new docs.HttpError(404, `Unknown HR document: ${req.params.resource}`);
  const def = registry[req.params.resource];
  // the dropdowns a form needs, resolved company-side so no other tenant leaks in
  // Collect link targets + optional ERPNext-style link filters (e.g. parent
  // department → is_group=1). Options are keyed by target, and again by
  // `target?isGroup=true` when a field declares linkQuery.
  const loads = new Map();
  const add = (target, linkQuery) => {
    if (!target) return;
    const key = optionsKey(target, linkQuery);
    if (!loads.has(key)) loads.set(key, { target, query: linkQuery || {} });
  };
  const collect = (field) => {
    if (field.t === 'link') add(field.o, field.linkQuery);
    else if (field.t === 'employee' || field.t === 'multiEmployee') add('employee');
    else if (field.t === 'userLink') add('user');
    else if (field.t === 'account') add('account');
    else if (field.t === 'currencyCode') add('currency');
    else if (field.t === 'costCenter') add('costCenter');
    else if (field.t === 'department') add('department', field.linkQuery);
    else if (field.t === 'designation') add('designation', field.linkQuery);
    else if (field.t === 'office') add('office');
    else if (field.t === 'company') add('company');
    for (const row of field.rows || []) collect(row);
  };
  for (const field of def.fields) collect(field);

  return Promise.all(
    [...loads.entries()].map(async ([key, { target, query }]) => ({
      key,
      options: await docs.options(target, req, query)
    }))
  ).then((list) => ({ descriptor, options: Object.fromEntries(list.map((x) => [x.key, x.options])) }));
}

function optionsKey(target, linkQuery) {
  if (!linkQuery || !Object.keys(linkQuery).length) return String(target);
  const qs = Object.entries(linkQuery)
    .map(([k, v]) => `${k}=${v === true ? 'true' : v === false ? 'false' : String(v)}`)
    .join('&');
  return `${target}?${qs}`;
}

function dashboard(req, _res, companyId) {
  const ws = WORKSPACES[req.params.slug];
  if (!ws) throw new docs.HttpError(404, `Unknown workspace: ${req.params.slug}`);
  const resources = [];
  for (const item of ws.items) {
    if (item.resource) resources.push({ label: item.label, resource: item.resource });
    for (const child of item.items || []) {
      if (child.resource) resources.push({ label: child.label, resource: child.resource });
    }
  }
  for (const extra of nav.extraDocuments[req.params.slug] || []) {
    resources.push({ label: extra.label, resource: extra.resource });
  }
  return Promise.all([
    docs.counts(resources.map((r) => r.resource), req),
    numberCards.computeWorkspace(req.params.slug, companyId),
    numberCards.chartFor(req.params.slug, companyId)
  ]).then(([counts, cards, chart]) => ({
    workspace: { slug: ws.slug, label: ws.label, icon: ws.icon, dashboard: ws.dashboard || null },
    numberCards: cards,
    chart,
    shortcuts: resources
      .filter((r) => counts[r.resource] !== null)
      .map((r) => ({ label: r.label, resource: r.resource, href: `/hr/${ws.slug}/${r.resource}`, count: counts[r.resource] })),
    links: ws.items.map((item) => decorateItem(ws.slug, item, true)),
    trackingLinks: nav.trackingLinks
  }));
}

function linkOptions(req, _res, companyId) {
  return docs.options(req.params.target, req, req.query);
}

function workspaceCharts(req, _res, companyId) {
  if (!WORKSPACES[req.params.slug]) throw new docs.HttpError(404, `Unknown workspace: ${req.params.slug}`);
  return dashboardCharts.chartsFor(req.params.slug, companyId);
}

module.exports = {
  loadPermissions,
  workspaces: wrap(workspacesOf),
  dashboard: wrap(dashboard),
  charts: wrap(workspaceCharts),
  documents: wrap(documentsMeta),
  document: wrap(documentMeta),
  list: wrap((req) => docs.list(req.params.resource, req, req.query)),
  detail: wrap((req) => docs.get(req.params.resource, req.params.id, req)),
  create: wrap((req) => docs.create(req.params.resource, req, req.body)),
  update: wrap((req) => docs.update(req.params.resource, req.params.id, req, req.body)),
  remove: wrap((req) => docs.remove(req.params.resource, req.params.id, req)),
  action: wrap((req) => docs.runAction(req.params.resource, req.params.id, req.params.key, req, req.body)),
  button: wrap((req) => docs.runButton(req.params.resource, req.params.id, req.params.key, req, req.body)),
  timeline: wrap((req) => docs.timeline(req.params.resource, req.params.id, req)),
  comment: wrap((req) => docs.addComment(req.params.resource, req.params.id, req, req.body)),
  options: wrap(linkOptions)
};
