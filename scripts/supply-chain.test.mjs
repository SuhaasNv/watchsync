// CI and image hardening (BUG-043): what runs in CI and ships in images can't change under us.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";

const root = new URL("../", import.meta.url);
const read = (file) => readFileSync(new URL(file, root), "utf8");
const workflows = readdirSync(new URL(".github/workflows/", root)).filter((f) =>
  f.endsWith(".yml"),
);

test("every action is pinned to a full commit SHA with its version noted", () => {
  for (const file of workflows) {
    for (const [, ref] of read(`.github/workflows/${file}`).matchAll(/uses:\s*(\S+.*)$/gm)) {
      if (ref.startsWith("./")) continue; // a workflow in this repository
      assert.match(ref, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+/, `${file}: ${ref}`);
    }
  }
});

test("CI's token is read-only unless a job asks for more", () => {
  assert.match(read(".github/workflows/ci.yml"), /^permissions:\n {2}contents: read$/m);
});

test("Docker base images are pinned by digest", () => {
  for (const file of ["Dockerfile.signaling", "Dockerfile.website"]) {
    const images = [...read(file).matchAll(/^(?:FROM |COPY --from=)(\S+)/gm)]
      .map((m) => m[1])
      .filter((ref) => /[:/]/.test(ref)); // not a build stage of the same file
    assert.ok(images.length > 0, file);
    for (const image of images) assert.match(image, /@sha256:[0-9a-f]{64}$/, `${file}: ${image}`);
  }
});
