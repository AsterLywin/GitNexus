export type RebaseAction = "pick" | "reword" | "edit" | "squash" | "fixup" | "drop";

export interface RebasePlanItem {
  id: string;
  action: RebaseAction;
  commit: string;
  subject: string;
  originalIndex: number;
}

export function validateRebasePlan(items: RebasePlanItem[]): void {
  if (!items.length) throw new Error("Rebase plan is empty.");
  for (const item of items) {
    if (!/^[0-9a-f]{7,64}$/i.test(item.commit)) {
      throw new Error(`Invalid commit id: ${item.commit}`);
    }
  }

  const firstActive = items.findIndex(item => item.action !== "drop");
  if (firstActive < 0) throw new Error("At least one commit must remain active.");

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if ((item.action === "squash" || item.action === "fixup") && i === 0) {
      throw new Error(`${item.action} cannot be the first rebase instruction.`);
    }
  }
}

export function serializeRebaseTodo(items: RebasePlanItem[]): string {
  validateRebasePlan(items);
  return items
    .map(item => `${item.action} ${item.commit} ${item.subject}`.trim())
    .join("\n") + "\n";
}
