'use strict';

/**
 * Static integrity checks for the ERPNext-shaped HR layer. These catch the two
 * failure modes that a metadata-driven CRUD engine can hide: a registry field
 * that points at a column the model does not have, and a status transition that
 * leads somewhere the document cannot be edited from.
 *
 * Run: node tests/hrms-documents.test.js
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const { registry, MANAGER_ONLY, LEGACY_STATUS_ALIASES } = require('../services/hrDocumentRegistry');
const hooks = require('../services/hrDocumentWorkflow');
const nav = require('../services/hrWorkspaceNav');
const numberCards = require('../services/hrNumberCards');
const { getFlatPermissionList } = require('../config/permissionCatalog');

const SCALARS = new Set(['String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Decimal', 'BigInt']);
const COMPUTED_PREFIX = 'computed';

function schemaIndex() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const models = {};
  for (const match of src.matchAll(/^model ([A-Za-z]+) \{([\s\S]*?)^\}/gm)) {
    const [, model, body] = match;
    const columns = new Set();
    const relations = new Set();
    for (const line of body.split('\n')) {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 2 || parts[0].startsWith('@') || parts[0].startsWith('//')) continue;
      const type = String(parts[1]).replace(/[?[\]]/g, '');
      if (SCALARS.has(type)) columns.add(parts[0]);
      else relations.add(parts[0]);
    }
    models[model] = { columns, relations };
  }
  return models;
}

function pascal(model) {
  return model[0].toUpperCase() + model.slice(1);
}

const MODELS = schemaIndex();
const PERMISSIONS = new Set(getFlatPermissionList().map((p) => p.name));
const HOOK_NAMES = new Set(Object.keys(hooks).filter((k) => k !== 'helpers'));

const tests = [];
function test(name, fn) {
  tests.push([name, fn]);
}

test('every registry model exists with a table', () => {
  for (const [resource, def] of Object.entries(registry)) {
    const model = pascal(def.model);
    assert.ok(MODELS[model], `${resource}: prisma model ${model} is missing`);
  }
});

test('every registry field maps to a real column', () => {
  for (const [resource, def] of Object.entries(registry)) {
    const model = pascal(def.model);
    const { columns, relations } = MODELS[model];
    for (const field of def.fields) {
      if (String(field.t).startsWith(COMPUTED_PREFIX)) continue;
      const known = columns.has(field.n) || relations.has(field.n);
      assert.ok(known, `${resource}.${field.n} is not a column of ${model}`);
    }
  }
});

test('submitted documents own their status column', () => {
  for (const [resource, def] of Object.entries(registry)) {
    if (!def.statuses) continue;
    assert.ok(
      MODELS[pascal(def.model)].columns.has('status'),
      `${resource} declares statuses but ${def.model} has no status column`
    );
    for (const action of def.actions || []) {
      for (const from of action.from) {
        assert.ok(def.statuses.includes(from), `${resource}: action ${action.key} starts from unknown status ${from}`);
      }
      assert.ok(def.statuses.includes(action.to), `${resource}: action ${action.key} targets unknown status ${action.to}`);
    }
  }
});

test('legacy status aliases only map onto declared statuses', () => {
  for (const [resource, aliases] of Object.entries(LEGACY_STATUS_ALIASES)) {
    const def = registry[resource];
    assert.ok(def, `alias target ${resource} is not a registered document`);
    for (const [legacy, mapped] of Object.entries(aliases)) {
      assert.ok(def.statuses ? def.statuses.includes(mapped) : true, `${resource}: ${legacy} → ${mapped} is not declared`);
      void legacy;
    }
  }
});

test('workflow hooks referenced by the registry all exist', () => {
  const KEYS = [
    'beforeWrite',
    'validate',
    'onCreated',
    'onUpdated',
    'onDeleting',
    'onSubmitted',
    'onCancelled',
    'onApproved',
    'onRejected',
    'onPaid',
    'onStarted',
    'onCompleted',
    'onAccepted'
  ];
  for (const [resource, def] of Object.entries(registry)) {
    for (const key of KEYS) {
      const hook = def[key];
      if (typeof hook !== 'string') continue;
      assert.ok(HOOK_NAMES.has(hook), `${resource}.${key} → ${hook} is not implemented`);
    }
  }
});

test('link fields point at a known document or master', () => {
  const masters = [
    'department',
    'designation',
    'office',
    'holiday',
    'employee',
    'user',
    'costCenter',
    'company',
    'account',
    'currency'
  ];
  const walk = (resource, field) => {
    if (field.t === 'link') {
      assert.ok(registry[field.o] || masters.includes(field.o), `${resource}.${field.n} links to unknown ${field.o}`);
    }
    for (const row of field.rows || []) walk(resource, row);
  };
  for (const [resource, def] of Object.entries(registry)) {
    for (const field of def.fields) walk(resource, field);
  }
});

test('workspace navigation only references registered documents', () => {
  const walk = (item) => {
    // greyed-out ERPNext items name a doctype we do not serve yet
    if (item.available !== false && item.resource) {
      assert.ok(registry[item.resource], `sidebar links to unregistered ${item.resource}`);
    }
    if (item.available === false) assert.ok(!registry[item.resource], `${item.label} is marked unavailable but is registered`);
    for (const child of item.items || []) walk(child);
  };
  assert.strictEqual(nav.workspaces.length, 9, 'ERPNext HRMS ships nine workspaces');
  for (const ws of nav.workspaces) {
    assert.ok(ws.slug && ws.label, 'workspace needs a slug and a label');
    assert.strictEqual(ws.items[0].kind, 'home', `${ws.slug} sidebar must start with Home like ERPNext`);
    for (const item of ws.items) walk(item);
  }
});

test('every registry document is reachable from a workspace', () => {
  const reachable = new Set(nav.resources());
  const orphans = Object.keys(registry).filter((r) => !reachable.has(r));
  assert.deepStrictEqual(orphans, [], 'documents with no sidebar entry are unreachable in the UI');
});

test('number cards query models that exist', () => {
  for (const slug of numberCards.workspaces) {
    const cards = numberCards.cardsFor(slug);
    assert.ok(cards.length, `${slug} has no number cards`);
    for (const card of cards) assert.ok(['count', 'sum'].includes(card.fn), `${slug}/${card.label} has an unknown function`);
  }
  assert.deepStrictEqual(
    numberCards.workspaces.sort(),
    nav.workspaces.map((w) => w.slug).sort(),
    'each workspace Home needs its own number cards'
  );
});

test('manager-only documents are also permission-gated', () => {
  const service = require('../services/hrDocumentService');
  for (const resource of MANAGER_ONLY) {
    assert.ok(registry[resource], `${resource} is flagged manager-only but is not registered`);
    assert.ok(
      service.PERMISSION_KEYS[resource],
      `${resource} has no permission key, so a granular grant can never open it`
    );
  }
  for (const key of Object.values(service.PERMISSION_KEYS)) {
    for (const action of ['view', 'create', 'edit', 'delete']) {
      assert.ok(PERMISSIONS.has(`${key}.${action}`), `permission ${key}.${action} is not in the catalog`);
    }
  }
});

test('descriptors expose the fields the backend validates', () => {
  const service = require('../services/hrDocumentService');
  for (const descriptor of service.descriptors()) {
    const def = registry[descriptor.resource];
    assert.strictEqual(descriptor.doctype, def.doctype);
    assert.strictEqual(descriptor.fields.length, def.fields.length, `${descriptor.resource} field count drifted`);
    for (const field of descriptor.fields) {
      assert.ok(field.n && field.l && field.t, `${descriptor.resource}: malformed field descriptor`);
    }
  }
});

let failed = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ✗ ${name}\n    ${error.message}`);
  }
}

console.log(`\n${tests.length - failed}/${tests.length} HRMS document checks passed`);
if (failed) process.exit(1);
