import next from "eslint-config-next/core-web-vitals";
import ts from "eslint-config-next/typescript";

const config = [
  { ignores: [".next/**", "src/generated/**", "next-env.d.ts", "public/**", "doctorpv-backup/**"] },
  ...next,
  ...ts,
];
export default config;
