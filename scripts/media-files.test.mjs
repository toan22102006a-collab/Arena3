import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("MEDIA_FILES matches public/media", () => {
  const source = fs.readFileSync("src/lib/arena3/media-files.ts", "utf8");
  const listed = [...source.matchAll(/^\s*"([^"]+)",$/gm)].map((m) => m[1]).sort();
  const onDisk = fs
    .readdirSync("public/media", { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith("."))
    .map((d) => d.name)
    .sort();
  assert.deepEqual(listed, onDisk);
});
