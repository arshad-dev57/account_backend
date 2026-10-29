'use strict';

/**
 * ERPNext shows and requires fields conditionally: `depends_on` hides a field
 * and `mandatory_depends_on` makes it required, both driven by the values of
 * other fields on the same document.
 *
 * The registry expresses the same rules with `when` and `reqWhen`. They are
 * normalized here once, shipped inside the descriptor, and evaluated by the
 * browser and by the write path against the same clauses, so a field can never
 * be required in the API while hidden in the form (or the other way round).
 */

function truthy(value) {
  if (value === undefined || value === null || value === '' || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Accepted shapes:
 *   'fieldName'                  -> visible when fieldName is truthy
 *   '!fieldName'                 -> visible when fieldName is falsy
 *   ['a', 'b']                   -> all clauses must hold
 *   { field, equals }            -> strict string/boolean comparison
 *   { field, notEquals }
 *   { field, in: [...] }
 *   { any: [...] }               -> at least one of the nested clauses holds
 *   { action: 'key' }            -> dialog-only field, always shown at form level
 */
function normalizeCondition(raw) {
  if (raw === undefined || raw === null || raw === false) return null;
  const list = Array.isArray(raw) ? raw : [raw];
  const clauses = [];
  for (const clause of list) {
    if (typeof clause === 'string') {
      if (clause.startsWith('action:')) continue;
      const negated = clause.startsWith('!');
      clauses.push({ field: negated ? clause.slice(1) : clause, truthy: !negated });
    } else if (clause && typeof clause === 'object') {
      if (clause.action) continue;
      if (Array.isArray(clause.any)) {
        const nested = normalizeCondition(clause.any);
        if (nested) clauses.push({ any: nested });
        continue;
      }
      if (!clause.field) continue;
      clauses.push({
        field: clause.field,
        equals: clause.equals,
        notEquals: clause.notEquals,
        in: Array.isArray(clause.in) ? clause.in : undefined,
        truthy: clause.equals === undefined && clause.notEquals === undefined && clause.in === undefined
      });
    }
  }
  return clauses.length ? clauses : null;
}

function clauseHolds(clause, values) {
  if (clause.any) return clause.any.some((nested) => clauseHolds(nested, values));
  const value = values ? values[clause.field] : undefined;
  if (clause.in) return clause.in.some((option) => String(option) === String(value ?? ''));
  if (clause.equals !== undefined) {
    if (typeof clause.equals === 'boolean') return Boolean(value) === clause.equals;
    return String(value ?? '') === String(clause.equals);
  }
  if (clause.notEquals !== undefined) return String(value ?? '') !== String(clause.notEquals);
  return clause.truthy ? truthy(value) : !truthy(value);
}

/** A field with no condition is always visible. */
function isVisible(field, values) {
  const clauses = normalizeCondition(field && field.when);
  if (!clauses) return true;
  return clauses.every((clause) => clauseHolds(clause, values));
}

/**
 * ERPNext's `reqd` is unconditional; `mandatory_depends_on` only forces the
 * field once its condition holds.
 */
function isRequired(field, values) {
  if (!field) return false;
  if (field.r) return true;
  const clauses = normalizeCondition(field.reqWhen);
  if (!clauses) return false;
  return clauses.every((clause) => clauseHolds(clause, values));
}

/** Descriptor payload for one field, conditions included. */
function fieldDescriptor(field) {
  return {
    n: field.n,
    l: field.l,
    t: field.t,
    r: Boolean(field.r),
    when: normalizeCondition(field.when),
    reqWhen: normalizeCondition(field.reqWhen),
    ...(field.dependsOn ? { dependsOn: field.dependsOn } : {})
  };
}

module.exports = { normalizeCondition, isVisible, isRequired, truthy, fieldDescriptor };
