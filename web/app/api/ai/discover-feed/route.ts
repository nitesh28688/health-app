import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import Parser from "rss-parser";

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

export async function POST(req: NextRequest) {
  const jwt = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!jwt) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const db = admin();
  const { data: userData } = await db.auth.getUser(jwt);
  if (!userData.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userId = userData.user.id;

  try {
    // 1. Fetch user's personalized cached AI items from their latest scan
    const { data: cacheRow } = await db.from("wellness_discover_feed_cache").select("items").eq("user_id", userId).maybeSingle();
    const personalizedItems = cacheRow?.items || [];

    // 2. Fetch external RSS items
    const parser = new Parser({
      customFields: {
        item: [['media:thumbnail', 'thumbnail']],
      }
    });

    const [vogue, allure] = await Promise.allSettled([
      parser.parseURL("https://www.vogue.com/feed/beauty/rss"),
      parser.parseURL("https://www.allure.com/feed/rss")
    ]);

    const externalItems: any[] = [];
    
    const processFeed = (result: PromiseSettledResult<any>, count: number) => {
      if (result.status === 'fulfilled' && result.value?.items) {
        return result.value.items.slice(0, count).map((i: any) => {
          let description = i.contentSnippet || i.description || "Read more about this trend...";
          if (description.length > 150) {
            description = description.substring(0, 150) + "...";
          }
          return {
            type: "external_article",
            title: i.title,
            description: description,
            link: i.link,
            image_url: i.thumbnail?.$?.url || null,
            source: result.value.title
          };
        });
      }
      return [];
    };

    externalItems.push(...processFeed(vogue, 5));
    externalItems.push(...processFeed(allure, 5));

    const combinedExternal = externalItems.sort(() => 0.5 - Math.random());
    
    // Mix personalized items (always put them near the top/mixed in)
    const finalFeed = [...personalizedItems, ...combinedExternal];

    return NextResponse.json({ feed: finalFeed });
  } catch (err: any) {
    console.error("RSS Feed Error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

