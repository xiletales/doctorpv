import "dotenv/config";
import bcrypt from "bcryptjs";
import Database from "better-sqlite3";

const file = (process.env.DATABASE_URL ?? "file:./data/doctorpv.db").replace(/^file:/, "");
const db = new Database(file);
db.pragma("journal_mode = WAL");

const now = Math.floor(Date.now() / 1000);
const hash = bcrypt.hashSync("demo1234", 10);
db.exec("DELETE FROM UserGang; DELETE FROM User; DELETE FROM Gang;");
const gang = db.prepare("INSERT INTO Gang (id,name,code,boundaryGeoJson,alleyGeoJson) VALUES (?,?,?,?,?)");
for (let i = 1; i <= 5; i++) gang.run(`G${i}`, `Gang ${i}`, `GANG-${i}`, "{}", "{}");
const user = db.prepare("INSERT INTO User (id,name,email,passwordHash,role,active,createdAt) VALUES (?,?,?,?,?,1,?)");
user.run("U-DLH", "Ratna Wibowo", "dlh@doctorpv.id", hash, "dlh", now);
user.run("U-RT", "Agus Santoso", "admin.rt@doctorpv.id", hash, "admin_rt", now);
user.run("U-G1", "Dewi Lestari", "gang1@doctorpv.id", hash, "koordinator", now);
user.run("U-T1", "Budi Hartono", "teknisi1@doctorpv.id", hash, "teknisi", now);
db.prepare("INSERT INTO UserGang (userId,gangId) VALUES (?,?)").run("U-G1", "G1");
console.log("Seeded users");
