const text = `The Ordinary Hyaluronic Acid 2% + B5 Serum is available at several major retailers. The price can vary depending on the retailer and whether it's the standard 30ml size or a larger "Jumbo" size.

Here's a summary of prices and retailers found:
*   **OLIVE YOUNG US:** $9.90 for 30ml.
*   **Kohl's:** $9.90 - $17.50, depending on size.
*   **Walmart:** The Ordinary, Hyaluronic Acid 2% + B5 Hydration Support Formula, 30ml is listed.
*   **eBay:** Prices vary from $9.87 to $15.99 for 30ml. A 30ml new in box is $9.99.
*   **Nordstrom:** A "Jumbo" Hyaluronic Acid 2% + B5 Serum is on sale for $31.50.
*   **Ulta Beauty:** Sells the Hyaluronic Acid 2% + B5 Hydrating Serum with Ceramides.
*   **YesStyle:** Sells the product.
*   **Skin Color:** $18.99 for 30ml.

Based on the current search results, the lowest price for the 30ml size appears to be $9.90 at OLIVE YOUNG US.

{
  "bestPrice": "$9.90",
  "retailer": "OLIVE YOUNG US",
  "url": "https://vertexaisearch.cloud.google.com/grounding-api-redirect/AUZIYQFyfM6HLoMZ-QkEgoVu_twZf2ybDf1HDe_jXf0a722o1iPsP-uQluVqPI0wuUDU1bDiePQR5guQudLjqpSoSRWchm3EScHj4IawQAFrqPRStnBt8t9VtHzkHPA8PPpY10vPBYq6lRl"
}`;

const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  throw new Error("No JSON object found in response");
}
const result = JSON.parse(jsonMatch[0]);
console.log(result);
