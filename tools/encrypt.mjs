import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { pbkdf2Sync, randomBytes, createCipheriv, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PRIVATE = join(ROOT, "tools", "private");
const PASSWORDS = join(PRIVATE, "passwords.txt");
const CONTENT = join(PRIVATE, "content.html");
const OUTPUT = join(ROOT, "content.js");
const MEDIA = join(ROOT, "media");
const SITE = "https://www.19-08-2027.pl/";
const GROUPS = ["dworek", "nocleg"];
const ITERATIONS = 250000;

function normalizePassword(s) {
    return s
        .replace(/ł/g, "l")
        .replace(/Ł/g, "L")
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
}

function encryptRaw(key, data) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([iv, cipher.update(data), cipher.final(), cipher.getAuthTag()]);
}

function encrypt(key, data) {
    const raw = encryptRaw(key, data);
    return { iv: raw.subarray(0, 12).toString("base64"), data: raw.subarray(12).toString("base64") };
}

let salt = randomBytes(16).toString("hex");
if (existsSync(OUTPUT)) {
    const m = readFileSync(OUTPUT, "utf8").match(/salt:\s*"([0-9a-f]{32})"/);
    if (m) salt = m[1];
}

const contentKey = randomBytes(32);

mkdirSync(MEDIA, { recursive: true });
readdirSync(MEDIA).forEach((f) => rmSync(join(MEDIA, f)));
const html = readFileSync(CONTENT, "utf8").replace(/src="((?:maps|photos)\/[\w-]+\.jpg)"/g, (_, path) => {
    const name = createHash("sha256").update(path).digest("hex").slice(0, 16) + ".bin";
    writeFileSync(join(MEDIA, name), encryptRaw(contentKey, readFileSync(join(PRIVATE, path))));
    return `data-enc="media/${name}"`;
});
const keys = [];
const links = [];

readFileSync(PASSWORDS, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((line, i) => {
        const [group, password = ""] = line.split(":").map((s) => s.trim());
        if (!GROUPS.includes(group)) {
            console.error(`Linia ${i + 1}: nieznana grupa "${group}" (dozwolone: ${GROUPS.join(", ")})`);
            process.exit(1);
        }
        const norm = normalizePassword(password);
        if (norm.length < 6) {
            console.error(`Linia ${i + 1}: hasło musi mieć co najmniej 6 liter/cyfr`);
            process.exit(1);
        }
        const passwordKey = pbkdf2Sync(norm, salt, ITERATIONS, 32, "sha256");
        keys.push({ group, ...encrypt(passwordKey, contentKey) });
        links.push(`  ${group.padEnd(7)} ${SITE}#k=${encodeURIComponent(password)}`);
    });

const missing = GROUPS.filter((g) => !keys.some((k) => k.group === g));
if (missing.length) {
    console.error(`Brak hasła dla grup: ${missing.join(", ")}`);
    process.exit(1);
}

const content = encrypt(contentKey, Buffer.from(html, "utf8"));
const out =
    "window.ACCESS = {\n" +
    `    salt: "${salt}",\n` +
    `    iterations: ${ITERATIONS},\n` +
    "    keys: [\n" +
    keys.map((k) => `        { group: "${k.group}", iv: "${k.iv}", data: "${k.data}" },\n`).join("") +
    "    ],\n" +
    `    iv: "${content.iv}",\n` +
    `    data: "${content.data}",\n` +
    "};\n";

writeFileSync(OUTPUT, out);
console.log(
    `Zapisano content.js (${Math.round(out.length / 1024)} KB).\n\nLinki do kodów QR (logują automatycznie):\n` + links.join("\n")
);
