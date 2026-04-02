"""Graph rebuilder — derives edges from ingested course data.

After ingestion, this module:
1. Creates explicit edges from node_links (file refs, page refs)
2. Creates sequential edges between assignments in the same module
3. Detects orphan nodes (no incoming or outgoing edges)
4. Updates node status for orphans
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from backend.db import get_db
from backend.models.graph import EdgeType
from backend.services.graph_service import add_edge
from backend.services.node_service import list_nodes

logger = logging.getLogger(__name__)


@dataclass
class GraphBuildResult:
    explicit_edges: int = 0
    sequential_edges: int = 0
    orphans_found: int = 0
    total_edges: int = 0
    errors: list[str] = field(default_factory=list)


async def rebuild_graph() -> GraphBuildResult:
    """Rebuild the dependency graph from current node data."""
    result = GraphBuildResult()
    db = await get_db()

    # Clear existing derived edges (keep manually added ones)
    await db.execute("DELETE FROM edges")
    await db.commit()

    # 1. Explicit edges from node_links
    cursor = await db.execute("SELECT source_id, target_id, link_type FROM node_links")
    rows = await cursor.fetchall()
    for row in rows:
        try:
            await add_edge(
                source=row[0],
                target=row[1],
                edge_type=EdgeType.EXPLICIT,
                label=f"Link: {row[2]}",
            )
            result.explicit_edges += 1
        except Exception as e:
            result.errors.append(f"Failed to add edge {row[0]}→{row[1]}: {e}")

    # 2. Sequential edges: assignments in the same module, ordered by module_order
    cursor = await db.execute("""
        SELECT id, module, module_order, week
        FROM nodes
        WHERE type = 'assignment' AND module IS NOT NULL AND module_order IS NOT NULL
        ORDER BY week ASC NULLS LAST, module_order ASC
    """)
    assignments = await cursor.fetchall()

    # Group by module
    modules: dict[str, list[tuple[str, int]]] = {}
    for row in assignments:
        module = row[1]
        if module not in modules:
            modules[module] = []
        modules[module].append((row[0], row[2]))  # (id, module_order)

    for module, items in modules.items():
        sorted_items = sorted(items, key=lambda x: x[1])
        for i in range(len(sorted_items) - 1):
            try:
                await add_edge(
                    source=sorted_items[i][0],
                    target=sorted_items[i + 1][0],
                    edge_type=EdgeType.EXPLICIT,
                    label=f"Sequential in {module}",
                )
                result.sequential_edges += 1
            except Exception as e:
                result.errors.append(f"Failed to add sequential edge: {e}")

    # 3. Week-to-week sequential edges for first assignment in each week
    cursor = await db.execute("""
        SELECT id, week, module_order FROM nodes
        WHERE type = 'assignment' AND week IS NOT NULL
        ORDER BY week ASC, module_order ASC
    """)
    weekly_assignments = await cursor.fetchall()

    # Get first assignment per week
    first_per_week: dict[int, str] = {}
    for row in weekly_assignments:
        week = row[1]
        if week not in first_per_week:
            first_per_week[week] = row[0]

    sorted_weeks = sorted(first_per_week.keys())
    for i in range(len(sorted_weeks) - 1):
        curr_week = sorted_weeks[i]
        next_week = sorted_weeks[i + 1]
        try:
            await add_edge(
                source=first_per_week[curr_week],
                target=first_per_week[next_week],
                edge_type=EdgeType.INFERRED,
                label=f"Week {curr_week} → Week {next_week}",
                confidence=0.6,
            )
            result.sequential_edges += 1
        except Exception as e:
            result.errors.append(f"Failed to add weekly edge: {e}")

    # 4. Detect orphans — nodes with no edges at all
    cursor = await db.execute("""
        SELECT n.id FROM nodes n
        WHERE n.type IN ('assignment', 'page')
        AND n.id NOT IN (SELECT source FROM edges)
        AND n.id NOT IN (SELECT target FROM edges)
    """)
    orphans = await cursor.fetchall()
    for row in orphans:
        await db.execute(
            "UPDATE nodes SET status = 'orphan' WHERE id = ? AND status = 'unaudited'",
            (row[0],),
        )
        result.orphans_found += 1

    await db.commit()

    # Count total edges
    cursor = await db.execute("SELECT COUNT(*) FROM edges WHERE status = 'active'")
    count_row = await cursor.fetchone()
    result.total_edges = count_row[0] if count_row else 0

    logger.info(
        "Graph rebuild: %d explicit, %d sequential, %d orphans, %d total edges",
        result.explicit_edges, result.sequential_edges, result.orphans_found, result.total_edges,
    )
    return result
