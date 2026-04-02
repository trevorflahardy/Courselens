# Course Audit System — Purpose & Vision

## The Problem

Teaching a course is hard. Designing one is harder.

Most course design happens incrementally — an instructor writes an assignment, links it to a rubric, adds a handout, moves on to the next week. Over a full semester of 15+ assignments, dozens of pages, lecture materials, and rubrics, something almost always breaks down:

- An assignment assumes students know how to do something that was never taught
- A rubric grades on "quality" without defining what quality means in context
- Week 5 asks students to submit a dataset in a specific format, but Week 8's analysis assignment expects a completely different format
- A peer review assignment appears with no prior instruction on how to give feedback
- A rubric was updated mid-semester but the assignment instructions weren't — now they contradict each other
- There's a three-week gap in the curriculum where a critical skill should have been introduced but wasn't
- Students keep asking the same questions in office hours because one sentence in the Week 3 instructions is genuinely ambiguous

None of these problems are malicious. They're the natural result of a complex artifact — a full course — being built and maintained by humans over time, often under pressure, without a systematic way to audit the whole thing at once.

The instructor sees each assignment in isolation. Students experience them in sequence. **No one has a holistic view of the entire course at once — until now.**

---

## What This System Does

This is an AI-powered course audit system built specifically for the EGN 3000L Foundations of Engineering Lab course at USF.

Its core job: **give an AI a complete, structured view of the entire course — every assignment, page, rubric, lecture, handout, and announcement — and let it reason across all of it simultaneously to find problems a human reviewer would miss.**

The system does this in three layers:

### Layer 1 — Ingest Everything

The system pulls in the entire course from Canvas:

- All assignments and their full instruction text
- Every rubric with its criteria and point weights
- Every course page and how it links to assignments
- All lecture materials and their learning objectives
- Every file students download (PDFs, templates, handouts)
- Announcements — which often contain patches to broken instructions, and are gold for finding where things went wrong

Each piece of content becomes a structured node in a local database. Every node knows what it links to, what module it lives in, what week it belongs to, and what files it references.

### Layer 2 — Build the Dependency Graph

Once everything is ingested, the AI derives a **dependency graph** of the entire course.

This graph answers the question: _what depends on what?_

Some dependencies are explicit — an assignment literally says "using the data you collected in Lab 3." Others are implicit — Week 8's report assumes you know how to make a graph in Excel, but nothing in the course ever teaches this. The AI finds both kinds.

Edges in the graph come in four types:

- **Explicit** — the assignment directly references a prior one
- **Inferred** — semantic similarity + reasoning suggests a dependency exists even if unstated
- **Artifact** — one assignment produces a file that a later one consumes as input
- **Gap** — there _should_ be a dependency (or a bridging lesson) but there isn't one

The result is a living, visual map of the entire course that you can click through — zooming into individual assignments, tracing how a student's work builds across the semester, and immediately seeing where the chain breaks.

### Layer 3 — Run Deep AI Audits

For each assignment, the AI runs three focused reasoning passes:

**Pass 1 — Standalone clarity**

The AI reads the assignment in isolation and asks: _could a student misunderstand this?_ It looks for ambiguous sentences, undefined terms, rubric criteria that don't appear in the instructions, submission formats that aren't specified, and skills that are assumed but never introduced. It quotes the exact text that triggered each finding.

**Pass 2 — Backward dependency check**

Using vector similarity search across all prior-week content, the AI asks: _does this assignment assume knowledge or artifacts from something earlier?_ If yes, is that dependency stated? If the dependency exists but is implicit, it's flagged. If the format of what's expected doesn't match what prior assignments actually produce, that's a format mismatch — a particularly common source of student confusion.

**Pass 3 — Forward impact check**

By traversing the dependency graph downstream, the AI asks: _if a student struggles with this assignment, which future assignments break?_ This surfaces cascade risks — places where one weak assignment creates compounding problems three weeks later. It also catches curriculum gaps: periods between weeks where a critical skill should have been introduced but the course simply moves on without it.

Every finding is specific, evidenced, and linked to related nodes. Not "this assignment could be clearer" but "the rubric criterion 'stakeholder analysis' (15 points) does not appear anywhere in the assignment instructions, meaning students are graded on something they were never asked to do."

---

## What the Dashboard Shows

### Assignment List

A modern, filterable view of every course item — assignments, pages, rubrics, lectures — organized by week, exactly like Canvas but with a layer of audit intelligence on top. Each item shows its finding counts at a glance: how many gaps, warnings, and informational notes the AI found. Clicking any item opens a detail panel with three tabs: Recommendations (the AI's findings), Links (upstream and downstream dependencies), and Rubric (the rubric text cross-referenced against instructions).

### Dependency Graph

A force-directed interactive graph of the entire course. Nodes are color-coded by type (assignment, page, rubric, lecture). Rings around nodes indicate their audit status (clean, warning, gap, orphan). Edges are solid for explicit dependencies, dashed for inferred ones, and red for detected gaps. Clicking a node opens its detail. Clicking an edge shows why the AI drew that connection and how confident it is. Filter buttons let you focus only on gaps, only on orphaned content, or only on inferred edges that haven't been verified.

### Live Audit Stream

When you trigger an audit from the dashboard, you watch it happen in real time. Findings appear as cards, one by one, as the AI reasons through each pass. You don't wait for a report — you see the AI's thinking materialize on screen. Each finding card shows severity, type, a plain-English explanation, the quoted text that triggered it, and a link to any related assignment.

---

## Why AI — and Why This Kind of AI

A checklist tool could catch some of this. A linter could catch formatting issues. A human peer reviewer could catch obvious problems.

None of these have a **holistic view**.

The AI in this system reads every assignment in the context of every other assignment. When it audits the Week 11 prototype submission, it already knows what Week 1 introduced, what Week 5 produced, what Week 8 expected, and what Week 13 will need. It can reason across that entire arc simultaneously — something a human reviewer doing a spot check simply cannot do.

The system uses Claude Code running on the Max plan as its AI engine. This means:

- No per-token API costs — the full audit pipeline runs within the existing subscription
- Native tool use — the AI calls structured tools (read a node, search for similar content, traverse the graph, emit a finding) rather than generating free-form text that has to be parsed
- Findings stream live — the AI emits each finding the moment it decides to, rather than batching everything at the end
- Multi-agent parallelism — multiple assignments can be audited simultaneously, with the AI spawning focused subagents for different passes

The AI is not just pattern-matching. It is reasoning. It reads a rubric criterion, checks whether that criterion appears in the instructions, checks whether anything in the prior weeks taught the skill being graded, considers what a student would actually do when they read this page, and decides whether that constitutes a problem worth flagging. That kind of pedagogical reasoning — applied consistently to every single assignment in a course — is what makes this system genuinely useful rather than just a formatting checker.

---

## What Gets Caught

To make this concrete, here are the categories of problems the system is designed to surface:

| Finding type          | Example                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------- |
| Clarity issue         | "Submit your analysis" — no format, length, or tool specified                                 |
| Rubric mismatch       | Rubric grades "stakeholder analysis" (15pts); instructions never mention stakeholders         |
| Assumption gap        | Assignment assumes students can write in APA format; never introduced in the course           |
| Format mismatch       | Week 5 produces a bullet list; Week 8 expects a formatted design rationale document           |
| Orphaned content      | Peer Review 1 has no upstream assignment teaching how to give peer feedback                   |
| Curriculum gap        | Nothing between Weeks 8–11 introduces iteration methodology; Week 11 requires it              |
| Cascade risk          | A weak Week 5 data collection format breaks the Week 8 analysis report and Week 13 final      |
| Rubric drift          | Rubric was updated; three criteria no longer match the assignment text                        |
| Implicit prerequisite | Assignment assumes prior design vocabulary introduced in a lecture that half the class missed |
| Broken file link      | Assignment references a template file that no longer exists in the course                     |

---

## The End State

A course designer or instructor opens the dashboard. They see at a glance that the course has 4 gap-level issues, 11 warnings, and 8 clean assignments. They click into the graph and immediately see that Prototype v2 is a red node with no clean path back to any lecture content. They click it, read the AI's finding, follow the link to the Redesign Brief (the upstream assignment), read that finding too, and understand in 90 seconds exactly what's broken and why.

They fix the instructions. They re-run the audit on just that assignment. The finding disappears. The graph updates. The node goes green.

That feedback loop — from course content to structured AI reasoning to specific actionable finding to fix to re-audit — is what this system is built for.

Not a one-time report. A living audit layer on top of a living course.
