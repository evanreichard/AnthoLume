function htmlClone(element: Element): Element {
  const clone = document.implementation.createHTMLDocument('').importNode(element, true);
  // Root Formatting - HTML otherwise appends whitespace after body to the book's body text.
  for (const node of Array.from(clone.childNodes)) if (node.nodeType === Node.TEXT_NODE && /^[\t\n\f\r ]*$/.test(node.textContent || '')) node.remove();
  return clone;
}
function tree(node: Node): unknown {
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) return node.textContent;
  if (node.nodeType === Node.COMMENT_NODE) return null;
  const children = Array.from(node.childNodes).filter(child => child.nodeType !== Node.COMMENT_NODE).map(tree);
  if (node.nodeType !== Node.ELEMENT_NODE) return children;
  const element = node as Element;
  return [element.namespaceURI, element.localName, element.id, children];
}
export function requireSafeHTMLStyle(text: string) {
  // HTML Raw Text - CSS comments and strings do not protect a literal HTML end tag from the next parser.
  if (/<\/style(?=[\t\n\f\r />]|$)/i.test(text)) throw new Error('XHTML style contains an HTML raw-text terminator');
}
export function requireStableBody(doc: Document) {
  if (!doc.querySelector('body')) throw new Error('Chapter body required');
  // Inert Whole Document - Head raw text must not manufacture body nodes; template descendants neither execute nor fetch.
  const template = document.createElement('template');
  const root = document.createElement('html');
  template.content.appendChild(root);
  root.innerHTML = htmlClone(doc.documentElement).innerHTML;
  const source = Array.from(doc.documentElement.children).map(tree);
  const parsed = Array.from(root.children).map(tree);
  if (JSON.stringify(source) !== JSON.stringify(parsed)) throw new Error('Unsupported document tree: HTML parsing would change head/body KO structure');
}
export function serializeChapter(doc: Document): string {
  for (const style of doc.querySelectorAll('style')) if (style.namespaceURI === 'http://www.w3.org/1999/xhtml') requireSafeHTMLStyle(style.textContent || '');
  // HTML Serialization - XML self-closing nonvoid tags otherwise change the source tree when srcdoc is parsed as HTML.
  return htmlClone(doc.documentElement).outerHTML;
}
