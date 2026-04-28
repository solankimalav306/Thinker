def chunk_text(text):
    words = text.split()
    total_words = len(words)

    # decide number of chunks based on size
    if total_words < 200:
        num_chunks = 1
    elif total_words < 600:
        num_chunks = 2
    else:
        num_chunks = 3

    chunk_size = total_words // num_chunks
    chunks = []

    for i in range(num_chunks):
        start = i * chunk_size
        end = (i + 1) * chunk_size if i != num_chunks - 1 else total_words

        chunk = " ".join(words[start:end])
        chunks.append(chunk)

    return chunks