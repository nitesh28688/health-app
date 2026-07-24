import Parser from "rss-parser";

async function run() {
  const parser = new Parser({
    customFields: {
      item: [['media:content', 'media'], ['media:thumbnail', 'thumbnail'], ['content:encoded', 'contentEncoded']],
    }
  });
  try {
    const feed = await parser.parseURL("https://www.vogue.com/feed/beauty/rss");
    console.log("Vogue items:", feed.items.length);
    console.log(JSON.stringify(feed.items[0], null, 2));
  } catch (e) {
    console.error("Vogue error:", e);
  }
  
  try {
    const feed2 = await parser.parseURL("https://www.allure.com/feed/rss");
    console.log("Allure items:", feed2.items.length);
    console.log(JSON.stringify(feed2.items[0], null, 2));
  } catch (e) {
    console.error("Allure error:", e);
  }
}

run();
