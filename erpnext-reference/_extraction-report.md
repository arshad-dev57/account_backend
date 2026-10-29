# ERPNext HRMS DocType extraction report

Source instance: `https://hrms-rje-xre.nvi.frappe.cloud` (authenticated browser session, read-only)
Fetched: 2026-10-27 via `GET /api/method/frappe.client.get?doctype=DocType&name=<DocType>` only.

## failures

```json
[]
```

No DocType fetch failed: every request returned HTTP 200 with a JSON `message` containing a
`fields` array. No 401/403, no login-page HTML, no unexpected payload shapes.

## Coverage

| Group | Enumerated | Extracted | Files |
| --- | --- | --- | --- |
| Module HR | 117 | 117 | `hr--<name>.json` (117) |
| Module Payroll | 43 | 43 | `payroll--<name>.json` (43) |
| Child tables referenced by the above | 52 distinct | 52 | `--child--<name>.json` (52) |
| Setup masters (Employee, Department, Designation, Branch, Employee Group, Holiday List) | - | pre-existing | `employee.json`, `setup-masters.json` (skipped per instructions) |

- 160 module DocTypes + 52 child-table files = 212 JSON files, 1783 fields captured in total.
- Completeness proof: re-enumerating module HR and Payroll after extraction returns the same
  name sets (rolling-hash checksum of the sorted name lists matched the extracted set exactly),
  so nothing was skipped or renamed mid-run.
- 51 of the 52 children already appear inside the HR/Payroll module lists and were fetched live;
  their `--child--*.json` files carry the identical live payload. The single child living in
  another module is `Assignment Rule Day` (module Automation), fetched separately.
- 130 distinct Link/Dynamic Link targets, 74 Table field references. 54 of the 160 module
  DocTypes are themselves child tables (`istable: 1`), and all 52 `--child--*` files have
  `istable: 1`, so every table referenced by an HR or Payroll document is documented.

## Per-file contents

Top level: `doctype`, `module`, `istable`, `is_submittable`, `title_field`, `autoname`,
`naming_series`, `naming_rule`, `naming_series_options`, `is_tree`, `track_changes`,
`states` (workflow-ish DocType State rows: `idx`/`title`/`color`), `workflow`, `document_type`,
`description`/`documentation`, `timeline_field`, `search_fields`, `allow_import`, plus
`sections`, `links`, `tables`, `fields` in ERPNext order.
`fields` holds every non-layout field (Section Break, Tab Break, Column Break, HTML, Button,
Fold excluded) with `fieldname`, `label`, `fieldtype`, `reqd`, `default`, `options`, `read_only`,
`hidden`, `depends_on`, `mandatory_depends_on`, `in_list_view`, `in_standard_filter`, `length`,
`precision`, `fetch_from`, `link_filters`, `unique`, `bold`, `description`, `search_index`,
`allow_on_submit`, `translatable`, and `section`.
`sections` lists Section Break / Tab Break entries in order as `{label, fieldname, type}`;
each field's `section` is the label of the most recent break before it (`null` for fields that
ERPNext places before the first break). Null/empty/zero values were dropped, except `default`
and the structural flags `istable` / `is_submittable` / `is_tree` / `track_changes`, which are
always kept as 0/1.

## Transfer integrity

Payloads were compacted in-page, base64-chunked and written out through the browser's
accessibility-snapshot file writer (`_collect.py` reassembles them and aborts unless chunk count,
total length and a 32-bit rolling checksum match the header, then validates JSON). All 10
snapshot batches passed integrity checks; nothing was hand-transcribed.

`_collect.py` and `_state.json` are the extractor/manifest used by this run and are kept as
provenance.

## Safety

All requests were HTTP GET reads of DocType metadata (`frappe.client.get`,
`frappe.client.get_list`). No POST/PUT/DELETE was issued, no document was created, edited,
submitted or deleted, so no ERPNext data was modified.
