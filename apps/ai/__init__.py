"""
AI service package
This package contains all modules required to run the offline AI
pipeline for processing audio data. The pipeline orchestrates a
series of stages including normalisation, segmentation, diarisation,
speech‑to‑text transcription, categorisation via a lightweight
language model and final refinement. The package intentionally
avoids touching any web or API related functionality – those live
under apps/web and apps/api respectively.

To run the pipeline from the command line see `main.py`.
"""
