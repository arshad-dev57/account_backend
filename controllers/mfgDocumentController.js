'use strict';

/**
 * ERPNext-shaped Manufacturing documents HTTP layer.
 * Mirrors hrDocumentController: workspace nav, descriptors, CRUD, actions.
 */

const docs = require('../services/mfgDocumentService');
const nav = require('../services/mfgWorkspaceNav');
const reports = require('../services/mfgReports');
const { registry } = require('../services/mfgDocumentRegistry');

const WORKSPACES = nav.workspaces.reduce((map, ws) => ({ ...map, [ws.slug]: ws }), {});

function fail(res, error) {
  const status = error instanceof docs.HttpError ? error.status : error.status || 500;
  if (status >= 500) console.error('[mfg-docs]', error);
  return res.status(status).json({
    success: false,
    message: error.message || 'Something went wrong',
    errors: error.extra?.errors
  });
}

function wrap(handler) {
  return async (req, res) => {
    const companyId = req.user?.companyId;
    if (!companyId) {
      return res.status(401).json({ success: false, message: 'Company context required' });
    }
    try {
      const payload = await handler(req, res, companyId);
      if (!res.headersSent) res.json({ success: true, data: payload });
      return undefined;
    } catch (error) {
      return fail(res, error);
    }
  };
}

function itemHref(slug, item) {
  if (item.resource) return `/manufacturing/${slug}/${item.resource}`;
  if (item.href) return item.href;
  if (item.report) return `/manufacturing/${slug}/report/${item.report}`;
  return null;
}

function itemAvailable(item) {
  if (item.available === false) return false;
  if ((item.kind === 'document' || item.kind === 'settings') && item.resource) {
    const def = registry[item.resource];
    return Boolean(def && def.available !== false && def.model);
  }
  if (item.kind === 'report' && item.report) return Boolean(reports.reports[item.report]);
  return true;
}

function decorateItem(slug, item) {
  const children = item.items ? item.items.map((child) => decorateItem(slug, child)) : undefined;
  return {
    ...item,
    available: itemAvailable(item),
    href: itemHref(slug, item),
    items: children
  };
}

function workspacesOf() {
  return {
    isManager: true,
    trackingLinks: [],
    workspaces: nav.workspaces.map((ws) => ({
      slug: ws.slug,
      label: ws.label,
      icon: ws.icon,
      items: ws.items.map((item) => decorateItem(ws.slug, item)),
      extraDocuments: []
    }))
  };
}

function documentsMeta(req) {
  const workspace = req.query.workspace ? String(req.query.workspace) : null;
  if (workspace && !WORKSPACES[workspace]) throw new docs.HttpError(404, `Unknown workspace: ${workspace}`);
  return {
    workspaces: nav.workspaces.map((ws) => ({ slug: ws.slug, label: ws.label })),
    descriptors: docs.descriptors(workspace)
  };
}

function optionsKey(target, linkQuery) {
  if (!linkQuery || !Object.keys(linkQuery).length) return String(target);
  const qs = Object.entries(linkQuery)
    .map(([k, v]) => `${k}=${v === true ? 'true' : v === false ? 'false' : String(v)}`)
    .join('&');
  return `${target}?${qs}`;
}

async function documentMeta(req) {
  const descriptor = docs.descriptorOf(req.params.resource);
  if (!descriptor) throw new docs.HttpError(404, `Unknown Manufacturing document: ${req.params.resource}`);
  const def = registry[req.params.resource];
  const loads = new Map();
  const add = (target, linkQuery) => {
    if (!target) return;
    const key = optionsKey(target, linkQuery);
    if (!loads.has(key)) loads.set(key, { target, query: linkQuery || {} });
  };
  const collect = (field) => {
    if (field.t === 'link') add(field.o, field.linkQuery);
    for (const row of field.rows || []) collect(row);
  };
  for (const field of def.fields || []) collect(field);

  const list = await Promise.all(
    [...loads.entries()].map(async ([key, { target, query }]) => ({
      key,
      options: await docs.options(target, req, query)
    }))
  );
  return { descriptor, options: Object.fromEntries(list.map((x) => [x.key, x.options])) };
}

async function dashboard(req, _res, companyId) {
  const ws = WORKSPACES[req.params.slug];
  if (!ws) throw new docs.HttpError(404, `Unknown workspace: ${req.params.slug}`);
  const resources = [];
  for (const item of ws.items) {
    if (item.resource) resources.push({ label: item.label, resource: item.resource });
    for (const child of item.items || []) {
      if (child.resource) resources.push({ label: child.label, resource: child.resource });
    }
  }
  const counts = await docs.counts(
    resources.map((r) => r.resource),
    req
  );

  // Simple number cards for Manufacturing home
  const cards = [
    { label: 'Open Work Orders', value: 0 },
    { label: 'Active BOMs', value: 0 },
    { label: 'Job Cards In Progress', value: 0 }
  ];
  try {
    const prisma = require('../prisma/client');
    cards[0].value = await prisma.manufacturingProductionOrder.count({
      where: { companyId, status: { in: ['Draft', 'Not Started', 'Planned', 'Released', 'In Process', 'In Progress', 'Paused'] } }
    });
    cards[1].value = await prisma.manufacturingBOM.count({ where: { companyId, status: 'Active' } });
    cards[2].value = await prisma.manufacturingWorkOrder.count({
      where: { companyId, status: { in: ['Work In Progress', 'InProgress', 'In Progress', 'Open', 'Pending'] } }
    });
  } catch (error) {
    console.error('[mfg-docs] dashboard cards', error.message);
  }

  return {
    workspace: { slug: ws.slug, label: ws.label, icon: ws.icon, dashboard: ws.dashboard || null },
    numberCards: cards,
    chart: null,
    shortcuts: resources
      .filter((r) => counts[r.resource] !== null)
      .map((r) => ({
        label: r.label,
        resource: r.resource,
        href: `/manufacturing/${ws.slug}/${r.resource}`,
        count: counts[r.resource]
      })),
    links: ws.items.map((item) => decorateItem(ws.slug, item)),
    trackingLinks: []
  };
}

function linkOptions(req) {
  return docs.options(req.params.target, req, req.query);
}

module.exports = {
  workspaces: wrap(workspacesOf),
  dashboard: wrap(dashboard),
  charts: wrap(async () => []),
  documents: wrap(documentsMeta),
  document: wrap(documentMeta),
  list: wrap((req) => docs.list(req.params.resource, req, req.query)),
  detail: wrap((req) => docs.get(req.params.resource, req.params.id, req)),
  create: wrap((req) => docs.create(req.params.resource, req, req.body)),
  update: wrap((req) => docs.update(req.params.resource, req.params.id, req, req.body)),
  remove: wrap((req) => docs.remove(req.params.resource, req.params.id, req)),
  action: wrap((req) => docs.runAction(req.params.resource, req.params.id, req.params.key, req, req.body)),
  button: wrap(async () => {
    throw new docs.HttpError(400, 'No buttons configured');
  }),
  timeline: wrap(async () => ({
    comments: [],
    activity: [],
    createdAt: null,
    updatedAt: null
  })),
  comment: wrap(async () => ({
    comments: [],
    activity: [],
    createdAt: null,
    updatedAt: null
  })),
  options: wrap(linkOptions)
};
