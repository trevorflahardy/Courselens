"""Seed demo data for the Course Audit System.

Creates realistic EGN 3000L course content:
- 15 assignments across 15 weeks
- 3 pages (syllabus, resources, peer review guide)
- 2 rubrics
- 1 lecture
- 20 edges (dependency graph)
- 8 findings (sample audit results)
"""

import hashlib
import sqlite3
import uuid
from datetime import datetime, timedelta
from pathlib import Path

DB_PATH = Path(__file__).parent.parent / "data" / "audit.db"


def content_hash(instructions: str, rubric_text: str = "", description: str = "") -> str:
    combined = f"{instructions}{rubric_text}{description}"
    return hashlib.sha256(combined.encode()).hexdigest()[:16]


def seed() -> None:
    if not DB_PATH.exists():
        print("Database not found. Run setup_db.py first.")
        return

    conn = sqlite3.connect(str(DB_PATH))
    conn.execute("PRAGMA foreign_keys=ON")

    # Clear existing data
    for table in ["ingest_log", "findings", "audit_runs", "edges", "node_links", "files", "nodes"]:
        conn.execute(f"DELETE FROM {table}")

    now = datetime.now().isoformat()

    # =========================================================================
    # NODES — 15 Assignments
    # =========================================================================
    assignments = [
        {
            "id": "assign-01",
            "title": "Week 1: Engineering Notebook Setup",
            "week": 1,
            "module": "Module 1: Foundations",
            "module_order": 1,
            "instructions": "Set up your engineering notebook using the provided template. Include a table of contents, date each entry, and write in pen. Your notebook will be checked weekly throughout the semester.",
            "rubric_text": "Notebook organization (10pts) | Table of contents present (5pts) | Date formatting correct (5pts) | Pen usage (5pts)",
            "status": "ok",
        },
        {
            "id": "assign-02",
            "title": "Week 2: Team Charter & Roles",
            "week": 2,
            "module": "Module 1: Foundations",
            "module_order": 2,
            "instructions": "With your team, create a team charter that defines roles, responsibilities, communication norms, and conflict resolution procedures. Submit as a single PDF.",
            "rubric_text": "Roles defined (10pts) | Communication norms (10pts) | Conflict resolution (10pts) | Professional formatting (5pts)",
            "status": "ok",
        },
        {
            "id": "assign-03",
            "title": "Week 3: Problem Statement & Stakeholder Analysis",
            "week": 3,
            "module": "Module 2: Problem Definition",
            "module_order": 1,
            "instructions": "Write a problem statement for your team's design project. Identify at least 3 stakeholders and describe their needs. Use the template provided in the course files.",
            "rubric_text": "Problem statement clarity (15pts) | Stakeholder identification (15pts) | Needs analysis depth (10pts) | Template usage (5pts)",
            "status": "warn",
        },
        {
            "id": "assign-04",
            "title": "Week 4: Requirements Document",
            "week": 4,
            "module": "Module 2: Problem Definition",
            "module_order": 2,
            "instructions": "Using your problem statement from Week 3, develop a full requirements document. Include functional requirements, non-functional requirements, and constraints. Reference your stakeholder analysis.",
            "rubric_text": "Functional requirements (15pts) | Non-functional requirements (10pts) | Constraints identified (10pts) | Traceability to stakeholders (10pts)",
            "status": "ok",
        },
        {
            "id": "assign-05",
            "title": "Week 5: Data Collection Plan",
            "week": 5,
            "module": "Module 3: Research & Data",
            "module_order": 1,
            "instructions": "Create a data collection plan for your project. Identify what data you need, how you'll collect it, and how you'll organize it. Submit your plan and any survey instruments.",
            "rubric_text": "Data needs identified (10pts) | Collection methods (10pts) | Organization plan (10pts) | Survey quality (10pts)",
            "status": "warn",
        },
        {
            "id": "assign-06",
            "title": "Week 6: Data Analysis & Visualization",
            "week": 6,
            "module": "Module 3: Research & Data",
            "module_order": 2,
            "instructions": "Analyze the data you collected. Create at least 3 visualizations (charts, graphs, or tables) that support your design decisions. Submit your analysis.",
            "rubric_text": "Analysis rigor (15pts) | Visualization quality (15pts) | Stakeholder analysis connection (10pts) | Conclusions drawn (10pts)",
            "status": "gap",
        },
        {
            "id": "assign-07",
            "title": "Week 7: Concept Generation (Brainstorming)",
            "week": 7,
            "module": "Module 4: Design",
            "module_order": 1,
            "instructions": "Generate at least 10 design concepts using brainstorming techniques covered in lecture. Document each concept with a sketch and brief description. Use your engineering notebook.",
            "rubric_text": "Number of concepts (10pts) | Sketch quality (10pts) | Description clarity (10pts) | Creativity (10pts)",
            "status": "ok",
        },
        {
            "id": "assign-08",
            "title": "Week 8: Decision Matrix & Concept Selection",
            "week": 8,
            "module": "Module 4: Design",
            "module_order": 2,
            "instructions": "Create a decision matrix to evaluate your top 5 concepts. Weight criteria based on your requirements document. Select your final concept and justify your choice.",
            "rubric_text": "Matrix completeness (15pts) | Criteria weighting (10pts) | Justification quality (15pts) | Requirements traceability (10pts)",
            "status": "ok",
        },
        {
            "id": "assign-09",
            "title": "Week 9: Peer Review 1 — Design Concepts",
            "week": 9,
            "module": "Module 5: Iteration",
            "module_order": 1,
            "instructions": "Review two other teams' concept selection reports. Provide constructive feedback on their decision matrix and concept justification. Use the peer review form.",
            "rubric_text": "Feedback specificity (15pts) | Constructive tone (10pts) | Coverage of all sections (10pts) | Actionable suggestions (15pts)",
            "status": "gap",
        },
        {
            "id": "assign-10",
            "title": "Week 10: Prototype v1",
            "week": 10,
            "module": "Module 5: Iteration",
            "module_order": 2,
            "instructions": "Build a first prototype of your selected concept. Document the build process in your engineering notebook. Submit photos and a brief description of materials used.",
            "rubric_text": "Prototype functionality (20pts) | Documentation quality (10pts) | Materials list (5pts) | Build process photos (5pts)",
            "status": "warn",
        },
        {
            "id": "assign-11",
            "title": "Week 11: Prototype v2 — Iteration",
            "week": 11,
            "module": "Module 5: Iteration",
            "module_order": 3,
            "instructions": "Based on feedback from Peer Review 1 and your own testing, iterate on your prototype. Document what changed and why. Apply the iteration methodology.",
            "rubric_text": "Changes documented (15pts) | Rationale for changes (15pts) | Iteration methodology applied (10pts) | Improvement demonstrated (10pts)",
            "status": "gap",
        },
        {
            "id": "assign-12",
            "title": "Week 12: Peer Review 2 — Prototypes",
            "week": 12,
            "module": "Module 6: Communication",
            "module_order": 1,
            "instructions": "Review two other teams' prototype v2. Evaluate functionality, documentation, and iteration quality. Provide written feedback.",
            "rubric_text": "Evaluation thoroughness (15pts) | Feedback quality (15pts) | Comparison to v1 (10pts) | Suggestions for final (10pts)",
            "status": "ok",
        },
        {
            "id": "assign-13",
            "title": "Week 13: Final Report Draft",
            "week": 13,
            "module": "Module 6: Communication",
            "module_order": 2,
            "instructions": "Submit a draft of your final design report. Include all sections: problem statement, requirements, research, design process, prototype evolution, and recommendations. Use the report template.",
            "rubric_text": "Completeness (20pts) | Technical writing quality (15pts) | Visual aids (10pts) | References (5pts)",
            "status": "warn",
        },
        {
            "id": "assign-14",
            "title": "Week 14: Final Presentation",
            "week": 14,
            "module": "Module 7: Final Deliverables",
            "module_order": 1,
            "instructions": "Deliver a 10-minute team presentation covering your entire design project. All team members must speak. Include a live demo or video of your prototype.",
            "rubric_text": "Content coverage (20pts) | Delivery quality (15pts) | Visual aids (10pts) | Demo/video (10pts) | Q&A handling (5pts)",
            "status": "ok",
        },
        {
            "id": "assign-15",
            "title": "Week 15: Final Report & Reflection",
            "week": 15,
            "module": "Module 7: Final Deliverables",
            "module_order": 2,
            "instructions": "Submit your final design report incorporating feedback from the draft review. Also submit an individual reflection (1-2 pages) on your learning throughout the course.",
            "rubric_text": "Report completeness (25pts) | Incorporation of feedback (15pts) | Individual reflection depth (10pts) | Professional formatting (5pts)",
            "status": "ok",
        },
    ]

    for a in assignments:
        h = content_hash(a.get("instructions", ""), a.get("rubric_text", ""))
        conn.execute(
            """INSERT INTO nodes (id, type, title, week, module, module_order,
               instructions, rubric_text, source, status, content_hash, created_at, updated_at)
               VALUES (?, 'assignment', ?, ?, ?, ?, ?, ?, 'seed', ?, ?, ?, ?)""",
            (a["id"], a["title"], a["week"], a["module"], a["module_order"],
             a["instructions"], a["rubric_text"], a["status"], h, now, now),
        )

    # =========================================================================
    # NODES — 3 Pages
    # =========================================================================
    pages = [
        {
            "id": "page-syllabus",
            "title": "Course Syllabus",
            "week": 1,
            "module": "Module 1: Foundations",
            "module_order": 0,
            "description": "EGN 3000L Foundations of Engineering Lab — Fall 2025. This course introduces the engineering design process through a semester-long team project.",
        },
        {
            "id": "page-resources",
            "title": "Design Resources & Templates",
            "week": 1,
            "module": "Module 1: Foundations",
            "module_order": 3,
            "description": "Links to all templates: engineering notebook template, team charter template, problem statement template, report template, peer review form.",
        },
        {
            "id": "page-peer-review-guide",
            "title": "How to Give Effective Peer Feedback",
            "week": 8,
            "module": "Module 5: Iteration",
            "module_order": 0,
            "description": "Guide on providing constructive peer feedback. Covers the SBI model (Situation-Behavior-Impact), how to be specific, and examples of good vs. bad feedback.",
        },
    ]

    for p in pages:
        h = content_hash(p.get("description", ""))
        conn.execute(
            """INSERT INTO nodes (id, type, title, week, module, module_order,
               description, source, status, content_hash, created_at, updated_at)
               VALUES (?, 'page', ?, ?, ?, ?, ?, 'seed', 'unaudited', ?, ?, ?)""",
            (p["id"], p["title"], p["week"], p["module"], p["module_order"],
             p["description"], h, now, now),
        )

    # =========================================================================
    # NODES — 2 Rubrics (standalone rubric nodes)
    # =========================================================================
    rubrics = [
        {
            "id": "rubric-peer-review",
            "title": "Peer Review Rubric",
            "week": 9,
            "module": "Module 5: Iteration",
            "description": "Standard rubric for all peer review assignments. Criteria: specificity of feedback (30%), constructive tone (20%), coverage (20%), actionable suggestions (30%).",
        },
        {
            "id": "rubric-final-report",
            "title": "Final Report Rubric",
            "week": 15,
            "module": "Module 7: Final Deliverables",
            "description": "Rubric for the final design report. Weighted heavily toward technical completeness and professional writing quality.",
        },
    ]

    for r in rubrics:
        h = content_hash(r.get("description", ""))
        conn.execute(
            """INSERT INTO nodes (id, type, title, week, module, description,
               source, status, content_hash, created_at, updated_at)
               VALUES (?, 'rubric', ?, ?, ?, ?, 'seed', 'unaudited', ?, ?, ?)""",
            (r["id"], r["title"], r["week"], r["module"], r["description"], h, now, now),
        )

    # =========================================================================
    # NODES — 1 Lecture
    # =========================================================================
    conn.execute(
        """INSERT INTO nodes (id, type, title, week, module, module_order,
           description, source, status, content_hash, created_at, updated_at)
           VALUES (?, 'lecture', ?, ?, ?, ?, ?, 'seed', 'unaudited', ?, ?, ?)""",
        ("lecture-iteration", "Lecture: Iteration Methodology in Engineering Design",
         10, "Module 5: Iteration", 0,
         "Covers iterative design cycles, build-test-learn loops, and when to pivot vs. persevere. Key vocabulary: iteration, prototype fidelity, design spiral.",
         content_hash("Covers iterative design cycles..."), now, now),
    )

    # =========================================================================
    # EDGES — 20 dependency relationships
    # =========================================================================
    edges = [
        # Explicit sequential dependencies
        ("assign-01", "assign-07", "explicit", "Notebook used for concept sketches", None, None),
        ("assign-02", "assign-03", "explicit", "Team roles inform stakeholder analysis", None, None),
        ("assign-03", "assign-04", "explicit", "Problem statement feeds requirements", "Using your problem statement from Week 3", 1.0),
        ("assign-04", "assign-05", "explicit", "Requirements guide data collection", None, None),
        ("assign-05", "assign-06", "explicit", "Data collection feeds analysis", None, None),
        ("assign-06", "assign-08", "explicit", "Data informs decision criteria", None, None),
        ("assign-07", "assign-08", "explicit", "Concepts evaluated in decision matrix", None, None),
        ("assign-08", "assign-10", "explicit", "Selected concept becomes prototype", None, None),
        ("assign-09", "assign-11", "explicit", "Peer feedback drives iteration", "Based on feedback from Peer Review 1", 1.0),
        ("assign-10", "assign-11", "explicit", "Prototype v1 iterated to v2", None, None),
        ("assign-11", "assign-12", "explicit", "Prototype v2 reviewed by peers", None, None),
        ("assign-13", "assign-15", "explicit", "Draft revised into final report", None, None),
        # Inferred dependencies
        ("assign-04", "assign-08", "inferred", "Requirements traceability in decision matrix", "Rubric: Requirements traceability (10pts)", 0.85),
        ("assign-06", "assign-13", "inferred", "Data visualizations reused in final report", None, 0.7),
        ("assign-03", "assign-06", "inferred", "Stakeholder analysis referenced in rubric", "Rubric: Stakeholder analysis connection (10pts)", 0.9),
        # Artifact dependencies
        ("assign-05", "assign-06", "artifact", "Survey data flows to analysis", None, None),
        ("assign-10", "assign-14", "artifact", "Prototype demo in final presentation", None, None),
        # Gap edges
        ("page-peer-review-guide", "assign-09", "gap", "Peer review guide placed at Week 8 but peer review is Week 9 — no instruction before first review", None, None),
        ("lecture-iteration", "assign-11", "gap", "Iteration methodology lecture at Week 10 but nothing between Weeks 8-10 introduces iteration concepts", None, None),
        ("assign-05", "assign-08", "gap", "Data format mismatch: Week 5 produces raw survey data, Week 8 expects formatted analysis", None, None),
    ]

    for src, tgt, etype, label, evidence, confidence in edges:
        conn.execute(
            """INSERT INTO edges (source, target, edge_type, label, evidence, confidence, status, derived_at)
               VALUES (?, ?, ?, ?, ?, ?, 'active', ?)""",
            (src, tgt, etype, label, evidence, confidence, now),
        )

    # =========================================================================
    # AUDIT RUN — one completed demo run
    # =========================================================================
    run_id = "demo-run-001"
    conn.execute(
        """INSERT INTO audit_runs (id, assignment_id, status, pass1_findings, pass2_findings,
           pass3_findings, total_findings, started_at, finished_at)
           VALUES (?, 'assign-06', 'done', 2, 3, 3, 8, ?, ?)""",
        (run_id, now, (datetime.now() + timedelta(minutes=2)).isoformat()),
    )

    # =========================================================================
    # FINDINGS — 8 sample findings
    # =========================================================================
    findings = [
        {
            "assignment_id": "assign-06",
            "severity": "gap",
            "finding_type": "rubric_mismatch",
            "title": "Rubric criterion 'stakeholder analysis connection' not in instructions",
            "body": "The rubric awards 10 points for 'Stakeholder analysis connection' but the assignment instructions never mention stakeholders or ask students to connect their data analysis back to stakeholder needs identified in Week 3.",
            "evidence": "Rubric: 'Stakeholder analysis connection (10pts)' — Instructions mention only 'Analyze the data you collected' with no stakeholder reference.",
            "pass_number": 1,
            "linked_node": "assign-03",
        },
        {
            "assignment_id": "assign-06",
            "severity": "warn",
            "finding_type": "clarity",
            "title": "No specification for visualization tools or formats",
            "body": "Students are told to 'create at least 3 visualizations' but no guidance is given on acceptable tools (Excel, Python, hand-drawn), formats (PNG, embedded, printed), or what makes a visualization 'quality' per the rubric.",
            "evidence": "Instructions: 'Create at least 3 visualizations (charts, graphs, or tables)' — no tool or format specified.",
            "pass_number": 1,
            "linked_node": None,
        },
        {
            "assignment_id": "assign-09",
            "severity": "gap",
            "finding_type": "orphan",
            "title": "No prior instruction on giving peer feedback",
            "body": "Peer Review 1 (Week 9) asks students to 'provide constructive feedback' and use a 'peer review form' but the peer review guide page exists at Week 8 with no explicit link from this assignment. Students may not know it exists.",
            "evidence": "Instructions: 'Provide constructive feedback on their decision matrix' — no reference to the peer review guide or any training on feedback techniques.",
            "pass_number": 1,
            "linked_node": "page-peer-review-guide",
        },
        {
            "assignment_id": "assign-11",
            "severity": "gap",
            "finding_type": "assumption_gap",
            "title": "Iteration methodology assumed but never explicitly taught before this point",
            "body": "The assignment says 'Apply the iteration methodology' and the rubric grades on 'Iteration methodology applied (10pts)'. The iteration lecture is at Week 10 but there's no content between Weeks 8-10 that introduces iteration concepts. Students encounter the term for the first time in the assignment itself.",
            "evidence": "Rubric: 'Iteration methodology applied (10pts)' — first mention of iteration methodology in course content.",
            "pass_number": 2,
            "linked_node": "lecture-iteration",
        },
        {
            "assignment_id": "assign-11",
            "severity": "warn",
            "finding_type": "dependency_gap",
            "title": "Implicit dependency on Peer Review 1 feedback not stated",
            "body": "Instructions say 'Based on feedback from Peer Review 1' but Peer Review 1 (Week 9) reviews concept selection reports, not prototypes. The feedback from PR1 may not be directly applicable to prototype iteration.",
            "evidence": "Instructions: 'Based on feedback from Peer Review 1 and your own testing, iterate on your prototype.'",
            "pass_number": 2,
            "linked_node": "assign-09",
        },
        {
            "assignment_id": "assign-05",
            "severity": "warn",
            "finding_type": "format_mismatch",
            "title": "Data collection output format doesn't match Week 8 decision matrix input",
            "body": "Week 5 asks students to collect raw data and submit survey instruments. Week 8's decision matrix requires weighted criteria derived from data analysis. There's no explicit instruction on how to transform raw data into decision criteria.",
            "evidence": "Week 5: 'Submit your plan and any survey instruments' → Week 8: 'Weight criteria based on your requirements document'",
            "pass_number": 2,
            "linked_node": "assign-08",
        },
        {
            "assignment_id": "assign-10",
            "severity": "warn",
            "finding_type": "cascade_risk",
            "title": "Weak prototype v1 cascades to v2 iteration and final presentation",
            "body": "Prototype v1 (Week 10) feeds into v2 iteration (Week 11), Peer Review 2 (Week 12), and the final presentation demo (Week 14). If v1 is fundamentally flawed, all downstream deliverables are compromised. The rubric for v1 is light on functionality assessment (20pts out of 40).",
            "evidence": "Downstream chain: assign-10 → assign-11 → assign-12, assign-10 → assign-14",
            "pass_number": 3,
            "linked_node": "assign-14",
        },
        {
            "assignment_id": "assign-13",
            "severity": "info",
            "finding_type": "curriculum_gap",
            "title": "No technical writing instruction between Weeks 1-12",
            "body": "The final report draft (Week 13) is graded on 'Technical writing quality (15pts)' but no earlier content in the course addresses technical writing conventions, formatting, or citation practices. Students are expected to produce professional-quality writing without explicit instruction.",
            "evidence": "Rubric: 'Technical writing quality (15pts)' — no prior module covers technical writing.",
            "pass_number": 3,
            "linked_node": None,
        },
    ]

    for f in findings:
        fid = str(uuid.uuid4())[:8]
        node_hash = content_hash(
            next(a["instructions"] for a in assignments if a["id"] == f["assignment_id"]),
            next((a.get("rubric_text", "") for a in assignments if a["id"] == f["assignment_id"]), ""),
        )
        conn.execute(
            """INSERT INTO findings (id, assignment_id, audit_run_id, severity, finding_type,
               title, body, linked_node, evidence, pass_number, status, content_hash_at_creation, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)""",
            (fid, f["assignment_id"], run_id, f["severity"], f["finding_type"],
             f["title"], f["body"], f["linked_node"], f["evidence"], f["pass_number"],
             node_hash, now),
        )

    # Update finding counts on nodes
    conn.execute("""
        UPDATE nodes SET finding_count = (
            SELECT COUNT(*) FROM findings
            WHERE findings.assignment_id = nodes.id AND findings.status = 'active'
        )
    """)

    # =========================================================================
    # NODE LINKS
    # =========================================================================
    links = [
        ("assign-03", "page-resources", "page"),
        ("assign-09", "rubric-peer-review", "page"),
        ("assign-12", "rubric-peer-review", "page"),
        ("assign-15", "rubric-final-report", "page"),
        ("assign-13", "rubric-final-report", "page"),
    ]
    for src, tgt, ltype in links:
        conn.execute(
            "INSERT INTO node_links (source_id, target_id, link_type) VALUES (?, ?, ?)",
            (src, tgt, ltype),
        )

    # =========================================================================
    # INGEST LOG
    # =========================================================================
    for a in assignments:
        conn.execute(
            "INSERT INTO ingest_log (node_id, action, status, detail, created_at) VALUES (?, 'seed', 'success', 'Demo seed data', ?)",
            (a["id"], now),
        )

    conn.commit()
    conn.close()

    # Print summary
    conn = sqlite3.connect(str(DB_PATH))
    for table in ["nodes", "node_links", "edges", "findings", "audit_runs", "ingest_log"]:
        count = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        print(f"  {table}: {count} rows")
    conn.close()
    print("\nDemo data seeded successfully!")


if __name__ == "__main__":
    seed()
