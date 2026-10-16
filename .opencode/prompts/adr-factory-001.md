Execute the ADR-Factory-001 specification-fix task exactly as defined in your system instructions.

Begin by copying the V1.1 baseline (`Source/SaaS_AI_Foundation_with_Template_Factory_V1_1/Template_Factory_V1_1/{schemas,examples,scripts,tests}`) into `factory-v1.2/`, then apply every required fix, write the ADR and the supporting documents, and run the full proof suite.

Do not stop until:
1. All pre-existing tests pass (adapted to corrected schemas) and their negatives still reject.
2. New positive tests prove the previously-rejected doc-conformant data now validates.
3. New negative tests prove each named defect is truly closed.
4. `python3 scripts/validate_examples.py` and `python3 -m unittest discover -s tests -v` both pass from `factory-v1.2/`, with real output pasted into `TEST_REPORT.md`.
5. The CF closure table honestly marks each CF CLOSED/PARTIAL/OPEN with the test that exercises it.

Never modify `Source/**`. Never weaken a hard gate. If a fix would weaken one, leave the CF OPEN and explain.
