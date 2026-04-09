"""
Survival Companion - RAG Ingestor
==================================
This utility processes Australian First Aid, Bushcraft, and Topography PDFs,
converting them into a local vector database for the LLM to query offline.

Requires:
    pip install chromadb sentence-transformers pypdf langchain
"""

import os
import glob
from pathlib import Path

# Try to import required ML libraries, fail gracefully if not installed
try:
    from langchain.document_loaders import PyPDFLoader
    from langchain.text_splitter import RecursiveCharacterTextSplitter
    from langchain.embeddings import SentenceTransformerEmbeddings
    from langchain.vectorstores import Chroma
    LIBRARIES_AVAILABLE = True
except ImportError:
    LIBRARIES_AVAILABLE = False


DATA_DIR = Path("data/manuals")
DB_DIR = Path("data/vectorstore")
EMBEDDING_MODEL = "all-MiniLM-L6-v2"  # Fast, lightweight model for Raspberry Pi


def ingest_manuals():
    """Ingest all PDFs in the Data Directory into a local ChromaDB."""
    if not LIBRARIES_AVAILABLE:
        print("Error: RAG dependencies not installed.")
        print("Run: pip install chromadb sentence-transformers pypdf langchain")
        return

    print("="*60)
    print("Survival Companion - Initializing Offline RAG Pipeline")
    print("="*60)

    # Ensure directories exist
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    DB_DIR.mkdir(parents=True, exist_ok=True)

    pdf_files = glob.glob(str(DATA_DIR / "*.pdf"))
    if not pdf_files:
        print(f"\n[!] No PDFs found in {DATA_DIR}.")
        print("Please place Australian Survival and First Aid manuals here.")
        return

    print(f"Found {len(pdf_files)} PDF manuals to ingest...")
    
    documents = []
    for pdf_path in pdf_files:
        print(f" -> Loading: {os.path.basename(pdf_path)}")
        loader = PyPDFLoader(pdf_path)
        documents.extend(loader.load())

    print(f"Total pages loaded: {len(documents)}")
    print("Chunking text for optimal retrieval...")

    # Split text into chunks for the LLM
    text_splitter = RecursiveCharacterTextSplitter(
        chunk_size=1000,
        chunk_overlap=200,
        length_function=len
    )
    chunks = text_splitter.split_documents(documents)
    print(f"Created {len(chunks)} text chunks.")

    print(f"Initializing Embedding Model ({EMBEDDING_MODEL})...")
    # This downloads the model the first time (needs internet!), then runs offline
    embeddings = SentenceTransformerEmbeddings(model_name=EMBEDDING_MODEL)

    print("Generating embeddings and building ChromaDB vector store...")
    print(f"This may take a while on a Raspberry Pi. Saving to: {DB_DIR}")
    
    # Create the vector store
    db = Chroma.from_documents(
        documents=chunks,
        embedding=embeddings,
        persist_directory=str(DB_DIR)
    )
    
    db.persist()
    print("\n[SUCCESS] RAG Database successfully built and saved!")
    print("The system will now ground all medical/survival answers using these absolute truths.")


if __name__ == "__main__":
    ingest_manuals()
