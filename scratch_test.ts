import * as dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { generateChatWithTools } from "./web/lib/gemini";

async function run() {
  console.log("Testing generateChatWithTools with google_search and url_context...");
  const prompt = "Nanoliss Quinoa Hair Masque ingredients";
  const res = await generateChatWithTools(
    [{ role: "user", parts: [{ text: prompt }] }],
    [{ google_search: {} }, { url_context: {} }]
  );
  if (!res.ok) {
    console.error("HTTP Error:", res.status, res.statusText);
    const text = await res.text();
    console.error("Body:", text);
    return;
  }
  const body = await res.json();
  console.log(JSON.stringify(body, null, 2));
}
run();
