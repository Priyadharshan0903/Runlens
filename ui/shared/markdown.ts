// Markdown for agent answers and reasons. Transcripts can contain anything a tool printed,
// including HTML from web pages, so raw HTML is shown as text and only http(s) links render.

import { Marked } from "marked";

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const md = new Marked({ gfm: true, async: false });
md.use({
  renderer: {
    html({ text }) {
      return escape(text);
    },
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      if (!/^https?:\/\//i.test(href)) return text;
      const t = title ? ` title="${escape(title)}"` : "";
      return `<a href="${escape(href)}"${t} target="_blank" rel="noreferrer noopener">${text}</a>`;
    },
    image({ text }) {
      return escape(`[image: ${text}]`);
    },
  },
});

export function renderMarkdown(source: string): string {
  return md.parse(source) as string;
}

export function renderInline(source: string): string {
  return md.parseInline(source) as string;
}
