from utils.chunking import VERSION, chunk_pages, clean_pages, embed_text


def words(n, stem="w"):
    return " ".join(f"{stem}{i}" for i in range(n)) + "."


def test_running_titles_and_page_numbers_are_dropped():
    topics = ["rivers and lakes", "mountain weather", "forest fires", "ocean currents", "desert soils", "glacier melt"]
    pages = [{"page": i + 1, "text": "Annual Report 2024\n" + f"A long paragraph about {t} and how they change over the seasons.\n{i + 1}"} for i, t in enumerate(topics)]
    kept = [l for _, lines in clean_pages(pages) for l in lines]
    assert not any("Annual Report" in l for l in kept)
    assert len(kept) == 6 and all("long paragraph" in l for l in kept)


def test_a_document_that_is_all_repeats_is_kept():
    pages = [{"page": i, "text": "same words"} for i in range(1, 7)]
    assert sum(len(lines) for _, lines in clean_pages(pages)) == 6


def test_hyphenated_line_ends_are_joined_and_abbreviations_do_not_split_sentences():
    chunks = chunk_pages([{"page": 1, "text": "We study retriev-\nal of passages. Smith et al. showed it works. See Fig. 3 for details."}])
    text = chunks[0]["text"]
    assert "retrieval of passages" in text
    assert "Smith et al. showed" in text and "Fig. 3 for" in text


def test_a_passage_can_cross_a_page_break_and_remembers_both_pages():
    chunks = chunk_pages([{"page": 4, "text": "The first half of an idea"}, {"page": 5, "text": "and its second half."}])
    assert len(chunks) == 1 and chunks[0]["pages"] == [4, 5] and chunks[0]["page"] == 4


def test_passages_are_about_the_target_size_and_overlap():
    text = " ".join(f"Sentence number {i} says something useful about topic {i}." for i in range(120))
    chunks = chunk_pages([{"page": 1, "text": text}])
    sizes = [len(c["text"].split()) for c in chunks]
    assert len(chunks) > 3 and max(sizes) < 200
    # the end of one passage reappears at the start of the next
    assert chunks[0]["text"].split(". ")[-2] in chunks[1]["text"]
    assert len({c["chunk_id"] for c in chunks}) == len(chunks) and all(c["v"] == VERSION for c in chunks)


def test_a_new_section_starts_a_new_passage_and_keeps_its_heading():
    pages = [{"page": 1, "text": "1 Introduction\n" + words(60, "intro") + "\n2 Methods\n" + words(60, "method")}]
    chunks = chunk_pages(pages)
    assert [c["heading"] for c in chunks] == ["1 Introduction", "2 Methods"]
    assert "intro0" in chunks[0]["text"] and "method0" not in chunks[0]["text"]
    assert embed_text(chunks[1]).startswith("2 Methods\n")


def test_text_without_line_breaks_still_works():
    chunks = chunk_pages([{"page": 1, "text": " ".join(f"Fact {i} is true." for i in range(100))}])
    assert chunks and all(c["text"].strip() for c in chunks)


def test_a_run_on_line_is_cut_down_to_size():
    chunks = chunk_pages([{"page": 1, "text": " ".join(f"cell{i}" for i in range(1000))}])
    assert max(len(c["text"].split()) for c in chunks) < 400


def test_other_scripts_are_kept_whole():
    chunks = chunk_pages([{"page": 1, "text": "नमस्ते दुनिया। यह एक परीक्षण है।"}])
    assert "नमस्ते दुनिया" in chunks[0]["text"]


def test_a_passage_across_a_page_break_can_be_shown_by_page():
    from utils.chunking import split_by_page
    chunks = chunk_pages([{"page": 4, "text": "The first half of an idea."}, {"page": 5, "text": "and its second half."}])
    assert split_by_page(chunks[0]) == [(4, "The first half of an idea."), (5, "and its second half.")]
    assert split_by_page({"page": 2, "text": "single"}) == [(2, "single")]


def test_a_passage_may_be_cited_by_any_page_it_touches():
    from utils.sources import sources_from_hits
    assert sources_from_hits([{"page": 4, "pages": [4, 5], "doc": "A"}]) == [{"doc": "A", "page": 4}, {"doc": "A", "page": 5}]
    assert sources_from_hits([{"page": 7}]) == [{"doc": "", "page": 7}]
