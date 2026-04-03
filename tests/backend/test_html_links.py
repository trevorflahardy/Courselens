"""Tests for HTML link extraction and classification."""

from backend.services.html_links import extract_links


def test_extracts_canvas_file_data_api_endpoint() -> None:
    html = '<div data-api-endpoint="/api/v1/courses/2018858/files/555"></div>'

    links = extract_links(html)

    assert len(links) == 1
    assert links[0].url == "/api/v1/courses/2018858/files/555"
    assert links[0].link_class == "file"


def test_classifies_assignment_href_links() -> None:
    html = '<a href="/courses/2018858/assignments/42">Project 1</a>'

    links = extract_links(html)

    assert len(links) == 1
    assert links[0].link_class == "assignment"
    assert links[0].text == "Project 1"


def test_classifies_file_page_and_external_links() -> None:
    html = """
    <a href=\"/courses/2018858/files/999/download?download_frd=1\">Starter Code</a>
    <a href=\"/courses/2018858/pages/week-2-overview\">Week 2 Overview</a>
    <a href=\"https://example.org/spec\">External Spec</a>
    """

    links = extract_links(html)

    assert [link.link_class for link in links] == ["file", "page", "external"]
