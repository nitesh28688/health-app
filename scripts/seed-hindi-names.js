const pg = require('pg');
const { GoogleGenAI } = require('@google/genai');

const client = new pg.Client({ connectionString: process.env.SEED_DB_URL });
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function translateBatch(items) {
  const prompt = `Translate these Indian food item names from English to their common Hindi/regional name in Latin script (e.g., "Kidney Beans" -> "rajma", "Lentils" -> "dal", "Flattened Rice" -> "poha").
If it's already a local name or transliterated (e.g. "Chapati"), just return the same name lowercased.
If it's a generic ingredient like "Salt" or "Water", return "namak" or "pani".
Keep it very short, 1-2 words.
Return EXACTLY a JSON array of strings in the exact same order as the input. No markdown formatting, just raw JSON.
Input:
${JSON.stringify(items.map(i => i.name))}
  `;

  const res = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  let text = res.text.trim();
  if (text.startsWith('```json')) text = text.slice(7, -3).trim();
  if (text.startsWith('```')) text = text.slice(3, -3).trim();
  return JSON.parse(text);
}

(async () => {
  try {
    await client.connect();

    const { rows } = await client.query(`
      SELECT id, name FROM foods 
      WHERE source = 'indb' AND name_local IS NULL
      LIMIT 20
    `);

    if (rows.length === 0) {
      console.log("No more foods need translating.");
      return;
    }

    console.log("Translating 20 items for spot check...");
    const names = await translateBatch(rows);

    for (let i = 0; i < rows.length; i++) {
      console.log(`${rows[i].name.padEnd(35)} -> ${names[i]}`);
    }

  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
})();
