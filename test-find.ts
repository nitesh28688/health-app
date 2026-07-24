import { searchGrounded } from "./web/lib/gemini";

async function test() {
  const prompt = `Search online for the product "THE ORDINARY Hyaluronic Acid 2% + B5 Serum".
Find it across multiple major retailers.
Determine the current best price and the exact URL to buy it at that price.
Return ONLY a valid JSON object in this exact format, with no markdown formatting:
{
  "bestPrice": "$XX.XX",
  "retailer": "Retailer Name",
  "url": "https://..."
}`;

  console.log("Searching...");
  const text = await searchGrounded(prompt);
  console.log("Raw output:", text);
  
  if (text) {
      try {
          const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
          console.log("Parsed JSON:", JSON.parse(jsonStr));
      } catch (e) {
          console.error("Parse error:", e);
      }
  }
}

test();
