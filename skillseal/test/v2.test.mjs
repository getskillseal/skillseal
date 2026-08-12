// v2 pointer token: end to end, no external network.
//
// Stands up a content store over http that serves blobs by their address (the
// same layout any S3 bucket or gateway uses), then exercises the whole path:
// build a signed manifest, shrink it to a pointer, decode it, resolve it,
// verify it, install it, and prove that tampering anywhere is refused. Also
// checks the old v1 token still installs.

import assert from "node:assert";
import http from "node:http";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createHash } from "node:crypto";
import { createPointer, readToken, createToken } from "../token.mjs";
import { buildManifest, verifyManifest, publisherHint } from "../manifest.mjs";
import { install } from "../install.mjs";

const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const pass = [];
const ok = (n) => pass.push(`  ✓ ${n}`);

function startStore() {
  const blobs = new Map(); // hex -> Buffer
  const server = http.createServer((req, res) => {
    const b = blobs.get(req.url.split("/").pop());
    if (!b) { res.statusCode = 404; return res.end("no"); }
    res.end(b);
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => {
    resolve({
      base: `http://127.0.0.1:${server.address().port}`,
      put: (addr, bytes) => blobs.set(addr.replace(/^sha256:/, ""), Buffer.from(bytes)),
      set: (addr, bytes) => blobs.set(addr.replace(/^sha256:/, ""), Buffer.from(bytes)),
      close: () => server.close(),
    });
  }));
}

async function main() {
  // A two-file skill.
  const skillDir = mkdtempSync(join(tmpdir(), "sk-skill-"));
  mkdirSync(join(skillDir, "scripts"), { recursive: true });
  writeFileSync(join(skillDir, "SKILL.md"), "---\nname: csv-stats\n---\n# CSV stats\nSummarize a CSV.\n");
  writeFileSync(join(skillDir, "scripts", "run.py"), "print('hi')\n");
  const files = [
    { path: "SKILL.md", bytes: readFileSync(join(skillDir, "SKILL.md")) },
    { path: "scripts/run.py", bytes: readFileSync(join(skillDir, "scripts", "run.py")) },
  ].map((f) => ({ ...f, address: "sha256:" + sha256hex(f.bytes), size: f.bytes.length }));

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicHex = publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");

  // Build a signed manifest and shrink it to a pointer.
  const { manifestBytes, address } = buildManifest({ name: "csv-stats", publisherKey: publicHex, privateKey, files });
  const token = createPointer({ manifestAddress: address, hint: publisherHint(publicHex) });

  assert.ok(token.length <= 72, `pointer is ${token.length} chars`);
  ok(`v2 pointer is short: ${token.length} chars (vs ~380 for v1)`);

  const decoded = readToken(token);
  assert.equal(decoded.version, 2);
  assert.equal(decoded.manifestAddress, address);
  assert.equal(decoded.publisherHint, publisherHint(publicHex));
  ok("pointer decodes to the manifest address and publisher hint");

  const v = verifyManifest(manifestBytes, address);
  assert.equal(v.name, "csv-stats");
  assert.equal(v.publisherKey, publicHex);
  assert.equal(v.files.length, 2);
  ok("manifest verifies against its address and its signature");

  const tampered = Buffer.from(manifestBytes); tampered[tampered.length - 4] ^= 0xff;
  assert.throws(() => verifyManifest(tampered, address), /does not match the address/);
  ok("a tampered manifest is refused (address mismatch)");

  // Re-sign a manifest that claims the same name with a different key: its
  // address changes, so the pasted pointer never resolves to it.
  const other = generateKeyPairSync("ed25519");
  const otherHex = other.publicKey.export({ type: "spki", format: "der" }).subarray(-32).toString("hex");
  const forged = buildManifest({ name: "csv-stats", publisherKey: otherHex, privateKey: other.privateKey, files });
  assert.notEqual(forged.address, address);
  ok("a re-signed manifest gets a different address (no silent swap)");

  // Serve it and install it.
  const store = await startStore();
  store.put(address, manifestBytes);
  for (const f of files) store.put(f.address, f.bytes);

  const outDir = mkdtempSync(join(tmpdir(), "sk-out-"));
  const res = await install(token, { to: outDir, locations: [store.base] });
  assert.ok(existsSync(join(outDir, "csv-stats", "SKILL.md")));
  assert.ok(existsSync(join(outDir, "csv-stats", "scripts", "run.py")));
  assert.ok(res.steps.some((s) => /manifest matches the address/.test(s)));
  assert.ok(res.steps.some((s) => /signed by/.test(s)));
  assert.ok(res.steps.some((s) => /files match their entries/.test(s)));
  ok("v2 pointer resolves, verifies, and installs a real folder");

  // Corrupt one file in the store; the read must be refused.
  const evil = Buffer.from(files[1].bytes); evil[0] ^= 0xff;
  store.set(files[1].address, evil);
  const outDir2 = mkdtempSync(join(tmpdir(), "sk-out2-"));
  await assert.rejects(install(token, { to: outDir2, locations: [store.base] }), /altered file|missing file/);
  ok("a corrupted file in the store is rejected on read");

  // v1 backward compatibility: an inline token still installs.
  const inline = Buffer.from("---\nname: hello\n---\n# Hello\n");
  const v1 = createToken({ fingerprint: "sha256:" + sha256hex(inline), publisherKey: publicHex, signature: null, name: "hello", inline });
  const outDir3 = mkdtempSync(join(tmpdir(), "sk-out3-"));
  await install(v1, { to: outDir3 });
  assert.ok(existsSync(join(outDir3, "hello", "SKILL.md")));
  ok("v1 inline token still installs (backward compatible)");

  store.close();
  for (const d of [skillDir, outDir, outDir2, outDir3]) rmSync(d, { recursive: true, force: true });

  console.log("\nskillseal v2 pointer\n" + pass.join("\n") + `\n\n  ${pass.length} checks passed\n`);
}

main().catch((e) => { console.error("\n  ✗", e.message, "\n"); process.exit(1); });
