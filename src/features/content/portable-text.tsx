import type { ReactNode } from "react";
import { plainDataRecord } from "../../domain/safe-objects";

function safeLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? value : undefined;
  } catch { return undefined; }
}

/** Render the public read projection's limited block/span/mark vocabulary. */
export function PortableText({ value }: { readonly value: readonly unknown[] }) {
  const blocks: { readonly key: string; readonly content: ReactNode; readonly style: string; readonly list?: string }[] = [];
  for (const [index, input] of value.entries()) {
    const block = plainDataRecord(input);
    if (block?._type !== "block" || !Array.isArray(block.children)) continue;
    const definitions = new Map((Array.isArray(block.markDefs) ? block.markDefs : []).flatMap((input) => {
      const mark = plainDataRecord(input);
      const href = mark?._type === "safeLink" ? safeLink(mark.href) : undefined;
      return href && typeof mark?._key === "string" ? [[mark._key, href] as const] : [];
    }));
    const content = block.children.map((input, childIndex) => {
      const span = plainDataRecord(input);
      if (span?._type !== "span" || typeof span.text !== "string") return null;
      let child: ReactNode = span.text;
      for (const mark of Array.isArray(span.marks) ? span.marks : []) {
        if (mark === "strong") child = <strong>{child}</strong>;
        else if (mark === "em") child = <em>{child}</em>;
        else if (mark === "code") child = <code>{child}</code>;
        else if (typeof mark === "string" && definitions.has(mark)) child = <a href={definitions.get(mark)} rel="noopener noreferrer" className="underline underline-offset-4">{child}</a>;
      }
      return <span key={typeof span._key === "string" ? span._key : childIndex}>{child}</span>;
    });
    blocks.push({ key: typeof block._key === "string" ? block._key : String(index), content,
      style: typeof block.style === "string" ? block.style : "normal", ...(typeof block.listItem === "string" ? { list: block.listItem } : {}) });
  }
  const elements: ReactNode[] = [];
  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    if (block.list === "bullet" || block.list === "number") {
      const items = [block];
      while (blocks[index + 1]?.list === block.list) items.push(blocks[++index]);
      const List = block.list === "number" ? "ol" : "ul";
      elements.push(<List key={block.key} className={`mt-4 space-y-2 pl-6 ${block.list === "number" ? "list-decimal" : "list-disc"}`}>
        {items.map((item) => <li key={item.key}>{item.content}</li>)}
      </List>);
    } else if (block.style === "h2") elements.push(<h2 key={block.key} className="mt-8 text-2xl font-semibold">{block.content}</h2>);
    else if (block.style === "h3") elements.push(<h3 key={block.key} className="mt-6 text-xl font-semibold">{block.content}</h3>);
    else elements.push(<p key={block.key} className="mt-4 leading-8">{block.content}</p>);
  }
  return <>{elements}</>;
}
