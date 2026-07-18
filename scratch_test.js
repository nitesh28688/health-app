require("dotenv").config({ path: ".env.local" });
const { searchGrounded } = require("./web/lib/gemini.ts");
// need to use ts-node or just rewrite the minimal fetch
