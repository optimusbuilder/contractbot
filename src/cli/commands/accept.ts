import chalk from "chalk";
import { clearChangeSet, getChangeSet, saveBaseline } from "../../differ/index.js";

export async function acceptCommand(apiName: string): Promise<void> {
  const changeSet = await getChangeSet(apiName);
  if (!changeSet) {
    throw new Error(`No pending change-set for ${apiName}. Run contractbot ci first.`);
  }

  await saveBaseline(apiName, changeSet.sourceUrl, changeSet.nextSpec, changeSet.nextMeta);
  await clearChangeSet(apiName);
  console.log(chalk.green(`✓ ${apiName}: accepted the detected contract change`));
  console.log(chalk.dim("  Commit .contractbot/baselines to record this approval."));
}
