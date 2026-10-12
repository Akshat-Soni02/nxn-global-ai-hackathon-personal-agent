// Getting JSON out of a model's reply: reasoning blocks and code fences removed, then the outermost object or array.

export function stripThinking(text: string): string {
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^[\s\S]*<\/think>/i, "")
    .trim();
}

export function extractJson(raw: string): unknown {
  let text = stripThinking(raw);
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  if (fenced?.[1]) text = fenced[1].trim();
  const starts = [text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0);
  if (starts.length === 0) throw new Error("the reply contains no JSON");
  const start = Math.min(...starts);
  const end = Math.max(text.lastIndexOf("}"), text.lastIndexOf("]"));
  if (end <= start) throw new Error("the reply contains no complete JSON");
  return JSON.parse(text.slice(start, end + 1));
}
