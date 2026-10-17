#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function decode(s) {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, "\n")
    .replace(/&amp;/g, "&");
}

function styleMap(style) {
  const m = {};
  for (const part of (style || "").split(";")) {
    if (!part) continue;
    const i = part.indexOf("=");
    if (i < 0) m[part] = "1";
    else m[part.slice(0, i)] = part.slice(i + 1);
  }
  return m;
}

function parse(xml) {
  const cells = [];
  const re = /<mxCell\b([^>]*?)(?:\/>|>([\s\S]*?)<\/mxCell>)/g;
  for (const match of xml.matchAll(re)) {
    const attr = match[1];
    const inner = match[2] || "";
    const take = (name) => {
      const found = attr.match(new RegExp(`\\b${name}="([^"]*)"`));
      return found ? decode(found[1]) : "";
    };
    const hasGeometry = /<mxGeometry\b/.test(inner);
    const geo = inner.match(/<mxGeometry\b([^>]*)\/?>/) || inner.match(/<mxGeometry\b([^>]*)>/);
    const g = geo ? geo[1] : "";
    const num = (name, fallback) => {
      const found = g.match(new RegExp(`\\b${name}="([^"]+)"`));
      return found ? Number(found[1]) : fallback;
    };
    const style = take("style");
    cells.push({
      id: take("id"),
      value: take("value"),
      style,
      sm: styleMap(style),
      vertex: /\bvertex="1"/.test(attr),
      edge: /\bedge="1"/.test(attr),
      parent: take("parent") || (take("id") === "0" ? null : "1"),
      source: take("source"),
      target: take("target"),
      x: num("x", 0),
      y: num("y", 0),
      w: num("width", 0),
      h: num("height", 0),
      hasGeometry,
      relative: /\brelative="1"/.test(g),
    });
  }
  return cells;
}

function intersects(a, b) {
  return a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;
}

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

function partialOverlap(a, b) {
  return intersects(a, b) && !contains(a, b) && !contains(b, a);
}

export function validateDrawio(filePath, content) {
  const errors = [];
  // 5. No XML comment
  if (content.includes("<!--")) {
    errors.push("Contains XML comment (<!--)");
  }
  // 6. No mermaid string
  if (/mermaid/i.test(content)) {
    errors.push("Contains 'mermaid' string");
  }

  const cells = parse(content);
  const ids = cells.map((c) => c.id);

  // 1. Unique IDs
  const seenIds = new Set();
  const dupes = [];
  for (const id of ids) {
    if (seenIds.has(id)) dupes.push(id);
    seenIds.add(id);
  }
  if (dupes.length > 0) {
    errors.push(`Duplicate cell IDs: ${dupes.join(", ")}`);
  }

  const map = new Map(cells.map((c) => [c.id, c]));

  // Root cells check
  if (!map.has("0") || !map.has("1")) {
    errors.push("Missing root cells 0 or 1");
  }

  for (const c of cells) {
    if (c.id === "0" || c.id === "1") continue;

    // 4. vertex="1" or edge="1" on every cell except 0, 1
    if (!c.vertex && !c.edge) {
      errors.push(`Cell ${c.id} has neither vertex="1" nor edge="1"`);
    }

    // 3. mxGeometry present on every cell except 0, 1
    if (!c.hasGeometry) {
      errors.push(`Cell ${c.id} is missing <mxGeometry>`);
    }

    // 2. source and target point to existing IDs
    if (c.edge) {
      if (c.source && !map.has(c.source)) {
        errors.push(`Edge ${c.id} source '${c.source}' does not exist`);
      }
      if (c.target && !map.has(c.target)) {
        errors.push(`Edge ${c.id} target '${c.target}' does not exist`);
      }
    }
  }

  // 7. No overlapping sibling vertices (excluding container/swimlane/lifeline/frame)
  const isContainer = (c) => {
    return (
      c.sm.shape === "swimlane" ||
      c.sm.swimlane === "1" ||
      c.sm.fillColor === "none" ||
      c.sm.opacity === "0" ||
      c.sm.shape === "umlLifeline" ||
      c.sm.shape === "umlFrame" ||
      c.style.includes("shape=umlLifeline") ||
      c.style.includes("shape=umlFrame") ||
      c.style.includes("text;") ||
      c.id === "boundary" ||
      c.id === "sys" ||
      c.style.includes("swimlane") ||
      c.style.includes("role=container") ||
      c.style.includes("role=part")
    );
  };

  const vertices = cells.filter((c) => c.vertex && c.w > 2 && c.h > 2 && !isContainer(c));
  // Group by parent
  const byParent = new Map();
  for (const v of vertices) {
    const p = v.parent || "1";
    if (!byParent.has(p)) byParent.set(p, []);
    byParent.get(p).push(v);
  }

  for (const [parent, siblings] of byParent.entries()) {
    for (let i = 0; i < siblings.length; i++) {
      for (let j = i + 1; j < siblings.length; j++) {
        const a = siblings[i];
        const b = siblings[j];
        if (partialOverlap(a, b)) {
          errors.push(`Overlapping siblings under parent '${parent}': ${a.id} and ${b.id}`);
        }
      }
    }
  }

  return errors;
}

function findDrawioFiles(dir) {
  const res = [];
  try {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        res.push(...findDrawioFiles(full));
      } else if (entry.endsWith(".drawio")) {
        res.push(full);
      }
    }
  } catch {}
  return res;
}

function main() {
  const dirs = ["docs/diagrams"];
  let allFiles = [];
  for (const d of dirs) {
    allFiles.push(...findDrawioFiles(d));
  }
  // Deduplicate
  allFiles = [...new Set(allFiles)];

  let totalFails = 0;
  console.log(`Checking ${allFiles.length} .drawio files...`);
  for (const file of allFiles) {
    const content = readFileSync(file, "utf8");
    const errors = validateDrawio(file, content);
    if (errors.length > 0) {
      console.log(`FAIL: ${file}`);
      for (const err of errors) {
        console.log(`  - ${err}`);
      }
      totalFails++;
    } else {
      console.log(`PASS: ${file}`);
    }
  }

  console.log(`\nResult: ${allFiles.length - totalFails}/${allFiles.length} passed.`);
  if (totalFails > 0) {
    process.exit(1);
  }
}

if (process.argv[1].endsWith("check-drawio.mjs")) {
  main();
}
