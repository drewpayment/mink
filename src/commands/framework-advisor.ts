import {
  frameworkAdvisorPath,
  frameworkAdvisorJsonPath,
} from "../core/paths";
import { atomicWriteJson, atomicWriteText } from "../core/fs-utils";
import { buildKnowledge, generateKnowledgeMarkdown } from "../core/framework-advisor/generate";
import { validateKnowledge } from "../core/framework-advisor/validate";

export async function frameworkAdvisor(
  cwd: string,
  args: string[]
): Promise<void> {
  const isValidate = args.includes("--validate");
  const isJson = args.includes("--json");

  const knowledge = buildKnowledge();

  if (isValidate) {
    const result = validateKnowledge(knowledge);
    if (result.valid) {
      console.log("[mink] Framework advisor knowledge is valid.");
      console.log(
        `  ${knowledge.frameworks.length} frameworks, ${knowledge.decisionTree.length} decision nodes, ${knowledge.migrationPrompts.length} migration prompts`
      );
    } else {
      console.error("[mink] Framework advisor validation failed:");
      for (const err of result.errors) {
        console.error(`  - ${err}`);
      }
      process.exit(1);
    }
    return;
  }

  if (isJson) {
    console.log(JSON.stringify(knowledge, null, 2));
    return;
  }

  // Default: generate both files
  const markdown = generateKnowledgeMarkdown(knowledge);

  atomicWriteText(frameworkAdvisorPath(cwd), markdown);
  atomicWriteJson(frameworkAdvisorJsonPath(cwd), knowledge);

  console.log("[mink] Framework advisor knowledge generated:");
  console.log(`  Markdown: ${frameworkAdvisorPath(cwd)}`);
  console.log(`  JSON:     ${frameworkAdvisorJsonPath(cwd)}`);
  console.log(
    `  ${knowledge.frameworks.length} frameworks, ${knowledge.decisionTree.length} decision nodes, ${knowledge.migrationPrompts.length} migration prompts`
  );
}
