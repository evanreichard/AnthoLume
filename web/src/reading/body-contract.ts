function htmlClone(element: Element): Element {
  const clone = document.implementation.createHTMLDocument('').importNode(element, true);
  // Root Formatting - HTML otherwise appends whitespace after body to the book's body text.
  for (const node of Array.from(clone.childNodes))
    if (node.nodeType === Node.TEXT_NODE && /^[\t\n\f\r ]*$/.test(node.textContent || '')) node.remove();
  return clone;
}
function tree(node: Node, inHead = false): unknown {
  // Head Text Runs - HTML merges CDATA with text, and removing a script can leave adjacent text nodes. Preserve exact node boundaries in the reading body.
  inHead ||= (node as Element).localName === 'head' && node.parentNode === node.ownerDocument?.documentElement;
  if (node.nodeType === Node.TEXT_NODE || node.nodeType === Node.CDATA_SECTION_NODE) return node.textContent;
  const children: unknown[] = [];
  for (const child of node.childNodes) {
    if (child.nodeType === Node.COMMENT_NODE) continue;
    const value = tree(child, inHead);
    const previous = children[children.length - 1];
    if (inHead && typeof value === 'string' && typeof previous === 'string')
      children[children.length - 1] = previous + value;
    else children.push(value);
  }
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
  // XML Publication - The pinned blobUrl view uses application/xhtml+xml, not HTML repair. Keep the independent head raw-text guard.
  const serialized = new XMLSerializer().serializeToString(doc.documentElement);
  const xml = new DOMParser().parseFromString(serialized, 'application/xhtml+xml');
  if (
    xml.querySelector('parsererror') ||
    JSON.stringify(tree(doc.documentElement)) !== JSON.stringify(tree(xml.documentElement)) ||
    JSON.stringify(tree(doc.querySelector('head')!, true)) !== JSON.stringify(tree(root.querySelector('head')!, true))
  )
    throw new Error('Unsupported document tree: serialization would change head/body KO structure');
}
export function serializeChapter(doc: Document): string {
  for (const style of doc.querySelectorAll('style'))
    if (style.namespaceURI === 'http://www.w3.org/1999/xhtml') requireSafeHTMLStyle(style.textContent || '');
  requireStableBody(doc);
  return new XMLSerializer().serializeToString(doc.documentElement);
}
