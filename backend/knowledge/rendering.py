"""HTML is disabled in Markdown, then sanitized for web and WeChat rich-text."""
import bleach
from markdown_it import MarkdownIt

parser = MarkdownIt('commonmark', {'html': False}).enable('table')


def render_markdown(value):
    return bleach.clean(parser.render(value), tags=['p', 'br', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'strong', 'em', 's', 'blockquote', 'ul', 'ol', 'li', 'pre', 'code', 'hr', 'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
                        attributes={'a': ['href', 'title'], 'img': ['src', 'alt', 'title'], 'ol': ['start']}, protocols=['https'], strip=True)
