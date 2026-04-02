"""Canvas course files ZIP ingestion.

Extracts files from a Canvas "Download Course Content" ZIP export,
creates file nodes, extracts text from PDFs/DOCXs, and logs ingestion.

The ZIP structure is folder-based:
  Admin Documents/    → admin/reference files
  Assignments/        → assignment-related files (templates, rubrics, code)
  Lecture Materials/   → organized by Week N/
  Videos/             → skipped (too large, no text)
  Uploaded Media/     → skipped (images)
  course_image/       → skipped
  unfiled/            → miscellaneous
"""

from __future__ import annotations

import hashlib
import logging
import re
import tempfile
import zipfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from backend.db import get_db
from backend.services.file_service import extract_text_from_file, track_file
from backend.services.node_service import compute_content_hash, upsert_node

logger = logging.getLogger(__name__)

# Extensions we can extract text from
_TEXT_EXTENSIONS = {".pdf", ".docx", ".doc", ".html", ".htm", ".txt", ".ino"}
# Extensions to skip entirely
_SKIP_EXTENSIONS = {".mp4", ".mp3", ".mov", ".avi", ".png", ".jpg", ".jpeg", ".gif", ".xlsx", ".pptx"}
# Folders to skip
_SKIP_FOLDERS = {"Videos", "Uploaded Media", "course_image"}

# Regex to extract week number from path
_WEEK_RE = re.compile(r"Week\s*(\d+)", re.IGNORECASE)


@dataclass
class IngestResult:
    files_extracted: int = 0
    nodes_created: int = 0
    text_extracted: int = 0
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


def _classify_folder(path_parts: list[str]) -> tuple[str, str | None, int | None]:
    """Classify a file by its folder path.

    Returns (category, module_name, week_number).
    """
    if not path_parts:
        return "root", None, None

    top = path_parts[0]

    if top == "Lecture Materials" and len(path_parts) > 1:
        subfolder = path_parts[1]
        week_match = _WEEK_RE.search(subfolder)
        week = int(week_match.group(1)) if week_match else None
        return "lecture", subfolder, week

    if top == "Assignments":
        if len(path_parts) > 1 and path_parts[1] == "Circuit Lab":
            return "assignment", "Circuit Lab", None
        return "assignment", None, None

    if top == "Admin Documents":
        return "admin", None, None

    if top == "unfiled":
        return "reference", None, None

    return "file", None, None


def _make_node_id(zip_path: str) -> str:
    """Generate a stable node ID from the ZIP path."""
    return "file-" + hashlib.md5(zip_path.encode()).hexdigest()[:12]


async def ingest_zip(
    zip_path: str,
    extract_dir: str | None = None,
) -> IngestResult:
    """Ingest a Canvas course files ZIP into the database.

    Args:
        zip_path: Path to the ZIP file.
        extract_dir: Directory to extract files to. Defaults to data/files/.
    """
    result = IngestResult()
    zip_file = Path(zip_path)

    if not zip_file.exists():
        result.errors.append(f"ZIP file not found: {zip_path}")
        return result

    if extract_dir is None:
        extract_dir = str(Path(zip_path).parent / "files")
    Path(extract_dir).mkdir(parents=True, exist_ok=True)

    db = await get_db()
    now = datetime.now().isoformat()

    with zipfile.ZipFile(zip_path, "r") as zf:
        for info in zf.infolist():
            # Skip directories
            if info.is_dir():
                continue

            zip_name = info.filename
            path_parts = Path(zip_name).parts
            suffix = Path(zip_name).suffix.lower()

            # Skip folders we don't process
            if path_parts and path_parts[0] in _SKIP_FOLDERS:
                result.skipped += 1
                continue

            # Skip large binary files
            if suffix in _SKIP_EXTENSIONS:
                result.skipped += 1
                continue

            # Extract the file
            try:
                extracted_path = zf.extract(info, extract_dir)
                result.files_extracted += 1
            except Exception as e:
                result.errors.append(f"Failed to extract {zip_name}: {e}")
                continue

            # Classify and create node
            category, module_name, week = _classify_folder(list(path_parts[:-1]))
            filename = Path(zip_name).name
            node_id = _make_node_id(zip_name)

            # Determine node type
            if category == "lecture":
                node_type = "lecture"
            elif category == "admin":
                node_type = "file"
            else:
                node_type = "file"

            # Extract text if possible
            extracted_text = None
            if suffix in _TEXT_EXTENSIONS:
                try:
                    if suffix == ".txt" or suffix == ".ino":
                        extracted_text = Path(extracted_path).read_text(encoding="utf-8", errors="replace")
                    else:
                        extracted_text = extract_text_from_file(extracted_path)
                    if extracted_text:
                        result.text_extracted += 1
                except Exception as e:
                    logger.warning("Text extraction failed for %s: %s", zip_name, e)

            # Track the file in the files table
            await track_file(
                file_id=node_id,
                filename=filename,
                local_path=extracted_path,
                content_type=suffix.lstrip("."),
                size_bytes=info.file_size,
            )

            if extracted_text:
                from backend.services.file_service import update_extracted_text
                await update_extracted_text(node_id, extracted_text)

            # Build description from extracted text (truncated for the node)
            description = None
            if extracted_text:
                # Use first 500 chars as description preview
                description = extracted_text[:500].strip()
                if len(extracted_text) > 500:
                    description += "..."

            # Create/update the node
            node_data: dict[str, object] = {
                "type": node_type,
                "title": filename,
                "file_path": extracted_path,
                "file_content": extracted_text,
                "source": "zip_import",
            }
            if description:
                node_data["description"] = description
            if week is not None:
                node_data["week"] = week
            if module_name:
                node_data["module"] = module_name

            await upsert_node(node_id, node_data)
            result.nodes_created += 1

            # Log the ingestion
            await db.execute(
                "INSERT INTO ingest_log (node_id, action, status, detail, created_at) VALUES (?, ?, ?, ?, ?)",
                (node_id, "zip_import", "success", f"Extracted from {zip_name}", now),
            )

    await db.commit()

    logger.info(
        "ZIP ingestion complete: %d files extracted, %d nodes created, %d text extracted, %d skipped",
        result.files_extracted, result.nodes_created, result.text_extracted, result.skipped,
    )
    return result
