import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const frontendDir = path.resolve(currentDir, "..");
const source = path.join(frontendDir, "config.json");
const publicDir = path.join(frontendDir, "public");
const target = path.join(publicDir, "config.json");

fs.mkdirSync(publicDir, { recursive: true });
fs.copyFileSync(source, target);
console.log("Synced config.json to public/config.json");
