"""File download tracking and text extraction dispatch."""

from __future__ import annotations

import hashlib
from datetime import datetime
from pathlib import Path

from backend.db import get_db


async def track_file(
    file_id: str,
    filename: str,
    local_path: str,
    content_type: str | None = None,
    size_bytes: int | None = None,
) -> dict[str, object]:
    db = await get_db()
    now = datetime.now().isoformat()
    await db.execute(
        """INSERT OR REPLACE INTO files
           (id, filename, local_path, content_type, size_bytes, downloaded_at)
           VALUES (?, ?, ?, ?, ?, ?)""",
        (file_id, filename, local_path, content_type, size_bytes, now),
    )
    await db.commit()
    return {"id": file_id, "filename": filename, "local_path": local_path}


async def update_extracted_text(file_id: str, text: str) -> None:
    db = await get_db()
    text_hash = hashlib.sha256(text.encode()).hexdigest()[:16]
    await db.execute(
        "UPDATE files SET extracted_text = ?, text_hash = ? WHERE id = ?",
        (text, text_hash, file_id),
    )
    await db.commit()


async def get_file(file_id: str) -> dict[str, object] | None:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM files WHERE id = ?", (file_id,))
    row = await cursor.fetchone()
    if row is None:
        return None
    return dict(row)


async def list_files() -> list[dict[str, object]]:
    db = await get_db()
    cursor = await db.execute("SELECT * FROM files ORDER BY downloaded_at DESC")
    rows = await cursor.fetchall()
    return [dict(r) for r in rows]


def extract_text_from_file(file_path: str) -> str | None:
    """Dispatch text extraction based on file extension."""
    path = Path(file_path)
    suffix = path.suffix.lower()

    if suffix == ".pdf":
        return _extract_pdf(path)
    elif suffix in (".docx", ".doc"):
        return _extract_docx(path)
    elif suffix in (".html", ".htm"):
        return _extract_html(path)
    return None


def _extract_pdf(path: Path) -> str:
    from pypdf import PdfReader
    reader = PdfReader(str(path))
    return "\n".join(page.extract_text() or "" for page in reader.pages)


def _extract_docx(path: Path) -> str:
    from docx import Document
    doc = Document(str(path))
    return "\n".join(p.text for p in doc.paragraphs)


def _extract_html(path: Path) -> str:
    from bs4 import BeautifulSoup
    html = path.read_text(encoding="utf-8")
    soup = BeautifulSoup(html, "html.parser")
    return soup.get_text(separator="\n", strip=True)
