from utils.page_refs import extract_page_refs
from services import indexing, retrieval
from test_indexing_retrieval import index_doc  # noqa: F401  (also installs the embedding stub)


def test_single_pages_and_abbreviations():
    assert extract_page_refs("Summarise page 10 in two sentences") == [10]
    assert extract_page_refs("what is on p. 7?") == [7]
    assert extract_page_refs("PAGE 3") == [3]


def test_ranges_lists_and_limits():
    assert extract_page_refs("compare pages 3-5") == [3, 4, 5]
    assert extract_page_refs("pages 5 to 3") == [3, 4, 5]
    assert extract_page_refs("pages 2, 4, 9") == [2, 4, 9]
    assert extract_page_refs("pages 1-200") == [1, 2, 3, 4, 5]  # capped


def test_only_pages_inside_the_document():
    assert extract_page_refs("page 40", page_count=12) == []
    assert extract_page_refs("pages 11-14", page_count=12) == [11, 12]


def test_numbers_that_are_not_pages():
    assert extract_page_refs("how many pages are there?") == []
    assert extract_page_refs("the 2024 season had 14 vessels") == []
    assert extract_page_refs("") == []
    assert extract_page_refs(None) == []


def test_pages_service_returns_whole_pages(tmp_path):
    pages = [{"page": n, "text": f"text of page {n}"} for n in (1, 2, 3)]
    index_doc(tmp_path, pages)
    out = retrieval.pages_service({"pdfId": "a" * 64, "storagePath": str(tmp_path), "pages": [2, 3, 9]})
    assert sorted(c["page"] for c in out["chunks"]) == [2, 3]
    assert retrieval.pages_service({"pdfId": "b" * 64, "storagePath": str(tmp_path), "pages": [1]}) == {"chunks": []}
