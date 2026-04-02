"""Extract internal and external links from Canvas HTML content."""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ExtractedLink:
    url: str
    link_class: str  # "file", "page", "external"
    text: str | None = None


# Canvas internal file API pattern: /api/v1/courses/.../files/...
_FILE_API_RE = re.compile(r'data-api-endpoint="([^"]*?/files/\d+)"')
# Standard href links
_HREF_RE = re.compile(r'<a\s[^>]*href="([^"]+)"[^>]*>(.*?)</a>', re.DOTALL)
# Canvas internal page/assignment patterns
_CANVAS_INTERNAL_RE = re.compile(r"/courses/\d+/(pages|assignments|quizzes|modules)/")


def extract_links(html: str) -> list[ExtractedLink]:
    """Parse HTML content and return classified links."""
    if not html:
        return []

    links: list[ExtractedLink] = []
    seen: set[str] = set()

    # 1. Canvas file API endpoints (data-api-endpoint attributes)
    for match in _FILE_API_RE.finditer(html):
        url = match.group(1)
        if url not in seen:
            seen.add(url)
            links.append(ExtractedLink(url=url, link_class="file"))

    # 2. Standard href links
    for match in _HREF_RE.finditer(html):
        url = match.group(1)
        text = re.sub(r"<[^>]+>", "", match.group(2)).strip() or None

        if url in seen or url.startswith("#") or url.startswith("mailto:"):
            continue
        seen.add(url)

        if _CANVAS_INTERNAL_RE.search(url):
            link_class = "page"
        elif url.startswith("/") or "instructure.com" in url:
            link_class = "page"
        else:
            link_class = "external"

        links.append(ExtractedLink(url=url, link_class=link_class, text=text))

    return links
