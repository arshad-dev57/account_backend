#!/usr/bin/env python3
"""Collect ERPNext DocType payloads that were transferred out of the browser via
accessibility snapshots (base64 chunks), verify integrity, and write one
reference JSON file per DocType.

usage: python3 _collect.py <tag> <snapshot-file> [<snapshot-file> ...]
  tag = hr | payroll | child
"""
import base64
import json
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = os.path.join(HERE, "_state.json")
SOURCE = "https://hrms-rje-xre.nvi.frappe.cloud"
FETCHED_VIA = "GET /api/method/frappe.client.get?doctype=DocType&name=<DocType>"
FETCHED_AT = "2026-10-27"
B64_RE = re.compile(r"C(\d{3})~([A-Za-z0-9+/=]+)")
HDR_RE = re.compile(r"QREF-BEGIN \S+ LEN=(\d+) CK=(-?\d+) NCH=(\d+)")


def js_hash(s):
    """Replicates: h = ((h << 5) - h + code) | 0  (32-bit signed)."""
    h = 0
    for ch in s:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
        if h >= 2 ** 31:
            h -= 2 ** 32
    return h


def snake(name):
    # spec examples: hr--leave-application.json, payroll--salary-slip.json
    return re.sub(r"[^A-Za-z0-9]+", "-", name).strip("-").lower() or "unnamed"


def load_snapshot(path):
    with open(path, encoding="utf-8") as fh:
        text = fh.read()
    hdr = HDR_RE.search(text)
    if not hdr:
        raise SystemExit("ERROR %s: no QREF header found" % path)
    length, ck, nch = int(hdr.group(1)), int(hdr.group(2)), int(hdr.group(3))
    found = {}
    for idx, data in B64_RE.findall(text):
        found.setdefault(int(idx), data)
    if len(found) != nch or sorted(found) != list(range(nch)):
        raise SystemExit("ERROR %s: chunk count mismatch (got %d, want %d)" % (path, len(found), nch))
    b64 = "".join(found[i] for i in range(nch))
    if len(b64) != length:
        raise SystemExit("ERROR %s: length mismatch (got %d, want %d)" % (path, len(b64), length))
    if js_hash(b64) != ck:
        raise SystemExit("ERROR %s: checksum mismatch" % path)
    return json.loads(base64.b64decode(b64).decode("utf-8"))


def main():
    tag = sys.argv[1]
    files = sys.argv[2:]
    state = {"failures": [], "children": {}, "written": {}, "integrity": []}
    if os.path.exists(STATE):
        with open(STATE, encoding="utf-8") as fh:
            state = json.load(fh)

    payloads = {}
    for f in files:
        payloads.update(load_snapshot(os.path.join(HERE, f) if not os.path.isabs(f) else f))
        state["integrity"].append({"snapshot": f, "ok": True})

    written, failures, mismatches = [], [], []
    for name, doc in payloads.items():
        if not isinstance(doc, dict) or doc.get("__error"):
            failures.append({"tag": tag, "doctype": name, "error": (doc or {}).get("__error", "empty")})
            continue
        doc = dict(doc)
        doc["source"] = SOURCE
        doc["fetchedVia"] = FETCHED_VIA
        doc["fetchedAt"] = FETCHED_AT
        ordered = {}
        for k in ("source", "fetchedVia", "fetchedAt", "doctype", "module", "istable",
                  "is_submittable", "autoname", "naming_series", "naming_rule",
                  "naming_series_options",
                  "title_field", "subject_field", "timeline_field", "is_tree", "track_changes",
                  "states", "workflow", "document_type", "description", "documentation",
                  "search_fields", "allow_import", "sections", "links", "tables", "fields"):
            if k in doc:
                ordered[k] = doc.pop(k)
        ordered.update({k: v for k, v in doc.items() if k not in ("is_tree",)})
        if "istable" not in ordered:
            ordered["istable"] = 0
        prefix = "--child--" if tag == "child" else tag + "--"
        fname = prefix + snake(name) + ".json"
        with open(os.path.join(HERE, fname), "w", encoding="utf-8") as fh:
            fh.write(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n")
        rec = {"file": fname, "doctype": name, "module": ordered.get("module"),
               "istable": ordered.get("istable"), "fields": len(ordered.get("fields", [])),
               "sections": len(ordered.get("sections", [])),
               "bytes": os.path.getsize(os.path.join(HERE, fname))}
        written.append(rec)
        if tag != "child" and (ordered.get("module") or "").lower() != tag:
            mismatches.append({"doctype": name, "module": ordered.get("module")})
        for t in ordered.get("tables", []):
            child = t.get("child_doctype")
            if child:
                state["children"].setdefault(child, []).append(name)

    state["failures"].extend(failures)
    state["written"].setdefault(tag, {})
    for w in written:
        state["written"][tag][w["file"]] = w
    with open(STATE, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, sort_keys=True)

    print(json.dumps({
        "tag": tag,
        "writtenThisRun": len(written),
        "failedThisRun": failures,
        "moduleMismatches": mismatches,
        "totals": {k: len(v) for k, v in state["written"].items()},
        "distinctChildrenReferenced": len(state["children"]),
        "sizesBytes": sum(w["bytes"] for w in written),
    }))


if __name__ == "__main__":
    main()
