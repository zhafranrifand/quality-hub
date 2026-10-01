import { hashPassword } from "../server/auth.js";
const password = process.argv[2] || process.env.OWNER_PASSWORD;
if (!password || password.length < 12) {
  console.error(
    'Use: npm run password -- "a-password-of-at-least-12-characters"',
  );
  process.exitCode = 1;
} else console.log(hashPassword(password));
