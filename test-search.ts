import { searchGrounded } from "./web/lib/gemini";
async function run() {
  console.log("Searching...");
  const res = await searchGrounded("What are the top 3 current beauty and skincare trends right now according to Vogue or Allure?");
  console.log("Result:", res);
}
run();
