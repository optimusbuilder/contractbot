import { resolve } from "path";
import { loadDiscoveryReview } from "../../investigator/index.js";

interface ReviewOptions { dir: string }

export async function reviewCommand(options: ReviewOptions): Promise<void> {
  const review = await loadDiscoveryReview(resolve(options.dir));
  if (!review) throw new Error("No agent discovery review queue found. Run contractbot discover --agent first.");
  console.log(JSON.stringify(review, null, 2));
}
