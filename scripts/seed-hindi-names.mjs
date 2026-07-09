import pg from 'pg';

const client = new pg.Client({ connectionString: process.env.SEED_DB_URL });
const apiKey = process.env.GEMINI_API_KEY;

async function translateBatch(items) {
  const prompt = `Translate these Indian food item names from English to their common Hindi/regional name in Latin script (e.g., "Kidney Beans" -> "rajma", "Lentils" -> "dal", "Flattened Rice" -> "poha").
If it's already a local name or transliterated (e.g. "Chapati"), just return the same name lowercased.
If it's a generic ingredient like "Salt" or "Water", return "namak" or "pani".
Keep it very short, 1-2 words.
Return EXACTLY a JSON array of strings in the exact same order as the input. No markdown formatting, just raw JSON.
Input:
${JSON.stringify(items.map(i => i.name))}
  `;

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
      }),
    }
  );

  const data = await res.json();
  let text = data.candidates[0].content.parts[0].text.trim();
  if (text.startsWith('```json')) text = text.slice(7, -3).trim();
  if (text.startsWith('```')) text = text.slice(3, -3).trim();
  return JSON.parse(text);
}

(async () => {
  try {
    await client.connect();

    let totalProcessed = 0;
    while (true) {
      const { rows } = await client.query(`
        SELECT id, name FROM foods 
        WHERE source = 'indb' AND name_local IS NULL
        LIMIT 50
      `);

      if (rows.length === 0) {
        console.log("No more foods need translating. Finished!");
        break;
      }

      console.log(`Translating batch of ${rows.length}... (Total processed so far: ${totalProcessed})`);
      try {
        const names = await translateBatch(rows);

        for (let i = 0; i < rows.length; i++) {
          await client.query(`UPDATE foods SET name_local = $1 WHERE id = $2`, [names[i], rows[i].id]);
        }
        totalProcessed += rows.length;
        console.log(`Batch complete! Sample: ${rows[0].name} -> ${names[0]}`);
      } catch (e) {
        console.error("Batch failed, retrying in 3s...", e.message);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

  } catch(e) {
    console.error(e);
  } finally {
    await client.end();
  }
})();
