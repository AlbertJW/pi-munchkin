// The screenshot tool, with a fake `screencapture` that writes a fixture PNG and
// records its arguments. No screen, no model.
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { deflateSync } from "node:zlib";
import { registerScreenshotTool } from "../extensions/visual-observe.ts";
import { makeFakePi } from "./integration-harness.ts";

function png(width: number, height: number): Buffer {
	const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
	const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
	const chunk = (kind: string, data: Buffer) => { const body = Buffer.concat([Buffer.from(kind), data]); const out = Buffer.alloc(body.length + 8); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 4 + body.length); return out; };
	const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
	const rows = Buffer.alloc((width * 3 + 1) * height, 0x80); for (let y = 0; y < height; y++) rows[y * (width * 3 + 1)] = 0;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

function fakeCapture(image: Buffer | null) {
	const dir = mkdtempSync(join(tmpdir(), "fake-screencapture-"));
	const fixture = join(dir, "fixture.png"); const argsLog = join(dir, "args");
	if (image) writeFileSync(fixture, image);
	const command = join(dir, "screencapture");
	writeFileSync(command, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsLog}'\n${image ? `for a; do last="$a"; done; cp '${fixture}' "$last"` : "exit 1"}\n`);
	chmodSync(command, 0o755);
	return { command, args: () => existsSync(argsLog) ? readFileSync(argsLog, "utf8").trim().split("\n") : null };
}

const vision = { provider: "p", id: "vlm", input: ["text", "image"] };
async function shoot(command: string, params: Record<string, unknown>, model: unknown = vision) {
	const fp = makeFakePi();
	registerScreenshotTool(fp.pi as never, { command });
	return fp.tools.get("screenshot").execute("s1", params, undefined, undefined, { cwd: tmpdir(), model });
}

test("a full-display screenshot is downscaled and says how to map coordinates back", async () => {
	const fake = fakeCapture(png(3200, 2000));
	const result = await shoot(fake.command, {});
	assert.deepEqual(fake.args()!.slice(0, 3), ["-x", "-t", "png"], "silent PNG capture of the main display");
	assert.equal(fake.args()!.length, 4);
	const [text, image] = result.content;
	assert.equal(image.type, "image");
	assert.equal(result.details.width, 1568);
	assert.equal(result.details.original_width, 3200);
	assert.match(text.text, /Screenshot 1568x980 \(captured 3200x2000 device pixels/);
	assert.match(text.text, /Multiply coordinates by 2\.04/);
});

test("display and region select what is captured; a model's own image limits win", async () => {
	const fake = fakeCapture(png(400, 200));
	await shoot(fake.command, { display: 2 });
	assert.ok(fake.args()!.includes("-D2"));
	const small = await shoot(fake.command, { region: { x: 10, y: 20, width: 200, height: 100 } }, { ...vision, inputLimits: { images: { resize: { maxWidth: 100, maxHeight: 100 } } } });
	assert.ok(fake.args()!.includes("-R10,20,200,100"));
	assert.equal(small.details.width, 100);
});

test("a text-only model is told why, and nothing is captured", async () => {
	const fake = fakeCapture(png(10, 10));
	const result = await shoot(fake.command, {}, { provider: "p", id: "coder", input: ["text"] });
	assert.equal(result.details.reason, "vision-unavailable");
	assert.match(result.content[0].text, /did not advertise image input/);
	assert.equal(fake.args(), null);
});

test("a failed capture is an error, not an empty image", async () => {
	await assert.rejects(shoot(fakeCapture(null).command, {}), /Grant Screen Recording to the terminal app running Pi/);
});
